/*
  Listings that changed under a waiting newsletter (Bryce, 9 October 2026).

  Week 41 went out with three dates the organizers had changed after Comb
  read them (DISPATCH, Test Bench #1, The Commons Problem). Broom caught all
  three two hours after the first wave, and its fixes waited in the Queue,
  which Bryce rarely opens: "I need to be told before I send the newsletters
  out". So the approval page shows, for every waiting draft, each listing in
  it that has
    - an open Broom item in the Queue (a change Broom found on the
      organizer's page that nobody has applied yet), or
    - card text that no longer matches the listing as the site draws it now
      (the listing was edited after the issue was built),
  with one button each: Fix (apply Broom's change to the listing, exactly as
  the Queue's Apply does, then rewrite the card) or Update email (rewrite the
  card from the listing).

  Events and Training cards are drawn by the site's own card builders
  (~/Newsletter/sitecards.py runs eventCardProps / trainingCardProps on the
  public Data API), so the same builders run here on the listing read fresh
  from Airtable give the text the card should carry: `title` = name, `m0…` =
  the lines under the title, `desc` = description, `b0…` = the bottom rows,
  empty rows dropped before numbering (render.py meta_rows). A card whose
  rows changed shape (a row added or gone, another icon: "Applications
  closed") can't be rewritten field by field – the page says so and a
  rebuild from Pen fixes it. Funding cards are Pen's wording, so only their
  open Broom items show.
*/

import type { CardProps } from '@/components/ListingCard'
import { eventCardProps } from '@/app/events/card'
import { trainingCardProps } from '@/app/training/card'
import type { EventListing } from '@/lib/data/events'
import { TABLE_ID as EVENTS_TABLE } from '@/lib/data/events'
import type { TrainingProgram } from '@/lib/data/training'
import { TRAINING_TABLE_ID } from '@/lib/data/training'
import { airtableRequest, isRecordId } from './airtable'
import {
  DraftProblemError,
  draftCardGroups,
  editDraftCard,
  type CardGroup,
  type CardInfo,
} from './newsletter'
import {
  acceptItem,
  getPreviewListings,
  getQueueItem,
  listQueue,
  QueueError,
  sanitiseEdits,
  type PreviewListing,
  type QueueItem,
} from './queue'

/** A line of the card the site would draw: the email's field name, its icon
 *  (null for the title and the description) and the text. */
export interface SiteField {
  name: string
  icon: string | null
  value: string
}

/** One piece of card text that differs from the listing now. */
export interface FieldChange {
  name: string
  label: string
  /** What the email says. */
  email: string
  /** What the site says. */
  site: string
}

/** An open Broom item in the Queue for a listing in the draft. */
export interface BroomFix {
  id: string
  verdict: string | null
  /** Pending / Failed can be applied; Revising waits for Fable. */
  status: string
  changes: Array<{ field: string; from: string; to: string }>
  /** Fable Review's first reason, as the Queue shows it. */
  reason: string | null
}

export interface ListingAlert {
  key: string
  group: string
  title: string
  broom: BroomFix[]
  changes: FieldChange[]
  /** The card can be rewritten from the listing, field by field. */
  updatable: boolean
  /** Why it can't, or what else to know; null when there's nothing. */
  note: string | null
}

const OPEN = new Set(['Pending', 'Failed', 'Revising'])

/** Whitespace collapsed, as the email's text is (sitecards.py `tidy`). */
export function tidy(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

function iconName(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.[a-z]+$/i, '')
}

/** Pure: the fields an email card drawn from these props carries, in the
 *  email's order. Mirrors sitecards.py `email_card` + render.py `meta_rows`. */
export function siteFields(p: CardProps): SiteField[] {
  const rows = (prefix: string, list: CardProps['meta'] | undefined) =>
    (list ?? [])
      .map(r => ({ icon: iconName(r.icon), value: tidy(r.value) }))
      .filter(r => r.value)
      .map((r, i) => ({ name: `${prefix}${i}`, ...r }))
  const out: SiteField[] = [
    { name: 'title', icon: null, value: tidy(p.name) },
    ...rows('m', p.titleMeta),
  ]
  const desc = tidy(p.description)
  if (desc) out.push({ name: 'desc', icon: null, value: desc })
  return [...out, ...rows('b', p.meta)]
}

/** Pure: how the card differs from what the site would draw now. A field
 *  counts as changed when the site's text differs from the text the card
 *  was built with (so the listing changed since) and from what it says now
 *  (so it isn't already fixed by hand). */
