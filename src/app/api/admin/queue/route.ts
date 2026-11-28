/*
  Queue API. GET needs the queue area (canViewQueue); POST needs a grant
  that writes there (canWorkQueue): 'edit', or 'suggest' ("can edit, Bryce
  checks first", queue-suggest.ts).

  GET  /api/admin/queue                        → { items, agent, chat,
                                                   teamChat? }
       (the rows only, no logo lookup, so the list lands in about a second;
       the page then asks /api/admin/queue/logos for the pictures)
  GET  /api/admin/queue?sync=1                 → the same, after closing the
       open Add rows whose record was deleted, published or hidden in
       Airtable itself – what the Mac worker does every five minutes, done
       now for the page's refreshes. A write, so it takes the edit grant;
       a viewer gets the plain list.
  GET  /api/admin/queue?decided=1              → { items } – every decided row,
       newest decision first, for the search's "Earlier" group (read only
       while a search is typed)
  GET  /api/admin/queue?id=<rec>               → { item } – one row as it is now
       (the page follows a Reopen with it until the Mac is done)
  GET  /api/admin/queue?target=<tbl>/<rec>     → { fields, attachments, schema,
       shown } (live; `shown` is the record's fingerprint, which the page
       sends back when it publishes an addition – queue-shown.ts; &fresh=1
       reads the table's field list anew, asked after a refusal)
  GET  /api/admin/queue?listing=<rec>          → { listing } – the listing with
       that record id as it is in Airtable now, whichever resource table
       holds it and whether or not the Queue ever did (null when none has
       it): what the search shows for a pasted id – queue-listing.ts
  GET  /api/admin/queue?history=<rec>          → { items } – every Queue row
       about the listing with that record id, for its history on the page:
       who published it and who changed what since – queue-history.ts
  GET  /api/admin/queue?order=<tbl>            → { order } – the page's published
       listings by Sort, for placing an addition (null for a table with no Sort)
  GET  /api/admin/queue?map=1                  → { records } – every Field map
       listing with its place, unpublished ones included (live, the map
       editor's own read; published logos are the site's copies), for the
       map strip on a /map addition – queue-map.ts
  POST /api/admin/queue  body { id, action, edits?, reason?, replyDraft? } → { item }
       action: accept | reject | edit | later | undo | flag | reopen | fix
       | delete | wait | public
       (later sets the item aside for a week, Fable reviews it again then;
       wait, body { on }, puts it in Waiting on them for a question he asked
       them outside email, or with on: false takes it out – waitItem;
       delete discards an open item silently: an addition's unpublished
       record goes too, the row closes, no reply, no Undo – deleteItem;
       undo also brings back an item set aside; edit keeps the page's pending edits, and the reply draft as
       edited, on the row – nothing more; flag writes the verdict, reasons
       and reject buttons Fable gave in the chat onto the row, body
       { flag } – or { undo: true } to put back what it replaced –
       queue-flag.ts; reopen brings a declined addition back, however
       old: the Mac rebuilds a deleted record from the row's saved copy –
       queue-reopen.ts; fix writes edits straight onto the listing of an
       addition already published or a change already applied, from Done
       today). An undo that could not put a field back (a picture with no
       copy to write, queue-before-picture.ts) adds { notPutBack: [names] }.
       Accepting a rule that brings wording for the public listing policy
       also takes { public: 'apply' | 'internal', publicSeen: <the wording
       the page showed> } – queue-rule-instant.ts; without them, or with
       wording that has changed since, the accept is refused. public, body
       { text, seen }, puts his own words for that sentence on the rule in
       place of the ones the page showed (seen) – savePublicWording,
       queue-rule-public.ts; nothing reaches the public page until Apply.

  Bryce checks first (queue-suggest.ts). With the 'suggest' grant, accept,
  reject, delete and later are refused (403); the page sends them as
       suggest  body { did: accept | reject | delete | later, edits?,
                replyDraft?, keep?, public?, publicSeen?, reason?,
                rejectReply? } – runs the decision's own checks, keeps the
                edits and reply draft on the row, and saves the suggestion
                on For Bryce; nothing is decided
       withdraw takes back their own suggestion or question (with full
                edit: dismisses anyone's, e.g. on a row a bot closed)
       ask      body { question } – on any item, decided ones included
  and every other action works as with 'edit', except that edit is refused
  while a suggestion on the item waits (theirs or anyone's). With full edit, accept,
  reject, delete and later on an item carrying a suggestion also take
  { suggested: <its at, as the page showed it>, suggestedPrint? } and are
  refused with 412 when the item changed since (requireSuggestionSeen). The
  refusal carries recheck { at, print? }: the page reads the item again
  and sends that print back as suggestedPrint, so the next press goes
  unless the item changed once more. The decision clears For Bryce and its
  History line names the suggester too. answer, body { answer }, answers a
  question (full edit only).

  `agent` is { port, token } for the local agent on the owner's Mac (null
  when QUEUE_AGENT_SECRET is not set): the page calls it after an accept so
  a Gmail reply draft lands at once instead of on the worker's next pass.
  Only an owner gets it (QUEUE_CHAT_OWNERS, a comma list of emails, else
  the root admins): nobody else's browser can reach his Mac, so for them
  it would only ping their own computer.

  `chat` says which Fable chat the page mounts (queue-team-chat.ts,
  chatKind): 'mac' for an owner (the chat on his Mac, as before), 'team'
  for everyone else who can work the Queue when QUEUE_TEAM_AGENT_SECRET is
  set (the same chat program on a server, reached through
  /api/admin/queue/chat), null otherwise. With 'team' comes
  `teamChat: { online }`: whether that server's agent has asked the site
  for work in the last minute.

  Every action that decides, edits or undoes something (all but edit, flag
  and public) is written onto the row's History with the signed-in admin's
  name, in the same write – queue-history.ts.

  What is applied is what the person saw (queue-shown.ts). Every Change and
  Rule item carries `shown`, a fingerprint of its proposed changes or its
  edits as the row held them when it was read. accept, reject, delete,
  later and suggest on such an item take { shown: <the item's, as the page
  showed it> } and are refused with 412 when the row's fingerprint is no
  longer that one (or none was sent): the page reads the item again. The
  fingerprint that passed is kept on the decision's History entry, where
  the Mac checks it before it writes an applied rule. Every History entry
  also carries the signed-in admin's address (`email`), which the page is
  never sent.

  A flag written from a reply in someone's Fable chat leaves a History
  line with their name ("Fable changed the verdict in Rob's chat") unless
  the chat is an owner's own, which leaves none, as before; so does
  putting the earlier one back.

  A POST must come from the admin's own page (own-page.ts): JSON, and
  neither from another site nor from another host under the same domain.

  Every accept writes to the live base, so the route re-reads the row first
  and refuses anything already decided (409). No fresh-session requirement:
  an accept is no more dangerous than a map-editor save, and the point of
  the page is one click.
*/

