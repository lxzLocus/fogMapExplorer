// Optional backend sync. Every call fails soft: if the backend is unreachable
// the app keeps working purely from localStorage.
import { getDeviceId } from './storage.js'
import { getToken } from './auth.js'

const BASE = '/api'

function headers() {
  const h = {
    'Content-Type': 'application/json',
    'X-Device-Id': getDeviceId(),
  }
  // When logged in, the account (Bearer token) takes precedence over the device.
  const token = getToken()
  if (token) h['Authorization'] = 'Bearer ' + token
  return h
}

export async function fetchRemoteState() {
  try {
    const r = await fetch(`${BASE}/state`, { headers: headers() })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

export async function pushRemoteState(state) {
  try {
    const r = await fetch(`${BASE}/state`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(state),
    })
    return r.ok
  } catch {
    return false
  }
}
