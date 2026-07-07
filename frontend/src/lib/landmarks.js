// Discoverable spots, exploration bounds and grid size (from the design doc).

export const LANDMARKS = [
  { name: '渋谷スクランブル交差点', lat: 35.6595, lng: 139.7005, kind: 'star', hue: '#FFD166' },
  { name: '代々木公園', lat: 35.6712, lng: 139.6949, kind: 'park', hue: '#7CFC9B' },
  { name: '明治神宮', lat: 35.6764, lng: 139.6993, kind: 'shrine', hue: '#FF7A5C' },
  { name: '原宿駅', lat: 35.6702, lng: 139.7027, kind: 'station', hue: '#5EC8FF' },
  { name: '表参道ヒルズ', lat: 35.6672, lng: 139.7091, kind: 'shop', hue: '#fff' },
  { name: '代官山', lat: 35.6481, lng: 139.7031, kind: 'shop', hue: '#fff' },
  { name: '恵比寿ガーデンプレイス', lat: 35.6425, lng: 139.713, kind: 'shop', hue: '#fff' },
  { name: '新宿駅', lat: 35.6896, lng: 139.7006, kind: 'station', hue: '#5EC8FF' },
  { name: '新宿御苑', lat: 35.6852, lng: 139.71, kind: 'park', hue: '#7CFC9B' },
  { name: '目黒川', lat: 35.6437, lng: 139.6989, kind: 'river', hue: '#5EC8FF' },
  { name: '国立競技場', lat: 35.6779, lng: 139.7143, kind: 'flag', hue: '#FFD166' },
  { name: '六本木ヒルズ', lat: 35.6605, lng: 139.7292, kind: 'shop', hue: '#fff' },
]

// Central-Tokyo bounding box used as the denominator for the explored %.
export const BOUNDS = { latMin: 35.62, latMax: 35.72, lngMin: 139.65, lngMax: 139.77 }

export const CELL = 250 // meters — grid cell edge

// Default center (Shibuya) if there is no saved position and no GPS fix yet.
export const DEFAULT_POS = { lat: 35.6595, lng: 139.7005 }

// GTA-style flat pictogram blips: solid glyph, dark halo, no container.
export function blipSvg(kind, c) {
  const S = 'stroke="#0a0d12" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"'
  switch (kind) {
    case 'station':
      return (
        '<rect x="5" y="4" width="12" height="11" rx="2.5" fill="' + c + '" ' + S + '/>' +
        '<rect x="7.5" y="6.5" width="7" height="3.5" rx="0.8" fill="#0a0d12"/>' +
        '<circle cx="8.5" cy="17.5" r="1.6" fill="' + c + '" ' + S + '/>' +
        '<circle cx="13.5" cy="17.5" r="1.6" fill="' + c + '" ' + S + '/>'
      )
    case 'park':
      return (
        '<circle cx="11" cy="8.5" r="5.5" fill="' + c + '" ' + S + '/>' +
        '<rect x="9.9" y="12" width="2.2" height="6" rx="1" fill="' + c + '" ' + S + '/>'
      )
    case 'shrine':
      return (
        '<path d="M3.5 6 Q11 3.5 18.5 6 L17.5 8.5 H4.5 Z" fill="' + c + '" ' + S + '/>' +
        '<rect x="5.5" y="8.5" width="2.4" height="9.5" fill="' + c + '" ' + S + '/>' +
        '<rect x="14.1" y="8.5" width="2.4" height="9.5" fill="' + c + '" ' + S + '/>' +
        '<rect x="4.8" y="11" width="12.4" height="1.8" fill="' + c + '" ' + S + '/>'
      )
    case 'shop':
      return (
        '<path d="M5 8 H17 L16 18 H6 Z" fill="' + c + '" ' + S + '/>' +
        '<path d="M8.5 8 V6.5 a2.5 2.5 0 0 1 5 0 V8" fill="none" stroke="' + c + '" stroke-width="1.6"/>' +
        '<path d="M8.5 8 V6.5 a2.5 2.5 0 0 1 5 0 V8" fill="none" stroke="#0a0d12" stroke-width="0.8"/>'
      )
    case 'river':
      return (
        '<path d="M3 8 Q6 5.5 9 8 T15 8 T21 8" fill="none" stroke="' + c + '" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="M3 13.5 Q6 11 9 13.5 T15 13.5 T21 13.5" fill="none" stroke="' + c + '" stroke-width="2.4" stroke-linecap="round"/>'
      )
    case 'flag':
      return (
        '<rect x="6" y="3.5" width="1.8" height="15" rx="0.9" fill="' + c + '" ' + S + '/>' +
        '<path d="M7.8 4.5 L17.5 7 L7.8 9.5 Z" fill="' + c + '" ' + S + '/>'
      )
    case 'star':
    default:
      return (
        '<path d="M11 2.5 L13.3 8.2 L19.5 8.7 L14.8 12.6 L16.3 18.5 L11 15.2 L5.7 18.5 L7.2 12.6 L2.5 8.7 L8.7 8.2 Z" fill="' +
        c +
        '" ' + S + '/>'
      )
  }
}
