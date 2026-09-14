/*
  Pins the Draft Mode keys across builds, so preview cookies stay valid.

  Next generates the draft-mode keys during `next build` and caches them in
  .next/cache/.previewinfo for 14 days; at the first build after that it
  generates new ones, which silently invalidates every admin's preview cookie
  (the cookie's value IS the previewModeId). This runs before `next build`
  (package.json "prebuild") and writes that file with keys derived from
  PREVIEW_KEY_SEED, so every build — with or without a restored build cache —
  has the same keys, and a preview cookie set at /admin/preview stays valid
  until the seed changes.

  Reads the seed from the process environment only (Vercel exposes project
  env vars to the build step; a local `next build` needs it on the command
  line — .env.local is not loaded here). Without the seed it does nothing and
  Next manages the keys as usual.
*/

import { createHmac } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const seed = process.env.PREVIEW_KEY_SEED
if (!seed) {
  console.log(
    'pin-preview-keys: PREVIEW_KEY_SEED not set — leaving draft-mode keys to Next'
  )
  process.exit(0)
}

// Same shapes Next generates: a 16-byte id, two 32-byte keys, all hex.
const derive = (label, bytes) =>
  createHmac('sha256', seed)
    .update(label)
    .digest('hex')
    .slice(0, bytes * 2)

const config = {
  previewModeId: derive('previewModeId', 16),
  previewModeSigningKey: derive('previewModeSigningKey', 32),
  previewModeEncryptionKey: derive('previewModeEncryptionKey', 32),
  // Next rotates the keys only once this has passed.
  expireAt: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
}

const dir = join(process.cwd(), '.next', 'cache')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, '.previewinfo'), JSON.stringify(config))
console.log('pin-preview-keys: draft-mode keys pinned from PREVIEW_KEY_SEED')
