/*
  The Queue: one Airtable table ("Queue", tblonlKwIFJ7Aa8QN) holding every
  proposed change or addition to the directory that is waiting for the owner.
  Rows are written by the bots on Bryce's Mac (Comb's Fable Review, Broom's
  Fable Review, the Secretary, the Discord intake); this file is the site's
  side — list the rows, and carry out a decision:

    accept  Add     → tick Publish? on the target record (plus any edits;
                      a Sort already taken moves the listings below down)
            Change  → write the proposed field values (a proposed Publish? or
                      Hide? box included), drop the Broom flag row
            Rule    → mark Accepted; the Mac worker patches the rulebook
    reject          → mark Rejected with the reason (the worker deletes a
                      rejected suggestion 24 hours later, so there is an undo)
    revise          → mark Revising with a note; the worker asks Claude to
                      rewrite the proposal and puts it back as Pending
    later           → set Review again on a week ahead: the page sets the
                      item aside until then, and the Mac worker has Fable
                      review it again when it is due (queue-later.ts)
    undo            → reverse an accept or reject made in the last day, or
                      bring back an item set aside
    reopen          → bring a declined addition back, however old: marks the
                      row and the Mac rebuilds the record if it was deleted,
                      then reopens the row (queue-reopen.ts)
    flag            → the verdict, reasons and reject buttons Fable gave in
                      the chat onto the row ("Update flag", queue-flag.ts);
                      its Undo puts back what they replaced
    suggest         → someone whose Queue grant is "Bryce checks first"
                      saves a Publish, Reject, Delete or Review again in a
                      week on the row's For Bryce field instead of deciding;
                      the usual decision by someone with full edit confirms
                      it (queue-suggest.ts). withdraw takes one back (or
                      dismisses it), ask and answer carry a question.

  Writes to the resource tables go through the raw admin client (no cache);
  after a publish or a field change the public cache tag is revalidated so
  the live pages pick it up within a few minutes. Field ids for the Queue
  table are permanent; target-record fields are addressed by NAME because
  the proposals name them and "Publish?"/"Hide?" are the same on every
  resource table.
*/

import { revalidateTag } from 'next/cache'
import {
  airtableRequest,
  isRecordId,
  listAll,
  type AirtableRow,
} from './airtable'
import { sealToken } from './session'
import { actorEmail } from './queue-actor'
import { CHAT_SOURCE, chatProposed } from './queue-chat-source'
import {
  ruleEditsOf,
  ruleMarkOf,
  type RuleEdit,
  type RuleMark,
} from './queue-rule-edits'
import { shownOf, shownOfRecord } from './queue-shown'
import { parseRejectDrafts } from './queue-decline'
import { listingState, type FoundListing } from './queue-listing'
import { isExpiredAttachment } from './attachment-url'
import { isSpent, keepPictures } from './queue-before-picture'
import {
  keepsOrder,
  NO_PLACE,
  roomFor,
  SORT_FIELD,
  sortValue,
  type Placed,
} from './queue-place'
import { fillFirst, neededLeft } from './queue-needed'
import { addedDates, type ListingDates } from './queue-urgent'
import { reviewAgainAt } from './queue-later'
import {
  passedBlock,
  passedOf,
  TAKEN_OUT_FORMULA,
  type Passed,
} from './queue-passed'
import { ruleTestOf, type RuleTest } from './queue-rule-test'
import { CHECKED_KEY, checkedOf, type CheckedClaim } from './queue-checked'
import {
  FIELD_FLAGS_KEY,
  fieldFlagsOf,
  type FieldFlags,
} from './queue-field-flags'
import {
  preparedFilesOf,
  preparedNamed,
  withPreparedPictures,
  type PreparedFile,
} from './queue-prepared'
import {
  PUBLIC_KEY,
  publicChoiceOf,
  ruleInstantOf,
  rulePublicOf,
  type PublicChoice,
  type RuleInstant,
  type RulePublic,
} from './queue-rule-instant'
import { rewritePublic } from './queue-rule-public'
import { alreadyRepliedOf, type AlreadyReplied } from './queue-already'
import {
  askedOf,
  askedState,
  ELSEWHERE_KEY,
  elsewhereOf,
  latestAsked,
  type Asked,
} from './queue-asked'
import { replyAlsoOf } from './queue-also'
import { reasonsText, type FlagUpdate } from './queue-flag'
import { LEFT_OUT_KEY, leftOutOf, withLeftOut } from './queue-left-out'
import {
  GONE_KEY,
  goneFields,
  goneNote,
  goneOf,
  isRetired,
} from './queue-retired'
import {
  declinedBeforeOf,
  pushbackOf,
  rejectIsCurrent,
  reopenedOf,
  reopeningOf,
  wasDeclined,
  withReopenMarker,
  type DeclinedBefore,
  type Pushback,
  type Reopened,
  type Reopening,
} from './queue-reopen'
import {
  historyOf,
  withEntry,
  type HistoryDid,
  type HistoryEntry,
  type Suggested,
  type Undid,
} from './queue-history'
import {
  CHECKER_NAME,
  editsPrint,
  firstName,
  forBryceOf,
  isWaiting,
  makePrint,
  MAX_TEXT as FOR_BRYCE_MAX_TEXT,
  openSuggestion,
  partWords,
  replyPrint,
  suggestWord,
  unseenParts,
  type ForBryce,
  type Print,
  type Question,
  type SuggestDid,
  type Suggestion,
} from './queue-suggest'

export const QUEUE_TABLE_ID = 'tblonlKwIFJ7Aa8QN'
const BROOM_ISSUES_TABLE_ID = 'tblntD3WITPEgjHRK'

const F = {
  title: 'fldeRsOE3DM3R2vbX',
  type: 'fldBc9YIDhjmu58f3',
  source: 'flddKkVy62MAZ8M0J',
  status: 'fldTXGYOoXcUApaI2',
  page: 'fldAMyLjM8CnXSRPX',
  targetTable: 'fld45SUjstUZROuXl',
  targetRecord: 'fldszXtLdUijgFG4l',
  issueRow: 'fld5zaEwhergaWYbF',
  sourceLink: 'fld4jnmGibDfKUwNx',
  sourceExcerpt: 'fld9VtbNjLpodrtA7',
  // A saved copy of what the item came from (the email thread, the Slack or
  // Discord post, the newsletter), written by the Mac and Comb: what Q shows
  // a teammate who can't open the Source link (queue-source.ts).
  sourceText: 'fldBnX1ohCmWuZFc0',
  proposal: 'fldgl9Ny2jnu8T0Da',
  verdict: 'fld835yJytaSRAuvB',
  reasons: 'fldvEp4bscGNzBcSJ',
  rejectChips: 'fldw42wRz08vO5Xzq',
  replyDraft: 'fld8lCAVyjDEVZ8VV',
  replyStatus: 'fldQuPHr742txLFCo',
  rejectReason: 'fldYa0cnc5rQxAfAa',
  note: 'fldaV8eBHNEuNPIjp',
  edits: 'fldzCgKQbopgcbrwq',
  decidedAt: 'fldtt7z4lYvAR5t94',
  appliedAt: 'fldML8YnyaDYaAmTb',
  error: 'fldrJcvFN3FCcyQPn',
  dedupKey: 'fldHuxapq09JkiohE',
  // Rejection replies written in advance by the Mac worker, one per reject
  // chip (JSON), and the one the page showed when Reject was pressed – the
  // Mac saves exactly that (Bryce, 5 Oct 2026).
  rejectDrafts: 'fldPusDzL9nnzibyt',
  rejectReply: 'fldUQqwJn7btv6EBP',
  // "Review again in a week": when the item comes back (queue-later.ts).
  reviewAgainOn: 'fldm9eFBj0iWuN23P',
  // When it came back: the date it was due, written by the Mac worker as it
  // clears Review again on, so the page can say it is back (queue-later.ts).
  cameBackOn: 'fldAaN9yEat8xWq00',
  // Logo Prep's version of a picture the row proposes, kept on the row by
  // the Mac (queue-prepared.ts): a Change's picture and Fable's proposed
  // logo for an addition.
  preparedLogo: 'fldDL9JaohN0Kx4CL',
  // Who decided, edited or undid the item on the page, and when: a JSON
  // list, one entry per action (queue-history.ts).
  history: 'fldjRsqYJAwR6CXpA',
  // "For Bryce": a suggested decision or a question from someone whose
  // Queue grant is "Bryce checks first", as JSON (queue-suggest.ts).
  // Referenced only by this id, here and in LIST_FORMULA. The field was
  // "Replaced listing" until 27 Nov 2026, empty in every row and unused.
  forBryce: 'fldWFnmC0u06GNC6B',
} as const

export type QueueType = 'Add' | 'Change' | 'Rule'
export type QueueSource =
  | 'Email'
  | 'Discord'
  | 'Broom'
  | 'Comb'
  | 'Form'
  | 'Teach'
  // A change proposed in the team's Fable chat (queue-chat-source.ts).
  | 'Queue chat'
export type QueueStatus =
  | 'Pending'
  | 'Revising'
  | 'Accepted'
  | 'Applied'
  | 'Rejected'
  | 'Failed'
  | 'Closed'
export type Verdict = 'Publish' | "Don't publish" | 'Unsure' | 'Fix' | 'Dismiss'

export interface ProposedChange {
  field: string
  from: unknown
  to: unknown
  /** Broom: the value Broom's flag asked for, when Fable's review set a
   *  different one (the Mac's `broom_item`). The page marks the field
   *  "edited by Fable" (Bryce, 28 Nov 2026, Concordia AI). */
  asked?: unknown
}

export interface QueueItem {
  id: string
  createdAt: string
  title: string
  type: QueueType
  source: QueueSource
  status: QueueStatus
  page: string | null
  targetTable: string | null
  targetRecord: string | null
  issueRow: string | null
  sourceLink: string | null
  /** Form: the "Airtable forms: someone has responded to …" email the
   *  submission arrived as, in Gmail (the proposal's `notification.link`,
   *  written by the Mac's forms duty). A Form row's Source link is the
   *  record in Airtable, so this is what Q opens (Bryce, 12 Nov 2026: "Q
   *  should open the original email with the form"). */
  emailLink?: string | null
  sourceExcerpt: string | null
  /** A saved copy of what the item came from (Source text), for a
   *  teammate who can't open the Source link (queue-source.ts). */
  sourceText?: string | null
  /** Source "Queue chat": the teammate who asked the chat, when the row
   *  names one (the proposal's `chat.by`, written by the Mac). */
  chatBy?: string | null
  /** The record's logo as the site shows it (from the site's own listing
   *  catalog for published records, else the Add snapshot), for the list. */
  logo: string | null
  /** Add: the proposed record, field name → value. */
  fields: Record<string, unknown> | null
  name: string | null
  url: string | null
  /** Change: the proposed field edits. */
  changes: ProposedChange[]
  /** Rule: the proposed rulebook diff (applied by the worker, never shown). */
  diff: string | null
  /** Rule: what changes, in plain words, and which rulebook it touches. */
  summary: string | null
  appliesTo: string | null
  /** Rule: the new rulebook text as it will read, and the text it takes
   *  the place of (null when it only adds). Shown on the card so the rule
   *  is judged on its words (Bryce, 5 Oct 2026, the teach loop). */
  ruleWording: string | null
  ruleWas: string | null
  /** Rule: the Mac's test of the rule on the owner's past decisions
   *  (proposal `replay`, ~/Queue/replay.py); null until it has run. */
  ruleTest: RuleTest | null
  /** Rule: it only changes the public listing policy page (the Mac's
   *  policy check, proposal `public_policy`), which no bot reads, so it is
   *  never tested on past decisions. */
  rulePublicPolicy: boolean
  /** Rule: drafted minutes after one decision, and where that was
   *  (proposal `instant`, ~/Queue/teach.py --instant); null for a rule from
   *  the nightly pass. */
  ruleInstant: RuleInstant | null
  /** Rule: the wording for the public listing policy that goes in with it
   *  (proposal `public`), and what the owner chose for it at Apply. The Mac
   *  writes it only on "apply". */
  rulePublic: RulePublic | null
  rulePublicChoice: PublicChoice | null
  /** Rule: it goes in only on the owner's own Apply (proposal
   *  `bryce_applies`: proposed in a teammate's chat, or drafted from a
   *  decision a teammate made). Its card is drawn from its edits, below,
   *  never from the words written about them (queue-rule-edits.ts). */
  ruleMark?: RuleMark | null
  /** A marked rule: the edits the worker writes on Apply, to the rulebook
   *  and to the public listing policy. Null when they cannot be read. */
  ruleEdits?: RuleEdit[] | null
  rulePublicEdits?: RuleEdit[] | null
  /** Change, Rule: the fingerprint of the changes or edits as this read of
   *  the row found them (queue-shown.ts). The page sends it back with a
   *  decision, which is refused when the row no longer matches. */
  shown?: string | null
  verdict: Verdict | null
  reasons: string[]
  rejectChips: string[]
  replyDraft: string | null
  replyStatus: string | null
  /** Who wrote a Discord request, laid out like a chat message on the
   *  page: name, handle, when (ISO), how it reached the owner (DM, reply
   *  to you, mentions you), where (a channel and server, DMs excepted) and
   *  their picture (Discord's CDN only). */
  saidBy: SaidBy | null
  /** Email/Discord: who the reply draft goes to (from the proposal's
   *  `reply` block, written at intake by the Secretary). */
  replyTo: string | null
  /** Email/Form: everyone else the decision answers – a second person
   *  behind the same listing (the proposal's `also_reply`, written by the
   *  Mac). Accept and Reject save each of them a draft in their own thread
   *  (Bryce, 24 Oct 2026, Mercial Research Fellowship: a correction and the
   *  listing's own form shared one item, and only one person got a reply). */
  replyAlso: string[]
  /** Form: why the Mac wrote no reply draft – the form came in without an
   *  email, or its Airtable notification isn't in Gmail to reply in. From
   *  the proposal's `no_reply` (worker duty f); shown where the draft would
   *  be (Bryce, 8 Oct 2026). Null once a `reply` block is there. */
  noReply: NoReply | null
  /** A question he asked them before deciding, and where it stands: a
   *  draft, sent and waiting on them, or answered. From the proposal's
   *  reply.asked (by email, kept current by the Mac) or, for one asked
   *  anywhere else, `waiting_on`, whichever is later (queue-asked.ts). */
  asked: Asked | null
  /** Email/Form: the owner already replied to them by hand in the
   *  request's Gmail thread, so neither Publish nor Reject saves a draft.
   *  From the proposal's reply.already, written by the Mac (Bryce, 12 Oct
   *  2026: a second decline nearly went to someone he had already
   *  answered). Null when he hasn't. */
  alreadyReplied: AlreadyReplied | null
  /** Rejected Email/Form: the reply the Mac wrote for this rejection and
   *  saved as a Gmail draft (Bryce, 4 Oct 2026: "when I reject something
   *  which was suggested, it should have an email response like when I
   *  accept something"). Rejected Discord: Fable's decline, kept here to
   *  copy (5 Oct 2026). From the proposal's reply.reject block; null
   *  when there is none for this decision. */
  rejectReply: RejectReply | null
  /** Open Email/Form/Discord rows: the rejection reply written in advance
   *  for each reject chip (chip → reply), shown under the accept reply.
   *  Empty until the Mac worker has written them. */
  rejectDrafts: Record<string, string>
  rejectReason: string | null
  note: string | null
  edits: Record<string, unknown> | null
  /** Applied Change: what the fields edited beyond the proposal held
   *  before Accept wrote them, for Undo to put back. */
  before?: Record<string, unknown> | null
  /** Applied Change: the proposed fields Accept left alone because Fable
   *  had already changed them on the record from the chat; Undo leaves
   *  them too. */
  keptByFable?: string[] | null
  /** Change: the proposed fields the admin left out with the cross
   *  (queue-left-out.ts) – a draft while the item is open; once applied,
   *  the fields Accept did not write, which Undo leaves alone too. */
  leftOut?: string[] | null
  /** Applied: the proposed fields Apply left out because their column was
   *  no longer in Airtable (queue-retired.ts); Undo leaves them too. */
  gone?: string[] | null
  decidedAt: string | null
  appliedAt: string | null
  error: string | null
  /** Set aside with "Review again in a week": when it comes back. The Mac
   *  worker clears it once Fable has looked again. */
  reviewAgainOn: string | null
  /** It came back from being set aside: the date it was due. */
  cameBackOn: string | null
  /** The flag was updated from the chat (queue-flag.ts) and what it said
   *  before is kept, so Undo can put it back. */
  flagUndo: boolean
  /** The verdict the chat's update replaced (null when it had none, or the
   *  flag was not updated), so the card can say it changed. */
  flagWas: Verdict | null
  /** The decision was a Reject of an addition – also once the Mac deleted
   *  the record and marked the row Applied (queue-reopen.ts). */
  declined: boolean
  /** Reopen pressed (or their reply to the decline came): the Mac is
   *  bringing it back, or could not (`error`). */
  reopening: Reopening | null
  /** Their reply to the decline, which brought the item back. */
  pushback: Pushback | null
  /** When and how it came back. */
  reopened: Reopened | null
  /** Brought back with no word from them since: the decline they already
   *  have, so Reject saves no second one. */
  declinedBefore: DeclinedBefore | null
  /** Its date went by while someone waits for a reply (the Mac's daily
   *  check, queue-passed.ts): Publish is off, Reject drafts the reply. */
  passed: Passed | null
  /** Add: the fields Fable would change, from its field check after a
   *  Publish or Unsure verdict, or a one-off pass on Don't publish (the proposal's
   *  `field_flags`, queue-field-flags.ts);
   *  null until the Mac has run it. */
  fieldFlags?: FieldFlags | null
  /** A requested change: what Fable checked on public pages before its
   *  verdict, claim by claim (the proposal's `checked`, queue-checked.ts);
   *  empty when the Mac checked nothing. */
  checked?: CheckedClaim[]
  /** The files on the row's Prepared logo field, with links fresh from
   *  this read (queue-prepared.ts). A Change's pictures already point at
   *  them; an addition's logo flag names one. */
  preparedLogos?: PreparedFile[]
  /** Who decided, edited or undid it on the page, and when, oldest first
   *  (queue-history.ts). Empty for a row nobody has acted on since
   *  18 Nov 2026. */
  history?: HistoryEntry[]
  /** A suggested decision or a question waiting for someone with full
   *  Queue edit, or a question answered (queue-suggest.ts); null when the
   *  row has none. */
  forBryce?: ForBryce | null
  /** The row's fingerprint now (queue-suggest.ts, makePrint): only on an
   *  item read by itself (getQueueItem), for the checks on a suggestion. */
  print?: Print
}

