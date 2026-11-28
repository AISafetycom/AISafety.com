#!/bin/sh
# Starts this checkout's dev server for the local Queue demo: made-up Queue
# rows, two made-up people, and no Airtable at all (README.md in this folder).
#
#   sh scripts/queue-demo/start.sh [port] [--reset] [--no-chat-server] [--mac-chat]
#
# --reset starts the rows, the people and the chat threads again from the
# seed. --no-chat-server leaves the stand-in for the team chat's server
# (fake-team-agent.mjs) off, to see the page with that server offline.
# --mac-chat also stands in for the agent on the owner's Mac (the same
# script, on 127.0.0.1:8795), so Bryce Demo's page mounts the Mac chat.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
port=${1:-3471}
case "$port" in --*) port=3471 ;; esac

# Any of them: .env, .env.local, .env.development, .env.development.local …
for f in "$root"/.env "$root"/.env.*; do
  if [ -e "$f" ]; then
    echo "This checkout has a .env file ($(basename "$f")): the demo runs only where there is none, so no real key is ever read." >&2
    exit 1
  fi
done

mkdir -p "$root/.admin-dev"
chat_server=1
mac_chat=0
for a in "$@"; do
  if [ "$a" = "--reset" ]; then
    rm -f "$root/.admin-dev/queue-demo.json" "$root/.admin-dev/users.json" \
      "$root/.admin-dev/queue-demo-chat.json"
    rm -rf "$root/.admin-dev/queue-team-chat"
  fi
  if [ "$a" = "--no-chat-server" ]; then
    chat_server=0
  fi
  if [ "$a" = "--mac-chat" ]; then
    mac_chat=1
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
export QUEUE_AGENT_PORT=
# The team chat (queue-team-chat.ts): on, with a placeholder secret that
# only fake-team-agent.mjs holds, and Bryce Demo as the owner, whose own
# chat would be the one on a Mac. There is none here, so he has no panel,
# unless --mac-chat stands in for it (a placeholder secret again, and a
# port of its own: never the real agent's 8790).
export QUEUE_TEAM_AGENT_SECRET=queue-demo-team-agent-placeholder-not-a-secret
export QUEUE_CHAT_OWNERS=bryce.demo@example.org
if [ "$mac_chat" = 1 ]; then
  export QUEUE_AGENT_SECRET=queue-demo-mac-agent-placeholder-not-a-secret
  export QUEUE_AGENT_PORT=8795
fi
export ADMIN_MAIL_SCRIPT_URL=
export ADMIN_MAIL_SECRET=
export KV_REST_API_URL=
export KV_REST_API_TOKEN=
export UPSTASH_REDIS_REST_URL=
export UPSTASH_REDIS_REST_TOKEN=
export BLOB_READ_WRITE_TOKEN=
export NODE_OPTIONS="--import $here/fake-airtable.mjs ${NODE_OPTIONS:-}"

cd "$root"
# The stand-in for the team chat's server (and, with --mac-chat, for the
# owner's Mac agent). It keeps going until the demo server has been gone
# for three minutes, or until its pid file is deleted or names a newer one.
agent_args="$port"
if [ "$mac_chat" = 1 ]; then
  agent_args="$agent_args --mac 8795"
fi
if [ "$chat_server" = 0 ]; then
  agent_args="$agent_args --no-team"
fi
if [ "$chat_server" = 1 ] || [ "$mac_chat" = 1 ]; then
  # shellcheck disable=SC2086 # the arguments are meant to split
  NODE_OPTIONS= nohup node "$here/fake-team-agent.mjs" $agent_args \
    >"$root/.admin-dev/fake-team-agent.log" 2>&1 &
else
  rm -f "$root/.admin-dev/fake-team-agent.pid"
fi
if [ -f "$HOME/DevServers/devserver.py" ]; then
  exec python3 "$HOME/DevServers/devserver.py" start "$root" --port "$port"
fi
exec npx next dev -p "$port"