import { NextRequest } from 'next/server'
import {
  canViewQueue,
  canWorkQueue,
  currentAdmin,
  queueMode,
} from '@/lib/admin/auth'
import {
  CHECKER_NAME,
  parsePrint,
  SUGGEST_DIDS,
  type SuggestDid,
} from '@/lib/admin/queue-suggest'
import { mapForStrip } from '@/lib/admin/queue-map'
import {
  acceptItem,
  agentInfo,
  answerItem,
  askItem,
  closeHandledRows,
  deleteItem,
  findListing,
  fixItem,
  flagItem,
  getPageOrder,
  getQueueItem,
  laterItem,
  listDecided,
  listForListing,
  listQueue,
  QueueError,
  rejectItem,
  reopenItem,
  readTarget,
  requireRecordShown,
  requireShown,
  requireSuggestionSeen,
  sanitiseEdits,
  saveEdits,
  savePublicWording,
  suggestItem,
  undoItem,
  unflagItem,
  waitItem,
  withdrawItem,
} from '@/lib/admin/queue'
import { notOwnPageRequest } from '@/lib/admin/own-page'
import { actingAs } from '@/lib/admin/queue-actor'
import { parseFlag } from '@/lib/admin/queue-flag'
import { publicChoiceOf } from '@/lib/admin/queue-rule-instant'
import { chatKind, chatOwners } from '@/lib/admin/queue-team-chat'
import { workMailbox } from '@/lib/admin/queue-source'
import {
  relayErrorText,
  teamAgentSecret,
  teamRelay,
} from '@/lib/admin/queue-team-relay'
import { ROOT_ADMINS } from '@/lib/admin/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

