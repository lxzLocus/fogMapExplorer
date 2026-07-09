import L from 'leaflet'
import { LANDMARKS, BOUNDS, CELL, DEFAULT_POS, blipSvg } from './landmarks.js'
import { loadLocal, saveLocal } from './storage.js'
import { fetchRemoteState, pushRemoteState } from './api.js'
import { fetchPois } from './pois.js'

const POI_DISCOVER_RANGE = 120 // meters — walk this close to "collect" a spot
const POI_FETCH_EVERY = 700 // meters moved before fetching more nearby spots

const DEFAULTS = {
  fogStyle: 'blur', // fixed
  revealRadius: 500, // meters, fixed
  accent: '#7CFC9B', // fixed (green)
}

/**
 * Owns the Leaflet map, the fog canvas mask and all exploration state.
 * Movement comes from the device's Geolocation API (watchPosition).
 *
 * React talks to it through `callbacks`:
 *   onStats(stats), onDiscoveries(list), onToast(name), onStatus(text)
 */
export class MapController {
  constructor(container, settings, callbacks, opts = {}) {
    this.container = container
    this.settings = { ...DEFAULTS, ...settings }
    this.cb = callbacks || {}
    this.sim = !!opts.sim // dev GPS emulation (joystick / click-to-teleport)

    this.pos = { ...DEFAULT_POS }
    this.visited = [] // {lat,lng}[]
    this.cells = new Set() // "row:col" grid keys
    this.discoveries = [] // {name,time,dist,t}[]
    this.totalDist = 0

    this.heading = Math.random() * Math.PI * 2
    this.follow = true // auto-pan the map to the player
    this.geoActive = false
    this.fogDirty = false
    this.lmMarkers = {}
    this.destroyed = false
  }

  // ---- settings accessors ----
  radius() { return this.settings.revealRadius }
  accent() { return this.settings.accent }
  fogStyleV() { return this.settings.fogStyle }

  // ---- geo helpers ----
  mPerLng(lat) { return 111320 * Math.cos((lat * Math.PI) / 180) }
  distM(a, b) {
    const dy = (b.lat - a.lat) * 111320
    const dx = (b.lng - a.lng) * this.mPerLng(a.lat)
    return Math.sqrt(dx * dx + dy * dy)
  }

  totalCells() {
    const b = BOUNDS
    const ny = Math.ceil(((b.latMax - b.latMin) * 111320) / CELL)
    const nx = Math.ceil(
      ((b.lngMax - b.lngMin) * this.mPerLng((b.latMin + b.latMax) / 2)) / CELL,
    )
    return nx * ny
  }

  addCells(p) {
    const b = BOUNDS
    const r = this.radius()
    const dLat = r / 111320
    const dLng = r / this.mPerLng(p.lat)
    const stepLat = CELL / 111320
    const stepLng = CELL / this.mPerLng(p.lat)
    // Global 250m grid (indexed from the BOUNDS origin, but not restricted to
    // it) so exploration accrues anywhere — Tokyo, Kansai, or the user's real
    // location.
    for (let la = p.lat - dLat; la <= p.lat + dLat; la += stepLat) {
      for (let lo = p.lng - dLng; lo <= p.lng + dLng; lo += stepLng) {
        if (this.distM(p, { lat: la, lng: lo }) > r) continue
        const key =
          Math.round(((la - b.latMin) * 111320) / CELL) +
          ':' +
          Math.round(((lo - b.lngMin) * this.mPerLng(la)) / CELL)
        this.cells.add(key)
      }
    }
  }

