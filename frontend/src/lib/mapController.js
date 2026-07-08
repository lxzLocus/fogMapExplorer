import L from 'leaflet'
import { LANDMARKS, BOUNDS, CELL, DEFAULT_POS, blipSvg } from './landmarks.js'
import { loadLocal, saveLocal } from './storage.js'
import { fetchRemoteState, pushRemoteState } from './api.js'

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
  constructor(container, fogEl, settings, callbacks) {
    this.container = container
    this.fogEl = fogEl
    this.settings = { ...DEFAULTS, ...settings }
    this.cb = callbacks || {}

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
    for (let la = p.lat - dLat; la <= p.lat + dLat; la += stepLat) {
      for (let lo = p.lng - dLng; lo <= p.lng + dLng; lo += stepLng) {
        if (la < b.latMin || la > b.latMax || lo < b.lngMin || lo > b.lngMax) continue
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

    const map = L.map(this.container, {
      center: [this.pos.lat, this.pos.lng],
      zoom: 15,
      zoomControl: false,
      attributionControl: true,
    })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(map)
    this.map = map
    this.buildMarker()

    map.on('dragstart', () => { this.follow = false })
    // During a pan the fog element is cheaply translated to follow the map
    // (onMapMove); the mask is only recomputed when movement settles. This
    // avoids the per-frame canvas re-encode that made the fog flicker.
    map.on('zoomstart', () => { this._zooming = true })
    map.on('zoomend', () => { this._zooming = false })
    map.on('move', () => this.onMapMove())
    map.on('moveend zoomend resize', () => this.requestFog())
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

    // Start real GPS tracking.
    this.startGeo()
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
    if (heading != null && !Number.isNaN(heading)) this.heading = heading
    this.marker.setLatLng([newPos.lat, newPos.lng])
    if (this.hdEl && heading != null) {
      this.hdEl.style.transform =
        'translate(-50%,-58%) rotate(' + (heading * 180) / Math.PI + 'deg)'
    }
    if (this.follow) this.map.panTo([newPos.lat, newPos.lng], { animate: false })

    const last = this.visited[this.visited.length - 1]
    if (!last || this.distM(last, this.pos) > Math.max(80, this.radius() * 0.12)) {
      this.visited.push({ ...this.pos })
      this.addCells(this.pos)
      this.checkLandmarks()
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

  // ---- landmark blips ----
  inRevealed(lm) {
    const r = this.radius()
    for (let i = this.visited.length - 1; i >= 0; i--) {
      if (this.distM(this.visited[i], lm) < r) return true
    }
    return false
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
    return L.divIcon({
      className: '',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      html:
        '<div style="animation:fx-blink 1.6s ease infinite;filter:drop-shadow(0 1px 2px rgba(0,0,0,.9));' +
        'font-family:Oswald,sans-serif;font-weight:700;font-size:17px;color:#fff;text-shadow:0 0 2px #0a0d12,-1px 0 #0a0d12,1px 0 #0a0d12,0 -1px #0a0d12,0 1px #0a0d12;' +
        'width:20px;height:20px;display:flex;align-items:center;justify-content:center;">?</div>',
    })
  }

  updateBlips() {
    if (!this.map) return
    for (const lm of LANDMARKS) {
      const discovered = this.discoveries.some((d) => d.name === lm.name)
      const revealed = discovered || this.inRevealed(lm)
      const cur = this.lmMarkers[lm.name]
      const want = revealed ? (discovered ? 'found' : 'hint') : 'none'
      if (cur && cur.kind === want) continue
      if (cur) this.map.removeLayer(cur.marker)
      if (want === 'none') {
        delete this.lmMarkers[lm.name]
        continue
      }
      const marker = L.marker([lm.lat, lm.lng], {
        icon: this.blipIcon(lm, want === 'found'),
        zIndexOffset: 500,
      }).addTo(this.map)
      marker.bindPopup(
        '<div style="font-family:\'Noto Sans JP\',sans-serif;font-weight:700;font-size:13px;">' +
          (want === 'found' ? lm.name : '未発見のスポット') +
          '</div>',
        { closeButton: false, offset: [0, -26] },
      )
      this.lmMarkers[lm.name] = { marker, kind: want }
    }
  }

  checkLandmarks() {
    for (const lm of LANDMARKS) {
      if (this.discoveries.some((d) => d.name === lm.name)) continue
      if (this.distM(this.pos, lm) < Math.min(this.radius(), 600)) {
        const now = new Date()
        const entry = {
          name: lm.name,
          time: now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0'),
          dist: (this.totalDist / 1000).toFixed(1) + ' km 地点',
          t: now.getTime(),
        }
        this.discoveries = [...this.discoveries, entry]
        this.emitDiscoveries()
        this.emit('onToast', lm.name)
      }
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
      landmarkTotal: LANDMARKS.length,
    })
  }

  // ---- fog rendering ----
  applyFogStyle() {
    const el = this.fogEl
    if (!el) return
    const st = this.fogStyleV()
    el.style.backdropFilter = ''
    el.style.webkitBackdropFilter = ''
    if (st === 'black') {
      el.style.background = '#04070c'
    } else if (st === 'grid') {
      el.style.background =
        'repeating-linear-gradient(0deg, rgba(20,30,45,.9) 0 1px, #050a12 1px 22px), repeating-linear-gradient(90deg, rgba(20,30,45,.9) 0 1px, transparent 1px 22px)'
      el.style.backgroundColor = '#050a12'
    } else {
      el.style.background = 'rgba(5,8,13,.62)'
      el.style.backdropFilter = 'blur(9px) brightness(.4) saturate(.4)'
      el.style.webkitBackdropFilter = 'blur(9px) brightness(.4) saturate(.4)'
    }
  }

  requestFog() {
    if (this.fogDirty) return
    this.fogDirty = true
    requestAnimationFrame(() => {
      this.fogDirty = false
      this.drawFog()
    })
  }

  // Keep Leaflet's internal size in sync with its container (fixes the iOS PWA
  // bottom gap where the map renders shorter than the screen).
  onViewportChange() {
    if (!this.map) return
    this.map.invalidateSize()
    this.requestFog()
  }

  // Cheaply translate the fog layer to track the map during a pan, then re-anchor
  // (full redraw) before the enlarged fog element would reveal an un-fogged edge.
  onMapMove() {
    const map = this.map
    const el = this.fogEl
    if (!map || !el || this._zooming || !this.fogAnchorLatLng) return
    const now = map.latLngToContainerPoint(this.fogAnchorLatLng)
    const dx = now.x - this.fogAnchorPx.x
    const dy = now.y - this.fogAnchorPx.y
    el.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)'
    const size = map.getSize()
    if (Math.abs(dx) > size.x * 0.1 || Math.abs(dy) > size.y * 0.1) this.requestFog()
  }

  drawFog() {
    const map = this.map
    const el = this.fogEl
    if (!map || !el) return
    const w = el.clientWidth
    const h = el.clientHeight
    if (!w || !h) return
    // The fog element is larger than the map viewport (see App.jsx) so that
    // translating it during a pan doesn't reveal an un-fogged edge. Offset the
    // holes by that margin so they line up with the map.
    const size = map.getSize()
    const offX = (w - size.x) / 2
    const offY = (h - size.y) / 2
    if (!this.fogCanvas) this.fogCanvas = document.createElement('canvas')
    const c = this.fogCanvas
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'destination-out'
    const r = this.radius()
    for (const p of this.visited) {
      const pt = map.latLngToContainerPoint(L.latLng(p.lat, p.lng))
      const edge = map.latLngToContainerPoint(L.latLng(p.lat, p.lng + r / this.mPerLng(p.lat)))
      const rpx = Math.abs(edge.x - pt.x)
      const cx = pt.x + offX
      const cy = pt.y + offY
      if (cx < -rpx || cx > w + rpx || cy < -rpx || cy > h + rpx) continue
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rpx)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(0.65, 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, rpx, 0, Math.PI * 2)
      ctx.fill()
    }
    const url = c.toDataURL()
    el.style.webkitMaskImage = 'url(' + url + ')'
    el.style.maskImage = 'url(' + url + ')'
    el.style.webkitMaskSize = '100% 100%'
    el.style.maskSize = '100% 100%'
    // Re-anchor the pan-follow to this freshly drawn state.
    this.fogAnchorLatLng = map.getCenter()
    this.fogAnchorPx = map.latLngToContainerPoint(this.fogAnchorLatLng)
    el.style.transform = 'translate3d(0,0,0)'
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