async function ensureAuth(write: boolean): Promise<Response | null> {
  const allowed = write ? await canWorkQueue() : await canViewQueue()
  if (!allowed) return json({ error: 'unauthorized' }, 401)
  return null
}

/** A QueueError carries text written for the page; anything else is
 *  logged and answered with a plain summary, never the raw error. */
function failure(e: unknown): Response {
  if (e instanceof QueueError) {
    return json({ ...(e.extra ?? {}), error: e.detail }, e.status)
  }
  const msg = e instanceof Error ? e.message : String(e)
  console.error('[admin-queue]', msg)
  return json(
    { error: 'The queue could not do that; details are in the server log.' },
    502
  )
}

/** Whether the team chat's server has asked for work lately. A relay that
 *  cannot be read counts as offline: the list must still load. */
async function teamOnline(): Promise<boolean> {
  try {
    return await teamRelay().online()
  } catch (e) {
    console.warn(
      '[admin-queue] could not read whether the team chat is online:',
      relayErrorText(e)
    )
    return false
  }
}

export async function GET(req: NextRequest) {
  const auth = await ensureAuth(false)
  if (auth) return auth
  try {
    if (req.nextUrl.searchParams.get('decided') === '1') {
      return json({ items: await listDecided() })
    }
    const one = req.nextUrl.searchParams.get('id')
    if (one) {
      const item = await getQueueItem(one)
      if (!item) return json({ error: 'That item no longer exists.' }, 404)
      return json({ item })
    }
    // The Field map as it stands, for the map strip on a /map addition:
    // every listing with its place, the ones not yet published included.
    if (req.nextUrl.searchParams.get('map') === '1') {
      return json({ records: await mapForStrip() })
    }
    const listing = req.nextUrl.searchParams.get('listing')
    if (listing) return json({ listing: await findListing(listing) })
    const history = req.nextUrl.searchParams.get('history')
    if (history) return json({ items: await listForListing(history) })
    const orderOf = req.nextUrl.searchParams.get('order')
    if (orderOf) return json({ order: await getPageOrder(orderOf) })
    const target = req.nextUrl.searchParams.get('target')
    if (target) {
      const [table = '', record = ''] = target.split('/')
      const read = await readTarget(
        table,
        record,
        req.nextUrl.searchParams.get('fresh') === '1'
      )
      if (!read) return json({ error: 'That record no longer exists.' }, 404)
      return json({
        fields: read.fields,
        attachments: read.attachments,
        schema: read.schema,
        // What this read shows of the record, for a Publish to be made on.
        shown: read.shown,
      })
    }
    const me = await currentAdmin()
    let items = await listQueue()
    if (
      req.nextUrl.searchParams.get('sync') === '1' &&
      (await canWorkQueue())
    ) {
      const closed = new Set(await closeHandledRows(items))
      if (closed.size) items = items.filter(i => !closed.has(i.id))
    }
    // Which Fable chat this person's page mounts. Only an owner's page is
    // handed the Mac agent: anyone else's would call their own computer.
    const email = me?.email ?? ''
    const chat = chatKind({
      email,
      owners: owners(),
      canWork: await canWorkQueue(),
      teamOn: Boolean(teamAgentSecret()),
    })
    return json({
      items,
      agent: chat === 'mac' ? agentInfo(email, me?.name ?? null) : null,
      chat,
      // A teammate's own @aisafety.com mailbox, which gets every form's
      // email: Q opens their copy there (queue-source.ts).
      mailbox: chat === 'mac' ? null : workMailbox(email),
      ...(chat === 'team' ? { teamChat: { online: await teamOnline() } } : {}),
    })
  } catch (e) {
    return failure(e)
  }
}

