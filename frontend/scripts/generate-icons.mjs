// Rasterises src/icon.svg into the PNG icons the PWA manifest + iOS need.
// Runs as `prebuild` (before `vite build`). Non-fatal: if it fails, the build
// continues (icons will simply 404 until this is fixed).
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

const root = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(root, '../src/icon.svg')
const pub = path.resolve(root, '../public')
const iconsDir = path.join(pub, 'icons')

const targets = [
  { file: path.join(iconsDir, 'pwa-192.png'), size: 192, bg: null },
  { file: path.join(iconsDir, 'pwa-512.png'), size: 512, bg: null },
  // maskable + apple icons must be fully opaque (no transparent corners).
  { file: path.join(iconsDir, 'pwa-maskable-512.png'), size: 512, bg: '#0a0d12' },
  { file: path.join(pub, 'apple-touch-icon.png'), size: 180, bg: '#0a0d12' },
]

async function main() {
  const svg = await readFile(src)
  await mkdir(iconsDir, { recursive: true })
  for (const t of targets) {
    let img = sharp(svg, { density: 384 }).resize(t.size, t.size, { fit: 'contain' })
    if (t.bg) img = img.flatten({ background: t.bg })
    await img.png().toFile(t.file)
    console.log('[icons] wrote', path.relative(pub, t.file))
  }
}

main().catch((e) => {
  console.warn('[icons] generation failed (non-fatal):', e.message)
})
