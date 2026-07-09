// PokéStop-style discovery: fetch real-world POIs from OpenStreetMap (Overpass)
// around the player so there's an endless supply of spots to discover.
// Fails soft — if Overpass is unreachable, the app falls back to the curated
// landmarks only.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

// OSM tags -> our blip kind (reuses blipSvg icons) + accent hue.
const HUE = {
  station: '#5EC8FF',
  park: '#7CFC9B',
  shrine: '#FF7A5C',
  shop: '#ffffff',
  river: '#5EC8FF',
  flag: '#FFD166',
  star: '#FFD166',
}

function classify(t) {
  if (!t) return 'star'
  if (t.railway === 'station' || t.public_transport === 'station' || t.station) return 'station'
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park'
  if (t.leisure === 'stadium' || t.leisure === 'pitch' || t.sport) return 'flag'
  if (t.amenity === 'place_of_worship' || t.historic === 'shrine') return 'shrine'
  if (t.tourism || t.historic) return 'star'
  if (t.shop || t.amenity) return 'shop'
  return 'star'
}

function buildQuery(lat, lng, radiusM) {
  const a = `(around:${radiusM},${lat},${lng})`
  return (
    '[out:json][timeout:20];(' +
    `node["railway"="station"]${a};` +
    `node["leisure"~"park|garden|stadium"]${a};` +
    `way["leisure"~"park|garden|stadium"]${a};` +
    `node["amenity"~"place_of_worship|cafe|restaurant|fast_food|cinema|theatre|marketplace|library|pub|bar"]${a};` +
    `node["tourism"~"attraction|museum|artwork|viewpoint|gallery|zoo|theme_park"]${a};` +
    `node["shop"]${a};` +
    `node["historic"]${a};` +
    ');out center 250;'
  )
}

/**
 * Returns [{ id, name, lat, lng, kind, hue }] for named POIs near (lat,lng).
 * Deduped by name so chains (every conbini) don't flood the map.
 */
export async function fetchPois(lat, lng, radiusM = 1200) {
  const body = 'data=' + encodeURIComponent(buildQuery(lat, lng, radiusM))
  for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, { method: 'POST', body })
      if (!r.ok) continue
      const data = await r.json()
      const seen = new Set()
      const out = []
      for (const el of data.elements || []) {
        const t = el.tags
        if (!t) continue
        const name = t.name || t['name:ja'] || t['name:en']
        if (!name || seen.has(name)) continue
        const lt = el.lat ?? el.center?.lat
        const ln = el.lon ?? el.center?.lon
        if (typeof lt !== 'number' || typeof ln !== 'number') continue
        seen.add(name)
        const kind = classify(t)
        out.push({ id: el.type + '/' + el.id, name, lat: lt, lng: ln, kind, hue: HUE[kind] })
      }
      return out
    } catch {
      /* try next endpoint */
    }
  }
  return []
}