const ACTIONS = new Set([
  'accept',
  'reject',
  'edit',
  'later',
  'undo',
  'flag',
  'reopen',
  'fix',
  'delete',
  'wait',
  'public',
  'suggest',
  'withdraw',
  'ask',
  'answer',
])

/** The actions that decide an item. With the 'suggest' grant they arrive as
 *  'suggest' instead; sent as themselves (an old tab), they are refused. */
const DECISIONS = new Set(['accept', 'reject', 'delete', 'later'])

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []

/** The people whose Fable chat is the one on the owner's Mac. */
function owners(): Set<string> {
  return chatOwners(
    process.env.QUEUE_CHAT_OWNERS,
    ROOT_ADMINS.map(u => u.email)
  )
}

export async function POST(req: NextRequest) {
  // The session rides on a cookie, which a browser also sends with a form
  // on another site: only the Queue page's own JSON writes are taken.
  if (notOwnPageRequest(req, { json: true })) {
    return json(
      { error: 'That request did not come from the Queue page.' },
      403
    )
  }
  const auth = await ensureAuth(true)
  if (auth) return auth
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (parsed && typeof parsed === 'object') {
      body = parsed as Record<string, unknown>
    }
  } catch {
    // empty body: handled below
  }
  const id = typeof body.id === 'string' ? body.id : ''
  const action = typeof body.action === 'string' ? body.action : ''
  if (!ACTIONS.has(action)) return json({ error: 'unknown action' }, 400)
  const me = await currentAdmin()
  // Every History entry written below carries this person's address beside
  // their name (queue-actor.ts): the Mac goes by the address.
  return actingAs(me?.email, () => decide(id, action, body, me))
}

