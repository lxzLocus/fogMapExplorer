// Local persistence (localStorage) + a stable per-device id used for sync.

const STATE_KEY = 'fogexplorer_v1'
const SETTINGS_KEY = 'fogexplorer_settings'
const DEVICE_KEY = 'fogexplorer_device'

export function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY)) || {}
  } catch {
    return {}
  }
}

export function saveLocal(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    /* quota / private mode — ignore */
  }
}

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}
  } catch {
    return {}
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* ignore */
  }
}

export function getDeviceId() {
  let id = null
  try {
    id = localStorage.getItem(DEVICE_KEY)
  } catch {
    /* ignore */
  }
  if (!id) {
    id =
      (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
      'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
    try {
      localStorage.setItem(DEVICE_KEY, id)
    } catch {
      /* ignore */
    }
  }
  return id
}
