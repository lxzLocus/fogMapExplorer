import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { pool, ensureSchema, dbOk } from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me'
if (JWT_SECRET === 'dev-insecure-secret-change-me') {
  console.warn('[auth] JWT_SECRET not set — using an insecure dev default. Set JWT_SECRET in production.')
}
const TOKEN_TTL = '365d'

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '4mb' }))

// The frontend is served same-origin behind nginx (which proxies /api), so CORS
// is not needed in production. We allow it anyway so the API also works when hit
// from a Vite dev server or an alternate host during development.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Device-Id, Authorization')
  res.set('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.get('/api/health', async (_req, res) => {
  res.json({ ok: true, db: await dbOk() })
})

// --- auth helpers -----------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function signToken(user) {
  return jwt.sign({ uid: String(user.id), email: user.email }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  })
}

// Returns the decoded payload for a valid Bearer token, null if absent.
// Throws (invalid/expired token) so callers can answer 401.
function verifyBearer(req) {
  const h = req.header('Authorization') || ''
  const m = h.match(/^Bearer (.+)$/)
  if (!m) return null
  return jwt.verify(m[1], JWT_SECRET)
}

// Resolve the state owner from the request: a logged-in user takes precedence,
// otherwise the anonymous device id. Throws on an invalid token.
function ownerFromReq(req) {
  const payload = verifyBearer(req)
  if (payload) return 'user:' + payload.uid
  const did = req.header('X-Device-Id')
  if (did && did.length >= 8 && did.length <= 128) return 'device:' + did
  return null
}

// --- auth routes ------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' })
  if (password.length < 8) return res.status(400).json({ error: 'パスワードは8文字以上にしてください' })
  try {
    const hash = await bcrypt.hash(password, 10)
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email`,
      [email, hash],
    )
    const user = rows[0]
    res.json({ token: signToken(user), user: { id: String(user.id), email: user.email } })
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'このメールアドレスは既に登録されています' })
    console.error('[register]', e)
    res.status(500).json({ error: 'server error' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  try {
    const { rows } = await pool.query(
      `SELECT id, email, password_hash FROM users WHERE email = $1`,
      [email],
    )
    if (!rows.length) return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' })
    const ok = await bcrypt.compare(password, rows[0].password_hash)
    if (!ok) return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' })
    const user = rows[0]
    res.json({ token: signToken(user), user: { id: String(user.id), email: user.email } })
  } catch (e) {
    console.error('[login]', e)
    res.status(500).json({ error: 'server error' })
  }
})

app.get('/api/auth/me', (req, res) => {
  try {
    const payload = verifyBearer(req)
    if (!payload) return res.status(401).json({ error: 'not authenticated' })
    res.json({ user: { id: payload.uid, email: payload.email } })
  } catch {
    res.status(401).json({ error: 'invalid token' })
  }
})

// --- state sync -------------------------------------------------------------
const cap = (a, n) => (Array.isArray(a) ? a.slice(-n) : [])

function resolveOwner(req, res) {
  let owner
  try {
    owner = ownerFromReq(req)
  } catch {
    res.status(401).json({ error: 'invalid token' })
    return null
  }
  if (!owner) {
    res.status(400).json({ error: 'missing auth or X-Device-Id' })
    return null
  }
  return owner
}

app.get('/api/state', async (req, res) => {
  const owner = resolveOwner(req, res)
  if (!owner) return
  try {
    const { rows } = await pool.query(
      `SELECT pos, visited, cells, discoveries, total_dist, updated_at
         FROM states WHERE owner = $1`,
      [owner],
    )
    if (!rows.length) return res.json(null)
    const r = rows[0]
    res.json({
      pos: r.pos,
      visited: r.visited,
      cells: r.cells,
      discoveries: r.discoveries,
      totalDist: Number(r.total_dist),
      updatedAt: r.updated_at,
    })
  } catch (e) {
    console.error('[GET /api/state]', e)
    res.status(500).json({ error: 'server error' })
  }
})

app.put('/api/state', async (req, res) => {
  const owner = resolveOwner(req, res)
  if (!owner) return
  const b = req.body || {}
  const pos =
    b.pos && typeof b.pos.lat === 'number' && typeof b.pos.lng === 'number'
      ? { lat: b.pos.lat, lng: b.pos.lng }
      : null
  const visited = cap(b.visited, 5000)
  const cells = cap(b.cells, 200000)
  const discoveries = cap(b.discoveries, 500)
  const totalDist = Number(b.totalDist) || 0
  try {
    await pool.query(
      `INSERT INTO states (owner, pos, visited, cells, discoveries, total_dist, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (owner) DO UPDATE SET
          pos = EXCLUDED.pos,
          visited = EXCLUDED.visited,
          cells = EXCLUDED.cells,
          discoveries = EXCLUDED.discoveries,
          total_dist = EXCLUDED.total_dist,
          updated_at = now()`,
      [
        owner,
        pos ? JSON.stringify(pos) : null,
        JSON.stringify(visited),
        JSON.stringify(cells),
        JSON.stringify(discoveries),
        totalDist,
      ],
    )
    res.json({ ok: true })
  } catch (e) {
    console.error('[PUT /api/state]', e)
    res.status(500).json({ error: 'server error' })
  }
})

const port = Number(process.env.PORT ?? 3000)

ensureSchema()
  .then(() => {
    app.listen(port, () => console.log(`[backend] listening on :${port}`))
  })
  .catch((e) => {
    console.error('[db] schema init failed', e)
    process.exit(1)
  })