  // ---- lifecycle ----
  async init() {
    const local = loadLocal()
    this.pos = local.pos || { ...DEFAULT_POS }
    this.visited = local.visited || [{ ...this.pos }]
    this.totalDist = local.totalDist || 0
    this.discoveries = local.discoveries || []
    this.cells = new Set(local.cells || [])
    if (!local.cells) this.visited.forEach((p) => this.addCells(p))

    // Discoverable spots: the curated landmarks (always available) plus real
    // OSM POIs fetched around the player as they move. Keyed by name.
    this.stops = new Map()
    for (const lm of LANDMARKS) this.stops.set(lm.name, lm)
    this.discoveredNames = new Set(this.discoveries.map((d) => d.name))
    this._lastFetch = null
    this._fetchingPois = false

    const map = L.map(this.container, {
      center: [this.pos.lat, this.pos.lng],
      zoom: 15,
      minZoom: 12,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: true,
      maxBoundsViscosity: 1.0,
    })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(map)
    // The CARTO dark tiles are very dark; brighten them so revealed areas read
    // as clearly "lit up" against the near-opaque fog.
    this.map = map
    // Brighten the very dark CARTO tiles so revealed areas are clearly visible.
    // The frosted fog dims + blurs these underneath, so fog still reads darker.
    // Brighten the very dark CARTO tiles so revealed areas are clear and sharp.
    // (No blur — the fog is a dark veil; revealed areas stay crisp.)
    const tilePane = map.getPane('tilePane')
    if (tilePane) tilePane.style.filter = 'brightness(2) contrast(1.05)'
    // Constrain panning to a generous box around wherever the player is (not a
    // fixed Tokyo box), so the map works at the user's real location too.
    this._applyBounds(this.pos)

    // Fog lives in its own Leaflet pane as a <canvas>. Because it's a child of
    // the map pane, Leaflet's pan/zoom transforms apply to it automatically, so
    // the fog (and its reveal holes) always stays aligned with the map — during
    // panning AND pinch-zoom. We only redraw when the view changes.
    map.createPane('fog')
    const fp = map.getPane('fog')
    fp.style.zIndex = 400
    fp.style.pointerEvents = 'none'
    // The fog is a <canvas> in this pane, so Leaflet's pan/zoom transforms move
    // it with the map (perfect tracking — no lag). Drawn directly (no
    // backdrop-filter, which cannot follow a pan without lagging).
    const cv = document.createElement('canvas')
    // Leaflet's zoom-animated class gives transform-origin:0 0 (so our zoom
    // scaling is anchored correctly) and the same smooth transition the tiles
    // use during a zoom — so the fog scales in lock-step with the map.
    cv.className = 'leaflet-zoom-animated'
    cv.style.position = 'absolute'
    cv.style.left = '0'
    cv.style.top = '0'
    fp.appendChild(cv)
    this.fogCanvasEl = cv
    this.fogCtx = cv.getContext('2d')

    this.buildMarker()

    map.on('dragstart', () => { this.follow = false })
    // Fog lives in the map pane: Leaflet's pan transform moves it with the map,
    // so we only redraw when the view settles (not per frame — that was the
    // scroll lag). Zoom is different: panes don't auto-scale during a zoom
    // animation, so we scale the fog ourselves via 'zoomanim' (like Leaflet's
    // own image/vector layers) to avoid the "zoom updates late" lag.
    map.on('zoomanim', (e) => this._onFogZoomAnim(e))
    map.on('zoomend', () => this.requestFog())
    map.on('moveend viewreset resize', () => this.requestFog())
    // Reveal/collect spot markers for whatever is now in view.
    map.on('moveend', () => this.updateBlips())
    // iOS PWA / rotation: the viewport can settle after launch, leaving Leaflet
    // sized smaller than its container (a gap at the bottom). Re-sync a couple
    // of times shortly after mount.
    this._sizeTimers = [
      setTimeout(() => this.onViewportChange(), 200),
      setTimeout(() => this.onViewportChange(), 900),
    ]

    this.applyFogStyle()
    this.updateBlips()
    this.refreshStats()
    this.emitDiscoveries()
    this.requestFog()

    // Merge whatever the backend has for this device (cross-device union).
    const remote = await fetchRemoteState()
    if (remote && !this.destroyed) this.mergeRemote(remote)

    // Seed nearby real-world spots and start movement (real GPS, or dev sim).
    this.maybeFetchPois()
    if (this.sim) this._startSim()
    else this.startGeo()
  }

  buildMarker() {
    if (this.marker) { this.map.removeLayer(this.marker); this.marker = null }
    const a = this.accent()
    const icon = L.divIcon({
      className: '',
      iconSize: [46, 46],
      iconAnchor: [23, 23],
      html:
        '<div style="position:relative;width:46px;height:46px;">' +
        '<div style="position:absolute;inset:0;border-radius:50%;border:2px solid ' + a + ';animation:fx-pulse 2s ease-out infinite;"></div>' +
        '<div data-hd style="position:absolute;left:50%;top:50%;width:0;height:0;transform:translate(-50%,-58%) rotate(' + (this.heading * 180 / Math.PI) + 'deg);border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:15px solid ' + a + ';filter:drop-shadow(0 0 6px ' + a + ');"></div>' +
        '</div>',
    })
    this.marker = L.marker([this.pos.lat, this.pos.lng], { icon, zIndexOffset: 1000 }).addTo(this.map)
    this.hdEl = this.marker.getElement().querySelector('[data-hd]')
  }

