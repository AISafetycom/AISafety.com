# Local Queue demo: "Bryce checks first" and the team's Fable chat

Runs this checkout's `/admin/queue` with made-up rows and two made-up
people, and no Airtable at all, so the suggest → From Rob → confirm flow can
be tried and recorded in a browser without touching the live base. The
team's Fable chat works too, against a stand-in for its server that gives
canned replies, so no server and no model are needed either.

- `fake-airtable.mjs` is loaded into the dev server (`NODE_OPTIONS=--import`)
  and answers every request to `api.airtable.com` from
  `.admin-dev/queue-demo.json`, which it fills from `seed.mjs` the first time.
  It refuses to load unless the token is the demo placeholder, and the server
  also runs with a placeholder base id, so nothing can reach the real base.
- `start.sh` sets those placeholders, blanks every other service the admin
  can reach (Mac agent, mail, Redis, Blob), writes the two people into
  `.admin-dev/users.json`, and starts the server. It refuses to run in a
  checkout that has a `.env` file of any kind (`.env`, `.env.local`,
  `.env.development` …).
- `fake-team-agent.mjs` stands in for the team chat's server
  (`src/lib/admin/queue-team-chat.ts`). Like the real one it only calls
  out: it asks the demo server for the requests the page has left, with a
  token sealed under the demo's placeholder secret, and posts each answer
  back in pieces, in the real agent's own formats. As the real one must,
  it checks the site's signature on each request, says it has a request
  before working on it, and never runs one twice. `start.sh` starts it
  (log: `.admin-dev/fake-team-agent.log`). It refuses to run with any
  other secret or beside a `.env` file of any kind, talks only to
  `localhost`, and
  stops by itself three minutes after the demo server has gone, or as soon
  as `.admin-dev/fake-team-agent.pid` is deleted or names a newer one.
- `cookie.mjs` prints the line that signs a browser tab in as one of the two
  people.

The people (neither is a real account):

| Email                    | Name       | Queue grant                  | Fable chat                        |
| ------------------------ | ---------- | ---------------------------- | --------------------------------- |
| `bryce.demo@example.org` | Bryce Demo | can edit (and Admin admin)   | the owner's (a Mac's): none here  |
| `rob.demo@example.org`   | Rob Demo   | can edit, Bryce checks first | the team's, through the demo site |

Bryce Demo is the chat's owner here (`QUEUE_CHAT_OWNERS`), as the real
owner is on the site: his chat would be the one on his own Mac, which the
demo does not have, so his page shows no chat panel and never calls
`127.0.0.1`. Everyone else gets the team's chat. Started with
`--mac-chat`, the demo also stands in for the Mac's agent (the same script,
on `127.0.0.1:8795`, with threads of its own and a placeholder secret of
its own), and Bryce Demo's page then mounts the Mac chat, called directly,
with the "Mac" dot at the top right.

## Steps

1. Start it from this checkout (port 3471, fresh rows and chat threads):

   ```sh
   sh scripts/queue-demo/start.sh 3471 --reset
   ```

   Add `--no-chat-server` to leave the stand-in for the chat's server off,
   and `--mac-chat` to give Bryce Demo a stand-in for the chat on his Mac.
   Each changes what the server itself is started with, so stop a running
   one first.

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

8. The team's Fable chat, as Rob. Open "Demo: Harbor City AI Safety
   Unconference": the chat box is under Fable's verdict (F puts the cursor
   in it). Type `Can you shorten the description?` and press Enter. The
   reply streams in, then two cards land by themselves: the new
   Description goes into the item's edit box ("Applied – goes with your
   suggestion", with Undo edit) and the new reply into the reply draft.
   Nothing has reached the site: press **Suggest publish** and the edits
   travel with the suggestion, for Bryce to confirm in step 5. While that
   suggestion waits, the chat's cards read "Take back your suggestion to
   use this". Other things to try:
   - Reload the page mid-reply (say `slow` for a long one): the panel says
     Fable is still answering and the reply lands when it is done.
   - Say `slow`, then send a second message while it is being written: it
     waits its turn ("You · waiting", with Remove) and is answered next.
     The round button stops the reply being written.
   - Paste a screenshot or drop a file: up to 2.5 MB of files a message
     here; a bigger one is refused with a line saying so.
   - **Start over** clears the thread. A dictation mic is not there: that
     is the Mac chat's.
   - The server offline: delete `.admin-dev/fake-team-agent.pid` (the
     stand-in stops within two seconds). A minute later the panel says the
     chat's server is offline, and a message sent anyway ends after 30
     seconds with "The chat's server isn't answering. Try again in a
     minute." Start it again with
     `node scripts/queue-demo/fake-team-agent.mjs 3471 >> .admin-dev/fake-team-agent.log 2>&1 &`;
     the note goes with the page's next refresh, within a minute.
   - Sign in as Bryce (step 3): no chat panel and no "Mac" dot, because his
     chat is the one on a Mac. With `--mac-chat` he has both, his page
     calls `127.0.0.1:8795` itself, and nothing of his goes through the
     site's relay; his cards read "Applied – goes with Accept".

9. A change proposed in the chat. The team's chat never changes a
   published listing itself: it files the change as an item of its own.
   "Demo: Safety Careers Evening: description" is one, in the Requests
   section on the Changes tab, with the chat's icon, "Queue chat" as its
   source, and its words under "Proposed in the Queue chat · by Rob Demo".
   It is decided like any change (Rob suggests, Bryce confirms).

/admin/users shows Rob's card with "Bryce checks first" ticked; unticking it
or ticking it again writes the change to the log with the old and new value.

The stand-in's replies are canned: the first message on an item, or one
that mentions the description, the wording or the reply, gets an `edits`
block (and a `reply` block on an item with a reply draft); `slow` gets a
long reply; `verdict` gets a new verdict, which the page writes onto the
item with a History line naming whose chat it was ("Fable changed the
verdict in Rob's chat"; the owner's own chat leaves none); anything else a
short answer. The threads are kept in
`.admin-dev/queue-demo-chat.json`, and `--reset` clears them.