export type NoReply = 'no email' | 'no notification'
const NO_REPLY: readonly string[] = ['no email', 'no notification']

export interface RejectReply {
  /** The words saved in Gmail (or, for Discord, to copy); null until they
   *  are written. */
  text: string | null
  /** saved = a Gmail draft · ready = a Discord reply to copy and send by hand */
  state: 'saved' | 'ready' | 'writing' | 'failed'
  error: string | null
}

type RawFields = Record<string, unknown>

/** Thrown for a problem the page should show as-is (bad input, already
 *  decided, Airtable refused). `status` is the HTTP status to answer with;
 *  `detail` is the text for the page, written here for the admin's eyes
 *  (the routes never echo a raw exception message). */
export class QueueError extends Error {
  status: number
  detail: string
  /** More for the page to act on, answered beside `error` (the check on a
   *  suggestion: what the item is now, requireSuggestionSeen). */
  extra: Record<string, unknown> | null
  constructor(
    message: string,
    status = 400,
    extra: Record<string, unknown> | null = null
  ) {
    super(message)
    this.status = status
    this.detail = message
    this.extra = extra
  }
}

const TABLE_ID_RE = /^tbl[A-Za-z0-9]{14}$/
const PROTECTED_FIELDS = new Set(['Publish?', 'Hide?'])

/** A proposed Publish?/Hide? value as the box Airtable stores – ticked only
 *  for a real yes. The two boxes stay out of hand edits, but a change that
 *  proposes one is the reviewer's call: Accept writes it and Undo puts it
 *  back (6 Oct 2026: The Big Tent's proposed Hide? was skipped while its row
 *  went to Applied, so the postponed event stayed on /events). */
function asBox(v: unknown): boolean {
  if (v === true || v === 1) return true
  return typeof v === 'string' && /^(true|yes|ticked|1)$/i.test(v.trim())
}

/** The key in a row's saved edits (JSON) that keeps, once a Change is
 *  applied, what its extra fields held before; never a field name. */
const BEFORE_KEY = '(before)'

/** The key in a row's saved edits (JSON) that keeps, once a Change is
 *  applied, the proposed fields Accept did not write because Fable had
 *  changed them on the record already; never a field name. */
const KEPT_KEY = '(kept by Fable)'

/** The key in a row's Proposal (JSON) that keeps the verdict, reasons,
 *  reject buttons and title – and the field changes, when those were
 *  replaced too – as they were before the flag was updated from the chat,
 *  for Undo. Raw, as the row held them. */
const FLAG_BEFORE_KEY = 'flag_before'

/** Columns Airtable fills itself, and ones the page has no editor for
 *  (pictures, links to other records): never written as an extra field. */
const UNWRITABLE_TYPES = new Set([
  'formula',
  'rollup',
  'lookup',
  'multipleLookupValues',
  'count',
  'autoNumber',
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'button',
  'multipleAttachments',
  'multipleRecordLinks',
  'singleCollaborator',
  'multipleCollaborators',
])

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function lines(v: unknown): string[] {
  return typeof v === 'string'
    ? v
        .split('\n')
        .map(l => l.replace(/^[-–•*]\s*/, '').trim())
        .filter(Boolean)
    : []
}

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string' || v.trim() === '') return null
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function toChanges(v: unknown): ProposedChange[] {
  if (!Array.isArray(v)) return []
  const out: ProposedChange[] = []
  for (const c of v) {
    if (!isRecord(c)) continue
    const field = str(c.field)
    if (!field) continue
    const change: ProposedChange = {
      field,
      from: c.from ?? null,
      to: c.to ?? null,
    }
    if (fableChangedIt(c.asked, change.to)) change.asked = c.asked
    out.push(change)
  }
  return out
}

/** True when the flag asked for a value and Fable's review proposes
 *  another: an empty or missing `asked` means Broom named no value. */
function fableChangedIt(asked: unknown, to: unknown): boolean {
  if (asked === undefined || asked === null || asked === '') return false
  if (Array.isArray(asked) && asked.length === 0) return false
  return JSON.stringify(asked) !== JSON.stringify(to)
}

/** What the page shows for a target record beyond the row itself: its
 *  logo and the listing's own link (a web address; the catalog's "#" and
 *  mailto: stand-ins are left out). */
export interface TargetLookup {
  logos: Record<string, string>
  links: Record<string, string>
  /** A published event's or training's start date and deadline, so the
   *  page can tell which Changes touch a listing that is about to happen
   *  (queue-urgent.ts). */
  dates: Record<string, ListingDates>
}

/** Record id → logo, link and (events, training) dates for every published
 *  listing, from the chatbot's catalog (cached five minutes; its ids are
 *  "<type>:<record id>"). Empty when the catalog cannot be built: the list
 *  is not worth an error. */
async function catalogTargets(): Promise<{
  logos: Map<string, string>
  links: Map<string, string>
  dates: Map<string, ListingDates>
}> {
  const logos = new Map<string, string>()
  const links = new Map<string, string>()
  const dates = new Map<string, ListingDates>()
  try {
    for (const l of (await getCatalog()).listings) {
      const rec = l.id.slice(l.id.indexOf(':') + 1)
      if (!isRecordId(rec)) continue
      if (l.logo && !isExpiredAttachment(l.logo)) logos.set(rec, l.logo)
      if (l.url && /^https?:\/\//.test(l.url)) links.set(rec, l.url)
      const start = l.meta.startDate ?? null
      const closes = l.meta.applicationsClose ?? null
      if (start || closes) dates.set(rec, { start, closes })
    }
  } catch (e) {
    console.error(
      '[admin-queue] catalog targets',
      e instanceof Error ? e.message : e
    )
  }
  return { logos, links, dates }
}

/** Airtable attachment links carry their expiry (ms since the epoch) as a
 *  path segment and answer 410 after it. The site's cached data can hold
 *  such links for hours, so anything expiring within ten minutes is
 *  treated as gone and read afresh. */
const logoCache = new Map<string, { url: string | null; at: number }>()
const LOGO_TTL_MS = 5 * 60 * 1000

/** Logos for records the catalog does not cover (unpublished Add targets):
 *  one list read per table, attachment fields only, in chunks of 40 ids,
 *  cached five minutes. Never throws: a missing logo is not worth an error. */
async function targetLogos(
  rows: { table: string; record: string }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const byTable = new Map<string, string[]>()
  const now = Date.now()
  for (const { table, record } of rows) {
    if (!TABLE_ID_RE.test(table) || !isRecordId(record)) continue
    const hit = logoCache.get(record)
    if (hit && now - hit.at < LOGO_TTL_MS) {
      if (hit.url) out.set(record, hit.url)
      continue
    }
    const list = byTable.get(table) ?? []
    list.push(record)
    byTable.set(table, list)
  }
  await Promise.all(
    [...byTable].map(async ([table, records]) => {
      try {
        const fields = (await getTableSchema(table)).filter(
          f => f.type === 'multipleAttachments' && /logo|image/i.test(f.name)
        )
        if (!fields.length) return
        for (let i = 0; i < records.length; i += 40) {
          const chunk = records.slice(i, i + 40)
          const params = new URLSearchParams()
          params.set(
            'filterByFormula',
            `OR(${chunk.map(r => `RECORD_ID()='${r}'`).join(',')})`
          )
          for (const f of fields) params.append('fields[]', f.name)
          const seen = new Set<string>()
          for (const r of await listAll<RawFields>(table, params)) {
            let url: string | null = null
            for (const f of fields) {
              const v = r.fields[f.name]
              const first: unknown = Array.isArray(v) ? v[0] : null
              if (!isRecord(first)) continue
              const shown = pictureUrl(first)
              if (typeof shown === 'string') {
                url = shown
                break
              }
            }
            logoCache.set(r.id, { url, at: now })
            seen.add(r.id)
            if (url) out.set(r.id, url)
          }
          for (const r of chunk) {
            if (!seen.has(r)) logoCache.set(r, { url: null, at: now })
          }
        }
      } catch (e) {
        console.error(
          '[admin-queue] target logos',
          e instanceof Error ? e.message : e
        )
      }
    })
  )
  return out
}

/** The first picture in an Add snapshot's Logo/Image field. */
function snapshotLogo(fields: Record<string, unknown> | null): string | null {
  if (!fields) return null
  for (const [k, v] of Object.entries(fields)) {
    if (!/logo|image/i.test(k) || !Array.isArray(v) || !v.length) continue
    const first: unknown = v[0]
    const url =
      typeof first === 'string'
        ? first
        : isRecord(first) && typeof first.url === 'string'
          ? first.url
          : null
    // snapshots are days old; an expired link is read afresh instead
    if (url && !isExpiredAttachment(url)) return url
  }
  return null
}

export interface SaidBy {
  name: string
  handle: string | null
  when: string | null
  how: string | null
  where: string | null
  avatar: string | null
}

/** Only a picture on Discord's own CDN is shown as someone's avatar: the
 *  proposal is written by the Mac-side bots, but the page must never be
 *  handed an arbitrary image URL. */
function discordCdnUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'cdn.discordapp.com'
      ? u.href
      : null
  } catch {
    return null
  }
}

/** The reply.reject block the Mac writes (actions.reject_draft), when it
 *  belongs to the row's current decision: an Undo and a fresh Reject make
 *  an older block stale. */
export function rejectReplyOf(
  v: unknown,
  decidedAt: string | null
): RejectReply | null {
  if (!isRecord(v) || !rejectIsCurrent(v, decidedAt)) return null
  const text = str(v.text)
  if (str(v.draft)) return { text, state: 'saved', error: null }
  if (str(v.ready) && text) return { text, state: 'ready', error: null }
  if (str(v.failed)) return { text, state: 'failed', error: str(v.failed) }
  if (str(v.writing)) return { text, state: 'writing', error: null }
  return null
}

/** Why a Form row has no reply draft (the proposal's `no_reply`, written by
 *  the Mac's forms duty), or null: none given, or a `reply` block is there. */
export function noReplyOf(proposal: Record<string, unknown>): NoReply | null {
  if (isRecord(proposal.reply)) return null
  const why = str(proposal.no_reply)
  if (!why) return null
  if (NO_REPLY.includes(why)) return why as NoReply
  console.warn(`Queue: unknown no_reply "${why}"`)
  return null
}

/** The Gmail link to the email a Form row's submission arrived as (the
 *  proposal's `notification.link`, written by the Mac's forms duty), or
 *  null. The Mac builds the link, as this code is public and never names
 *  the mailbox; only an https link on mail.google.com itself is passed on. */
export function emailLinkOf(proposal: Record<string, unknown>): string | null {
  if (!isRecord(proposal.notification)) return null
  const link = str(proposal.notification.link)
  if (!link) return null
  try {
    const u = new URL(link)
    return u.protocol === 'https:' && u.hostname === 'mail.google.com'
      ? link
      : null
  } catch {
    return null
  }
}

function rowToItem(
  row: {
    id: string
    createdTime: string
    fields: RawFields
  },
  logos: Map<string, string> = new Map()
): QueueItem {
  const f = row.fields
  const proposal = parseJson(f[F.proposal])
  const inChat = chatProposed(str(f[F.source]), proposal)
  const kind = str(f[F.type]) ?? 'Add'
  // What a decision on a change or a rule is made on (queue-shown.ts).
  const shown = shownOf({
    type: kind,
    proposal,
    targetTable: f[F.targetTable],
    targetRecord: f[F.targetRecord],
  })
  const ruleMark =
    kind === 'Rule' && isRecord(proposal)
      ? ruleMarkOf(proposal.bryce_applies)
      : null
  let fields: Record<string, unknown> | null = null
  let name: string | null = null
  let url: string | null = null
  let changes: ProposedChange[] = []
  let diff: string | null = null
  let summary: string | null = null
  let appliesTo: string | null = null
  let ruleWording: string | null = null
  let ruleWas: string | null = null
  let ruleTest: RuleTest | null = null
  let rulePublicPolicy = false
  let ruleInstant: RuleInstant | null = null
  let rulePublic: RulePublic | null = null
  let rulePublicChoice: PublicChoice | null = null
  let replyTo: string | null = null
  let replyAlso: string[] = []
  let noReply: NoReply | null = null
  let emailLink: string | null = null
  let alreadyReplied: AlreadyReplied | null = null
  let asked: Asked | null = null
  let rejectReply: RejectReply | null = null
  let saidBy: SaidBy | null = null
  let rejectReplied = false
  let reopening: Reopening | null = null
  let pushback: Pushback | null = null
  let reopened: Reopened | null = null
  let declinedBefore: DeclinedBefore | null = null
  let passed: Passed | null = null
  let fieldFlags: FieldFlags | null = null
  let checked: CheckedClaim[] = []
  const preparedLogos = preparedFilesOf(f[F.preparedLogo], isExpiredAttachment)
  if (isRecord(proposal)) {
    // Asked outside email (the chat's waiting block or the G button); an
    // emailed question, read below, counts instead when it is later.
    asked = elsewhereOf(proposal[ELSEWHERE_KEY])
    passed = passedOf(proposal.passed)
    fieldFlags = fieldFlagsOf(proposal[FIELD_FLAGS_KEY])
    checked = checkedOf(proposal[CHECKED_KEY])
    reopening = reopeningOf(proposal.reopen)
    pushback = pushbackOf(proposal.pushback)
    reopened = reopenedOf(proposal.reopened)
    declinedBefore = declinedBeforeOf(proposal.reply, pushback)
    // Only this decision's reject block: one left by a Reject that was
    // undone must not make a later Publish read as a decline.
    rejectReplied =
      isRecord(proposal.reply) &&
      rejectIsCurrent(proposal.reply.reject, str(f[F.decidedAt]))
    // A picture the Mac prepared for the site replaces the raw file a
    // change proposes, here and so at Apply, which reads the row afresh
    // (the Known gap in ~/Queue/CLAUDE.md, closed 17 Nov 2026).
    changes = withPreparedPictures(
      toChanges(proposal.changes),
      proposal.changes,
      preparedLogos
    )
    diff = str(proposal.diff)
    summary = str(proposal.summary)
    appliesTo = str(proposal.applies_to) ?? str(proposal.appliesTo)
    ruleWording = str(proposal.wording)
    ruleWas = str(proposal.was)
    ruleTest = ruleTestOf(proposal.replay)
    rulePublicPolicy = proposal.public_policy === true
    ruleInstant = ruleInstantOf(proposal.instant)
    rulePublic = rulePublicOf(proposal.public)
    name = str(proposal.name)
    url = str(proposal.url)
    if (isRecord(proposal.reply)) {
      const to = str(proposal.reply.to)
      const who = str(proposal.reply.name)
      replyTo = to ? (who ? `${who} <${to}>` : to) : null
      replyAlso = replyAlsoOf(proposal.also_reply)
      rejectReply = rejectReplyOf(proposal.reply.reject, str(f[F.decidedAt]))
      alreadyReplied = alreadyRepliedOf(proposal.reply.already)
      asked = latestAsked(askedOf(proposal.reply.asked), asked)
      if (proposal.reply.platform === 'discord' && who) {
        const how = str(proposal.reply.how)
        saidBy = {
          name: who,
          handle: to,
          when: str(proposal.reply.when),
          how,
          // a DM's "where" is just the DM again
          where:
            how === 'DM' || how === 'group DM'
              ? null
              : str(proposal.reply.where),
          avatar: discordCdnUrl(str(proposal.reply.avatar)),
        }
      }
    }
    noReply = noReplyOf(proposal)
    emailLink = emailLinkOf(proposal)
    if (isRecord(proposal.fields)) {
      fields = proposal.fields
    } else if (kind !== 'Rule' && changes.length === 0 && !diff) {
      // An old row: the proposal is the record's fields themselves. Never a
      // rule, which has none: one the team's chat proposed comes without a
      // `diff`, and all of it, the address on its mark included, would
      // have gone to the page as fields.
      const rest: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(proposal)) {
        if (
          k !== 'chat' &&
          k !== 'bryce_applies' &&
          k !== 'name' &&
          k !== 'url' &&
          k !== 'no_reply' &&
          k !== 'notification' &&
          k !== FLAG_BEFORE_KEY &&
          k !== 'reopen' &&
          k !== 'pushback' &&
          k !== 'reopened' &&
          k !== 'passed' &&
          k !== FIELD_FLAGS_KEY &&
          k !== CHECKED_KEY
        )
          rest[k] = v
      }
      fields = rest
    }
  }
  const saved = parseJson(f[F.edits])
  let edits: Record<string, unknown> | null = null
  let before: Record<string, unknown> | null = null
  let keptByFable: string[] | null = null
  let leftOut: string[] | null = null
  let gone: string[] | null = null
  if (isRecord(saved)) {
    const {
      [BEFORE_KEY]: was,
      [KEPT_KEY]: kept,
      [LEFT_OUT_KEY]: left,
      [GONE_KEY]: deleted,
      [PUBLIC_KEY]: publicChoice,
      ...rest
    } = saved
    edits = rest
    rulePublicChoice = publicChoiceOf(publicChoice)
    const goneNames = goneOf(deleted)
    gone = goneNames.length ? goneNames : null
    before = isRecord(was) ? was : null
    keptByFable = Array.isArray(kept)
      ? kept.filter((k): k is string => typeof k === 'string')
      : null
    const names = leftOutOf(
      left,
      changes.map(c => c.field)
    )
    leftOut = names.length ? names : null
  }
  // The reply the page sent with Reject shows at once, before the Mac has
  // saved it (Undo clears it, so it always belongs to this decision).
  const chosenReject = str(f[F.rejectReply])
  if (chosenReject && str(f[F.status]) === 'Rejected') {
    rejectReply =
      rejectReply === null
        ? { text: chosenReject, state: 'writing', error: null }
        : { ...rejectReply, text: rejectReply.text ?? chosenReject }
  }
  return {
    id: row.id,
    createdAt: row.createdTime,
    title: str(f[F.title]) ?? name ?? '(untitled)',
    type: (str(f[F.type]) as QueueType | null) ?? 'Add',
    // A change proposed in the team's chat reads as that whatever its
    // Source says: until the field has the choice, the Mac files it under
    // Comb and marks the proposal (queue-chat-source.ts).
    source: inChat
      ? CHAT_SOURCE
      : ((str(f[F.source]) as QueueSource | null) ?? 'Comb'),
    status: (str(f[F.status]) as QueueStatus | null) ?? 'Pending',
    page: str(f[F.page]),
    targetTable: str(f[F.targetTable]),
    targetRecord: str(f[F.targetRecord]),
    issueRow: str(f[F.issueRow]),
    sourceLink: str(f[F.sourceLink]),
    emailLink,
    sourceExcerpt: str(f[F.sourceExcerpt]),
    sourceText: str(f[F.sourceText]),
    ...(inChat ? { chatBy: inChat.by } : {}),
    logo:
      (str(f[F.targetRecord]) && logos.get(str(f[F.targetRecord]) ?? '')) ||
      snapshotLogo(fields),
    fields,
    name,
    url,
    changes,
    diff,
    summary,
    appliesTo,
    ruleWording,
    ruleWas,
    ruleTest,
    rulePublicPolicy,
    ruleInstant,
    rulePublic,
    rulePublicChoice,
    ...(ruleMark
      ? {
          ruleMark,
          ruleEdits: isRecord(proposal) ? ruleEditsOf(proposal.edits) : null,
          rulePublicEdits:
            isRecord(proposal) && isRecord(proposal.public)
              ? ruleEditsOf(proposal.public.edits)
              : null,
        }
      : {}),
    ...(shown ? { shown } : {}),
    verdict: str(f[F.verdict]) as Verdict | null,
    reasons: lines(f[F.reasons]),
    rejectChips: lines(f[F.rejectChips]),
    replyDraft: str(f[F.replyDraft]),
    replyStatus: str(f[F.replyStatus]),
    replyTo,
    replyAlso,
    noReply,
    alreadyReplied,
    asked,
    rejectReply,
    rejectDrafts: parseRejectDrafts(f[F.rejectDrafts]),
    saidBy,
    rejectReason: str(f[F.rejectReason]),
    note: str(f[F.note]),
    edits,
    before,
    keptByFable,
    leftOut,
    gone,
    decidedAt: str(f[F.decidedAt]),
    appliedAt: str(f[F.appliedAt]),
    error: str(f[F.error]),
    reviewAgainOn: str(f[F.reviewAgainOn]),
    cameBackOn: str(f[F.cameBackOn]),
    flagUndo: isRecord(proposal) && isRecord(proposal[FLAG_BEFORE_KEY]),
    flagWas:
      isRecord(proposal) && isRecord(proposal[FLAG_BEFORE_KEY])
        ? (str(proposal[FLAG_BEFORE_KEY].verdict) as Verdict | null)
        : null,
    declined: wasDeclined({
      type: str(f[F.type]) ?? 'Add',
      status: str(f[F.status]) ?? 'Pending',
      decidedAt: str(f[F.decidedAt]),
      appliedAt: str(f[F.appliedAt]),
      rejectReason: str(f[F.rejectReason]),
      rejectReplied: rejectReplied || Boolean(str(f[F.rejectReply])),
      error: str(f[F.error]),
    }),
    reopening,
    pushback,
    reopened,
    declinedBefore,
    passed,
    fieldFlags,
    checked,
    preparedLogos,
    history: historyOf(f[F.history]),
    forBryce: forBryceIn(row.id, f[F.forBryce]),
  }
}