  destroy() {
    this.destroyed = true
    clearTimeout(this.saveT)
    clearTimeout(this.syncT)
    clearTimeout(this.toastT)
    clearInterval(this._simTick)
    ;(this._sizeTimers || []).forEach(clearTimeout)
    if (this.geoWatch != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.geoWatch)
    }
    if (this.map) { this.map.remove(); this.map = null }
  }

  // ---- position ingestion (from GPS) ----
  applyPosition(newPos, heading) {
    if (!this.map) return
    const moved = this.distM(this.pos, newPos)
    // Ignore GPS teleports/first-fix jumps when totalling distance.
    if (moved > 0.5 && moved < 150) this.totalDist += moved

    this.pos = newPos
    // Keep the allowed pan area centred on the player as they travel.
    if (!this._boundsCenter || this.distM(this._boundsCenter, this.pos) > 20000) {
      this._applyBounds(this.pos)
    }
    if (heading != null && !Number.isNaN(heading)) this.heading = heading
    this.marker.setLatLng([newPos.lat, newPos.lng])
    if (this.hdEl && heading != null) {
      this.hdEl.style.transform =
        'translate(-50%,-58%) rotate(' + (heading * 180) / Math.PI + 'deg)'
    }
    if (this.follow) this.map.panTo([newPos.lat, newPos.lng], { animate: false })

    // Collect any spots we're now next to, and top up spots as we move.
    this.checkStops()
    this.maybeFetchPois()

    const last = this.visited[this.visited.length - 1]
    if (!last || this.distM(last, this.pos) > Math.max(80, this.radius() * 0.12)) {
      this.visited.push({ ...this.pos })
      this.addCells(this.pos)
      this.updateBlips()
      this.refreshStats()
      this.saveDebounced()
      this.syncDebounced()
    }
    this.requestFog()
  }

  headingFromMove(newPos) {
    const dLat = (newPos.lat - this.pos.lat) * 111320
    const dLng = (newPos.lng - this.pos.lng) * this.mPerLng(this.pos.lat)
    if (Math.abs(dLat) < 0.5 && Math.abs(dLng) < 0.5) return null
    return Math.atan2(dLng, dLat)
  }

  // ---- real GPS ----
  startGeo() {
    if (!('geolocation' in navigator)) {
      this.emit('onStatus', '位置情報が利用できません')
      return
    }
    this.emit('onStatus', 'GPS取得中…')
    this.geoWatch = navigator.geolocation.watchPosition(
      (p) => {
        this.geoActive = true
        const { latitude, longitude, heading } = p.coords
        const newPos = { lat: latitude, lng: longitude }
        const hd =
          heading != null && !Number.isNaN(heading)
            ? (heading * Math.PI) / 180
            : this.headingFromMove(newPos)
        this.emit('onStatus', 'GPS追跡中')
        this.applyPosition(newPos, hd)
      },
      (err) => {
        this.geoActive = false
        this.emit('onStatus', this.geoErrText(err))
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    )
  }

  geoErrText(err) {
    switch (err && err.code) {
      case 1: return '位置情報が拒否されています（許可してください）'
      case 2: return '位置を取得できません'
      case 3: return 'GPSタイムアウト'
      default: return 'GPSエラー'
    }
  }

  recenter() {
    this.follow = true
    if (this.map && this.pos) this.map.setView([this.pos.lat, this.pos.lng], 15)
  }

  // Constrain panning to a generous box around the player so you can explore
  // locally but not wander off into empty map. Re-centred as the player moves.
  _applyBounds(pos) {
    if (!this.map || !pos) return
    const d = 0.5 // ~55km half-box
    this._boundsCenter = { ...pos }
    this.map.setMaxBounds([
      [pos.lat - d, pos.lng - d],
      [pos.lat + d, pos.lng + d],
    ])
  }

  // ---- dev GPS emulation ----
  _startSim() {
    this.emit('onStatus', 'SIM — スティックで移動 / 地図クリック・都市で瞬間移動')
    this.map.on('click', (e) => this.simTeleport(e.latlng.lat, e.latlng.lng))
    clearInterval(this._simTick)
    this._simTick = setInterval(() => {
      if (this._simVec) this.simStep(this._simVec.heading, this._simVec.speed)
    }, 100)
  }
  // heading: radians from north, clockwise. speed: m/s (0 = stop).
  setSimVector(heading, speed) {
    this._simVec = speed > 0 ? { heading, speed } : null
  }
  simStep(heading, speed) {
    if (!this.map) return
    const dist = speed * 0.1 // per 100ms tick
    const nLat = this.pos.lat + (Math.cos(heading) * dist) / 111320
    const nLng = this.pos.lng + (Math.sin(heading) * dist) / this.mPerLng(this.pos.lat)
    this.applyPosition({ lat: nLat, lng: nLng }, heading)
  }
  simTeleport(lat, lng) {
    if (!this.map) return
    this.pos = { lat, lng }
    this._applyBounds(this.pos)
    this.follow = true
    this.map.setView([lat, lng], Math.max(this.map.getZoom(), 15))
    this.marker.setLatLng([lat, lng])
    this.visited.push({ lat, lng })
    this.addCells(this.pos)
    this._lastFetch = null // force a fresh POI fetch around the new area
    this.maybeFetchPois()
    this.checkStops()
    this.updateBlips()
    this.refreshStats()
    this.requestFog()
    this.saveDebounced()
    this.syncDebounced()
  }

  // ---- spot discovery (PokéStop-style) ----
  isDiscovered(name) {
    return this.discoveredNames.has(name)
  }

  // Fetch more real-world spots once the player has moved far enough.
  async maybeFetchPois() {
    if (this._fetchingPois || !this.pos) return
    if (this._lastFetch && this.distM(this._lastFetch, this.pos) < POI_FETCH_EVERY) return
    this._lastFetch = { ...this.pos }
    this._fetchingPois = true
    try {
      const pois = await fetchPois(this.pos.lat, this.pos.lng, 1500)
      let added = 0
      for (const p of pois) {
        if (!this.stops.has(p.name)) {
          this.stops.set(p.name, p)
          added++
        }
      }
      if (added && !this.destroyed) {
        this.checkStops()
        this.updateBlips()
      }
    } catch {
      /* offline / rate-limited — keep the landmarks */
    }
    this._fetchingPois = false
  }

  // Discover (collect) any known spot the player is standing next to.
  checkStops() {
    let found = false
    for (const s of this.stops.values()) {
      if (this.isDiscovered(s.name)) continue
      if (this.distM(this.pos, s) < POI_DISCOVER_RANGE) {
        const now = new Date()
        this.discoveries = [
          ...this.discoveries,
          {
            name: s.name,
            kind: s.kind,
            time: now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0'),
            dist: (this.totalDist / 1000).toFixed(1) + ' km 地点',
            t: now.getTime(),
          },
        ]
        this.discoveredNames.add(s.name)
        this.emit('onToast', s.name)
        found = true
      }
    }
    if (found) {
      this.emitDiscoveries()
      this.refreshStats()
      this.saveDebounced()
      this.syncDebounced()
    }
  }

  blipIcon(lm, discovered) {
    if (discovered) {
      return L.divIcon({
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        html:
          '<svg width="24" height="24" viewBox="0 0 22 22" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.9));overflow:visible;">' +
          blipSvg(lm.kind, lm.hue) +
          '</svg>',
      })
    }
    // Undiscovered = a small static dot in the spot's colour (no animation, so
    // many can be shown cheaply). It turns into the full icon once collected.
    const c = lm.hue || '#9fb2c8'
    return L.divIcon({
      className: '',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      html:
        '<div style="width:11px;height:11px;border-radius:50%;background:' + c + ';opacity:.8;' +
        'border:1.5px solid #0a0d12;box-shadow:0 1px 2px rgba(0,0,0,.85);"></div>',
    })
  }

  updateBlips() {
    if (!this.map) return
    // Only render markers for spots in (or near) the current view; discovered
    // spots always show, undiscovered ones only when near the player.
    const bounds = this.map.getBounds().pad(0.15)
    const discovered = []
    const hints = []
    for (const s of this.stops.values()) {
      if (!bounds.contains([s.lat, s.lng])) continue
      if (this.isDiscovered(s.name)) discovered.push(s)
      else hints.push(s) // any undiscovered spot in view shows as a dot
    }
    // Cap the undiscovered dots to the nearest 60 (bounds marker count in dense
    // areas); discovered spots always show.
    if (this.pos) hints.sort((a, b) => this.distM(this.pos, a) - this.distM(this.pos, b))
    const want = new Map() // name -> 'found' | 'hint'
    for (const s of discovered) want.set(s.name, 'found')
    for (const s of hints.slice(0, 60)) want.set(s.name, 'hint')
    // remove markers no longer wanted (or whose state changed)
    for (const name in this.lmMarkers) {
      if (want.get(name) !== this.lmMarkers[name].kind) {
        this.map.removeLayer(this.lmMarkers[name].marker)
        delete this.lmMarkers[name]
      }
    }
    // add missing markers
    for (const [name, state] of want) {
      if (this.lmMarkers[name]) continue
      const s = this.stops.get(name)
      const marker = L.marker([s.lat, s.lng], {
        icon: this.blipIcon(s, state === 'found'),
        zIndexOffset: 500,
      }).addTo(this.map)
      marker.bindPopup(
        '<div style="font-family:\'Noto Sans JP\',sans-serif;font-weight:700;font-size:13px;">' +
          (state === 'found' ? s.name : '未発見のスポット') +
          '</div>',
        { closeButton: false, offset: [0, -26] },
      )
      this.lmMarkers[name] = { marker, kind: state }
    }
  }

  // ---- stats ----
  refreshStats() {
    const total = this.totalCells()
    const pct = Math.min(100, (this.cells.size / total) * 100)
    const areaKm2 = (this.cells.size * CELL * CELL) / 1e6
    const xp = this.cells.size
    const level = Math.floor(Math.sqrt(xp / 30)) + 1
    const cur = 30 * (level - 1) * (level - 1)
    const next = 30 * level * level
    this.emit('onStats', {
      exploredPct: pct.toFixed(1),
      areaKm: areaKm2.toFixed(1),
      distKm: (this.totalDist / 1000).toFixed(1),
      level,
      xpPct: Math.round(((xp - cur) / (next - cur)) * 100),
      xpToNext: next - xp + ' セル',
      discoveryCount: this.discoveries.length,
    })
  }

  // ---- fog rendering ----
  applyFogStyle() {
    // Semi-transparent dark veil: unrevealed areas are dimmed (the bright map
    // shows through faintly) yet clearly distinct from the sharp, bright
    // revealed areas. Drawn on a canvas in the pane, so it tracks perfectly.
    const st = this.fogStyleV()
    this.fogFill = st === 'black' ? '#04070c' : 'rgba(4,6,11,0.95)'
    this.requestFog()
  }

  requestFog() {
    if (this.fogDirty) return
    this.fogDirty = true
    requestAnimationFrame(() => {
      this.fogDirty = false
      this.drawFog()
    })
  }

  // Scale/translate the fog canvas to match a zoom animation, so it tracks the
  // zoom smoothly instead of snapping late on zoomend (mirrors L.ImageOverlay).
  _onFogZoomAnim(e) {
    const cv = this.fogCanvasEl
    if (!cv || !this._fogNW || !this.map) return
    const scale = this.map.getZoomScale(e.zoom)
    const offset = this.map._latLngToNewLayerPoint(this._fogNW, e.zoom, e.center)
    L.DomUtil.setTransform(cv, offset, scale)
  }

  // Keep Leaflet's internal size in sync with its container (fixes the iOS PWA
  // bottom gap where the map renders shorter than the screen).
  onViewportChange() {
    if (!this.map) return
    this.map.invalidateSize()
    this.requestFog()
  }

  drawFog() {
    const map = this.map
    const cv = this.fogCanvasEl
    if (!map || !cv) return
    const size = map.getSize()
    if (!size.x || !size.y) return
    // Cover the viewport plus padding so short pans don't reveal an un-fogged
    // edge before the next redraw.
    const padX = Math.round(size.x * 0.3)
    const padY = Math.round(size.y * 0.3)
    const w = size.x + padX * 2
    const h = size.y + padY * 2
    // Position the canvas in the map's layer coordinate space; Leaflet then
    // pans/zooms it together with the tiles.
    const topLeft = map.containerPointToLayerPoint([-padX, -padY])
    L.DomUtil.setPosition(cv, topLeft)
    // Anchor for zoom-animation scaling (see _onFogZoomAnim).
    this._fogNW = map.layerPointToLatLng(topLeft)

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr)
    if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr)
    cv.style.width = w + 'px'
    cv.style.height = h + 'px'

    const ctx = this.fogCtx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = this.fogFill || 'rgba(4,6,11,0.95)'
    ctx.fillRect(0, 0, w, h)
    // Cut clear holes where the player has been.
    ctx.globalCompositeOperation = 'destination-out'
    const r = this.radius()
    for (const p of this.visited) {
      const lp = map.latLngToLayerPoint(L.latLng(p.lat, p.lng))
      const edge = map.latLngToLayerPoint(L.latLng(p.lat, p.lng + r / this.mPerLng(p.lat)))
      const rpx = Math.abs(edge.x - lp.x)
      const cx = lp.x - topLeft.x
      const cy = lp.y - topLeft.y
      if (cx < -rpx || cx > w + rpx || cy < -rpx || cy > h + rpx) continue
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rpx)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(0.78, 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, rpx, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  // ---- settings updates (mirrors the prototype's componentDidUpdate) ----
  setSettings(next) {
    const prev = this.settings
    this.settings = { ...this.settings, ...next }
    if (next.fogStyle && next.fogStyle !== prev.fogStyle) this.applyFogStyle()
    if (next.revealRadius && next.revealRadius !== prev.revealRadius) {
      this.cells = new Set()
      this.visited.forEach((p) => this.addCells(p))
      this.updateBlips()
      this.refreshStats()
      this.requestFog()
      this.saveDebounced()
      this.syncDebounced()
    }
    if (next.accent && next.accent !== prev.accent && this.map) {
      this.buildMarker()
    }
  }

  // ---- reset ----
  reset() {
    this.visited = this.pos ? [{ ...this.pos }] : []
    this.cells = new Set()
    this.visited.forEach((p) => this.addCells(p))
    this.totalDist = 0
    this.discoveries = []
    this.discoveredNames = new Set()
    this.updateBlips()
    this.refreshStats()
    this.emitDiscoveries()
    this.requestFog()
    this.saveDebounced()
    this.syncDebounced()
  }

  // ---- persistence + sync ----
  snapshot() {
    return {
      pos: this.pos,
      visited: this.visited.slice(-800),
      cells: [...this.cells],
      totalDist: this.totalDist,
      discoveries: this.discoveries,
    }
  }
  saveDebounced() {
    clearTimeout(this.saveT)
    this.saveT = setTimeout(() => saveLocal(this.snapshot()), 700)
  }
  syncDebounced() {
    clearTimeout(this.syncT)
    this.syncT = setTimeout(() => pushRemoteState(this.snapshot()), 3000)
  }

  // Re-sync after login/logout: the API owner (user vs device) changed, so pull
  // that owner's state and union-merge it with what's on screen. If the owner has
  // no state yet (fresh account), push the current progress up to migrate it.
  async resync() {
    if (this.destroyed) return
    const remote = await fetchRemoteState()
    if (this.destroyed) return
    if (remote) this.mergeRemote(remote)
    else await pushRemoteState(this.snapshot())
  }

  mergeRemote(remote) {
    ;(remote.cells || []).forEach((c) => this.cells.add(c))

    const byName = new Map()
    for (const d of [...(remote.discoveries || []), ...this.discoveries]) {
      const ex = byName.get(d.name)
      if (!ex || (d.t || 0) < (ex.t || 0)) byName.set(d.name, d)
    }
    this.discoveries = [...byName.values()]
    this.discoveredNames = new Set(this.discoveries.map((d) => d.name))

    this.visited = [...(remote.visited || []), ...this.visited].slice(-2000)
    this.totalDist = Math.max(this.totalDist, remote.totalDist || 0)

    this.updateBlips()
    this.refreshStats()
    this.emitDiscoveries()
    this.requestFog()
    this.saveDebounced()
    this.syncDebounced()
  }

  // ---- callback helpers ----
  emit(name, arg) {
    if (this.cb && typeof this.cb[name] === 'function') this.cb[name](arg)
  }
  emitDiscoveries() {
    this.emit('onDiscoveries', [...this.discoveries])
  }
}
