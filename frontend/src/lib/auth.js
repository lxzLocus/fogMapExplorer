// Email/password auth. Tokens (JWT) are stored in localStorage and attached to
// API requests by api.js. Accounts are optional — the app also works as a guest.

const TOKEN_KEY = 'fogexplorer_token'
const USER_KEY = 'fogexplorer_user'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY)) || null
  } catch {
    return null
  }
}

export function isLoggedIn() {
  return !!getToken()
}

function save(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* ignore */
  }
}

export function logout() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}

async function post(path, body) {
  let r
  try {
    r = await fetch('/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, error: 'サーバーに接続できません' }
  }
  let data = {}
  try {
    data = await r.json()
  } catch {
    /* ignore */
  }
  if (!r.ok) return { ok: false, error: data.error || 'エラー (' + r.status + ')' }
  save(data.token, data.user)
  return { ok: true, user: data.user }
}

export function register(email, password) {
  return post('/auth/register', { email, password })
}

export function login(email, password) {
  return post('/auth/login', { email, password })
}
