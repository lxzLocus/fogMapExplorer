import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'

const { Pool } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10),
})

/**
 * Apply schema.sql, retrying while the database container spins up.
 * `docker compose` starts `db` before it is ready to accept connections,
 * so we retry rather than crash-loop.
 */
export async function ensureSchema({ retries = 30, delayMs = 2000 } = {}) {
  const schemaPath = path.resolve(__dirname, '../db/schema.sql')
  const sql = await readFile(schemaPath, 'utf8')
  let lastErr
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query(sql)
      console.log('[db] schema ready')
      return
    } catch (e) {
      lastErr = e
      console.log(`[db] not ready (${i + 1}/${retries}): ${e.code || e.message}`)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

export async function dbOk() {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}