/** The row's For Bryce field, read; a value it can't read (typed in by
 *  hand) is said in the log and shows as none. */
function forBryceIn(id: string, raw: unknown): ForBryce | null {
  const fb = forBryceOf(raw)
  if (!fb && typeof raw === 'string' && raw.trim()) {
    console.warn(`[admin-queue] ${id}: unreadable For Bryce value, ignored`)
  }
  return fb
}

/** The fingerprint of a row as Airtable holds it (queue-suggest.ts). */
function printOfRow(f: RawFields): Print {
  const proposal = parseJson(f[F.proposal])
  return makePrint({
    verdict: str(f[F.verdict]),
    changes: isRecord(proposal) ? proposal.changes : null,
    table: str(f[F.targetTable]),
    record: str(f[F.targetRecord]),
    edits: parseJson(f[F.edits]),
    reply: f[F.replyDraft],
  })
}

// Open rows, plus anything decided in the last day: the "Done today" strip
// with its Undo buttons. A day is enough for any viewer's "today" (their
// midnight is at most 24 hours back); the browser trims it to its own
// calendar day. Also the rows the Mac's daily check took out in the last
// week, for the line at the top of the list (queue-passed.ts); they have no
// Decided at, so they show nowhere else. And every row whose For Bryce
// holds something, whatever its status (queue-suggest.ts): a question about
// a decided item, a suggestion on a row a bot closed meanwhile (so it can
// be dismissed), an answer waiting to be read. The field is named by its id
// (Airtable formulas take `{fld…}`), so renaming it can't break the list.
export const LIST_FORMULA =
  "OR({Status}='Pending',{Status}='Revising',{Status}='Accepted',{Status}='Failed'," +
  "AND(OR({Status}='Applied',{Status}='Rejected'),IS_AFTER({Decided at},DATEADD(NOW(),-1,'day')))," +
  TAKEN_OUT_FORMULA +
  `,{${F.forBryce}}!=''` +
  ')'

/** The rows, and nothing else: one paginated read of the Queue table, so
 *  the page has its list in about a second. A logo here comes only from
 *  the proposal snapshot; the rest arrive through queueTargets() once the
 *  list is on screen, because those need the site's catalog (every table,
 *  seconds when its cache is cold, which every accept makes it) and a read
 *  per table for unpublished targets. */
export async function listQueue(): Promise<QueueItem[]> {
  const params = new URLSearchParams()
  params.set('returnFieldsByFieldId', 'true')
  params.set('filterByFormula', LIST_FORMULA)
  const rows = await listAll<RawFields>(QUEUE_TABLE_ID, params)
  return rows.map(r => rowToItem(r))
}

// Every decision ever made, newest first, for the search's "Earlier" group
// (Bryce, 20 Oct 2026: a decline from a week before could not be found).
// Only read while a search is typed, once per page visit.
const DECIDED_FORMULA = 'NOT({Decided at} = BLANK())'

/** Every decided row, newest decision first. The rejection replies written
 *  in advance are left off: nobody decides from this list. */
export async function listDecided(): Promise<QueueItem[]> {
  const params = new URLSearchParams()
  params.set('returnFieldsByFieldId', 'true')
  params.set('filterByFormula', DECIDED_FORMULA)
  params.set('sort[0][field]', F.decidedAt)
  params.set('sort[0][direction]', 'desc')
  const rows = await listAll<RawFields>(QUEUE_TABLE_ID, params)
  return rows.map(r => {
    const fields = { ...r.fields }
    delete fields[F.rejectDrafts]
    return rowToItem({ ...r, fields })
  })
}

/** Every Queue row about one listing (its Target record), for the
 *  listing's history on the page: who published it, who changed what since
 *  (queue-history.ts). Read when an item or a found listing is opened. The
 *  rejection replies written in advance are left off, as in listDecided. */
export async function listForListing(record: string): Promise<QueueItem[]> {
  if (!isRecordId(record)) return []
  const params = new URLSearchParams()
  params.set('returnFieldsByFieldId', 'true')
  // isRecordId has checked the id is letters and digits only.
  params.set('filterByFormula', `{${F.targetRecord}}='${record}'`)
  const rows = await listAll<RawFields>(QUEUE_TABLE_ID, params)
  return rows.map(r => {
    const fields = { ...r.fields }
    delete fields[F.rejectDrafts]
    return rowToItem({ ...r, fields })
  })
}

/** Logo and link by target record for the rows that came without one:
 *  the site's catalog for published listings (which is where a Change's
 *  link comes from: its proposal names only the fields it edits), then
 *  one batched read per table for the logos of the rest (Comb's
 *  unpublished Adds, whose link the proposal carries). Records without a
 *  picture, or without a link, are left out of that map. Never throws: a
 *  missing logo or link is not worth an error. */
export async function queueTargets(
  targets: { table: string; record: string }[]
): Promise<TargetLookup> {
  const out: TargetLookup = { logos: {}, links: {}, dates: {} }
  // record → table, deduplicated
  const wanted = new Map<string, string>()
  for (const t of targets) {
    if (TABLE_ID_RE.test(t.table) && isRecordId(t.record)) {
      wanted.set(t.record, t.table)
    }
  }
  if (!wanted.size) return out
  const catalog = await catalogTargets()
  const rest: { table: string; record: string }[] = []
  for (const [record, table] of wanted) {
    const link = catalog.links.get(record)
    if (link) out.links[record] = link
    const dates = catalog.dates.get(record)
    if (dates) out.dates[record] = dates
    const logo = catalog.logos.get(record)
    if (logo) out.logos[record] = logo
    else rest.push({ table, record })
  }
  if (rest.length) {
    for (const [record, url] of await targetLogos(rest)) {
      out.logos[record] = url
    }
  }
  return out
}

export async function getQueueItem(id: string): Promise<QueueItem | null> {
  if (!isRecordId(id)) return null
  const res = await airtableRequest(
    `${QUEUE_TABLE_ID}/${id}?returnFieldsByFieldId=true`
  )
  if (res.status === 404 || res.status === 403) return null
  if (!res.ok) {
    throw new QueueError(
      `Airtable read failed: ${res.status} ${await res.text()}`,
      502
    )
  }
  // No logo lookup here (it can cost a catalog build): the page keeps the
  // picture it already shows when a decision comes back.
  const row = (await res.json()) as {
    id: string
    createdTime: string
    fields: RawFields
  }
  // With its fingerprint, for the checks on a suggestion (queue-suggest.ts).
  return { ...rowToItem(row), print: printOfRow(row.fields) }
}

// ─── The target record, live ────────────────────────────────────────────────

export interface FieldInfo {
  id: string
  name: string
  /** Airtable field type: singleSelect, multipleSelects, checkbox, date,
   *  number, multilineText, url, multipleAttachments, … */
  type: string
  /** The options of a select field, in Airtable's order. */
  choices?: string[]
}

const schemaCache = new Map<string, { at: number; fields: FieldInfo[] }>()
const SCHEMA_TTL_MS = 10 * 60 * 1000
/** Each table's name column (Projects calls it "Project Name"), filled
 *  with the schema. */
const primaryNames = new Map<string, string>()
/** Every field of the base by its id, with the table it belongs to and
 *  its name (Publish? and Hide? included), filled with the schema: a record
 *  read with fields keyed by id says which table it came from. */
const fieldHomes = new Map<string, { table: string; name: string }>()
/** Each table's formula fields and the fields each one is built from,
 *  filled with the schema (see mapPreview). */
const formulaInputs = new Map<string, { id: string; inputs: string[] }[]>()

/** Every field of a resource table, in Airtable's column order, so the page
 *  can list what is EMPTY on a record (a missing logo, an empty location)
 *  and not only what is filled. Read from the base's metadata, cached for
 *  `maxAgeMs` (ten minutes unless asked for fresher). */