/** One action on one item, by the signed-in admin. */
async function decide(
  id: string,
  action: string,
  body: Record<string, unknown>,
  me: Awaited<ReturnType<typeof currentAdmin>>
): Promise<Response> {
  try {
    const item = await getQueueItem(id)
    if (!item) return json({ error: 'That item no longer exists.' }, 404)
    // The name the row's history keeps for this action.
    const by = me?.name || me?.email || null
    const checkFirst = (await queueMode()) === 'suggest'
    if (checkFirst && (DECISIONS.has(action) || action === 'answer')) {
      return json(
        {
          error:
            action === 'answer'
              ? `Answers come from ${CHECKER_NAME} or someone else with full Queue edit.`
              : `${CHECKER_NAME} checks your decisions first, so nothing was decided. Reload the page, then send it as a suggestion.`,
        },
        403
      )
    }
    if (!checkFirst && action === 'suggest') {
      return json(
        { error: 'You can decide this yourself, with no suggestion.' },
        400
      )
    }
    if (DECISIONS.has(action)) {
      requireSuggestionSeen(
        item,
        typeof body.suggested === 'string' ? body.suggested : null,
        parsePrint(body.suggestedPrint)
      )
    }
    // A decision on a change or a rule, or a suggestion of one, is made on
    // the changes or edits the page showed (queue-shown.ts).
    if (DECISIONS.has(action) || action === 'suggest') {
      requireShown(item, body.shown)
    }
    // Publishing an addition, or suggesting it, is made on the record the
    // page showed: what goes on the site is the record as it stands.
    if (
      action === 'accept' ||
      (action === 'suggest' && body.did === 'accept')
    ) {
      await requireRecordShown(item, body.shown)
    }
    let notPutBack: string[] = []
    if (action === 'suggest') {
      const did = body.did as SuggestDid
      if (!SUGGEST_DIDS.includes(did)) {
        return json({ error: 'Suggest what?' }, 400)
      }
      const choice = publicChoiceOf(body.public)
      await suggestItem(
        item,
        {
          did,
          edits: body.edits === undefined ? null : sanitiseEdits(body.edits),
          replyDraft:
            typeof body.replyDraft === 'string' ? body.replyDraft : null,
          keep: strings(body.keep),
          publicWording: choice
            ? {
                choice,
                seen:
                  typeof body.publicSeen === 'string' ? body.publicSeen : null,
              }
            : null,
          reason: typeof body.reason === 'string' ? body.reason : '',
          rejectReply:
            typeof body.rejectReply === 'string' ? body.rejectReply : null,
        },
        by
      )
    } else if (action === 'withdraw') {
      await withdrawItem(item, by, !checkFirst)
    } else if (action === 'ask') {
      await askItem(
        item,
        typeof body.question === 'string' ? body.question : '',
        by
      )
    } else if (action === 'answer') {
      await answerItem(
        item,
        typeof body.answer === 'string' ? body.answer : '',
        by
      )
    } else if (action === 'accept') {
      const choice = publicChoiceOf(body.public)
      await acceptItem(
        item,
        sanitiseEdits(body.edits),
        typeof body.replyDraft === 'string' ? body.replyDraft : null,
        // Proposed fields Fable has already changed on the record.
        Array.isArray(body.keep)
          ? body.keep.filter((k): k is string => typeof k === 'string')
          : [],
        // A rule's wording for the public listing policy: what he chose,
        // and the wording the page showed him.
        choice
          ? {
              choice,
              seen:
                typeof body.publicSeen === 'string' ? body.publicSeen : null,
            }
          : null,
        by
      )
    } else if (action === 'reject') {
      await rejectItem(
        item,
        typeof body.reason === 'string' ? body.reason : '',
        typeof body.rejectReply === 'string' ? body.rejectReply : null,
        by
      )
    } else if (action === 'edit') {
      await saveEdits(
        item,
        sanitiseEdits(body.edits),
        typeof body.replyDraft === 'string' ? body.replyDraft : undefined,
        Array.isArray(body.keys)
          ? body.keys.filter((k): k is string => typeof k === 'string')
          : undefined,
        { by, checkFirst }
      )
      return json({ item: await getQueueItem(id) })
    } else if (action === 'fix') {
      await fixItem(item, sanitiseEdits(body.edits), by)
    } else if (action === 'later') {
      await laterItem(item, by)
    } else if (action === 'wait') {
      await waitItem(item, body.on !== false, by)
    } else if (action === 'public') {
      if (typeof body.text !== 'string') {
        return json({ error: 'No wording was sent.' }, 400)
      }
      await savePublicWording(
        item,
        body.text,
        typeof body.seen === 'string' ? body.seen : null
      )
    } else if (action === 'delete') {
      await deleteItem(item, by)
    } else if (action === 'reopen') {
      await reopenItem(item, by)
    } else if (action === 'flag') {
      // From a teammate's chat it is on the item's History with their
      // name; from an owner's own chat it leaves no line, as before.
      const named = owners().has((me?.email ?? '').toLowerCase())
        ? undefined
        : by
      if (body.undo === true) {
        await unflagItem(item, named)
      } else {
        const parsed = parseFlag(body.flag, item.type)
        if ('error' in parsed) return json({ error: parsed.error }, 400)
        await flagItem(item, parsed.flag, named)
      }
    } else {
      notPutBack = await undoItem(item, by)
    }
    console.log(
      `[admin-queue] ${action} ${item.type} ${item.id} "${item.title}" by ${me?.name ?? me?.email ?? '?'}${notPutBack.length ? ` – not put back: ${notPutBack.join(', ')}` : ''}`
    )
    return json({
      item: await getQueueItem(id),
      ...(notPutBack.length ? { notPutBack } : {}),
    })
  } catch (e) {
    return failure(e)
  }
}
