import { NextRequest } from 'next/server'
import { canViewConversationLog, currentAdmin } from '@/lib/admin/auth'
import {
  REVIEW_VALUES,
  getConversation,
  isRecordId,
  isConversationsTableConfigured,
  listAnnotationFacets,
  listConversationsPage,
  NoteNotFoundError,
  updateConversation,
  type ReviewValue,
} from '@/lib/admin/airtable'
import { getCatalog } from '@/lib/assistant/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Pulls the listing ids out of every [[card:ID|note]] token in a reply. */
const CARD_ID_RE = /\[\[\s*card\s*:\s*([^\]|\n]+?)(?:\s*\|[^\n]*?)?\s*\]\]/gi
function collectCardIds(text: string, into: Set<string>): void {
  CARD_ID_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CARD_ID_RE.exec(text)) !== null) {
    into.add(m[1].replace(/\s+/g, ''))
  }
}

const REC_RE = /rec[A-Za-z0-9]+/

async function ensureAuth(): Promise<Response | null> {
  if (!(await canViewConversationLog())) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!isConversationsTableConfigured()) {
    return new Response(
      JSON.stringify({ error: 'ADMIN_CONVERSATIONS_TABLE_ID not set' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
  return null
}

export async function GET(req: NextRequest) {
  const auth = await ensureAuth()
  if (auth) return auth
  const url = new URL(req.url)

  // Label/verdict counts for the filter pills and the label pickers — a
  // lightweight sidecar request, separate from the heavy conversation list.
  if (url.searchParams.get('facets') === '1') {
    return Response.json(await listAnnotationFacets())
  }

  const rawLimit = Number(url.searchParams.get('limit') ?? '200')
  const pageSize = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.floor(rawLimit), 200))
    : 200
  const offsetParam = url.searchParams.get('offset') || undefined
  const zeroOnly = url.searchParams.get('zeroOnly') === '1'
  const search = url.searchParams.get('search') || undefined
  const review = url.searchParams.getAll('rating')
  const label = url.searchParams.getAll('label')
  // A shared link names one conversation by record id — serve exactly that
  // one (it may be far older than any page of the list).
  const id = url.searchParams.get('id')
  let conversations, offset
  if (id) {
    const single = await getConversation(id)
    if (!single) {
      return new Response(JSON.stringify({ error: 'conversation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    conversations = [single]
    offset = null
  } else {
    ;({ conversations, offset } = await listConversationsPage({
      pageSize,
      offset: offsetParam,
      search,
      review,
      label,
    }))
  }
  // zeroMatches now lives inside Data; filter client-side here so the API
  // contract stays the same for the admin viewer.
  const filtered = zeroOnly
    ? conversations.filter(c => c.data?.zeroMatches === true)
    : conversations

  // Card tokens store only the listing id + inline note, not the listing's
  // name or logo, so the transcript viewer can't tell which listing a card
  // actually is. Resolve the referenced ids against the catalog and ship a
  // {name, logo} lookup map alongside the conversations.
  const referencedIds = new Set<string>()
  for (const c of filtered) {
    if (!c.data) continue
    collectCardIds(c.data.response, referencedIds)
    for (const turn of c.data.history) {
      if (turn.role === 'assistant') collectCardIds(turn.content, referencedIds)
    }
    for (const id of c.data.citations) referencedIds.add(id)
    for (const id of c.clickedCitations) referencedIds.add(id)
    // Listing ids the bot read live webpages or past-round history for, so
    // the transcript's "visited …'s webpage" / "checked past rounds of …"
    // notes can show the listing's name even when the call failed and the
    // listing was never carded or cited.
    for (const turn of c.data.tools) {
      if (!Array.isArray(turn)) continue
      for (const t of turn) {
        const call = t as { name?: unknown; input?: { id?: unknown } }
        if (
          (call?.name === 'read_listing_page' ||
            call?.name === 'get_program_history') &&
          typeof call.input?.id === 'string'
        ) {
          referencedIds.add(call.input.id)
        }
      }
    }
  }

  type ListingInfo = {
    name: string
    organization?: string
    logo?: string
    url?: string
    pageUrl?: string
  }
  const listings: Record<string, ListingInfo> = {}
  if (referencedIds.size > 0) {
    const catalog = await getCatalog()
    const byId = new Map<string, ListingInfo>()
    const byRec = new Map<string, ListingInfo>()
    for (const l of catalog.listings) {
      const info = {
        name: l.name,
        organization: l.organization,
        logo: l.logo,
        url: l.url,
        pageUrl: l.pageUrl,
      }
      byId.set(l.id, info)
      const rec = REC_RE.exec(l.id)?.[0]
      if (rec) byRec.set(rec, info)
    }
    for (const id of referencedIds) {
      const rec = REC_RE.exec(id)?.[0]
      const info = byId.get(id) ?? (rec ? byRec.get(rec) : undefined)
      if (info) {
        listings[id] = info
        if (rec) listings[rec] = info
      }
    }
  }

  // Fall back to the name/url snapshot stored at log time for any listing the
  // live catalog no longer has (e.g. an event deleted after it ended). Only
  // fills gaps – the live catalog wins when the listing still exists.
  for (const c of filtered) {
    for (const ref of c.data?.citationRefs ?? []) {
      if (listings[ref.id]) continue
      const info: ListingInfo = {
        name: ref.name,
        organization: ref.organization,
        logo: ref.logo,
        url: ref.url,
      }
      listings[ref.id] = info
      const rec = REC_RE.exec(ref.id)?.[0]
      if (rec && !listings[rec]) listings[rec] = info
    }
  }

  return Response.json({ conversations: filtered, listings, offset })
}

export async function PATCH(req: NextRequest) {
  const auth = await ensureAuth()
  if (auth) return auth
  let body: {
    id?: unknown
    notes?: unknown
    tags?: unknown
    review?: unknown
    addNote?: unknown
    deleteNote?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return new Response('invalid JSON', { status: 400 })
  }
  if (typeof body.id !== 'string' || !body.id) {
    return new Response(JSON.stringify({ error: 'id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!isRecordId(body.id)) {
    return new Response(
      JSON.stringify({ error: 'id must be an Airtable record id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }
  const patch: {
    notes?: string
    tags?: string[]
    review?: ReviewValue | null
    addNote?: string
    deleteNote?: { index: number; at: string; actor: string }
  } = {}
  if (typeof body.notes === 'string') patch.notes = body.notes
  // A signed note: the server stamps it with the signed-in name and time.
  if (typeof body.addNote === 'string' && body.addNote.trim()) {
    patch.addNote = body.addNote.trim().slice(0, 4000)
  }
  if (Array.isArray(body.tags) && body.tags.every(t => typeof t === 'string')) {
    patch.tags = (body.tags as string[]).map(t => t.trim()).filter(Boolean)
  }
  // Only the three known verdicts may be written (null clears) — the update
  // uses typecast for Tags, and this guard keeps it from ever inventing a
  // fourth Review option.
  if (body.review === null) {
    patch.review = null
  } else if (REVIEW_VALUES.includes(body.review as ReviewValue)) {
    patch.review = body.review as ReviewValue
  }
  if (body.deleteNote && typeof body.deleteNote === 'object') {
    const d = body.deleteNote as Record<string, unknown>
    if (
      typeof d.index === 'number' &&
      Number.isInteger(d.index) &&
      d.index >= 0 &&
      typeof d.at === 'string' &&
      typeof d.actor === 'string'
    ) {
      patch.deleteNote = { index: d.index, at: d.at, actor: d.actor }
    }
  }
  // The row's Review log names whoever made the change.
  const who = await currentAdmin()
  let updated
  try {
    updated = await updateConversation(body.id, patch, who?.name ?? 'unknown')
  } catch (err) {
    if (err instanceof NoteNotFoundError) {
      return Response.json({ error: err.message }, { status: 409 })
    }
    throw err
  }
  return Response.json({ conversation: updated })
}