export function compareCard(
  card: CardInfo,
  site: SiteField[]
): { changes: FieldChange[]; updatable: boolean; note: string | null } {
  const shape = (fs: Array<{ name: string; icon: string | null }>) =>
    fs.map(f => `${f.name}:${f.icon ?? ''}`).join(' ')
  const bySite = new Map(site.map(f => [f.name, f]))
  const changes: FieldChange[] = []
  for (const f of card.fields) {
    const s = bySite.get(f.name)
    if (!s) continue
    const built = tidy(f.original ?? f.value)
    if (s.value !== built && s.value !== tidy(f.value))
      changes.push({
        name: f.name,
        label: f.label,
        email: tidy(f.value),
        site: s.value,
      })
  }
  const sameShape = shape(card.fields) === shape(site)
  if (sameShape) return { changes, updatable: true, note: null }
  // Rows added, gone or with another icon: list what the site has instead.
  const have = new Set(card.fields.map(f => tidy(f.value)))
  const extra = site.filter(f => !have.has(f.value)).map(f => f.value)
  return {
    changes,
    updatable: false,
    note:
      'The site’s card for this listing now has different lines' +
      (extra.length ? ` (${extra.map(v => `“${v}”`).join(', ')})` : '') +
      ', so the email can’t be updated line by line. Ask Pen to rebuild the issue.',
  }
}

function display(v: unknown): string {
  if (v == null || v === '') return '(empty)'
  if (Array.isArray(v)) return v.map(x => display(x)).join(', ')
  if (typeof v === 'object') return '(file)'
  return String(v)
}

function broomFix(item: QueueItem): BroomFix {
  return {
    id: item.id,
    verdict: item.verdict,
    status: item.status,
    changes: item.changes.map(c => ({
      field: c.field,
      from: display(c.from),
      to: display(c.to),
    })),
    reason: item.reasons[0] ?? null,
  }
}

/** The open Broom items that should hold a send: anything but a Fable
 *  "Dismiss" (Broom was wrong). */
export function openBroomItems(items: QueueItem[], keys: Set<string>) {
  return items.filter(
    i =>
      i.source === 'Broom' &&
      i.type === 'Change' &&
      OPEN.has(i.status) &&
      i.verdict !== 'Dismiss' &&
      i.targetRecord != null &&
      keys.has(i.targetRecord)
  )
}

function propsOf(preview: PreviewListing | null): CardProps | null {
  if (!preview) return null
  if (preview.kind === 'event')
    return eventCardProps(preview.listing as EventListing)
  if (preview.kind === 'training')
    return trainingCardProps(preview.listing as TrainingProgram)
  return null
}

/** Pure: the alerts for one draft, from its cards, the open Queue rows and
 *  each listing as the site would map it now (keyed "table/record", both
 *  tables tried: a key is in one of them, or neither for a funding card). */
export function listingAlerts(
  groups: CardGroup[],
  queue: QueueItem[],
  previews: Record<string, PreviewListing | null>
): ListingAlert[] {
  const keys = new Set(
    groups.flatMap(g => g.cards.map(c => c.key)).filter(isRecordId)
  )
  const broom = openBroomItems(queue, keys)
  const out: ListingAlert[] = []
  for (const g of groups) {
    for (const card of g.cards) {
      if (!isRecordId(card.key)) continue
      const mine = broom.filter(i => i.targetRecord === card.key)
      const props =
        propsOf(previews[`${EVENTS_TABLE}/${card.key}`] ?? null) ??
        propsOf(previews[`${TRAINING_TABLE_ID}/${card.key}`] ?? null)
      const cmp =
        props && card.fields.length > 0
          ? compareCard(card, siteFields(props))
          : { changes: [], updatable: false, note: null }
      // A shape change with no text change is still news (a deadline row
      // appeared); a funding card has no site card to compare with.
      if (mine.length === 0 && cmp.changes.length === 0 && !cmp.note) continue
      out.push({
        key: card.key,
        group: g.id,
        title: card.title,
        broom: mine.map(broomFix),
        changes: cmp.changes,
        updatable: cmp.updatable,
        note:
          cmp.note ??
          (!props && mine.length > 0
            ? 'This card’s text comes from Pen: after Fix, edit it in the preview or ask Pen to rebuild.'
            : null),
      })
    }
  }
  return out
}

/** Each listing in the draft as the site would map it now: one list read
 *  per table (Events, Training), uncached, so an edit a moment ago counts. */
async function previewsFor(
  keys: string[]
): Promise<Record<string, PreviewListing | null>> {
  if (keys.length === 0) return {}
  return getPreviewListings(
    keys.flatMap(record => [
      { table: EVENTS_TABLE, record, edits: {} },
      { table: TRAINING_TABLE_ID, record, edits: {} },
    ])
  )
}