export async function getTableSchema(
  table: string,
  maxAgeMs: number = SCHEMA_TTL_MS
): Promise<FieldInfo[]> {
  if (!TABLE_ID_RE.test(table)) return []
  const hit = schemaCache.get(table)
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.fields
  const token = process.env.AIRTABLE_TOKEN
  const base = process.env.AIRTABLE_BASE_ID
  if (!token || !base) return []
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${base}/tables`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }
  )
  if (!res.ok) return []
  const data = (await res.json()) as {
    tables: {
      id: string
      primaryFieldId: string
      fields: {
        id: string
        name: string
        type: string
        options?: {
          choices?: { name: string }[]
          referencedFieldIds?: string[]
        }
      }[]
    }[]
  }
  for (const t of data.tables) {
    const primary = t.fields.find(f => f.id === t.primaryFieldId)
    if (primary) primaryNames.set(t.id, primary.name)
    for (const f of t.fields)
      fieldHomes.set(f.id, { table: t.id, name: f.name })
    formulaInputs.set(
      t.id,
      t.fields
        .filter(f => f.type === 'formula')
        .map(f => ({ id: f.id, inputs: f.options?.referencedFieldIds ?? [] }))
    )
    schemaCache.set(t.id, {
      at: Date.now(),
      fields: t.fields
        .filter(f => !PROTECTED_FIELDS.has(f.name))
        .map(f => {
          const choices = f.options?.choices?.map(c => c.name)
          return choices?.length
            ? { id: f.id, name: f.name, type: f.type, choices }
            : { id: f.id, name: f.name, type: f.type }
        }),
    })
  }
  return schemaCache.get(table)?.fields ?? []
}

/** The target record's fields as they are in Airtable right now, keyed by
 *  field NAME. Attachments become a list of URLs (the large thumbnail when
 *  Airtable made one, else the file); Publish?/Hide? are dropped. Used for
 *  the focused item, because the snapshot on the queue row was taken when
 *  the row was written and Airtable's attachment URLs expire within hours. */
/** What the page shows beside a picture in an attachment field: the link
 *  the field list carries for it (the large thumbnail when Airtable made
 *  one), and the file's own name, pixel size, bytes and type. */
export interface AttachmentInfo {
  url: string
  filename: string | null
  width: number | null
  height: number | null
  size: number | null
  type: string | null
}

/** Airtable's "large" thumbnail is a JPEG, so a transparent logo (PNG,
 *  WebP, GIF, SVG) comes back on a black square – on 12 Oct 2026 AI Safety
 *  Purdue's prepared WebP showed that way on its card. For those types the
 *  page shows the file itself; anything else keeps the thumbnail. */
const TRANSPARENT_TYPES = /^image\/(png|webp|gif|svg\+xml)$/
export function pictureUrl(x: Record<string, unknown>): unknown {
  const large =
    isRecord(x.thumbnails) && isRecord(x.thumbnails.large)
      ? x.thumbnails.large.url
      : null
  if (typeof x.type === 'string' && TRANSPARENT_TYPES.test(x.type)) return x.url
  return typeof large === 'string' ? large : x.url
}

function attachmentInfo(x: Record<string, unknown>): AttachmentInfo | null {
  if (typeof x.url !== 'string') return null
  const shown = pictureUrl(x)
  return {
    url: typeof shown === 'string' ? shown : x.url,
    filename: typeof x.filename === 'string' ? x.filename : null,
    width: typeof x.width === 'number' ? x.width : null,
    height: typeof x.height === 'number' ? x.height : null,
    size: typeof x.size === 'number' ? x.size : null,
    type: typeof x.type === 'string' ? x.type : null,
  }
}

export interface TargetRead {
  fields: Record<string, unknown>
  /** The pictures behind each attachment field, by field name. */
  attachments: Record<string, AttachmentInfo[]>
}

/** One record's fields as Airtable holds them, keyed by field name; null
 *  when the table has no such record. */
async function readRecord(
  table: string,
  record: string
): Promise<RawFields | null> {
  if (!TABLE_ID_RE.test(table) || !isRecordId(record)) return null
  const res = await airtableRequest(`${table}/${record}`)
  if (res.status === 404 || res.status === 403) return null
  if (!res.ok) {
    throw new QueueError(
      `Airtable read failed: ${res.status} ${await res.text()}`,
      502
    )
  }
  return ((await res.json()) as { fields: RawFields }).fields
}

export async function getTargetFields(
  table: string,
  record: string
): Promise<TargetRead | null> {
  const raw = await readRecord(table, record)
  return raw ? targetRead(raw) : null
}

/** A record's fingerprint as the page shows it (queue-shown.ts): over the
 *  fields the page's own rules keep, read with the table's field list. */
function recordShown(
  table: string,
  record: string,
  raw: RawFields,
  schema: FieldInfo[]
): string {
  return shownOfRecord({
    table,
    record,
    fields: raw,
    types: new Map(schema.map(f => [f.name, f.type])),
    never: PROTECTED_FIELDS,
  })
}

/** What the page is handed for an item's record: its fields, its
 *  pictures, the table's field list, and the fingerprint of all that
 *  (`shown`), which the page sends back when it publishes an addition
 *  (requireRecordShown). `fresh` reads the field list anew: the page asks
 *  for that after a refusal, so a list that changed a moment ago cannot
 *  refuse it twice. Null when the record is not there. */
export async function readTarget(
  table: string,
  record: string,
  fresh = false
): Promise<(TargetRead & { schema: FieldInfo[]; shown: string }) | null> {
  const [raw, schema] = await Promise.all([
    readRecord(table, record),
    fresh ? getTableSchema(table, 0) : getTableSchema(table),
  ])
  if (!raw) return null
  return {
    ...targetRead(raw),
    schema,
    shown: recordShown(table, record, raw, schema),
  }
}

function targetRead(raw: RawFields): TargetRead {
  const out: Record<string, unknown> = {}
  const attachments: Record<string, AttachmentInfo[]> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (PROTECTED_FIELDS.has(k)) continue
    if (
      Array.isArray(v) &&
      v.length &&
      v.every(isRecord) &&
      v.every(x => typeof x.url === 'string')
    ) {
      const infos = v
        .map(attachmentInfo)
        .filter((a): a is AttachmentInfo => a !== null)
      out[k] = infos.map(a => a.url)
      attachments[k] = infos
    } else if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      (Array.isArray(v) && v.every(x => typeof x === 'string'))
    ) {
      out[k] = v
    }
  }
  return { fields: out, attachments }
}

// ─── Where a new listing sits on its page ───────────────────────────────────

/** The table's published listings in the order its page shows them (Sort
 *  ascending, a listing with no Sort first, as the site reads them), for
 *  the Position picker on an addition. Null when the table keeps no Sort:
 *  its page orders itself (events, dated training, the map). */
export async function getPageOrder(table: string): Promise<Placed[] | null> {
  if (!TABLE_ID_RE.test(table)) return null
  const schema = await getTableSchema(table)
  if (!keepsOrder(schema)) return null
  const name = primaryNames.get(table) ?? 'Name'
  const featured = schema.some(f => f.name === 'Featured')
  const params = new URLSearchParams({
    filterByFormula: 'AND({Publish?}, NOT({Hide?}))',
    'sort[0][field]': SORT_FIELD,
    'sort[0][direction]': 'asc',
  })
  params.append('fields[]', name)
  params.append('fields[]', SORT_FIELD)
  if (featured) params.append('fields[]', 'Featured')
  let rows: AirtableRow<RawFields>[]
  try {
    rows = await listAll<RawFields>(table, params)
  } catch (e) {
    throw new QueueError(
      `Airtable read failed: ${e instanceof Error ? e.message : String(e)}`,
      502
    )
  }
  return rows.map(r => ({
    id: r.id,
    name: str(r.fields[name]) ?? '(no name)',
    sort:
      typeof r.fields[SORT_FIELD] === 'number' ? r.fields[SORT_FIELD] : null,
    featured: Boolean(str(r.fields.Featured)),
  }))
}

/** Refuses to publish an addition its page could not show whole (the
 *  page's Accept guards, checked again here), going by the record with the
 *  edits in (an emptied field counts as empty): one with no place on a page
 *  kept in a manual order (Bryce, 28 Oct 2026: "make it impossible to
 *  accept a Queue suggestion if no sort is picked"), or with a field its
 *  page needs still empty (queue-needed.ts; Bryce, 29 Oct 2026: "accepting
 *  something with a field missing should be blocked from being accepted").
 *  A 422, not a 409: the item is still open, and Accept works once it is
 *  filled in. A record no longer in Airtable is left to the write, which
 *  says so. */
async function requireReady(
  item: QueueItem,
  table: string,
  record: string,
  edits: Record<string, unknown>
): Promise<void> {
  const schema = await getTableSchema(table)
  const read = await getTargetFields(table, record)
  if (!read) return
  const sort = SORT_FIELD in edits ? edits[SORT_FIELD] : read.fields[SORT_FIELD]
  if (keepsOrder(schema) && sortValue(sort) === null) {
    throw new QueueError(NO_PLACE, 422)
  }
  const missing = neededLeft(item.page, table, read.fields, edits, schema)
  if (missing.length > 0) throw new QueueError(fillFirst(missing), 422)
}

/** Frees a Sort value for the addition being published: the listing that
 *  holds it, and each one straight after it with no gap, moves down one
 *  (roomFor), ten records a request. Nothing to do when it is free. */
async function makeRoom(
  table: string,
  record: string,
  sort: number
): Promise<void> {
  const order = await getPageOrder(table)
  if (!order) return
  const moves = roomFor(order, sort, record)
  for (let i = 0; i < moves.length; i += 10) {
    const res = await airtableRequest(table, {
      method: 'PATCH',
      body: JSON.stringify({
        records: moves
          .slice(i, i + 10)
          .map(m => ({ id: m.id, fields: { [SORT_FIELD]: m.sort } })),
      }),
    })
    if (!res.ok) {
      throw new QueueError(
        `Airtable refused to move the listings below it down: ${res.status} ${(await res.text()).slice(0, 300)}`,
        502
      )
    }
  }
}

// ─── Preview through the site's own code ────────────────────────────────────

import {
  communityFromRecord,
  TABLE_ID as COMMUNITIES_TABLE,
} from '@/lib/data/communities'
import { eventFromRecord, TABLE_ID as EVENTS_TABLE } from '@/lib/data/events'
import {
  recurringProgramFromRecord,
  trainingProgramFromRecord,
} from '@/lib/data/training'
import { funderFromRecord, TABLE_ID as FUNDING_TABLE } from '@/lib/data/funding'
import {
  courseFromRecord,
  TABLE_ID as SELF_STUDY_TABLE,
} from '@/lib/data/self-study'
import {
  mediaChannelFromRecord,
  TABLE_ID as MEDIA_TABLE,
} from '@/lib/data/media-channels'
import {
  advisorFromRecord,
  TABLE_ID as ADVISORS_TABLE,
} from '@/lib/data/advisors'
import {
  projectFromRecord,
  TABLE_ID as PROJECTS_TABLE,
} from '@/lib/data/projects'
import {
  founderResourceFromRecord,
  TABLE_ID as FOUNDERS_TABLE,
} from '@/lib/data/founders'
import { mapOrgFromRecord, TABLE_ID as MAP_TABLE } from '@/lib/data/map'
import { getCatalog } from '@/lib/assistant/catalog'
import type { AirtableRawRecord } from '@/lib/data/airtable'

const TRAINING_TABLE = 'tbli1YSCpIuNY2DvL'
const RECURRING_TABLE = 'tblEEIbj6dW5oS4cX'

export type PreviewKind =
  | 'community'
  | 'event'
  | 'training'
  | 'recurring'
  | 'funder'
  | 'course'
  | 'mediaChannel'
  | 'advisor'
  | 'project'
  | 'founder'
  | 'mapOrg'

export interface PreviewListing {
  kind: PreviewKind
  listing: unknown
}

/** The record as the site would show it: read with fields keyed by id (the
 *  shape the page mappers take), the admin's edits laid over it by field
 *  name, then mapped by that table's own record-to-listing function. Null
 *  when the mapper skips the record. */
export async function getPreviewListing(
  table: string,
  record: string,
  edits: Record<string, unknown>
): Promise<PreviewListing | null> {
  if (!TABLE_ID_RE.test(table) || !isRecordId(record)) return null
  const res = await airtableRequest(
    `${table}/${record}?returnFieldsByFieldId=true`
  )
  if (!res.ok) return null
  const raw = (await res.json()) as AirtableRow<Record<string, unknown>>
  const schema = Object.keys(edits).length ? await getTableSchema(table) : []
  return mapPreview(table, raw, edits, schema)
}

export interface PreviewTarget {
  table: string
  record: string
  edits: Record<string, unknown>
}

/** Every open item's card in one go, so the page can hold them ready
 *  before an item is opened: one list read per 40 records of a table
 *  (Airtable allows five requests a second, so tables run one after
 *  another), keyed "table/record". Unknown or deleted records map to null. */
export async function getPreviewListings(
  targets: PreviewTarget[]
): Promise<Record<string, PreviewListing | null>> {
  const out: Record<string, PreviewListing | null> = {}
  const byTable = new Map<string, PreviewTarget[]>()
  for (const t of targets) {
    if (!TABLE_ID_RE.test(t.table) || !isRecordId(t.record)) continue
    const list = byTable.get(t.table) ?? []
    list.push(t)
    byTable.set(t.table, list)
  }
  for (const [table, list] of byTable) {
    const schema = await getTableSchema(table)
    for (let i = 0; i < list.length; i += 40) {
      const chunk = list.slice(i, i + 40)
      const params = new URLSearchParams()
      params.set('returnFieldsByFieldId', 'true')
      params.set(
        'filterByFormula',
        `OR(${chunk.map(t => `RECORD_ID()='${t.record}'`).join(',')})`
      )
      const rows = new Map(
        (await listAll<Record<string, unknown>>(table, params)).map(r => [
          r.id,
          r,
        ])
      )
      for (const t of chunk) {
        const r = rows.get(t.record)
        out[`${table}/${t.record}`] = r
          ? mapPreview(
              table,
              { ...r, fields: { ...r.fields } },
              t.edits,
              schema
            )
          : null
      }
    }
  }
  return out
}

/** A picture edit as the page's mappers read one: `[{url, filename}]`.
 *  The chat and the row's saved edits name a picture by its link (text, or
 *  links separated by commas), and a mapper sees only Airtable's shape –
 *  so a link stayed invisible on the card until Accept (Bryce, 23 Sept
 *  2026: "I don't see the logos in their fields"). Anything that is not a
 *  picture link is left as it came. */
export function asAttachmentPreview(v: unknown): unknown {
  const parts =
    typeof v === 'string'
      ? v
          .split(',')
          .map(x => x.trim())
          .filter(Boolean)
      : v
  const files = asAttachmentWrite(parts)
  if (!files || !files.length) return v
  const shown = files.filter(
    (f): f is { url: string; filename: string } =>
      isRecord(f) && typeof f.url === 'string'
  )
  return shown.length ? shown : v
}

/** The record with the edits laid over it (by field name → id), mapped by
 *  that table's own record-to-listing function. */
function mapPreview(
  table: string,
  raw: AirtableRow<Record<string, unknown>>,
  edits: Record<string, unknown>,
  schema: FieldInfo[]
): PreviewListing | null {
  const byName = new Map(schema.map(f => [f.name, f]))
  const edited = new Set<string>()
  for (const [name, value] of Object.entries(edits)) {
    const f = byName.get(name)
    if (!f) continue
    raw.fields[f.id] =
      f.type === 'multipleAttachments' ? asAttachmentPreview(value) : value
    edited.add(f.id)
  }
  // A formula built from an edited field still holds Airtable's old answer
  // until Accept saves the edit, and a card that reads it first kept showing
  // the old value (Bryce, 28 Oct 2026: a /map Category edit left the card on
  // "Research support, Resource" – the card reads Category (text), as
  // /communities reads Platform wrangled). Dropping the formula makes the
  // card fall back to the field itself, which carries the edit.
  for (const f of formulaInputs.get(table) ?? []) {
    if (f.inputs.some(id => edited.has(id))) delete raw.fields[f.id]
  }
  const rec = raw as unknown as AirtableRawRecord
  const wrap = (kind: PreviewKind, listing: unknown): PreviewListing | null =>
    listing ? { kind, listing } : null
  switch (table) {
    case COMMUNITIES_TABLE:
      return wrap('community', communityFromRecord(rec))
    case EVENTS_TABLE:
      return wrap('event', eventFromRecord(rec))
    case TRAINING_TABLE:
      return wrap('training', trainingProgramFromRecord(rec))
    case RECURRING_TABLE:
      return wrap('recurring', recurringProgramFromRecord(rec))
    case FUNDING_TABLE:
      return wrap('funder', funderFromRecord(rec))
    case SELF_STUDY_TABLE:
      return wrap('course', courseFromRecord(rec))
    case MEDIA_TABLE:
      return wrap('mediaChannel', mediaChannelFromRecord(rec))
    case ADVISORS_TABLE:
      return wrap('advisor', advisorFromRecord(rec))
    case PROJECTS_TABLE:
      return wrap('project', projectFromRecord(rec))
    case FOUNDERS_TABLE:
      return wrap('founder', founderResourceFromRecord(rec))
    case MAP_TABLE:
      return wrap('mapOrg', mapOrgFromRecord(rec))
    default:
      return null
  }
}

// ─── Image upload ───────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** Puts one image into an attachment field of the target record, replacing
 *  whatever was there (a logo slot holds one picture). Goes through
 *  Airtable's upload endpoint, so no public URL is needed. The record is
 *  unpublished, so nothing reaches the site until Accept. */
/** A picture that Replace or Undo took off a record, handed back to the
 *  page so Undo can put it back. Airtable keeps nothing extra – the page
 *  holds the bytes (Bryce, 17 Sept 2026: "not if it's stored in Airtable,
 *  since that would be messy"). */
export interface PreviousImage {
  filename: string
  contentType: string
  base64: string
}

export interface ImageWrite {
  urls: string[]
  attachments: AttachmentInfo[]
  /** What the write took off the record, when it can be put back. */
  previous: PreviousImage | null
  /** Nothing was written: the record already held the picture. */
  unchanged?: boolean
}

interface StoredAttachment {
  id: string
  url: string
  filename?: string
  type?: string
  size?: number
  thumbnails?: { large?: { url?: string } }
}

function isStoredAttachment(x: unknown): x is StoredAttachment {
  return isRecord(x) && typeof x.id === 'string' && typeof x.url === 'string'
}

/** The bytes of a picture on a record, read from Airtable's own link (the
 *  only host this fetches from). Null when it is too big to come back
 *  through the upload route, or cannot be read. */
async function fetchImage(x: StoredAttachment): Promise<PreviousImage | null> {
  if (typeof x.size === 'number' && x.size > MAX_UPLOAD_BYTES) return null
  try {
    const host = new URL(x.url).hostname
    if (!/(^|\.)airtableusercontent\.com$|(^|\.)airtable\.com$/.test(host)) {
      return null
    }
    const res = await fetch(x.url, { cache: 'no-store' })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_UPLOAD_BYTES) return null
    const type = (x.type ?? res.headers.get('content-type') ?? '').split(';')[0]
    if (!IMAGE_TYPE_RE.test(type)) return null
    return {
      filename: x.filename ?? 'image',
      contentType: type,
      base64: buf.toString('base64'),
    }
  } catch {
    return null
  }
}

const IMAGE_TYPE_RE = /^image\/(png|jpe?g|webp|gif|svg\+xml)$/

async function checkImageField(
  table: string,
  record: string,
  field: string
): Promise<void> {
  if (!TABLE_ID_RE.test(table) || !isRecordId(record)) {
    throw new QueueError('This item has no valid target record.', 400)
  }
  const schema = await getTableSchema(table)
  const info = schema.find(f => f.name === field)
  if (!info || info.type !== 'multipleAttachments') {
    throw new QueueError(`"${field}" is not an image field.`, 400)
  }
}

/** The pictures an attachment field holds right now. */
async function storedImages(
  table: string,
  record: string,
  field: string
): Promise<StoredAttachment[]> {
  const res = await airtableRequest(`${table}/${record}`)
  if (!res.ok) {
    throw new QueueError(`Airtable read failed: ${res.status}`, 502)
  }
  const stored = ((await res.json()) as { fields: RawFields }).fields[field]
  return Array.isArray(stored) ? stored.filter(isStoredAttachment) : []
}

/** Empties an attachment field, handing back the picture that was there
 *  (Undo after a first drop, or Redo of an undone clear). */
export async function clearImage(
  table: string,
  record: string,
  field: string
): Promise<ImageWrite> {
  await checkImageField(table, record, field)
  const before = await storedImages(table, record, field)
  const previous = before[0] ? await fetchImage(before[0]) : null
  await patchRecord(table, record, { [field]: [] })
  return { urls: [], attachments: [], previous }
}

export async function uploadImage(
  table: string,
  record: string,
  field: string,
  file: { filename: string; contentType: string; base64: string }
): Promise<ImageWrite> {
  await checkImageField(table, record, field)
  if (!IMAGE_TYPE_RE.test(file.contentType)) {
    throw new QueueError('Only PNG, JPEG, WebP, GIF or SVG images.', 400)
  }
  const bytes = Math.floor((file.base64.length * 3) / 4)
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new QueueError('That image is over 5 MB.', 400)
  }
  const token = process.env.AIRTABLE_TOKEN
  const base = process.env.AIRTABLE_BASE_ID
  if (!token || !base) throw new QueueError('Airtable is not configured.', 500)
  const res = await fetch(
    `https://content.airtable.com/v0/${base}/${record}/${encodeURIComponent(field)}/uploadAttachment`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contentType: file.contentType,
        filename: file.filename.slice(0, 120) || 'image',
        file: file.base64,
      }),
      cache: 'no-store',
    }
  )
  if (!res.ok) {
    throw new QueueError(
      `Airtable refused the upload: ${res.status} ${(await res.text()).slice(0, 300)}`,
      502
    )
  }
  // The upload reply keys fields by id, so re-read the record by name.
  const list = await storedImages(table, record, field)
  const newest = list[list.length - 1]
  // A logo slot holds one picture: keep only the one just dropped, after
  // reading the old one's bytes so the page can offer Undo.
  const old = list.length > 1 ? list[list.length - 2] : undefined
  const previous = old ? await fetchImage(old) : null
  if (newest && list.length > 1) {
    await patchRecord(table, record, { [field]: [{ id: newest.id }] })
  }
  if (!newest) return { urls: [], attachments: [], previous }
  const picture = attachmentInfo(newest as unknown as Record<string, unknown>)
  return {
    urls: [picture?.url ?? newest.url],
    attachments: picture ? [picture] : [],
    previous,
  }
}

