#!/bin/sh
# Starts this checkout's dev server for the local Queue demo: made-up Queue
# rows, two made-up people, and no Airtable at all (README.md in this folder).
#
#   sh scripts/queue-demo/start.sh [port] [--reset]
#
# --reset starts the rows and the people again from the seed.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
port=${1:-3471}
case "$port" in --reset) port=3471 ;; esac

if [ -f "$root/.env.local" ] || [ -f "$root/.env" ]; then
  echo "This checkout has a .env file: the demo runs only where there is none, so no real key is ever read." >&2
  exit 1
fi

mkdir -p "$root/.admin-dev"
for a in "$@"; do
  if [ "$a" = "--reset" ]; then
    rm -f "$root/.admin-dev/queue-demo.json" "$root/.admin-dev/users.json"
  fi
done
if [ ! -f "$root/.admin-dev/users.json" ]; then
  node --input-type=module -e "
    import { DEMO_USERS } from '$here/seed.mjs'
    import { writeFileSync } from 'node:fs'
    const at = new Date().toISOString()
    writeFileSync('$root/.admin-dev/users.json', JSON.stringify({
      users: DEMO_USERS.map(u => ({ ...u, addedAt: at, addedBy: 'queue demo' })),
    }, null, 2))
  "
fi

# Placeholders, never real values: the demo's Airtable is fake-airtable.mjs,
# and every other service the admin can reach is switched off.
export AIRTABLE_TOKEN=demo-placeholder-token
export AIRTABLE_BASE_ID=appQUEUEDEMO00000
export ADMIN_SESSION_SECRET=${ADMIN_SESSION_SECRET:-queue-demo-local-placeholder-not-a-secret}
export QUEUE_AGENT_SECRET=
export ADMIN_MAIL_SCRIPT_URL=
export ADMIN_MAIL_SECRET=
export KV_REST_API_URL=
export KV_REST_API_TOKEN=
export UPSTASH_REDIS_REST_URL=
export UPSTASH_REDIS_REST_TOKEN=
export BLOB_READ_WRITE_TOKEN=
export NODE_OPTIONS="--import $here/fake-airtable.mjs ${NODE_OPTIONS:-}"

cd "$root"
if [ -f "$HOME/DevServers/devserver.py" ]; then
  exec python3 "$HOME/DevServers/devserver.py" start "$root" --port "$port"
fi
exec npx next dev -p "$port"