function recordKeys(groups: CardGroup[]): string[] {
  return [
    ...new Set(groups.flatMap(g => g.cards.map(c => c.key)).filter(isRecordId)),
  ]
}

/** The alerts for a draft, read now: its cards from ActiveCampaign, the
 *  Queue's open rows and the listings from Airtable. */
export async function draftListingAlerts(
  draftId: string,
  messageId?: string
): Promise<ListingAlert[]> {
  const groups = await draftCardGroups(draftId, messageId)
  const keys = recordKeys(groups)
  const [queue, previews] = await Promise.all([
    keys.length ? listQueue() : Promise.resolve([] as QueueItem[]),
    previewsFor(keys),
  ])
  return listingAlerts(groups, queue, previews)
}

/** Proposed fields someone already changed on the listing since Broom
 *  flagged it (the value is neither Broom's "from" nor its "to"): Apply
 *  leaves those alone, as the Queue does for Fable's chat changes. */
async function alreadyChanged(item: QueueItem): Promise<string[]> {
  if (!item.targetTable || !item.targetRecord) return []
  const res = await airtableRequest(`${item.targetTable}/${item.targetRecord}`)
  if (!res.ok) return []
  const fields = ((await res.json()) as { fields?: Record<string, unknown> })
    .fields
  const same = (a: unknown, b: unknown) => display(a) === display(b)
  return item.changes
    .filter(c => {
      const now = fields?.[c.field] ?? null
      return !same(now, c.from) && !same(now, c.to)
    })
    .map(c => c.field)
}

export interface FixResult {
  cards: CardGroup[]
  alerts: ListingAlert[]
  /** Broom's change went into the listing. */
  applied: boolean
  /** The card's text in the email was rewritten. */
  cardUpdated: boolean
  /** What still needs doing, in plain words; null when nothing does. */
  note: string | null
}

/** Fix one listing of a draft: with `queueId`, apply that open Broom item
 *  to the listing first (the Queue's Apply: Status Applied, the flag row
 *  gone); then rewrite the card from the listing as the site now draws it,
 *  when its lines still have the same shape. */
export async function fixListing(
  draftId: string,
  key: string,
  queueId: string | null,
  messageId?: string
): Promise<FixResult> {
  if (!isRecordId(key)) throw new QueueError('Not a listing card.', 400)
  let groups = await draftCardGroups(draftId, messageId)
  const group = groups.find(g => g.cards.some(c => c.key === key))
  if (!group) throw new QueueError('That card is no longer in this email.', 409)
  let applied = false
  let note: string | null = null
  if (queueId) {
    const item = await getQueueItem(queueId)
    if (
      !item ||
      item.source !== 'Broom' ||
      item.type !== 'Change' ||
      item.targetRecord !== key
    )
      throw new QueueError(
        'That Broom item is gone or isn’t about this listing. Reload the page.',
        409
      )
    const keep = await alreadyChanged(item)
    await acceptItem(item, sanitiseEdits(item.edits ?? {}), null, keep)
    applied = true
    if (keep.length)
      note = `Left ${keep.join(', ')} as it is: someone changed it on the listing after Broom’s check.`
  }
  const previews = await previewsFor([key])
  const card = group.cards.find(c => c.key === key) as CardInfo
  const props =
    propsOf(previews[`${EVENTS_TABLE}/${key}`] ?? null) ??
    propsOf(previews[`${TRAINING_TABLE_ID}/${key}`] ?? null)
  let cardUpdated = false
  if (props && card.fields.length > 0) {
    const cmp = compareCard(card, siteFields(props))
    if (cmp.changes.length > 0 && cmp.updatable) {
      try {
        const values = Object.fromEntries(
          cmp.changes.map(c => [c.name, c.site])
        )
        groups = (
          await editDraftCard(
            draftId,
            group.id,
            key,
            values,
            undefined,
            messageId
          )
        ).cards
        cardUpdated = true
      } catch (err) {
        if (!(err instanceof DraftProblemError)) throw err
        note = [
          note,
          `The email couldn’t be updated: ${err.problems.join('; ')}.`,
        ]
          .filter(Boolean)
          .join(' ')
      }
    } else if (!cmp.updatable) {
      note = [note, cmp.note].filter(Boolean).join(' ')
    }
  }
  const queue = await listQueue()
  const alerts = listingAlerts(
    groups,
    queue,
    await previewsFor(recordKeys(groups))
  )
  return { cards: groups, alerts, applied, cardUpdated, note }
}