/** Use on Fable's proposed logo for an addition (queue-field-flags.ts):
 *  the prepared file on the row's Prepared logo field goes onto the
 *  record's logo field, the way a picture dropped into the slot does – so
 *  Undo can put the old one back (`previous`). Only while the item is open,
 *  only the file the flag names, and only while the record still holds the
 *  file the flag was judged against (or already holds this one). The
 *  record is unpublished; Publish takes it live with the rest. */
export async function applyPreparedLogo(
  item: QueueItem,
  field: string,
  filename: string
): Promise<ImageWrite> {
  requireOpen(item)
  if (item.type !== 'Add') {
    throw new QueueError('Only an addition takes a proposed logo.', 400)
  }
  const { table, record } = target(item)
  const flag = item.fieldFlags?.pictures.find(
    p => p.field === field && p.to.file === filename
  )
  if (!flag) {
    throw new QueueError(
      "Fable's proposed logo is no longer on this item. Reload the page.",
      409
    )
  }
  const file = preparedNamed(
    flag.to.file,
    flag.to.size,
    item.preparedLogos ?? []
  )
  if (!file) {
    throw new QueueError(
      'The prepared logo is no longer on the Queue row. Reload the page.',
      409
    )
  }
  await checkImageField(table, record, field)
  const now = (await storedImages(table, record, field))[0] ?? null
  const isSide = (side: { file: string; size: number | null }) =>
    now !== null &&
    now.filename === side.file &&
    (side.size === null || now.size === undefined || now.size === side.size)
  if (isSide(flag.to)) {
    const info = attachmentInfo(now as unknown as Record<string, unknown>)
    return {
      urls: [info?.url ?? (now as StoredAttachment).url],
      attachments: info ? [info] : [],
      previous: null,
      unchanged: true,
    }
  }
  if (flag.from === null ? now !== null : !isSide(flag.from)) {
    throw new QueueError(
      'The logo on the record has changed since Fable looked at it, so this was not used. Reload to see it.',
      409
    )
  }
  const bytes = await fetchImage({
    id: '',
    url: file.url,
    filename: file.filename,
    type: file.type ?? undefined,
    size: file.size ?? undefined,
  })
  if (!bytes) {
    throw new QueueError(
      'The prepared logo could not be read from the Queue row.',
      502
    )
  }
  return uploadImage(table, record, field, bytes)
}

// ─── Airtable helpers ───────────────────────────────────────────────────────

async function patchRecord(
  table: string,
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  const res = await airtableRequest(`${table}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new QueueError(
      res.status === 429
        ? 'Airtable is rate-limiting right now. Try again in a few seconds.'
        : `Airtable refused the change: ${res.status} ${text.slice(0, 300)}`,
      502
    )
  }
}

/** True when the record exists (in this base). */
async function recordExists(table: string, id: string): Promise<boolean> {
  // The single-record endpoint takes no fields[] filter; the row is small.
  const res = await airtableRequest(`${table}/${id}`)
  if (res.status === 404 || res.status === 403) return false
  if (!res.ok) {
    throw new QueueError(
      `Airtable read failed: ${res.status} ${await res.text()}`,
      502
    )
  }
  return true
}

/** Deletes a record; a record that is already gone is not an error. */
async function deleteRecord(table: string, id: string): Promise<void> {
  const res = await airtableRequest(`${table}/${id}`, { method: 'DELETE' })
  if (res.ok || res.status === 404 || res.status === 403) return
  throw new QueueError(
    `Airtable refused the delete: ${res.status} ${await res.text()}`,
    502
  )
}

async function patchQueueRow(
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  await patchRecord(QUEUE_TABLE_ID, id, fields)
}

function target(item: QueueItem): { table: string; record: string } {
  const table = item.targetTable ?? ''
  const record = item.targetRecord ?? ''
  if (!TABLE_ID_RE.test(table) || !isRecordId(record)) {
    throw new QueueError('This item has no valid target record.', 400)
  }
  return { table, record }
}

/** Field name → value pairs the admin typed, checked before they reach
 *  Airtable: names must be plain short strings and never the publish flags. */
/** A picture as a proposal carries it — `{url, filename}` or a list of
 *  those — in the one shape Airtable writes to an attachment field and the
 *  site's card reads from one: a list of `{url, filename}`. Null for
 *  anything else (a bare URL string is a text field's value, not a file). */
export function asAttachments(
  v: unknown
): { url: string; filename: string }[] | null {
  const list = Array.isArray(v) ? v : [v]
  if (!list.length) return null
  const out: { url: string; filename: string }[] = []
  for (const x of list) {
    if (!isRecord(x) || typeof x.url !== 'string') return null
    const url = x.url.trim()
    if (!/^https?:\/\//i.test(url) || url.length > 2000) return null
    let filename =
      typeof x.filename === 'string' ? x.filename.trim().slice(0, 120) : ''
    if (!filename) {
      try {
        filename = decodeURIComponent(
          new URL(url).pathname.split('/').pop() ?? ''
        )
      } catch {
        filename = ''
      }
    }
    out.push({ url, filename: filename || 'image' })
  }
  return out
}

const ATTACHMENT_ID_RE = /^att[A-Za-z0-9]{14}$/

/** What an attachment field is written with: each picture as `{url,
 *  filename}` – a link as plain text counts, since Broom's proposals and the
 *  page's edits name a picture by its link, and Airtable answers the bare
 *  string with 422 "parameters must be objects, not strings" – or `{id}`
 *  for a picture the field already holds. Null when an entry is neither
 *  (a description of the old file, say). Nothing clears the field. */
export function asAttachmentWrite(v: unknown): unknown[] | null {
  if (v === null || v === undefined) return []
  const list = Array.isArray(v) ? v : [v]
  const out: unknown[] = []
  for (const x of list) {
    const files = asAttachments(typeof x === 'string' ? { url: x } : x)
    if (files) {
      out.push(files[0])
    } else if (
      isRecord(x) &&
      typeof x.id === 'string' &&
      ATTACHMENT_ID_RE.test(x.id)
    ) {
      out.push({ id: x.id })
    } else {
      return null
    }
  }
  return out
}

/** The retired columns (queue-retired.ts) among these fields that the
 *  table no longer has. Only a write that names one reads the schema
 *  afresh, so a column deleted in the last few minutes already counts.
 *  The newsletter's Fix reads it too, so such a field is not taken for one
 *  someone changed by hand (it reads as empty once the column is gone). */
export async function deletedColumns(
  table: string,
  fields: string[]
): Promise<string[]> {
  if (!fields.some(f => isRetired(table, f))) return []
  return goneFields(table, fields, await getTableSchema(table, 0))
}

/** The fields of one write, with every attachment field of the table put
 *  in the shape Airtable takes (asAttachmentWrite), and without any retired
 *  column the table no longer has (`gone`): Airtable would refuse the whole
 *  write over it. Other fields pass through, and so does everything when
 *  the table's schema cannot be read. A value that is not a picture either
 *  stops the write (`throw`, for an Apply the admin is watching) or leaves
 *  that one field as it is (`skip`, for an Undo that should still put the
 *  other fields back, and say which it could not: `skipped`). `pictures`
 *  names the attachment fields the write holds. */
async function withAttachmentShapes(
  table: string,
  fields: Record<string, unknown>,
  onText: 'throw' | 'skip'
): Promise<{
  fields: Record<string, unknown>
  gone: string[]
  pictures: string[]
  skipped: string[]
}> {
  const gone = await deletedColumns(table, Object.keys(fields))
  const schema = await getTableSchema(table)
  const out: Record<string, unknown> = {}
  const pictures: string[] = []
  const skipped: string[] = []
  for (const [k, v] of Object.entries(fields)) {
    if (gone.includes(k)) {
      console.warn(
        `[admin-queue] ${table}: left "${k}" out – the column is no longer in Airtable`
      )
      continue
    }
    if (schema.find(f => f.name === k)?.type !== 'multipleAttachments') {
      out[k] = v
      continue
    }
    const files = asAttachmentWrite(v)
    if (files) {
      out[k] = files
      pictures.push(k)
      continue
    }
    const shown = (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 80)
    if (onText === 'throw') {
      throw new QueueError(
        `"${k}" takes a picture link, and "${shown}" is not one.`,
        400
      )
    }
    console.warn(`[admin-queue] ${table}: left "${k}" alone – "${shown}"`)
    skipped.push(k)
  }
  return { fields: out, gone, pictures, skipped }
}

export function sanitiseEdits(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    const name = k.trim()
    if (!name || name.length > 100 || PROTECTED_FIELDS.has(name)) continue
    const files = asAttachments(v)
    if (files) {
      out[name] = files
      continue
    }
    if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      (Array.isArray(v) && v.every(x => typeof x === 'string'))
    ) {
      out[name] = v === '' ? null : v
    }
  }
  return out
}

function now(): string {
  return new Date().toISOString()
}

function refreshCache(): void {
  revalidateTag('airtable-records', 'max')
}

const DECISIONS: readonly HistoryDid[] = ['accept', 'reject', 'later', 'delete']

/** The History field with one more entry: who did what to the item, for
 *  the same write as the action itself (queue-history.ts). `by` is the
 *  signed-in admin's name; null when the caller has nobody to name.
 *
 *  A decision also settles the row's For Bryce (queue-suggest.ts) in that
 *  same write: the field is cleared, and a suggestion it confirmed or
 *  overrode, or a question it answered by deciding, is named on the entry,
 *  so the line keeps both names. */
function stamped(
  item: QueueItem,
  by: string | null,
  did: HistoryDid,
  at: string,
  more: { fields?: string[]; undid?: Undid | null } = {}
): Record<string, unknown> {
  const fb = DECISIONS.includes(did) ? (item.forBryce ?? null) : null
  const suggested: Suggested | null =
    fb && isWaiting(fb)
      ? { by: fb.by, did: fb.kind === 'suggest' ? fb.did : 'ask' }
      : null
  return {
    [F.history]: historyWith(item, {
      at,
      by,
      did,
      ...more,
      ...(suggested ? { suggested } : {}),
      // A decision on a change or a rule: what it was made on.
      ...(DECISIONS.includes(did) && item.shown ? { shown: item.shown } : {}),
    }),
    ...(fb ? { [F.forBryce]: null } : {}),
  }
}

/** The row's History with one more entry, which carries the address of
 *  whoever this request acts for (queue-actor.ts) beside their name. */
function historyWith(
  item: QueueItem,
  entry: Omit<Parameters<typeof withEntry>[1], 'email'>
): string {
  return withEntry(item.history ?? [], { ...entry, email: actorEmail() })
}

/** A decision on a change or a rule is made on what the page showed: the
 *  page sends the fingerprint of the item it had on screen (`shown`,
 *  queue-shown.ts), and a row whose changes or edits read differently by
 *  now is refused, 412, so the page reads it again. One that sent none (a
 *  tab from before this check) is refused the same way. */
export function requireShown(item: QueueItem, sent: unknown): void {
  if (item.type !== 'Change' && item.type !== 'Rule') return
  if (typeof sent === 'string' && sent === item.shown) return
  const what = item.type === 'Rule' ? 'This rule’s edits' : 'The changes'
  throw new QueueError(
    typeof sent === 'string'
      ? `${what} are not what your page showed: they changed after it read them. Here is the item as it is now. Look again, then decide.`
      : 'Your page has not said what it showed for this item. Reload the page, then decide.',
    412
  )
}

/** An addition is published as its record stands, so Publish is made on
 *  the record the page showed: the page sends the fingerprint that came
 *  with its read of the record (readTarget), and a record that reads
 *  differently by now (a chat rewrote a field, someone edited it in
 *  Airtable) is refused, 412, so the page reads it again. A page that
 *  sent none had not read the record yet (or is a tab from before this
 *  check) and is refused the same way.
 *
 *  The fingerprint that passed goes on the item, and from there on the
 *  decision's History entry (`shown`), as a change's or a rule's does.
 *
 *  Nothing to check for an item that is not an open addition with a
 *  record, or whose record is gone: the accept says so itself. */
export async function requireRecordShown(
  item: QueueItem,
  sent: unknown
): Promise<void> {
  if (item.type !== 'Add') return
  if (item.status !== 'Pending' && item.status !== 'Failed') return
  const table = item.targetTable ?? ''
  const record = item.targetRecord ?? ''
  if (!TABLE_ID_RE.test(table) || !isRecordId(record)) return
  const raw = await readRecord(table, record)
  if (!raw) return
  let now = recordShown(table, record, raw, await getTableSchema(table))
  if (typeof sent === 'string' && sent !== now) {
    // The table's field list may have changed since this server last read
    // it (kept ten minutes): once more with it read anew, which is how the
    // page's own re-read after a refusal is answered.
    now = recordShown(table, record, raw, await getTableSchema(table, 0))
  }
  if (typeof sent === 'string' && sent === now) {
    item.shown = now
    return
  }
  throw new QueueError(
    typeof sent === 'string'
      ? 'This listing’s record is not what your page showed: it changed after your page read it. Here it is as it is now. Look again, then decide.'
      : 'Your page had not read this listing’s record yet. It is reading it now: look at it, then decide.',
    412
  )
}

function requireOpen(item: QueueItem): void {
  if (item.status !== 'Pending' && item.status !== 'Failed') {
    throw new QueueError(
      `This item is already ${item.status.toLowerCase()}. Reload the page.`,
      409
    )
  }
}

// ─── Handled in Airtable directly ───────────────────────────────────────────

/** The tables whose rows carry the Publish?/Hide? pair – the ones that hold
 *  suggestions. Jobs has neither (its rows come from a feed and are never
 *  suggested). Mirrors SUGGESTION_TABLES in ~/Queue/queue_lib.py. */
const SUGGESTION_TABLES = new Set([
  EVENTS_TABLE,
  TRAINING_TABLE,
  RECURRING_TABLE,
  MAP_TABLE,
  COMMUNITIES_TABLE,
  SELF_STUDY_TABLE,
  FUNDING_TABLE,
  MEDIA_TABLE,
  ADVISORS_TABLE,
  PROJECTS_TABLE,
  FOUNDERS_TABLE,
])
const UNPUBLISHED_FORMULA = 'AND(NOT({Publish?}), NOT({Hide?}))'

// ─── A listing by its record id ─────────────────────────────────────────────

/** The resource tables with the page each one feeds, the busiest first:
 *  the tables a record id from the search box may belong to. */
const LISTING_TABLES: [table: string, page: string][] = [
  [EVENTS_TABLE, '/events'],
  [TRAINING_TABLE, '/training'],
  [RECURRING_TABLE, '/training'],
  [MAP_TABLE, '/map'],
  [COMMUNITIES_TABLE, '/communities'],
  [SELF_STUDY_TABLE, '/self-study'],
  [FUNDING_TABLE, '/funding'],
  [MEDIA_TABLE, '/media-channels'],
  [ADVISORS_TABLE, '/advisors'],
  [FOUNDERS_TABLE, '/founders'],
  [PROJECTS_TABLE, '/projects'],
]

/** The listing a record id belongs to, as it is in Airtable now, whether or
 *  not the Queue has ever held it: the search box's answer to a pasted id
 *  no open item has (Bryce, 16 Nov 2026: a note named a published round by
 *  its id, and searching for it found nothing). Null when no resource
 *  table has it.
 *
 *  Airtable has no lookup by id across tables, but it answers a read by
 *  record id from whichever table of the base holds the record, not only
 *  the one named in the request. So the record is read with its fields
 *  keyed by id, and those ids say which table it really sits in: one read
 *  for any record there is. Should Airtable ever start checking the table,
 *  the loop goes on to the next one (one read after another, well inside
 *  the base's five a second) and the same check finds the record in its
 *  own. Once a read has been seen to come from another table than the one
 *  asked, a miss on the first table is taken as "no such record" without
 *  asking the other ten. */
let readsCrossTables = false
export async function findListing(
  record: string
): Promise<FoundListing | null> {
  if (!isRecordId(record)) return null
  const pages = new Map(LISTING_TABLES)
  for (const [asked] of LISTING_TABLES) {
    const res = await airtableRequest(
      `${asked}/${record}?returnFieldsByFieldId=true`
    )
    if (res.status === 404 || res.status === 403) {
      // Reads have been seen to cross tables: one miss speaks for them all.
      if (readsCrossTables) return null
      continue
    }
    if (!res.ok) {
      throw new QueueError(
        `Airtable read failed: ${res.status} ${await res.text()}`,
        502
      )
    }
    const byId = ((await res.json()) as { fields: RawFields }).fields
    // The record's table, and its fields by name, read off the field ids.
    const named = () => {
      const raw: RawFields = {}
      let table: string | null = null
      for (const [id, v] of Object.entries(byId)) {
        const home = fieldHomes.get(id)
        // A field added in the last few minutes: not in the list yet.
        if (!home) continue
        table ??= home.table
        if (home.table === table) raw[home.name] = v
      }
      return { table, raw }
    }
    // Fills fieldHomes and primaryNames (cached for ten minutes); read
    // afresh when the cached list knows none of the record's fields.
    await getTableSchema(asked)
    let { table, raw } = named()
    if (!table && Object.keys(byId).length) {
      await getTableSchema(asked, 0)
      ;({ table, raw } = named())
    }
    // A record with nothing filled in names no table; one from a table
    // that feeds no page (a Queue row, a job) is not a listing.
    if (!table) return null
    if (table !== asked) readsCrossTables = true
    const page = pages.get(table)
    if (!page) return null
    const name = raw[primaryNames.get(table) ?? 'Name']
    const base = process.env.AIRTABLE_BASE_ID
    return {
      table,
      record,
      page,
      name: typeof name === 'string' ? name.trim() : '',
      state: listingState(raw),
      airtable: base ? `https://airtable.com/${base}/${table}/${record}` : null,
      ...targetRead(raw),
      schema: await getTableSchema(table),
    }
  }
  return null
}

