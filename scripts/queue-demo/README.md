# Local Queue demo: "Bryce checks first"

Runs this checkout's `/admin/queue` with made-up rows and two made-up
people, and no Airtable at all, so the suggest → From Rob → confirm flow can
be tried and recorded in a browser without touching the live base.

- `fake-airtable.mjs` is loaded into the dev server (`NODE_OPTIONS=--import`)
  and answers every request to `api.airtable.com` from
  `.admin-dev/queue-demo.json`, which it fills from `seed.mjs` the first time.
  It refuses to load unless the token is the demo placeholder, and the server
  also runs with a placeholder base id, so nothing can reach the real base.
- `start.sh` sets those placeholders, blanks every other service the admin
  can reach (Mac agent, mail, Redis, Blob), writes the two people into
  `.admin-dev/users.json`, and starts the server. It refuses to run in a
  checkout that has a `.env.local` or `.env`.
- `cookie.mjs` prints the line that signs a browser tab in as one of the two
  people.

The people (neither is a real account):

| Email                    | Name       | Queue grant                  |
| ------------------------ | ---------- | ---------------------------- |
| `bryce.demo@example.org` | Bryce Demo | can edit (and Admin admin)   |
| `rob.demo@example.org`   | Rob Demo   | can edit, Bryce checks first |

## Steps

1. Start it from this checkout (port 3471, fresh rows):

   ```sh
   sh scripts/queue-demo/start.sh 3471 --reset
   ```

   It runs detached through `~/DevServers/devserver.py` when that exists
   (stop it with `python3 ~/DevServers/devserver.py stop 3471`), else in the
   foreground with `npx next dev`. Use the shell, not the Browser pane's
   `preview_start`: a server started that way could not serve `/admin/queue`
   on 12 November 2026.

2. Print both sign-in lines:

   ```sh
   node scripts/queue-demo/cookie.mjs rob.demo@example.org
   node scripts/queue-demo/cookie.mjs bryce.demo@example.org
   ```

3. Open `http://localhost:3471/admin/login`, and in that tab's console run
   `await fetch('/api/admin/auth', { method: 'DELETE' })` (a cookie left by
   another local server would otherwise win), then paste Rob's line, then go
   to `http://localhost:3471/admin/queue`. To switch to Bryce, paste Bryce's
   line and reload. Cookies don't depend on the port, so two people need two
   browser profiles (or one tab, switching).

4. As Rob: open "Demo: Harbor City AI Safety Unconference", change a field
   or the reply, type a note, press **Suggest publish** (or A). The item moves
   to the folded **With Bryce** section, the toast says nothing changed on
   the site, and the card shows "You suggested Publish" with Take back. Try
   **Suggest reject** on "Demo: Crypto and AI Builders" with a reason, and
   **Ask Bryce** on the decided "Demo: Safety Careers Evening" (open it from
   Done today).

5. As Bryce: **From Rob** is the first section. Open each item: the card
   shows Rob's call and reason above his edits. A confirms the Publish. On
   the Reject, R opens Reject with Rob's reason and decline text filled in,
   and Enter confirms. Answer the question on its card. Each item's History
   keeps both names ("Published · suggested by Rob").

6. To see the 412: as Rob, suggest something; then change that row in
   `.admin-dev/queue-demo.json` by hand (its `fld835yJytaSRAuvB`, the verdict,
   from "Publish" to "Unsure"); then as Bryce press A. The toast says the
   verdict changed after Rob's suggestion and the page reads the item again.
   Press A once more: it goes, because the page has now read the item as it
   is. Change the verdict again before that second press and it is stopped
   once more ("changed again since your page read it"). The card's Dismiss
   takes a suggestion off an open item with nothing decided.

7. Start again from the seed at any time by deleting
   `.admin-dev/queue-demo.json` (the next request writes a fresh one), or by
   running `start.sh` with `--reset`. The server's log names every write
   (`[queue-demo] PATCH …`).

/admin/users shows Rob's card with "Bryce checks first" ticked; unticking it
or ticking it again writes the change to the log with the old and new value.
