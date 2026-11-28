// Prints the line that signs a browser tab in to the local Queue demo as one
// of its made-up people (README.md in this folder): paste it into the
// browser's console on the demo's page. The cookie is sealed with the demo's
// placeholder secret (start.sh), so it opens nothing but the demo server.
//
//   node scripts/queue-demo/cookie.mjs rob.demo@example.org

import { createHmac } from 'node:crypto'
import { DEMO_USERS } from './seed.mjs'

const SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  'queue-demo-local-placeholder-not-a-secret'
const email = (process.argv[2] ?? '').trim().toLowerCase()
if (!DEMO_USERS.some(u => u.email === email)) {
  console.error(
    `Which demo person? One of: ${DEMO_USERS.map(u => u.email).join(', ')}`
  )
  process.exit(1)
}
const now = Math.floor(Date.now() / 1000)
const body = Buffer.from(
  JSON.stringify({ v: 1, email, iat: now, exp: now + 7 * 24 * 3600 })
).toString('base64url')
const tag = createHmac('sha256', SECRET).update(body).digest('base64url')
console.log(
  `document.cookie = "aisafety_admin_session=${body}.${tag}; path=/; max-age=604800; SameSite=Lax"`
)