/** Why an open Add row is done with, read off its target record as it is
 *  now (null for a record that is gone): nothing while the record is still
 *  an unpublished, unhidden suggestion. The wording is the Mac worker's. */
export function handledOutside(
  record: { fields: Record<string, unknown> } | null
): string | null {
  if (!record) return 'Deleted outside the queue'
  if (record.fields['Hide?']) return 'Hidden outside the queue'
  if (record.fields['Publish?']) return 'Published outside the queue'
  return null
}

/** A Queue row's Status as Airtable holds it this moment (an empty one
 *  reads as Pending, as in the list): null when the row is gone, undefined
 *  when the read failed (logged). */
async function statusNow(id: string): Promise<string | null | undefined> {
  const res = await airtableRequest(
    `${QUEUE_TABLE_ID}/${id}?returnFieldsByFieldId=true`
  )
  if (res.status === 404 || res.status === 403) return null
  if (!res.ok) {
    console.error(
      `[admin-queue] sync: reading queue row ${id} failed: ${res.status}`
    )
    return undefined
  }
  const row = (await res.json()) as { fields: RawFields }
  return str(row.fields[F.status]) ?? 'Pending'
}

/** Close the open Add rows whose record was deleted, published or hidden
 *  in Airtable itself – the Mac worker's sync, done here when the page asks
 *  so the list is right the moment the admin looks rather than on the
 *  worker's next five-minute pass (Bryce, 17 Sept 2026: suggestions he had
 *  just deleted still counted). One read per table of its unpublished
 *  records; a row whose record is not among them is read once more before
 *  it closes, in case the listing raced a record just added. The row
 *  itself is read again too, right before the write: `items` can be seconds
 *  old, and a row decided since then is left alone. Accepted rows and Broom
 *  flags stay with the worker. Never throws: a table that cannot be read is
 *  left for the worker. Answers with the ids it closed. */
export async function closeHandledRows(items: QueueItem[]): Promise<string[]> {
  const byTable = new Map<string, QueueItem[]>()
  for (const i of items) {
    if (i.type !== 'Add') continue
    if (i.status !== 'Pending' && i.status !== 'Revising') continue
    if (!i.targetTable || !i.targetRecord) continue
    if (!SUGGESTION_TABLES.has(i.targetTable) || !isRecordId(i.targetRecord)) {
      continue
    }
    const rows = byTable.get(i.targetTable) ?? []
    rows.push(i)
    byTable.set(i.targetTable, rows)
  }
  const closed: string[] = []
  const tables = [...byTable]
  // A few tables at a time: Airtable allows five requests a second.
  for (let at = 0; at < tables.length; at += 3) {
    await Promise.all(
      tables.slice(at, at + 3).map(async ([table, rows]) => {
        try {
          const params = new URLSearchParams()
          params.set('filterByFormula', UNPUBLISHED_FORMULA)
          params.append('fields[]', 'Publish?')
          const live = new Set(
            (await listAll<RawFields>(table, params)).map(r => r.id)
          )
          for (const row of rows) {
            const record = row.targetRecord as string
            if (live.has(record)) continue
            const res = await airtableRequest(`${table}/${record}`)
            let why: string | null
            if (res.status === 404 || res.status === 403) {
              why = handledOutside(null)
            } else if (!res.ok) {
              console.error(
                `[admin-queue] sync: reading ${table}/${record} failed: ${res.status}`
              )
              continue
            } else {
              why = handledOutside((await res.json()) as { fields: RawFields })
            }
            if (!why) continue
            // The list this row came from can be seconds old, and Accept
            // publishes the record a moment before it marks the row
            // Applied: closing on the old status wrote "Published outside
            // the queue" over a decision just made here, which took it off
            // Done today with no Undo and no reply draft (17 Nov 2026; the
            // Mac worker's sync had the same fault until 5 Oct 2026).
            const status = await statusNow(row.id)
            if (status !== 'Pending' && status !== 'Revising') {
              console.log(
                `[admin-queue] sync: left ${row.id} "${row.title}" alone – ${
                  status === undefined
                    ? 'its status could not be read'
                    : status === null
                      ? 'the row is gone'
                      : `decided since the list was read (${status})`
                }`
              )
              continue
            }
            await patchQueueRow(row.id, {
              [F.status]: 'Closed',
              [F.error]: why,
            })
            console.log(
              `[admin-queue] sync: closed ${row.id} "${row.title}" – ${why.toLowerCase()}`
            )
            closed.push(row.id)
          }
        } catch (e) {
          console.error(
            `[admin-queue] sync: ${rows[0]?.page ?? table}`,
            e instanceof Error ? e.message : e
          )
        }
      })
    )
  }
  return closed
}

// ─── Decisions ──────────────────────────────────────────────────────────────

/** A Change's edits to fields its proposal does not name (Bryce, 5 Oct
 *  2026: "I want a way of editing other random fields too"), the ones that
 *  can be written: not Publish?/Hide?, nor a column Airtable fills itself,
 *  a picture or a link to other records. */
export function extraEdits(
  item: QueueItem,
  edits: Record<string, unknown>,
  schema: FieldInfo[]
): Record<string, unknown> {
  const proposed = new Set(item.changes.map(c => c.field))
  const types = new Map(schema.map(f => [f.name, f.type]))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(edits)) {
    if (
      proposed.has(k) ||
      k === BEFORE_KEY ||
      k === KEPT_KEY ||
      k === LEFT_OUT_KEY ||
      k === GONE_KEY
    ) {
      continue
    }
    if (PROTECTED_FIELDS.has(k) || k.length > 100) continue
    if (UNWRITABLE_TYPES.has(types.get(k) ?? '')) continue
    out[k] = v
  }
  return out
}

/** What these fields of the record hold now (an empty one as null, an
 *  unticked box as false). */
async function currentValues(
  table: string,
  record: string,
  names: string[]
): Promise<Record<string, unknown>> {
  const res = await airtableRequest(`${table}/${record}`)
  if (!res.ok) {
    throw new QueueError(
      `Airtable read failed: ${res.status} ${(await res.text()).slice(0, 300)}`,
      502
    )
  }
  const data = (await res.json()) as { fields?: RawFields }
  const types = new Map(
    (await getTableSchema(table)).map(f => [f.name, f.type])
  )
  const out: Record<string, unknown> = {}
  for (const k of names) {
    const v = data.fields?.[k]
    out[k] = v ?? (types.get(k) === 'checkbox' ? false : null)
  }
  return out
}

/** A rule that brings wording for the public listing policy goes in only
 *  with a choice for it, made on the wording the page showed. */
function requirePublicSeen(
  item: QueueItem,
  publicWording: { choice: PublicChoice; seen: string | null } | null
): void {
  if (item.type !== 'Rule' || !item.rulePublic) return
  if (!publicWording) {
    throw new QueueError(
      'This rule comes with wording for the public listing policy, which this page had not shown you. Read it on the rule, then apply again.',
      412
    )
  }
  if (
    publicWording.choice === 'apply' &&
    publicWording.seen !== item.rulePublic.wording
  ) {
    throw new QueueError(
      'The wording for the public listing policy has changed since this page loaded it. Read the new wording, then apply again.',
      412
    )
  }
}

/** Carries out an Accept. Answers with the proposed or edited fields it
 *  left out because their column is no longer in Airtable (GONE_KEY), so a
 *  caller can say so; the row keeps them too. */
export async function acceptItem(
  item: QueueItem,
  pageEdits: Record<string, unknown>,
  replyDraft: string | null = null,
  keep: string[] = [],
  publicWording: { choice: PublicChoice; seen: string | null } | null = null,
  /** Who pressed it, for the row's history. */
  by: string | null = null
): Promise<string[]> {
  requireOpen(item)
  const stamp = now()
  // A change: the fields this accept writes to the listing, for the
  // history line.
  let wrote: string[] = []
  // A rule that brings wording for the public listing policy: the page says
  // what he chose for it, and which wording it showed him. Before the try,
  // so a refusal leaves the rule open, not Failed. 412, not 409: the rule is
  // still open, and the page re-reads it so the wording he must see shows.
  requirePublicSeen(item, publicWording)
  // The proposed fields left out with the cross come with the page's edits
  // under their own key, which is never a field to write.
  const { [LEFT_OUT_KEY]: left, ...edits } = pageEdits
  const leftOut =
    item.type === 'Change'
      ? leftOutOf(
          left,
          item.changes.map(c => c.field)
        )
      : []
  const saved: Record<string, unknown> = { ...edits }
  for (const k of leftOut) delete saved[k]
  // The reply draft as it reads on the page goes on the row first, so the
  // Mac agent (or the worker) saves exactly what the admin approved.
  const draft =
    replyDraft !== null && item.replyDraft !== null
      ? replyDraft.trim().slice(0, 5000)
      : null
  const draftFields: Record<string, unknown> =
    draft !== null && draft !== item.replyDraft ? { [F.replyDraft]: draft } : {}
  // Before the try: a passed item (its date went by while someone waits
  // for a reply) stays open for the Reject that drafts it, not Failed.
  if (item.passed) throw new QueueError(passedBlock(item.passed), 422)
  // Before the try: an addition with no place or an empty needed field
  // stays open, not Failed.
  if (
    item.type === 'Add' &&
    item.targetTable &&
    isRecordId(item.targetRecord ?? '')
  ) {
    await requireReady(
      item,
      item.targetTable,
      item.targetRecord as string,
      edits
    )
  }
  try {
    if (item.type === 'Add') {
      const t = target(item)
      const { fields, gone } = await withAttachmentShapes(
        t.table,
        edits,
        'throw'
      )
      // An edit to a column no longer in Airtable did not go out.
      for (const k of gone) delete saved[k]
      if (gone.length > 0) saved[GONE_KEY] = gone
      // A place picked on the page whose Sort a listing already holds:
      // that one and the run after it move down one first.
      const sort = fields[SORT_FIELD]
      if (typeof sort === 'number') await makeRoom(t.table, t.record, sort)
      await patchRecord(t.table, t.record, { ...fields, 'Publish?': true })
    } else if (item.type === 'Change') {
      // A row with no listing at all is a correction the Mac could not place
      // (no page named, no listing plainly the one): nothing to apply, so
      // accepting it just marks it done (12 Oct 2026).
      const t = item.targetTable || item.targetRecord ? target(item) : null
      const fields: Record<string, unknown> = {}
      // A proposed field Fable has since changed on the record from the
      // chat holds Fable's value, which the page shows in the proposal's
      // place: Accept leaves it, so the older proposal never lands over it
      // (Threading the Needle, 7 Oct 2026: Broom's raw logo and a "dark
      // version of the same new mark" placeholder sat above Fable's
      // finished logos, and Apply would have written them back). One the
      // admin edited on the page is written as edited (Bryce, 12 Oct 2026).
      const kept = item.changes
        .map(c => c.field)
        .filter(k => keep.includes(k) && !(k in edits))
      if (kept.length > 0) saved[KEPT_KEY] = kept
      // A proposed field the admin left out is not written at all: the
      // listing keeps what it holds there (Bryce, 15 Oct 2026: "I want to
      // be able to delete a suggested field change"). The row keeps which,
      // for the Done view and for Undo.
      if (leftOut.length > 0) saved[LEFT_OUT_KEY] = leftOut
      for (const c of item.changes) {
        if (
          c.field.length > 100 ||
          kept.includes(c.field) ||
          leftOut.includes(c.field)
        ) {
          continue
        }
        if (PROTECTED_FIELDS.has(c.field)) {
          fields[c.field] = asBox(c.to)
          continue
        }
        // A proposed picture goes to Airtable as an attachment list.
        fields[c.field] =
          c.field in edits ? edits[c.field] : (asAttachments(c.to) ?? c.to)
      }
      // Fields edited beyond the proposal go in the same write.
      const extra = t
        ? extraEdits(item, edits, await getTableSchema(t.table))
        : {}
      if (t) Object.assign(fields, extra)
      if (Object.keys(fields).length > 0) {
        const to = t ?? target(item) // fields but no listing: the usual error
        // A field whose column is no longer in Airtable (an old row's
        // proposal, queue-retired.ts) is left out and the rest still land;
        // the row keeps which, for the Done view and for Undo.
        const shaped = await withAttachmentShapes(to.table, fields, 'throw')
        if (shaped.gone.length > 0) {
          for (const k of shaped.gone) delete saved[k]
          saved[GONE_KEY] = shaped.gone
        }
        // What the write replaces is kept on the row so Undo can put it
        // back: the fields edited beyond the proposal, and every picture,
        // as a lasting copy – a proposal names the old one only by its file
        // name (queue-before-picture.ts).
        const keep = Object.keys(shaped.fields).filter(
          k => k in extra || shaped.pictures.includes(k)
        )
        if (keep.length > 0) {
          const was = await currentValues(to.table, to.record, keep)
          for (const k of shaped.pictures) {
            if (k in was) was[k] = await keepPictures(was[k])
          }
          saved[BEFORE_KEY] = was
        }
        if (Object.keys(shaped.fields).length > 0) {
          await patchRecord(to.table, to.record, shaped.fields)
          wrote = Object.keys(shaped.fields)
        }
      }
      // The Broom flag row goes either way: an applied fix clears it, and
      // so does accepting a flag with nothing to apply – the flag was right
      // and the admin has dealt with it, usually through the chat (Bryce,
      // 15 Sept 2026: "the flag was correct and led me to take action … I
      // also want the Airtable record to be removed"). It used to stay for
      // him to handle by hand, with the row parked at Accepted.
      if (item.issueRow && isRecordId(item.issueRow)) {
        await deleteRecord(BROOM_ISSUES_TABLE_ID, item.issueRow)
      }
    } else {
      // Rule: the file lives on the Mac; the worker applies it. With public
      // wording, his choice goes on the row for the worker to read: it puts
      // the wording on the public page only on "apply".
      await patchQueueRow(item.id, {
        ...draftFields,
        [F.status]: 'Accepted',
        [F.decidedAt]: stamp,
        [F.error]: null,
        ...stamped(item, by, 'accept', stamp),
        ...(item.rulePublic && publicWording
          ? {
              [F.edits]: JSON.stringify({ [PUBLIC_KEY]: publicWording.choice }),
            }
          : {}),
      })
      return []
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await patchQueueRow(item.id, {
      [F.status]: 'Failed',
      [F.error]: msg.slice(0, 1000),
    }).catch(() => {})
    throw e
  }
  await patchQueueRow(item.id, {
    ...draftFields,
    [F.status]: 'Applied',
    [F.decidedAt]: stamp,
    [F.appliedAt]: stamp,
    [F.edits]: Object.keys(saved).length ? JSON.stringify(saved) : null,
    [F.error]: null,
    ...stamped(item, by, 'accept', stamp, { fields: wrote }),
  })
  refreshCache()
  return goneOf(saved[GONE_KEY])
}

// ─── The local agent on the owner's Mac ─────────────────────────────────────

/** A Gmail draft, a Discord send or a rulebook patch cannot run on Vercel;
 *  a small agent on the owner's Mac (~/Queue/agent.py, loopback only) does
 *  them the moment Accept is clicked. The page calls it directly and shows
 *  it this token, sealed with the secret both sides hold, so a stray page
 *  in the same browser cannot drive the agent. Null when the secret is not
 *  configured: the page then leaves those steps to the Mac worker. */
export interface AgentInfo {
  port: number
  token: string
}

const AGENT_TOKEN_LIFE_SECONDS = 12 * 60 * 60

export function agentInfo(
  email: string,
  /** The admin's name, which the Mac keeps on an item's history when a
   *  chat reply they asked for changes the listing (queue-history.ts). */
  name: string | null = null
): AgentInfo | null {
  const secret = process.env.QUEUE_AGENT_SECRET
  if (!secret || !email) return null
  const port = Number(process.env.QUEUE_AGENT_PORT) || 8790
  const iat = Math.floor(Date.now() / 1000)
  const token = sealToken(
    {
      v: 1,
      kind: 'queue-agent',
      email,
      ...(name?.trim() ? { name: name.trim().slice(0, 100) } : {}),
      iat,
      exp: iat + AGENT_TOKEN_LIFE_SECONDS,
    },
    secret
  )
  return { port, token }
}

export async function rejectItem(
  item: QueueItem,
  reason: string,
  reply: string | null = null,
  by: string | null = null
): Promise<void> {
  requireOpen(item)
  // The reason is optional (Bryce, 24 Sept 2026: "I should be able to
  // reject without a reason").
  const why = reason.trim()
  const stamp = now()
  // The rejection reply as the page showed it, saved by the Mac as it
  // reads; none (a typed reason) and Fable writes it from the reason.
  // None for an item brought back after a decline with no word from them
  // since: they have the first one (queue-reopen.ts).
  const words =
    item.replyTo && !item.declinedBefore
      ? (reply ?? '').trim().slice(0, 5000)
      : ''
  const fields: Record<string, unknown> = {
    [F.status]: 'Rejected',
    [F.rejectReason]: why || null,
    [F.decidedAt]: stamp,
    [F.error]: null,
    [F.rejectReply]: words || null,
    ...stamped(item, by, 'reject', stamp),
  }
  if (item.type === 'Change' && item.issueRow && isRecordId(item.issueRow)) {
    // A dismissed Broom flag is done with: clear the flag row now.
    await deleteRecord(BROOM_ISSUES_TABLE_ID, item.issueRow)
    fields[F.appliedAt] = stamp
  }
  await patchQueueRow(item.id, fields)
}

/** "Review again in a week": the item leaves the list until then, and the
 *  Mac worker has Fable review it again when it is due. Nothing else on the
 *  row changes, so its edits and chat are there when it comes back. */
export async function laterItem(
  item: QueueItem,
  by: string | null = null
): Promise<void> {
  requireOpen(item)
  await patchQueueRow(item.id, {
    [F.reviewAgainOn]: reviewAgainAt(Date.now()),
    ...stamped(item, by, 'later', now()),
  })
}

/** "Waiting on them" by hand (Bryce, 26 Nov 2026, on Common Ground: AI
 *  Safety, translated: he had messaged the host on Luma and the item stayed
 *  in the list – "We need a button to mark as waiting on them maybe?").
 *  `on`: he has asked them something outside email, so the item waits in
 *  the folded section until he pastes their answer into the chat, or the
 *  wait runs out (queue-asked.ts); what he asked, when the chat recorded it
 *  before, is kept. Off: Stop waiting, the item is back in its place. Only a
 *  question asked outside email is ever taken off: an emailed one is
 *  followed in Gmail by the Mac. */
export async function waitItem(
  item: QueueItem,
  on: boolean,
  by: string | null = null
): Promise<void> {
  requireOpen(item)
  const f = await rawQueueFields(item.id)
  const proposal = parseJson(f[F.proposal])
  const next: Record<string, unknown> = isRecord(proposal)
    ? { ...proposal }
    : {}
  const held = elsewhereOf(next[ELSEWHERE_KEY])
  const at = now()
  if (on) {
    if (
      item.asked &&
      askedState({ ...item, dates: addedDates(item) }, Date.now()) === 'waiting'
    ) {
      throw new QueueError(
        'It is waiting on them already. Reload the page.',
        409
      )
    }
    next[ELSEWHERE_KEY] = {
      at,
      text: held && !held.answer ? held.text : '',
      ...(by ? { by } : {}),
    }
  } else {
    if (!held) {
      throw new QueueError('It is not waiting on them. Reload the page.', 409)
    }
    delete next[ELSEWHERE_KEY]
  }
  await patchQueueRow(item.id, {
    [F.proposal]: JSON.stringify(next, null, 1),
    ...stamped(item, by, on ? 'wait' : 'unwait', at),
  })
}

/** The row's Error once Delete has closed it. */
export const DELETED_NOTE = 'Deleted in the Queue'

/** Delete (Bryce, 6 Nov 2026: "Need a delete button", on an /advisors
 *  suggestion Comb had picked up from a Discord yes to his own invitation):
 *  a silent discard for an item that should not be in the Queue at all.
 *  It does what deleting the suggestion in Airtable by hand does: an
 *  addition's unpublished record goes at once, a Broom flag's issue row
 *  with it, and the row closes the way the sync closes one whose record
 *  was deleted outside the Queue. No reply is drafted or copied, Fable
 *  learns nothing from it (the Mac's teach loop skips Closed rows), Comb
 *  leaves a closed row alone, and it gets no Decided at, so it is not a
 *  decision: it shows in neither Done today nor the search's Earlier
 *  group. There is no Undo, so the page asks first. A live listing is
 *  never deleted: an addition published outside the Queue is refused, and
 *  one hidden there keeps its record. A change never touches its listing. */
export async function deleteItem(
  item: QueueItem,
  by: string | null = null
): Promise<void> {
  requireOpen(item)
  const record = await deletableRecord(item)
  if (record && !record.hidden) await deleteRecord(record.table, record.id)
  if (item.type === 'Change' && item.issueRow && isRecordId(item.issueRow)) {
    await deleteRecord(BROOM_ISSUES_TABLE_ID, item.issueRow)
  }
  await patchQueueRow(item.id, {
    [F.status]: 'Closed',
    [F.error]: DELETED_NOTE,
    ...stamped(item, by, 'delete', now()),
  })
}

/** An addition's record as Delete would find it: null when there is none
 *  to delete (not an addition, or the record is gone already). Refuses a
 *  live one: Delete never takes a listing off the site. */
async function deletableRecord(
  item: QueueItem
): Promise<{ table: string; id: string; hidden: boolean } | null> {
  const table = item.targetTable ?? ''
  const record = item.targetRecord ?? ''
  if (
    item.type !== 'Add' ||
    !SUGGESTION_TABLES.has(table) ||
    !isRecordId(record)
  ) {
    return null
  }
  const res = await airtableRequest(`${table}/${record}`)
  if (res.ok) {
    const { fields } = (await res.json()) as { fields: RawFields }
    if (fields['Publish?']) {
      throw new QueueError(
        'It is live on the site, so Delete leaves it alone. Reload the page.',
        409
      )
    }
    return { table, id: record, hidden: Boolean(fields['Hide?']) }
  }
  if (res.status !== 404 && res.status !== 403) {
    throw new QueueError(
      `Airtable read failed: ${res.status} ${await res.text()}`,
      502
    )
  }
  return null
}

/** The row's fields as Airtable holds them, for a write that must keep
 *  what it does not change (the Proposal JSON). */
async function rawQueueFields(id: string): Promise<RawFields> {
  const res = await airtableRequest(
    `${QUEUE_TABLE_ID}/${id}?returnFieldsByFieldId=true`
  )
  if (!res.ok) {
    throw new QueueError(
      `Airtable read failed: ${res.status} ${await res.text()}`,
      502
    )
  }
  return ((await res.json()) as { fields: RawFields }).fields
}

/** "Update flag" from the chat (queue-flag.ts): Fable's new verdict,
 *  reasons and reject buttons – and title and field changes, when it gave
 *  them – onto the row, keeping what they replace for Undo. Reply draft,
 *  Reply status and the page's edits stay as they are, and nothing is
 *  written to the listing. */
export async function flagItem(
  item: QueueItem,
  flag: FlagUpdate,
  /** Whose chat the flag came from, when it is not the owner's own: kept
   *  on the row's History (queue-history.ts, `flag`). Left out, no line is
   *  written, as it always was for the owner. */
  inChatOf?: string | null
): Promise<void> {
  requireOpen(item)
  const f = await rawQueueFields(item.id)
  const proposal = parseJson(f[F.proposal])
  const next: Record<string, unknown> = isRecord(proposal)
    ? { ...proposal }
    : {}
  // What the row says now – Undo goes back one step, so a review that ran
  // again in between is what comes back, not an older one.
  const before: Record<string, unknown> = {
    verdict: f[F.verdict] ?? null,
    reasons: f[F.reasons] ?? null,
    chips: f[F.rejectChips] ?? null,
    title: f[F.title] ?? null,
  }
  const fields: Record<string, unknown> = {
    [F.verdict]: flag.verdict,
    [F.reasons]: reasonsText(flag.reasons),
    [F.rejectChips]: flag.chips ? flag.chips.join('\n') : null,
  }
  if (flag.title) fields[F.title] = flag.title
  if (flag.changes) {
    before.changes = next.changes ?? null
    // The shape the Mac writes: each change names its record.
    next.changes = flag.changes.map(c => ({
      ...(item.targetTable && item.targetRecord
        ? { table: item.targetTable, record: item.targetRecord }
        : {}),
      field: c.field,
      from: c.from,
      to: c.to,
    }))
  }
  next[FLAG_BEFORE_KEY] = before
  fields[F.proposal] = JSON.stringify(next, null, 1)
  await patchQueueRow(item.id, {
    ...fields,
    ...(inChatOf === undefined ? {} : stamped(item, inChatOf, 'flag', now())),
  })
}

/** Undo for "Update flag": the row says again what it said before. */
export async function unflagItem(
  item: QueueItem,
  /** Who put the earlier flag back, when it is not the owner: see flagItem. */
  by?: string | null
): Promise<void> {
  requireOpen(item)
  const f = await rawQueueFields(item.id)
  const proposal = parseJson(f[F.proposal])
  const before = isRecord(proposal) ? proposal[FLAG_BEFORE_KEY] : null
  if (!isRecord(proposal) || !isRecord(before)) {
    throw new QueueError('Nothing to undo: the flag has not been updated.', 409)
  }
  const next: Record<string, unknown> = { ...proposal }
  delete next[FLAG_BEFORE_KEY]
  if ('changes' in before) {
    if (before.changes === null) delete next.changes
    else next.changes = before.changes
  }
  const fields: Record<string, unknown> = {
    [F.verdict]: before.verdict ?? null,
    [F.reasons]: before.reasons ?? null,
    [F.rejectChips]: before.chips ?? null,
    [F.proposal]: JSON.stringify(next, null, 1),
  }
  if (typeof before.title === 'string') fields[F.title] = before.title
  await patchQueueRow(item.id, {
    ...fields,
    ...(by === undefined ? {} : stamped(item, by, 'unflag', now())),
  })
}

/** His own words for the sentence a rule brings for the public listing
 *  policy, typed on the rule's card (Bryce, 27 Nov 2026): they take the
 *  place of the words the card showed, on the row's Proposal, so the chat,
 *  the rule test and Apply all see them (queue-rule-public.ts). Nothing goes
 *  on the public page until he applies the rule. `seen` is the wording the
 *  page showed; a row that says something else by now (the chat or another
 *  tab rewrote it) is refused with 412, so his words never replace ones he
 *  has not read. */
export async function savePublicWording(
  item: QueueItem,
  text: string,
  seen: string | null
): Promise<void> {
  requireOpen(item)
  if (item.type !== 'Rule' || !item.rulePublic) {
    throw new QueueError(
      'This item has no wording for the public listing policy.',
      400
    )
  }
  if (seen !== item.rulePublic.wording) {
    throw new QueueError(
      'The public wording changed since this page loaded it (in the chat or another tab). Your words are still in the box: save again to use them.',
      412
    )
  }
  const f = await rawQueueFields(item.id)
  const proposal = parseJson(f[F.proposal])
  if (!isRecord(proposal) || !isRecord(proposal.public)) {
    throw new QueueError(
      'This rule no longer has wording for the public listing policy. Reload the page.',
      409
    )
  }
  let block: Record<string, unknown> | null
  try {
    block = rewritePublic(proposal.public, text)
  } catch (e) {
    throw new QueueError(e instanceof Error ? e.message : String(e), 422)
  }
  if (!block) return
  await patchQueueRow(item.id, {
    [F.proposal]: JSON.stringify({ ...proposal, public: block }, null, 1),
  })
}

/** What one save changes on the row: with `keys` (the fields the page
 *  touched since its last save), only those keys move – set to the page's
 *  value, or dropped when the page no longer edits them – and every other
 *  key keeps what the row holds. So a page that opened the item before
 *  another page (or the chat) edited it cannot wipe those edits with its
 *  own save (Bryce, 23 Sept 2026: a Short name edit took a logo edit off
 *  the row – "it and the logos disappeared"). Without `keys` the page's
 *  edits replace the row's, as before. */
export function mergeEdits(
  current: Record<string, unknown> | null,
  edits: Record<string, unknown>,
  keys?: string[]
): Record<string, unknown> {
  if (!keys) return edits
  const out: Record<string, unknown> = { ...(current ?? {}) }
  for (const k of keys) {
    if (k in edits) out[k] = edits[k]
    else delete out[k]
  }
  return out
}

/** The page's pending edits, kept on the row so they are still there after
 *  a reload (and for the chat, which reads them). They reach the live base
 *  only through acceptItem. Since 14 Sept 2026 this is also how a change
 *  asked of Fable in the chat lands: it proposes, the admin applies, the
 *  edits sit here until Accept. (It replaced the "Note to Claude" round
 *  trip through the Mac worker.) */
export async function saveEdits(
  item: QueueItem,
  edits: Record<string, unknown>,
  replyDraft?: string,
  keys?: string[],
  /** Who is saving: someone whose decisions are suggestions can't change
   *  an item while a suggestion on it waits (queue-suggest.ts). Not only
   *  their own: a name that changed since (a new sign-in card) would
   *  otherwise free the item, and their edit would change what is being
   *  confirmed. */
  who: { by: string | null; checkFirst: boolean } | null = null
): Promise<void> {
  requireOpen(item)
  const open = openSuggestion(item.forBryce)
  if (open && who?.checkFirst) {
    const what = suggestWord(open.did, item.type)
    throw new QueueError(
      open.by === who.by
        ? `You suggested ${what} on this. Take it back first to change anything.`
        : `${firstName(open.by)} suggested ${what} on this, and it waits for ${CHECKER_NAME}, so it can't be changed now.`,
      409
    )
  }
  // The fields left out sit on the row with the edits, under their own key,
  // so a save that does not touch them keeps them.
  const merged = mergeEdits(
    withLeftOut(item.edits ?? {}, item.leftOut ?? []),
    edits,
    keys
  )
  const fields: Record<string, unknown> = {
    [F.edits]: Object.keys(merged).length ? JSON.stringify(merged) : null,
  }
  // The reply draft as edited on the page (the chat can rewrite it) is
  // kept on the row too; only for items that carry one, and it stays a
  // draft – the Mac saves it in Gmail or Bryce pastes it, never sends it.
  if (replyDraft !== undefined && item.replyDraft !== null) {
    fields[F.replyDraft] = replyDraft.trim().slice(0, 5000)
  }
  // Someone with full edit changing a suggested item before deciding it:
  // the suggestion follows their own edits, so their Confirm still goes.
  // Each part only while it is as the suggestion left it: a change from
  // anywhere else since still stops the next press once
  // (requireSuggestionSeen), and their page sends what it has read.
  if (open && who && !who.checkFirst && item.print) {
    const print: Print = { ...open.print }
    if (open.print.edits === item.print.edits) {
      print.edits = editsPrint(Object.keys(merged).length ? merged : null)
    }
    if (F.replyDraft in fields && open.print.reply === item.print.reply) {
      print.reply = replyPrint(fields[F.replyDraft])
    }
    if (print.edits !== open.print.edits || print.reply !== open.print.reply) {
      fields[F.forBryce] = JSON.stringify({ ...open, print })
    }
  }
  await patchQueueRow(item.id, fields)
}

/** A field fixed after the decision, from Done today (Bryce, 21 Oct 2026:
 *  "make fields in the today view editable", for every kind). The listing
 *  is live, so the edit goes straight onto it, and onto the row's edits as
 *  if it had been made before Accept: the Done view reads what the
 *  decision wrote from there, and Undo treats it the same way – an
 *  addition's Undo only unpublishes, a change's puts back what it
 *  replaced. A declined addition is left alone (the Mac deletes its
 *  record), and a rule has no fields. */
export function isFixable(item: QueueItem): boolean {
  if (item.status !== 'Applied' || item.declined) return false
  if (item.type === 'Add') return true
  return (
    item.type === 'Change' && Boolean(item.targetTable && item.targetRecord)
  )
}

export async function fixItem(
  item: QueueItem,
  edits: Record<string, unknown>,
  by: string | null = null
): Promise<void> {
  if (!isFixable(item)) {
    throw new QueueError(
      'Only a published addition or an applied change can be edited after the decision.',
      409
    )
  }
  const keys = Object.keys(edits)
  if (keys.length === 0) throw new QueueError('Nothing to save.', 400)
  if (keys.includes(LEFT_OUT_KEY)) {
    throw new QueueError('A field is left out only before the decision.', 400)
  }
  const t = target(item)
  // The write as Airtable takes it, worked out before anything is written:
  // a column no longer in Airtable (an old row's field, queue-retired.ts)
  // cannot take a fix, and the admin is told so.
  const shaped = await withAttachmentShapes(t.table, edits, 'throw')
  if (shaped.gone.length > 0) {
    throw new QueueError(
      `${goneNote(t.table, shaped.gone)} Nothing was saved.`,
      409
    )
  }
  const raw = parseJson((await rawQueueFields(item.id))[F.edits])
  const saved: Record<string, unknown> = isRecord(raw) ? { ...raw } : {}
  if (item.type === 'Change') {
    // A field beyond the proposal keeps what it held before, for Undo, as
    // one edited before Accept does.
    const proposed = new Set(item.changes.map(c => c.field))
    const before = isRecord(saved[BEFORE_KEY]) ? { ...saved[BEFORE_KEY] } : {}
    // So does a proposed picture Accept did not write (Fable had changed
    // it, or it was left out): the listing still holds the one from
    // before, and the proposal names it only by its file name.
    const unwritten = new Set(
      [saved[KEPT_KEY], saved[LEFT_OUT_KEY]].flatMap(l =>
        Array.isArray(l) ? l : []
      )
    )
    const fresh = keys.filter(
      k =>
        !(k in before) &&
        (!proposed.has(k) || (shaped.pictures.includes(k) && unwritten.has(k)))
    )
    if (fresh.length > 0) {
      const was = await currentValues(t.table, t.record, fresh)
      for (const k of shaped.pictures) {
        if (k in was) was[k] = await keepPictures(was[k])
      }
      Object.assign(before, was)
    }
    if (Object.keys(before).length > 0) saved[BEFORE_KEY] = before
    // A proposed field Fable had changed, or that was left out, is now
    // written as edited here.
    for (const key of [KEPT_KEY, LEFT_OUT_KEY]) {
      const list = saved[key]
      if (!Array.isArray(list)) continue
      const rest = list.filter(k => !keys.includes(k))
      if (rest.length > 0) saved[key] = rest
      else delete saved[key]
    }
  } else {
    // A new place on the page moves the listings after it down one, as
    // Accept does.
    const sort = edits[SORT_FIELD]
    if (typeof sort === 'number') await makeRoom(t.table, t.record, sort)
  }
  await patchRecord(t.table, t.record, shaped.fields)
  await patchQueueRow(item.id, {
    [F.edits]: JSON.stringify({ ...saved, ...edits }),
    ...stamped(item, by, 'fix', now(), { fields: Object.keys(shaped.fields) }),
  })
  refreshCache()
}

/** A picture dropped on a published addition: from then on the Done view
 *  shows the listing's own, not the one the decision wrote over it (an
 *  attachment link expires within hours, so the new one is not kept). */
export async function forgetRowEdit(
  item: QueueItem,
  field: string
): Promise<void> {
  const saved = parseJson((await rawQueueFields(item.id))[F.edits])
  if (!isRecord(saved) || !(field in saved)) return
  const rest = { ...saved }
  delete rest[field]
  await patchQueueRow(item.id, {
    [F.edits]: Object.keys(rest).length ? JSON.stringify(rest) : null,
  })
}

/** Reopen a declined addition, however old (queue-reopen.ts): the row gets
 *  the marker and stays decided until the Mac has the record back – the
 *  same one when it still exists, else one rebuilt from the row's saved
 *  copy – and then reopens it in one write. The page asks the Mac's agent
 *  to do that at once; the worker is the fallback. */
export async function reopenItem(
  item: QueueItem,
  by: string | null = null
): Promise<void> {
  if (item.type !== 'Add') {
    throw new QueueError('Only an addition can be reopened.', 400)
  }
  if (!item.declined) {
    throw new QueueError(
      `Only a declined addition can be reopened; this one is ${item.status.toLowerCase()}.`,
      409
    )
  }
  if (item.reopening && !item.reopening.error) {
    throw new QueueError('It is on its way back already.', 409)
  }
  const raw = parseJson((await rawQueueFields(item.id))[F.proposal])
  if (!isRecord(raw)) {
    throw new QueueError('This item has no saved copy to bring back.', 409)
  }
  await patchQueueRow(item.id, {
    [F.proposal]: JSON.stringify(withReopenMarker(raw, now()), null, 1),
    [F.error]: null,
    ...stamped(item, by, 'reopen', now()),
  })
}

/** Takes a decision back. Answers with the fields of an applied change it
 *  could not put back (a picture with no copy to write), so the page can
 *  say the listing still holds what Accept wrote there. */
export async function undoItem(
  item: QueueItem,
  by: string | null = null
): Promise<string[]> {
  // An item set aside: back in the list now.
  if (
    (item.status === 'Pending' || item.status === 'Failed') &&
    item.reviewAgainOn
  ) {
    await patchQueueRow(item.id, {
      [F.reviewAgainOn]: null,
      ...stamped(item, by, 'undo', now(), { undid: 'later' }),
    })
    return []
  }
  const reopen: Record<string, unknown> = {
    [F.status]: 'Pending',
    [F.decidedAt]: null,
    [F.appliedAt]: null,
    [F.rejectReason]: null,
    [F.error]: null,
    [F.rejectReply]: null,
    // Every branch below reopens the row with this one write.
    ...stamped(item, by, 'undo', now(), {
      undid: item.status === 'Rejected' ? 'reject' : 'accept',
    }),
  }
  // Accept and Reject both clear a Broom flag's row, and it cannot come
  // back. The reopened item lets go of it: the Mac worker takes a flag
  // whose row is gone for one cleared in Airtable and closes the item
  // within five minutes (Bryce, 12 Oct 2026: SteadRise, rejected and
  // undone, then "already closed" on the second Reject).
  if (
    item.type === 'Change' &&
    item.issueRow &&
    isRecordId(item.issueRow) &&
    !(await recordExists(BROOM_ISSUES_TABLE_ID, item.issueRow))
  ) {
    reopen[F.issueRow] = null
  }
  // A rejected suggestion the Mac has deleted is marked Applied, but there
  // is no publish to take back: Reopen brings it back instead.
  if (item.declined && item.status !== 'Rejected') {
    throw new QueueError(
      'Too late to undo: the record was deleted after the decline. Reopen brings it back.',
      409
    )
  }
  if (item.status === 'Applied' && item.type === 'Add') {
    const t = target(item)
    await patchRecord(t.table, t.record, { 'Publish?': false })
    await patchQueueRow(item.id, reopen)
    refreshCache()
    return []
  }
  if (item.status === 'Applied' && item.type === 'Change') {
    // A correction the Mac could not place (no listing at all): Accept only
    // marked it done (12 Oct 2026), so reopening is the whole Undo (Bryce,
    // 14 Nov 2026: LIaiSE Context Weekend, "Undo failed · This item has no
    // valid target record").
    if (!item.targetTable && !item.targetRecord) {
      await patchQueueRow(item.id, reopen)
      return []
    }
    const t = target(item)
    const fields: Record<string, unknown> = {}
    for (const c of item.changes) {
      // Accept did not write it (Fable had changed it, it was left out,
      // or its column was no longer in Airtable), so it stays.
      if (
        item.keptByFable?.includes(c.field) ||
        item.leftOut?.includes(c.field) ||
        item.gone?.includes(c.field)
      ) {
        continue
      }
      // A picture goes back as the copy Accept kept: the proposal names
      // the old one only by its file name.
      fields[c.field] = PROTECTED_FIELDS.has(c.field)
        ? asBox(c.from)
        : item.before && c.field in item.before
          ? item.before[c.field]
          : (c.from ?? null)
    }
    // The fields edited beyond the proposal, as they were before Accept.
    for (const [k, v] of Object.entries(item.before ?? {})) {
      if (PROTECTED_FIELDS.has(k) || k in fields) continue
      fields[k] = v
    }
    // A column deleted since Accept wrote it cannot be put back; the other
    // fields still are. So are they when a picture cannot be: one named
    // only by its file name (accepted before 3 Nov 2026), or one Accept
    // could keep only by Airtable's link, which has run out. Those are
    // named back to the admin, so the listing is not taken for undone.
    const shaped = await withAttachmentShapes(t.table, fields, 'skip')
    const back = shaped.fields
    const notBack = [...shaped.skipped]
    for (const k of shaped.pictures) {
      if (!isSpent(back[k])) continue
      delete back[k]
      notBack.push(k)
    }
    if (Object.keys(back).length) await patchRecord(t.table, t.record, back)
    // The edits stay as the page's draft, the fields left out too; what
    // they replaced is spent, and so is the list of deleted columns.
    if (item.before || item.keptByFable || item.gone) {
      const kept = withLeftOut(item.edits ?? {}, item.leftOut ?? [])
      reopen[F.edits] = Object.keys(kept).length ? JSON.stringify(kept) : null
    }
    await patchQueueRow(item.id, reopen)
    refreshCache()
    return notBack
  }
  if (item.status === 'Rejected') {
    if (item.type === 'Add') {
      const t = target(item)
      if (!(await recordExists(t.table, t.record))) {
        throw new QueueError(
          'Too late to undo: the record has already been deleted. Reopen brings it back.',
          409
        )
      }
    }
    await patchQueueRow(item.id, reopen)
    return []
  }
  if (
    item.status === 'Accepted' &&
    (item.type === 'Rule' || item.type === 'Change')
  ) {
    // A rule the worker has not applied yet (or a flag accepted without a
    // field change before 15 Sept 2026): nothing was written, so reopening
    // is enough. A flag cleared since then cannot come back – its Broom row
    // is gone – but the item reopens like any applied change.
    await patchQueueRow(item.id, reopen)
    return []
  }
  throw new QueueError(
    `Nothing to undo: the item is ${item.status.toLowerCase()}.`,
    409
  )
}

// ─── Bryce checks first (queue-suggest.ts) ──────────────────────────────────

/** A decision by someone with full edit on an item that carries a
 *  suggestion goes only on what their page has shown: this suggestion
 *  (`seen`, its time), on the row's verdict, proposed changes, target,
 *  Edits and Reply draft as they were when it was made. A part that has
 *  changed since passes once their page has read it as it is now
 *  (`seenPrint`, the fingerprint an earlier refusal gave the page, which
 *  then read the item again). Otherwise 412, with `recheck` = { at, print }
 *  so the page can say it has seen the item as it is now on the next
 *  press; a Mac duty rewriting the reply draft or a picture link so stops
 *  one press, never the item for good. */
export function requireSuggestionSeen(
  item: QueueItem,
  seen: string | null,
  seenPrint: Print | null = null
): void {
  const s = openSuggestion(item.forBryce)
  if (!s) return
  const who = firstName(s.by)
  const what = suggestWord(s.did, item.type)
  if (seen !== s.at) {
    // No fingerprint here: the next press is checked against the
    // suggestion's own, so a change since it was made is still said.
    throw new QueueError(
      `${who} suggested ${what} on this after your page loaded it. Here it is now. Look again, then decide.`,
      412,
      { recheck: { at: s.at } }
    )
  }
  if (!item.print) {
    throw new QueueError(
      'The item could not be checked against the suggestion. Reload the page.',
      412
    )
  }
  const moved = unseenParts(s.print, item.print, seenPrint)
  if (moved.length > 0) {
    const words = partWords(moved)
    const Words = `${words[0].toUpperCase()}${words.slice(1)}`
    throw new QueueError(
      seenPrint
        ? `${Words} changed again since your page read it. Here is the item as it is now. Look again, then decide.`
        : `${Words} changed after ${who} suggested ${what}. Here is the item as it is now. Look again, then decide.`,
      412,
      { recheck: { at: s.at, print: item.print, moved } }
    )
  }
}

/** What a "Suggest …" press sends: the decision it stands for, with what
 *  that decision would take (the page's edits and reply draft, the reason
 *  and decline text, a change's kept fields, a rule's public wording). */
export interface SuggestInput {
  did: SuggestDid
  /** The page's edits, as Accept would send them; null keeps the row's. */
  edits: Record<string, unknown> | null
  replyDraft: string | null
  keep: string[]
  publicWording: { choice: PublicChoice; seen: string | null } | null
  reason: string
  rejectReply: string | null
}

/** A suggested decision: nothing changes on the listing and the row stays
 *  open (no Decided at, so none of the Mac's decision steps run), but the
 *  checks the decision itself would make run now, so a problem shows at
 *  once rather than when it is confirmed. The page's edits and reply draft
 *  go on the row in the same write, with the suggestion and its History
 *  line. */
export async function suggestItem(
  item: QueueItem,
  input: SuggestInput,
  by: string | null
): Promise<void> {
  requireOpen(item)
  const fb = item.forBryce ?? null
  const open = openSuggestion(fb)
  if (open) {
    const what = suggestWord(open.did, item.type)
    throw new QueueError(
      open.by === by
        ? `You suggested ${what} on this already. Take it back first to suggest something else.`
        : `${firstName(open.by)} suggested ${what} on this already. Reload the page.`,
      409
    )
  }
  if (fb?.kind === 'ask' && !fb.answer && fb.by !== by) {
    throw new QueueError(
      `${firstName(fb.by)} has a question on this waiting. Reload the page.`,
      409
    )
  }
  // The page's edits without the fields left out, which are no fields.
  const pageEdits: Record<string, unknown> = { ...(input.edits ?? {}) }
  delete pageEdits[LEFT_OUT_KEY]
  // The same checks as the decision.
  if (input.did === 'accept') {
    requirePublicSeen(item, input.publicWording)
    if (item.passed) throw new QueueError(passedBlock(item.passed), 422)
    if (
      item.type === 'Add' &&
      item.targetTable &&
      isRecordId(item.targetRecord ?? '')
    ) {
      await requireReady(
        item,
        item.targetTable,
        item.targetRecord as string,
        input.edits ? pageEdits : (item.edits ?? {})
      )
    }
  } else if (input.did === 'delete') {
    await deletableRecord(item)
  }
  const nowPrint = item.print ?? (await getQueueItem(item.id))?.print
  if (!nowPrint) {
    throw new QueueError('That item no longer exists.', 404)
  }
  const at = now()
  const fields: Record<string, unknown> = {}
  let print: Print = nowPrint
  if (input.edits) {
    const saved = Object.keys(input.edits).length ? input.edits : null
    fields[F.edits] = saved ? JSON.stringify(saved) : null
    print = { ...print, edits: editsPrint(saved) }
  }
  if (input.replyDraft !== null && item.replyDraft !== null) {
    const reply = input.replyDraft.trim().slice(0, 5000)
    fields[F.replyDraft] = reply
    print = { ...print, reply: replyPrint(reply) }
  }
  const text = (v: string | null) =>
    (v ?? '').trim().slice(0, FOR_BRYCE_MAX_TEXT) || null
  const suggestion: Suggestion = {
    kind: 'suggest',
    by,
    at,
    did: input.did,
    reason: text(input.reason),
    rejectReply: input.did === 'reject' ? text(input.rejectReply) : null,
    keep: input.did === 'accept' ? input.keep.slice(0, 50) : [],
    publicChoice:
      input.did === 'accept' ? (input.publicWording?.choice ?? null) : null,
    edited: Object.keys(input.edits ? pageEdits : (item.edits ?? {})).slice(
      0,
      50
    ),
    print,
    // Their own question it takes the place of, answered or not.
    asked:
      fb?.kind === 'ask'
        ? { question: fb.question, answer: fb.answer, by: fb.answeredBy }
        : null,
  }
  await patchQueueRow(item.id, {
    ...fields,
    [F.forBryce]: JSON.stringify(suggestion),
    [F.history]: historyWith(item, {
      at,
      by,
      did: 'suggest',
      suggested: { by, did: input.did },
    }),
  })
}

/** Takes a suggestion or a question off the row: its author taking it back
 *  while it waits, or someone with full edit dismissing it (a row a bot
 *  closed after the suggestion, say). An answered question is cleared the
 *  same way once its author has read the answer, with no History line:
 *  the answer has one already. */
export async function withdrawItem(
  item: QueueItem,
  by: string | null,
  fullEdit: boolean
): Promise<void> {
  const fb = item.forBryce
  if (!fb) {
    throw new QueueError(
      'Nothing is waiting on it to take back. Reload the page.',
      409
    )
  }
  if (!fullEdit && fb.by !== by) {
    throw new QueueError(
      `That is ${firstName(fb.by)}'s, so only they can take it back.`,
      403
    )
  }
  const fields: Record<string, unknown> = { [F.forBryce]: null }
  if (isWaiting(fb)) {
    fields[F.history] = historyWith(item, {
      at: now(),
      by,
      did: 'withdraw',
      suggested: { by: fb.by, did: fb.kind === 'suggest' ? fb.did : 'ask' },
    })
  }
  await patchQueueRow(item.id, fields)
}

/** "Ask Bryce": a question on any item, decided ones included. It waits in
 *  the From section of everyone with full edit until one of them answers
 *  it on the card or decides the item. */
export async function askItem(
  item: QueueItem,
  question: string,
  by: string | null
): Promise<void> {
  const q = question.trim().slice(0, FOR_BRYCE_MAX_TEXT)
  if (!q) throw new QueueError('Write the question first.', 400)
  const fb = item.forBryce
  if (fb && isWaiting(fb)) {
    throw new QueueError(
      fb.kind === 'suggest'
        ? `${fb.by === by ? 'Your' : `${firstName(fb.by)}'s`} suggestion on this is waiting already. Take it back first to ask instead.`
        : 'A question on this is waiting already. Reload the page.',
      409
    )
  }
  const at = now()
  const asked: Question = {
    kind: 'ask',
    by,
    at,
    question: q,
    answer: null,
    answeredBy: null,
    answeredAt: null,
  }
  await patchQueueRow(item.id, {
    [F.forBryce]: JSON.stringify(asked),
    [F.history]: historyWith(item, { at, by, did: 'ask' }),
  })
}

/** The answer to a question, written on the card by someone with full
 *  edit: the item is the asker's again, with the answer on it. */
export async function answerItem(
  item: QueueItem,
  answer: string,
  by: string | null
): Promise<void> {
  const fb = item.forBryce
  if (!fb || fb.kind !== 'ask' || fb.answer) {
    throw new QueueError(
      'No question on it is waiting for an answer. Reload the page.',
      409
    )
  }
  const a = answer.trim().slice(0, FOR_BRYCE_MAX_TEXT)
  if (!a) throw new QueueError('Write the answer first.', 400)
  const at = now()
  const answered: Question = {
    ...fb,
    answer: a,
    answeredBy: by,
    answeredAt: at,
  }
  await patchQueueRow(item.id, {
    [F.forBryce]: JSON.stringify(answered),
    [F.history]: historyWith(item, {
      at,
      by,
      did: 'answer',
      suggested: { by: fb.by, did: 'ask' },
    }),
  })
}
