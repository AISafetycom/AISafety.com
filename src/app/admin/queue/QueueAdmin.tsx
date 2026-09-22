'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import type { SaidBy } from '@/lib/admin/queue'
import type {
  AgentInfo,
  AttachmentInfo,
  FieldInfo,
  PreviousImage,
  PreviewKind,
  QueueItem,
} from '@/lib/admin/queue'
import { missingFields } from '@/lib/admin/queue-needed'
import Icon from '@/components/Icon'
import { activityIcon } from '@/app/communities/activity-icon'
import { isAcceptingApplications } from '@/lib/funding-status'
import { trainingTypeColor } from '@/lib/training-types'
import { eventTypeColor } from '@/lib/event-types'
import SitePreview, {
  forgetPreviews,
  prefetchPreview,
  seedPreviews,
} from './SitePreview'
import Chat from './Chat'
import styles from './queue.module.css'

// The Queue is a triage tool Bryce sits in for long stretches, so it has its
// own look (see queue.module.css) rather than the admin's teal card stack:
// a list of items on the left, one item in focus on the right, keyboard
// shortcuts, auto-advance after every decision and an undo toast. Nothing
// here changes the site until Accept is clicked; the API refuses anything
// already decided.

const API = '/api/admin/queue'
const UPLOAD_API = '/api/admin/queue/upload'

// The list reads Airtable again this often while the tab is in view, and
// the moment it comes back into view. Two refreshes closer together than
// the gap (a tab flicked back and forth) are one.
const REFRESH_MS = 60 * 1000
const REFRESH_MIN_GAP_MS = 5 * 1000

// The list shows one kind of work at a time (additions to judge whole,
// changes to judge as a diff, or rules for the bots), grouped by where each
// item came from. Bryce, 11 Sept 2026: "to be in the headspace for one of
// those all at once".
type Section = 'requests' | 'broom' | 'rules' | 'comb'
const SECTIONS: Section[] = ['requests', 'broom', 'rules', 'comb']
type Kind = 'additions' | 'changes' | 'rules'
const KINDS: { key: Kind; label: string; title: string }[] = [
  {
    key: 'additions',
    label: 'Additions',
    title: 'New listings to publish or reject',
  },
  {
    key: 'changes',
    label: 'Changes',
    title: 'Proposed changes to existing listings',
  },
  {
    key: 'rules',
    label: 'Rules',
    title: 'Changes to the bots\u2019 rulebooks',
  },
]
const SECTION_LABEL: Record<Section, string> = {
  requests: 'Requests',
  broom: 'Broom',
  rules: 'Rules',
  comb: 'Comb',
}

// Inside a section the items sit under their resource page, in the site's
// own nav order, so one page can be judged at a stretch with the rest folded
// away. Bryce, 17 Sept 2026: "I need to be able to sub-group by resource
// page". A section on a single page shows no sub-heads.
const PAGE_ORDER = [
  '/training',
  '/events',
  '/map',
  '/communities',
  '/self-study',
  '/jobs',
  '/funding',
  '/media-channels',
  '/advisors',
  '/projects',
  '/founders',
  '/donation-guide',
]
const NO_PAGE_LABEL = 'No page'

/** One resource page's items within a section. `key` is the page label
 *  ('/training', '/training (recurring)', '' for no page). */
type PageGroup = { key: string; label: string; items: QueueItem[] }

function pageRank(group: PageGroup): number {
  if (!group.key) return PAGE_ORDER.length + 1
  const page = group.items[0]?.page ?? ''
  const i = PAGE_ORDER.indexOf(page)
  return i === -1 ? PAGE_ORDER.length : i
}

/** The site's nav order, unknown pages after it by name, recurring programs
 *  right behind /training, items with no page last. */
function byPageOrder(a: PageGroup, b: PageGroup): number {
  return pageRank(a) - pageRank(b) || a.key.localeCompare(b.key)
}

/** Split a section's (already sorted) items by resource page, keeping each
 *  page's items in the order they came. */
function splitByPage(list: QueueItem[]): PageGroup[] {
  const byKey = new Map<string, PageGroup>()
  for (const item of list) {
    const key = pageLabel(item) ?? ''
    let group = byKey.get(key)
    if (!group) {
      group = { key, label: key || NO_PAGE_LABEL, items: [] }
      byKey.set(key, group)
    }
    group.items.push(item)
  }
  return [...byKey.values()].sort(byPageOrder)
}

// Library icons (public/images/icons), rendered through the site's <Icon>.
const ICON = {
  requests: '/images/icons/speech-bubble.svg',
  mail: '/images/icons/mail.svg',
  discord: '/images/icons/discord.svg',
  form: '/images/icons/clipboard.svg',
  broom: '/images/icons/flag.svg',
  comb: '/images/icons/magnifying-glass.svg',
  rule: '/images/icons/book.svg',
  check: '/images/icons/check.svg',
  x: '/images/icons/x.svg',
  question: '/images/icons/question-mark.svg',
  plus: '/images/icons/plus.svg',
  stars: '/images/icons/stars.svg',
  undo: '/images/icons/reset.svg',
  external: '/images/icons/link-out.svg',
  copy: '/images/icons/copy.svg',
  table: '/images/icons/table.svg',
  arrow: '/images/icons/arrow-right.svg',
  timer: '/images/icons/timer.svg',
  download: '/images/icons/download.svg',
  done: '/images/icons/check-in-circle.svg',
  pencil: '/images/icons/pencil-small.svg',
  chevron: '/images/icons/chevron-down.svg',
} as const

function sourceIcon(item: QueueItem): string {
  if (item.type === 'Rule' || item.source === 'Teach') return ICON.rule
  switch (item.source) {
    case 'Email':
      return ICON.mail
    case 'Discord':
      return ICON.discord
    case 'Form':
      return ICON.form
    case 'Broom':
      return ICON.broom
    default:
      return ICON.comb
  }
}

function verdictIcon(item: QueueItem): string {
  if (item.verdict === 'Publish' || item.verdict === 'Fix') return ICON.check
  if (item.verdict === 'Unsure') return ICON.question
  return ICON.x
}

/** The host of a link, lower-case, or '' when it is not an http(s) URL.
 *  Icons and labels are picked by exact host, never by substring, so a
 *  link to "airtable.com.example" is just an outside link. */
function hostOf(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return ''
    return u.hostname.toLowerCase()
  } catch {
    return ''
  }
}

function onHost(url: string, host: string): boolean {
  const h = hostOf(url)
  return h === host || h.endsWith(`.${host}`)
}

function linkIcon(url: string): string {
  if (onHost(url, 'airtable.com')) return ICON.table
  if (onHost(url, 'discord.com')) return ICON.discord
  if (hostOf(url) === 'mail.google.com') return ICON.mail
  return ICON.external
}

type Theme = 'light' | 'dark'
const THEME_KEY = 'aisafety-admin-queue:theme'
const COLLAPSED_KEY = 'aisafety-admin-queue:collapsed'
const FOLDED_PAGES_KEY = 'aisafety-admin-queue:folded-pages'
const KIND_KEY = 'aisafety-admin-queue:kind'

function sectionOf(item: QueueItem): Section {
  if (item.type === 'Rule' || item.source === 'Teach') return 'rules'
  if (item.source === 'Broom') return 'broom'
  if (item.source === 'Comb') return 'comb'
  return 'requests'
}

/** Which of the Additions / Changes / Rules views an item belongs to. */
function kindOf(item: QueueItem): Kind {
  if (item.type === 'Rule' || item.source === 'Teach') return 'rules'
  return item.type === 'Add' ? 'additions' : 'changes'
}

function verdictRank(v: QueueItem['verdict']): number {
  switch (v) {
    case 'Publish':
    case 'Fix':
      return 0
    case 'Unsure':
    case null:
      return 1
    default:
      return 2
  }
}

/** Sizes a text box to what is typed in it, on open and on every keystroke,
 *  so a long description is never hidden behind a scrollbar. */
/** Cmd+Enter (Ctrl+Enter elsewhere) finishes a text box the way clicking
 *  away does: the words are kept and the box closes (Bryce, 17 Sept 2026:
 *  "CMD ENTER should exit the box (saving)"). */
function isDoneKey(e: React.KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey)
}

function fitToText(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  // scrollHeight leaves out the border; offset - client is exactly that.
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
}

/** A Change row's title is written as "Record name: what was found"; the
 *  page shows the name in its own place and the finding as the heading.
 *  Rows that carry `name` in the proposal use it; older ones split the
 *  title at the first ": ". */
function splitTitle(item: QueueItem): { name: string | null; heading: string } {
  if (item.type !== 'Change') return { name: null, heading: item.title }
  if (item.name && item.title.startsWith(item.name + ': ')) {
    return { name: item.name, heading: item.title.slice(item.name.length + 2) }
  }
  const at = item.title.indexOf(': ')
  if (at > 0 && at < 120) {
    return { name: item.title.slice(0, at), heading: item.title.slice(at + 2) }
  }
  return { name: item.name, heading: item.title }
}

/** Broom writes its finding as a one-paragraph summary followed by the
 *  evidence; the summary is what gets read, the rest is there when needed. */
function splitExcerpt(text: string): { lead: string; detail: string | null } {
  const m = /\n\s*\n/.exec(text)
  if (!m) return { lead: text.trim(), detail: null }
  return {
    lead: text.slice(0, m.index).trim(),
    detail: text.slice(m.index + m[0].length).trim() || null,
  }
}

/** The record id in the address bar, if it names one. */
function hashId(): string | null {
  return /^#(rec[A-Za-z0-9]{14})$/.exec(window.location.hash)?.[1] ?? null
}

/** The "Source:" line of Comb's Airtable comment, minus the clock time and
 *  zone on a posting date ("posted 15 September 2026 19:57 UTC+01:00" →
 *  "posted 15 September 2026"): the day is what places it. */
function foundLabel(text: string): string {
  return text
    .replace(
      /(\d{1,2} [A-Z][a-z]+ \d{4}) \d{1,2}:\d{2}(?: UTC[+\-\u2212]\d{2}:\d{2})?/,
      '$1'
    )
    .trim()
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const m = Math.round(ms / 60000)
  if (m < 2) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

/** Midnight this morning in the viewer's own time zone. */
function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Decided at or after the given moment. A row with no decision time
 *  (there should be none) is shown rather than lost. */
function decidedSince(item: QueueItem, since: number): boolean {
  const t = item.decidedAt ? Date.parse(item.decidedAt) : NaN
  return !Number.isFinite(t) || t >= since
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map(show).join(', ')
  return JSON.stringify(v)
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** An Airtable date as people write it: "1 February 2027", or with the
 *  time after a comma when the field carries one. Anything else comes
 *  back untouched. Only what is SHOWN goes through here; the value kept
 *  for editing and saving stays in Airtable's own YYYY-MM-DD (Bryce,
 *  17 Sept 2026: "show dates in friendly format"). */
function friendly(text: string): string {
  if (DATE_ONLY_RE.test(text)) {
    const [y, m, d] = text.split('-').map(Number)
    const date = new Date(Date.UTC(y, m - 1, d))
    if (Number.isNaN(date.getTime())) return text
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }
  if (DATE_TIME_RE.test(text)) return whenLabel(text) || text
  return text
}

/** An attachment value as the queue sees it: Airtable's own shape (an
 *  object or list with `url`), the site's snapshot (a list of URLs), or
 *  Broom's proposal (`{url, filename}`). The old side of a change often
 *  carries only `{id, filename}`, which is why `pictureOf` also takes the
 *  record's live field. */
function pictureUrl(v: unknown): string | null {
  if (Array.isArray(v)) return v.length ? pictureUrl(v[0]) : null
  if (typeof v === 'string') return IMAGE_URL.test(v) ? v : null
  if (v && typeof v === 'object' && 'url' in v) {
    const url = (v as { url: unknown }).url
    return typeof url === 'string' ? url : null
  }
  return null
}

function looksLikeAttachment(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0 && v.every(looksLikeAttachment)
  return Boolean(
    v && typeof v === 'object' && ('url' in v || 'filename' in v || 'id' in v)
  )
}

function fileNameOf(v: unknown): string | null {
  if (Array.isArray(v)) return v.length ? fileNameOf(v[0]) : null
  if (v && typeof v === 'object' && 'filename' in v) {
    const f = (v as { filename: unknown }).filename
    return typeof f === 'string' ? f : null
  }
  if (typeof v === 'string') {
    try {
      return decodeURIComponent(new URL(v).pathname.split('/').pop() ?? '')
    } catch {
      return null
    }
  }
  return null
}

/** The picture behind one side of a change to a logo or image field: the
 *  value's own URL, else (for the old side, whose snapshot has none) the
 *  record's live field. Null when the value is not a picture at all. */
function pictureOf(
  v: unknown,
  liveValue: unknown
): { url: string | null; name: string | null } | null {
  if (!looksLikeAttachment(v) && !pictureUrl(v)) return null
  return {
    url: pictureUrl(v) ?? pictureUrl(liveValue),
    name: fileNameOf(v) ?? fileNameOf(liveValue),
  }
}

/** Saves a picture under its file name. A host that refuses a cross-site
 *  read cannot be fetched from here, so the picture opens in a tab instead
 *  (a plain download link is ignored by browsers for another site). */
async function downloadPicture(url: string, name: string | null) {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) throw new Error(String(res.status))
    const href = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = href
    a.download = name ?? 'image'
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}

function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** One side of a change to an image field: the picture with a download
 *  button on hover, then its file name, then its size in pixels and bytes
 *  (the bytes only when the host lets the page read the file). A missing
 *  picture (an expired link) shows the name only. */
function Picture({ url, name }: { url: string | null; name: string | null }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [bytes, setBytes] = useState<number | null>(null)
  // Keyed by URL where it is used, so a new picture is a fresh component.
  useEffect(() => {
    if (!url) return
    let cancelled = false
    fetch(url, { mode: 'cors' })
      .then(r => (r.ok ? r.blob() : null))
      .then(b => {
        if (!cancelled && b) setBytes(b.size)
      })
      .catch(() => {
        // the host does not allow a cross-site read: no byte count
      })
    return () => {
      cancelled = true
    }
  }, [url])
  const meta = [
    dims ? `${dims.w} × ${dims.h}` : null,
    bytes !== null ? fileSize(bytes) : null,
  ].filter(Boolean)
  return (
    <span className={styles.picture}>
      <span className={styles.pictureFrame}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.pictureImg}
            src={url}
            alt=""
            onLoad={e => {
              const el = e.currentTarget
              if (el.naturalWidth) {
                setDims({ w: el.naturalWidth, h: el.naturalHeight })
              }
            }}
          />
        ) : (
          <span className={`${styles.pictureImg} ${styles.pictureEmpty}`} />
        )}
        {url && (
          <button
            type="button"
            className={styles.pictureDownload}
            title={`Download ${name ?? 'the picture'}`}
            aria-label={`Download ${name ?? 'the picture'}`}
            onClick={() => void downloadPicture(url, name)}
          >
            <Icon src={ICON.download} size={12} />
          </button>
        )}
      </span>
      {name && <span className={styles.pictureName}>{name}</span>}
      {meta.length > 0 && (
        <span className={styles.pictureMeta}>{meta.join(' · ')}</span>
      )}
    </span>
  )
}

/** What the record's pictures are (file name, size, type), by the link the
 *  field list holds for them – from the live read and from an upload.
 *  Module-wide, so the picture slot can look its own links up. */
const attachmentMeta = new Map<string, AttachmentInfo>()
function rememberAttachments(
  byField: Record<string, AttachmentInfo[]> | undefined
): void {
  if (!byField) return
  for (const list of Object.values(byField)) {
    for (const a of list) attachmentMeta.set(a.url, a)
  }
}

const TYPE_LABEL: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'image/svg+xml': 'SVG',
}

/** "250 × 63 · 2 KB · WebP" for a picture the record holds. */
function attachmentMetaLine(a: AttachmentInfo): string {
  return [
    a.width && a.height ? `${a.width} × ${a.height}` : null,
    a.size !== null ? fileSize(a.size) : null,
    a.type
      ? (TYPE_LABEL[a.type] ?? a.type.replace(/^image\//, '').toUpperCase())
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The cached card no longer speaks for this record: it changed. */
function forgetCard(item: QueueItem): void {
  if (item.targetTable && item.targetRecord) {
    forgetPreviews(item.targetTable, item.targetRecord)
  }
}

// Row pictures whose link has failed: never shown again, however often the
// server hands the same link back.
const deadLogos = new Set<string>()

/** The picture that Replace, Undo or Redo took off a record, held in the
 *  page – never in Airtable – so the next Undo can put it back. By item and
 *  field, so it is still there after moving to another item and back. A
 *  null file means the field was empty before the drop, so Undo empties
 *  it again. `redo` is set after an Undo: the next press puts the
 *  replacement back. */
interface ImageStash {
  file: PreviousImage | null
  redo: boolean
}
const imageStash = new Map<string, ImageStash>()
const STASH_LIMIT = 12
function stashImage(key: string, stash: ImageStash): void {
  imageStash.delete(key)
  imageStash.set(key, stash)
  while (imageStash.size > STASH_LIMIT) {
    const oldest = imageStash.keys().next().value
    if (oldest === undefined) break
    imageStash.delete(oldest)
  }
}

const NAME_KEYS = /\b(name|title)\b|^organi[sz]ation$/i
const URL_KEYS = /^(url|website|link|join link|apply link|application link)$/i
const DESC_KEYS = /description/i

/** The listing's own link: the row's, else the first link-like field of
 *  the record as read live (or as proposed). */
function listingLink(
  item: QueueItem,
  fields: Record<string, unknown> | null | undefined
): string | null {
  if (item.url) return item.url
  for (const [k, v] of Object.entries(fields ?? item.fields ?? {})) {
    if (URL_KEYS.test(k) && typeof v === 'string' && /^https?:\/\//.test(v)) {
      return v
    }
  }
  return null
}

function linkLabel(url: string): string {
  if (hostOf(url) === 'mail.google.com') return 'Open email'
  if (onHost(url, 'discord.com')) return 'Open Discord'
  if (onHost(url, 'airtable.com')) return 'Open in Airtable'
  return 'Open source'
}

/** Text, numbers, lists of text and empty fields can be typed into. Lists
 *  are edited as comma-separated text. Attachments and checkboxes cannot. */
function isEditable(v: unknown): boolean {
  return (
    typeof v === 'string' ||
    typeof v === 'number' ||
    v === null ||
    v === undefined ||
    (Array.isArray(v) && v.every(x => typeof x === 'string'))
  )
}

/** Turn what was typed back into the shape Airtable expects for that field:
 *  a list stays a list, a number stays a number, empty clears the field. */
function coerceEdits(
  edits: Record<string, string>,
  original: Record<string, unknown>,
  types: Map<string, FieldInfo> = new Map()
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, text] of Object.entries(edits)) {
    const was = original[k]
    const t = text.trim()
    const type = types.get(k)?.type
    if (type === 'checkbox') out[k] = t === 'true'
    else if (t === '') out[k] = null
    else if (type === 'multipleSelects' || Array.isArray(was)) {
      out[k] = t
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
    } else if (
      (type === 'number' || typeof was === 'number') &&
      !Number.isNaN(Number(t))
    ) {
      out[k] = Number(t)
    } else out[k] = text
  }
  return out
}

/** The row's saved edits in the shape the page's editors hold: text, a
 *  list as one comma-separated string. */
function editsAsText(edits: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(edits)) {
    if (v === null || v === undefined) out[k] = ''
    else if (typeof v === 'string') out[k] = v
    else if (Array.isArray(v)) {
      out[k] = v
        .map(x =>
          x && typeof x === 'object' && 'url' in (x as object)
            ? String((x as { url: unknown }).url)
            : String(x)
        )
        .join(', ')
    } else out[k] = String(v)
  }
  return out
}

/** The draft an item starts from: its saved edits, when it is still open. */
function draftOfRow(items: QueueItem[] | null | undefined, id: string): Draft {
  const item = items?.find(i => i.id === id)
  if (!item || !item.edits || !isOpen(item)) return FRESH
  return { ...FRESH, edits: editsAsText(item.edits) }
}

function sameEdits(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every(k => a[k] === b[k])
}

function isOpen(item: QueueItem): boolean {
  return (
    item.status === 'Pending' ||
    item.status === 'Revising' ||
    item.status === 'Failed'
  )
}

/** The edits a card preview is built with before the admin touches
 *  anything: a Change shows its proposed values, an Add shows the record. */
function proposedEdits(item: QueueItem): Record<string, unknown> {
  return item.type === 'Change'
    ? Object.fromEntries(item.changes.map(c => [c.field, c.to]))
    : {}
}

/** What the lookup answers: a logo and the listing's own link, each by
 *  target record, for the records that have one. */
interface TargetLookup {
  logos: Record<string, string>
  links: Record<string, string>
}
const NO_TARGETS: TargetLookup = { logos: {}, links: {} }

/** The list arrives without most logos, and a Change row without its
 *  listing's link (its proposal names only the fields it edits), so it
 *  lands at once; this asks for the pictures and links of the rows that
 *  came without one (the site's catalog, then the records themselves for
 *  unpublished targets) and answers with each by target record. Best
 *  effort: no logo or link is not worth an error. */
/** Records whose picture and link have been asked for already, so a
 *  refresh of the list asks only for the rows that are new to it. */
const askedTargets = new Set<string>()

async function loadTargets(items: QueueItem[]): Promise<TargetLookup> {
  const targets: { table: string; record: string }[] = []
  for (const i of items) {
    if ((i.logo && i.url) || !i.targetTable || !i.targetRecord) continue
    if (askedTargets.has(i.targetRecord)) continue
    askedTargets.add(i.targetRecord)
    targets.push({ table: i.targetTable, record: i.targetRecord })
  }
  if (!targets.length) return NO_TARGETS
  try {
    const res = await fetch(`${API}/logos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets }),
    })
    const data = (await res.json()) as Partial<TargetLookup>
    if (res.ok && (data.logos || data.links)) {
      return { logos: data.logos ?? {}, links: data.links ?? {} }
    }
  } catch {
    // not answered: asked again below
  }
  for (const t of targets) askedTargets.delete(t.record)
  return NO_TARGETS
}

/** The row with the picture and link the lookup found for it, when the
 *  row came without them. */
function withTarget(i: QueueItem, found: TargetLookup): QueueItem {
  const rec = i.targetRecord
  if (!rec) return i
  const logo = !i.logo && found.logos[rec] ? found.logos[rec] : null
  const url = !i.url && found.links[rec] ? found.links[rec] : null
  if (!logo && !url) return i
  return { ...i, logo: logo ?? i.logo, url: url ?? i.url }
}

/** Build every open item's card in one request and hold them ready, so
 *  opening an item never waits on Airtable. Best effort. */
async function preloadCards(items: QueueItem[]): Promise<void> {
  const targets = items
    .filter(
      i =>
        isOpen(i) &&
        (i.type === 'Add' || i.type === 'Change') &&
        i.targetTable &&
        i.targetRecord
    )
    .map(i => ({
      table: i.targetTable as string,
      record: i.targetRecord as string,
      edits: proposedEdits(i),
    }))
  if (!targets.length) return
  try {
    const res = await fetch(`${API}/previews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets }),
    })
    const data = (await res.json()) as {
      previews?: Record<string, { kind: PreviewKind | null; listing?: unknown }>
    }
    if (!res.ok || !data.previews) return
    seedPreviews(
      targets.map(t => ({
        ...t,
        preview: data.previews?.[`${t.table}/${t.record}`] ?? { kind: null },
      }))
    )
  } catch {
    // the single-card route still works
  }
}

/** The toast shows for nine seconds; U undoes the last decision for five
 *  minutes after it, toast or no toast (Bryce, 11 Sept 2026). */
const TOAST_MS = 9000
/** The slide down at the end, part of TOAST_MS. Matches the CSS. */
const TOAST_OUT_MS = 220
const UNDO_MS = 5 * 60 * 1000

// Recurring programs live under /training's "recurring" view.
const RECURRING_TABLE = 'tblEEIbj6dW5oS4cX'

/** The page as shown on the row and the detail: recurring programs sit in
 *  /training's own "recurring" view, so they say so. */
function pageLabel(item: QueueItem): string | null {
  if (!item.page) return null
  return item.targetTable === RECURRING_TABLE
    ? `${item.page} (recurring)`
    : item.page
}

/** The live page, landing on this record's card (every site card carries
 *  its record id as an anchor; ScrollToHash finds it once rendered). */
function livePageUrl(item: QueueItem): string {
  const view = item.targetTable === RECURRING_TABLE ? '?view=recurring' : ''
  const hash = item.targetRecord ? `#${item.targetRecord}` : ''
  return `https://aisafety.com${item.page ?? ''}${view}${hash}`
}

/** The listing's name goes to the clipboard on the way to the live page,
 *  ready to paste into the site search or Airtable. */
function copyListingName(item: QueueItem): void {
  navigator.clipboard
    ?.writeText(splitTitle(item).name ?? item.title)
    .catch(() => {})
}

function acceptLabel(item: QueueItem): string {
  if (item.type === 'Add') return 'Publish'
  if (item.type === 'Change') {
    return item.changes.length ? 'Apply change' : 'Accept flag'
  }
  return 'Apply rule'
}

function verdictWord(item: QueueItem): string {
  if (item.verdict === 'Publish') return 'Publish it'
  if (item.verdict === "Don't publish") return "Don't publish"
  if (item.verdict === 'Fix') return 'Fix it'
  if (item.verdict === 'Dismiss') return 'Dismiss the flag'
  if (item.verdict === 'Unsure') return 'Unsure'
  return item.verdict ?? ''
}

/** An emailed request whose reply draft still has to reach Gmail. */
function wantsDraft(item: QueueItem): boolean {
  return (
    Boolean(item.replyDraft) &&
    (item.source === 'Email' || item.source === 'Form') &&
    item.replyStatus !== 'Saved' &&
    item.replyStatus !== 'Sent'
  )
}

function replyLabel(item: QueueItem): string {
  if (!item.replyDraft) return ''
  // A Discord reply is copied and sent by hand: nothing to report here.
  if (item.source === 'Discord') return ''
  if (item.replyStatus === 'Saved') return 'Draft saved in Gmail'
  if (item.replyStatus === 'Sent') return 'Reply sent'
  if (item.replyStatus === 'Failed') return 'Draft failed'
  if (item.status === 'Applied' || item.status === 'Accepted') {
    return 'Draft on its way to Gmail'
  }
  return ''
}

function doneLabel(item: QueueItem): string {
  if (item.status === 'Rejected') return 'Rejected'
  if (item.status === 'Accepted') return 'Accepted'
  if (item.type === 'Add') return 'Published'
  if (item.type === 'Change') {
    const n = item.changes.length
    if (n === 0) return 'Flag cleared'
    return `Changed ${n} field${n === 1 ? '' : 's'}`
  }
  return 'Applied'
}

/** The toast and the row while a decision is on its way to Airtable. */
function workingLabel(item: QueueItem, action: Decision): string {
  if (action === 'reject') return 'Rejecting…'
  const label = acceptLabel(item)
  if (label === 'Publish') return 'Publishing…'
  if (label === 'Accept flag') return 'Accepting…'
  return 'Applying…'
}

interface Draft {
  mode: 'idle' | 'reject'
  edits: Record<string, string>
  editing: string | null
  chip: string | null
  other: string
  /** The reply draft as edited on the page (null = as written at intake). */
  reply: string | null
  editingReply: boolean
  busy: boolean
  error: string | null
}

const FRESH: Draft = {
  mode: 'idle',
  edits: {},
  editing: null,
  chip: null,
  other: '',
  reply: null,
  editingReply: false,
  busy: false,
  error: null,
}

interface Toast {
  item: QueueItem
  /** A rejection: the mark is a cross in the danger colour. */
  no: boolean
  /** working: the decision is still on its way to Airtable (the toast
   *  stays up, U queues an undo). done: it landed. failed: the item is
   *  still in the list, with Retry. */
  state: 'working' | 'done' | 'failed'
  text: string
  /** A second line that fills in later: what happened to the reply draft. */
  sub?: string
  /** What Retry sends again after a failure. */
  retry?: { action: Decision; extra: Record<string, unknown> }
}

/** What the page tells the Mac agent to do after an accept. */
type AgentAction = 'gmail_draft'

interface AgentResult {
  ok: boolean
  /** The agent could not be reached at all (not running, or blocked). */
  offline: boolean
  replyStatus: string | null
  detail: string
  /** /ping: the agent can hold a conversation about an item (chat.py). */
  chat: boolean
}

const AGENT_TIMEOUT_MS = 15000

/** Call the local agent on the owner's Mac (~/Queue/agent.py). It listens
 *  on loopback only and checks the token the site minted, so the call is
 *  harmless from anywhere but this page in this browser. */
async function callAgent(
  agent: AgentInfo,
  path: '/ping' | '/act',
  body?: { id: string; action: AgentAction }
): Promise<AgentResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), AGENT_TIMEOUT_MS)
  try {
    const res = await fetch(`http://127.0.0.1:${agent.port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify({ ...body, token: agent.token }) : undefined,
      cache: 'no-store',
      signal: ctrl.signal,
    })
    const data = (await res.json()) as {
      ok?: boolean
      replyStatus?: string
      detail?: string
      error?: string
      chat?: boolean
    }
    return {
      ok: Boolean(data.ok),
      offline: false,
      replyStatus: data.replyStatus ?? null,
      detail: data.detail ?? data.error ?? '',
      chat: Boolean(data.chat),
    }
  } catch {
    return {
      ok: false,
      offline: true,
      replyStatus: null,
      detail: '',
      chat: false,
    }
  } finally {
    clearTimeout(timer)
  }
}

const WORKER_NOTE = 'the Mac saves the reply draft within five minutes'
const OFFLINE_SUB = `Mac agent not reachable · ${WORKER_NOTE}`

type Decision = 'accept' | 'reject'
type Action = Decision | 'undo'

export default function QueueAdmin({
  canEdit,
}: {
  /** False for a view-only grant: the same queue with nothing to click that
   *  would decide anything. The API refuses those writes regardless. */
  canEdit: boolean
}) {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  // The list as it is now, for callbacks that must not go stale.
  const itemsRef = useRef(items)
  itemsRef.current = items
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [toast, setToast] = useState<Toast | null>(null)
  // True for the last moments of a toast, while it slides back down.
  const [toastLeaving, setToastLeaving] = useState(false)
  // The last decision, kept for U after the toast has gone.
  const [undoable, setUndoable] = useState<QueueItem | null>(null)
  // Decisions still being written to Airtable, by item id. The page moves
  // on the moment Accept or Reject is clicked and the toast says when each
  // one lands (Bryce, 16 Sept 2026: waiting on every click was too slow).
  const [pending, setPending] = useState<Record<string, Decision>>({})
  const pendingRef = useRef(pending)
  // Decisions whose Undo was pressed before they landed: undone on arrival.
  const undoAfterRef = useRef<Set<string>>(new Set())
  // The last decision clicked is the only one U can target, in whatever
  // order the writes land.
  const lastDecidedRef = useRef<string | null>(null)
  // What Cmd+Z takes back: each change to an item's edits or reply, with
  // the draft as it was, and when the last decision was made, so the more
  // recent of the two is the one undone (Bryce, 17 Sept 2026: "CMD Z in
  // general should undo the last action (i.e. changing a field)"). A logo
  // swap is written to Airtable at once and is not taken back here.
  const historyRef = useRef<{ id: string; before: Draft; at: number }[]>([])
  const decidedAtRef = useRef(0)
  // What Cmd+Shift+Z puts back: the edits Cmd+Z took away, newest last. A
  // fresh change after an undo empties it, as in any editor. An undone
  // decision is not redone this way (A or R makes it again).
  const redoRef = useRef<{ id: string; after: Draft }[]>([])
  const actRef = useRef<
    (
      item: QueueItem,
      action: Action,
      extra?: Record<string, unknown>
    ) => Promise<void>
  >(async () => {})
  // The local agent on the owner's Mac: its port + a token from the API
  // (null when the secret is not configured), and whether it answered a
  // ping. Reply drafts go through it the moment an emailed request is
  // accepted; the Mac worker is the fallback.
  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null)
  // The agent answered the ping and can chat: the conversation panel shows.
  const [agentChat, setAgentChat] = useState(false)
  // Bumped by the F key so the chat box takes focus.
  const [chatFocus, setChatFocus] = useState(0)
  const wantedRef = useRef<string | null>(null)
  // The focused item's record as it is in Airtable now, plus the table's
  // field list, so empty fields (a missing logo) show as empty. By item id.
  const [live, setLive] = useState<
    Record<string, { fields: Record<string, unknown>; schema: FieldInfo[] }>
  >({})
  const [showDone, setShowDone] = useState(false)
  // "Done today" is the viewer's own calendar day, not the last 24 hours:
  // the server sends a day's worth, the browser keeps what was decided
  // since its local midnight, and moves on when the next one passes.
  const [dayStart, setDayStart] = useState(startOfToday)
  useEffect(() => {
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)
    const t = setTimeout(
      () => setDayStart(startOfToday()),
      Math.max(1000, midnight.getTime() - Date.now() + 1000)
    )
    return () => clearTimeout(t)
  }, [dayStart])
  const [showHelp, setShowHelp] = useState(false)
  const [theme, setTheme] = useState<Theme>('light')
  const [kind, setKind] = useState<Kind>('additions')
  const [collapsed, setCollapsed] = useState<Record<Section, boolean>>({
    requests: false,
    broom: false,
    rules: false,
    comb: false,
  })
  // Folded page sub-groups, keyed "<section>:<page label>".
  const [foldedPages, setFoldedPages] = useState<Record<string, boolean>>({})
  const listRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  // The page never scrolls as a whole: the queue fills the viewport below the
  // admin header and the list and the detail pane scroll on their own, so
  // the header, the top bar and the list stay put and nothing slides under
  // the header. The header's height depends on the window width, so it is
  // measured rather than assumed.
  useEffect(() => {
    const fit = () => {
      const el = rootRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      el.style.height = `${Math.max(320, window.innerHeight - top)}px`
    }
    fit()
    window.addEventListener('resize', fit)
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    ro?.observe(document.body)
    return () => {
      window.removeEventListener('resize', fit)
      ro?.disconnect()
    }
  }, [])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY)
      if (saved === 'dark' || saved === 'light') setTheme(saved)
      const folded = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}')
      if (folded && typeof folded === 'object') {
        setCollapsed(prev => {
          const next = { ...prev }
          for (const key of SECTIONS) next[key] = folded[key] === true
          return next
        })
      }
      const pages = JSON.parse(localStorage.getItem(FOLDED_PAGES_KEY) ?? '{}')
      if (pages && typeof pages === 'object' && !Array.isArray(pages)) {
        const next: Record<string, boolean> = {}
        for (const [key, value] of Object.entries(pages)) {
          if (value === true) next[key] = true
        }
        setFoldedPages(next)
      }
      const k = localStorage.getItem(KIND_KEY)
      if (k === 'additions' || k === 'changes' || k === 'rules') setKind(k)
    } catch {
      // storage refused: stay on the defaults
    }
  }, [])

  const toggleGroup = (section: Section) => {
    setCollapsed(prev => {
      const next = { ...prev, [section]: !prev[section] }
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  const foldPage = useCallback((foldKey: string, folded: boolean) => {
    setFoldedPages(prev => {
      if (Boolean(prev[foldKey]) === folded) return prev
      const next = { ...prev }
      if (folded) next[foldKey] = true
      else delete next[foldKey]
      try {
        localStorage.setItem(FOLDED_PAGES_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const togglePage = (foldKey: string) =>
    foldPage(foldKey, !foldedPages[foldKey])

  const chooseKind = (next: Kind) => {
    setKind(next)
    // An item from the other view must not stay in focus: let the
    // focus-keeping effect pick the first item of this one.
    if (selected && kindOf(selected) !== next) setSelectedId(null)
    try {
      localStorage.setItem(KIND_KEY, next)
    } catch {
      // ignore
    }
  }

  const toggleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // ignore
    }
  }

  // Each read of the list is numbered; an answer that is not the newest
  // read's – or that began before a decision landed – is dropped, so the
  // page never steps back to an older list.
  const loadSeq = useRef(0)
  const lastRefreshRef = useRef(0)
  /** Read the list. `sync` has the API first close the rows whose record
   *  was deleted, published or hidden in Airtable itself (a moment slower,
   *  so the first read skips it). Once a list is on screen, a read that
   *  fails leaves it be. */
  const load = useCallback(async (opts: { sync?: boolean } = {}) => {
    const seq = ++loadSeq.current
    if (opts.sync) lastRefreshRef.current = Date.now()
    setLoadError(null)
    try {
      const res = await fetch(opts.sync ? `${API}?sync=1` : API, {
        cache: 'no-store',
      })
      const data = (await res.json()) as {
        items?: QueueItem[]
        agent?: AgentInfo | null
        error?: string
      }
      if (!res.ok || !data.items) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      if (seq !== loadSeq.current) return
      const before = itemsRef.current
      const known = new Map((before ?? []).map(i => [i.id, i]))
      const fresh: QueueItem[] = []
      const next = data.items.map(i => {
        const was = known.get(i.id)
        if (!was) {
          fresh.push(i)
          return i
        }
        // A decision still on its way: the page's own version stands.
        if (pendingRef.current[i.id]) return was
        // The list comes without most pictures, and a Change without its
        // listing's link; the ones on the page stay.
        return {
          ...i,
          logo: i.logo ?? was.logo,
          url: i.url ?? was.url,
        }
      })
      setItems(next)
      setAgent(data.agent ?? null)
      // The list is on screen now; the pictures, the links and the cards
      // follow in the background, each filled in as it arrives. A refresh
      // asks only for what is new to it.
      void loadTargets(next).then(found => {
        if (
          !Object.keys(found.logos).length &&
          !Object.keys(found.links).length
        )
          return
        setItems(prev => (prev ? prev.map(i => withTarget(i, found)) : prev))
      })
      void preloadCards(before ? fresh : next)
    } catch (e) {
      if (itemsRef.current) return
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // The first read is the quick one, so the list is on screen at once;
  // the synced one follows right behind it and corrects the count.
  useEffect(() => {
    wantedRef.current = hashId()
    void load().then(() => load({ sync: true }))
  }, [load])

  // The list keeps itself current: again the moment the tab or window
  // comes back into view (Bryce, 17 Sept 2026: he deletes suggestions in
  // Airtable, switches back, and the count should have moved), and once a
  // minute while it is in view – synced, so nothing waits on the Mac
  // worker's five-minute pass.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRefreshRef.current < REFRESH_MIN_GAP_MS) return
      void load({ sync: true })
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    const timer = setInterval(refresh, REFRESH_MS)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
      clearInterval(timer)
    }
  }, [load])

  // A "#rec…" in the address (the Secretary note's "Queued:" link, or one
  // Bryce copied from his own address bar) opens that item; one already
  // decided shows in the done list. The same happens when the hash changes
  // while the page is open.
  useEffect(() => {
    if (!items || !wantedRef.current) return
    const id = wantedRef.current
    const hit = items.find(i => i.id === id)
    if (!hit) {
      wantedRef.current = null
      return
    }
    setSelectedId(id)
    if (!isOpen(hit)) setShowDone(true)
    // The list shows one kind at a time; the linked item's kind wins.
    else setKind(kindOf(hit))
    // The focus-keeping effect below runs in this same pass, before the
    // selection above has landed; it clears the ref and stands aside.
  }, [items])

  useEffect(() => {
    const onHash = () => {
      const id = hashId()
      if (!id) return
      wantedRef.current = id
      // Re-run the effect above with the items already loaded.
      setItems(prev => (prev ? [...prev] : prev))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // The address bar follows the item in focus, so a link to one specific
  // suggestion can be copied and sent. Replaced, not pushed: W/Q through
  // the list must not fill the back button.
  useEffect(() => {
    if (!items) return
    const want = selectedId && !showDone ? `#${selectedId}` : ''
    if (window.location.hash === want) return
    if (!want && !window.location.hash) return
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search + want
    )
  }, [items, selectedId, showDone])

  useEffect(() => {
    if (!agent) {
      setAgentOnline(null)
      return
    }
    let cancelled = false
    void callAgent(agent, '/ping').then(res => {
      if (cancelled) return
      setAgentOnline(res.ok)
      setAgentChat(res.ok && res.chat)
    })
    return () => {
      cancelled = true
    }
  }, [agent])

  // One flat, ordered list of open items: requests, Broom, rules, then Comb
  // with Fable's Publish verdicts first, each section split by resource
  // page. W/Q and auto-advance walk it, opening a folded page as they
  // reach it; a folded section is passed over.
  const ordered = useMemo(() => {
    const groups: Record<Section, QueueItem[]> = {
      requests: [],
      broom: [],
      rules: [],
      comb: [],
    }
    const done: QueueItem[] = []
    const perKind: Record<Kind, number> = {
      additions: 0,
      changes: 0,
      rules: 0,
    }
    let open = 0
    for (const item of items ?? []) {
      if (!isOpen(item)) {
        // Today's decisions, plus one linked from the address bar however
        // old: that link promised to show it.
        if (decidedSince(item, dayStart) || item.id === selectedId) {
          done.push(item)
        }
        continue
      }
      open++
      const k = kindOf(item)
      perKind[k]++
      if (k === kind) groups[sectionOf(item)].push(item)
    }
    const newest = (a: QueueItem, b: QueueItem) =>
      a.createdAt < b.createdAt ? 1 : -1
    const byVerdict = (a: QueueItem, b: QueueItem) =>
      verdictRank(a.verdict) - verdictRank(b.verdict) || newest(a, b)
    groups.requests.sort(newest)
    groups.broom.sort(byVerdict)
    groups.rules.sort(newest)
    groups.comb.sort(byVerdict)
    done.sort((a, b) => ((a.decidedAt ?? '') < (b.decidedAt ?? '') ? 1 : -1))
    // Sub-heads only where a section spans more than one page; a section on
    // a single page lists its items as they are.
    const pages: Record<Section, PageGroup[]> = {
      requests: [],
      broom: [],
      rules: [],
      comb: [],
    }
    for (const s of SECTIONS) {
      const split = splitByPage(groups[s])
      pages[s] = split.length > 1 ? split : []
    }
    // `walk` is every item in the open sections in list order, folded pages
    // included, with the page fold each one sits under; `flat` is what is
    // on screen.
    const walk: QueueItem[] = []
    const foldOf = new Map<string, string>()
    for (const s of SECTIONS) {
      if (collapsed[s]) continue
      if (!pages[s].length) {
        walk.push(...groups[s])
        continue
      }
      for (const p of pages[s]) {
        const foldKey = `${s}:${p.key}`
        for (const item of p.items) {
          walk.push(item)
          foldOf.set(item.id, foldKey)
        }
      }
    }
    const flat = walk.filter(i => !foldedPages[foldOf.get(i.id) ?? ''])
    return { groups, pages, done, flat, walk, foldOf, open, perKind }
  }, [items, collapsed, foldedPages, kind, dayStart, selectedId])

  const selected = useMemo(() => {
    if (!items) return null
    return items.find(i => i.id === selectedId) ?? null
  }, [items, selectedId])

  // Midnight can empty the done list while it is open; back to the queue.
  useEffect(() => {
    if (showDone && items && !ordered.done.length) setShowDone(false)
  }, [showDone, items, ordered.done])

  // Keep something in focus: the first open item, or the next one after a
  // decision.
  useEffect(() => {
    if (!items) return
    if (wantedRef.current) {
      wantedRef.current = null
      return
    }
    if (selectedId && ordered.walk.some(i => i.id === selectedId)) return
    if (selected && isOpen(selected)) return
    if (selected && !isOpen(selected) && showDone) return
    // The first item on screen; with every page folded, the first there
    // is, with its page opened.
    const first = ordered.flat[0] ?? ordered.walk[0]
    const foldKey = first && ordered.foldOf.get(first.id)
    if (foldKey && foldedPages[foldKey]) foldPage(foldKey, false)
    setSelectedId(first?.id ?? null)
  }, [
    items,
    ordered.flat,
    ordered.walk,
    ordered.foldOf,
    foldedPages,
    foldPage,
    selectedId,
    selected,
    showDone,
  ])

  // The card of the item after this one is fetched now, so W/auto-advance
  // shows it at once, whether or not its page is folded.
  useEffect(() => {
    if (!selected) return
    const walk = ordered.walk
    const next = walk[walk.findIndex(i => i.id === selected.id) + 1]
    if (!next?.targetTable || !next.targetRecord) return
    if (next.type !== 'Add' && next.type !== 'Change') return
    prefetchPreview(next.targetTable, next.targetRecord, proposedEdits(next))
  }, [selected, ordered.walk])

  useEffect(() => {
    if (!selected) return
    // Additions always; a Change only when it swaps a picture, whose old
    // side is snapshotted without a link (the live read supplies one).
    const wantsLive =
      selected.type === 'Add' ||
      (selected.type === 'Change' &&
        selected.changes.some(c => looksLikeAttachment(c.from)))
    if (!wantsLive) return
    if (!selected.targetTable || !selected.targetRecord) return
    if (live[selected.id]) return
    const id = selected.id
    const target = `${selected.targetTable}/${selected.targetRecord}`
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`${API}?target=${encodeURIComponent(target)}`, {
          cache: 'no-store',
        })
        const data = (await res.json()) as {
          fields?: Record<string, unknown>
          attachments?: Record<string, AttachmentInfo[]>
          schema?: FieldInfo[]
        }
        if (!cancelled && res.ok && data.fields) {
          const fields = data.fields
          const schema = data.schema ?? []
          rememberAttachments(data.attachments)
          setLive(prev => ({ ...prev, [id]: { fields, schema } }))
        }
      } catch {
        // the snapshot stays
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selected, live])

  const setLiveField = useCallback(
    (id: string, field: string, value: unknown) => {
      setLive(prev => {
        const cur = prev[id]
        if (!cur) return prev
        return {
          ...prev,
          [id]: { ...cur, fields: { ...cur.fields, [field]: value } },
        }
      })
    },
    []
  )

  // Fable changed the record from the chat on the Mac: drop the live read
  // so the effect above fetches it again.
  const forgetLive = useCallback((id: string) => {
    setLive(prev => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  // A row's picture link has stopped working (Airtable links last a few
  // hours): show the plain box and ask for a fresh link.
  const logoDied = useCallback((item: QueueItem) => {
    if (item.logo) deadLogos.add(item.logo)
    const setLogo = (logo: string | null) =>
      setItems(prev =>
        prev ? prev.map(i => (i.id === item.id ? { ...i, logo } : i)) : prev
      )
    setLogo(null)
    // The load-time lookup already asked for this record; ask once more.
    if (item.targetRecord) askedTargets.delete(item.targetRecord)
    void loadTargets([{ ...item, logo: null }]).then(found => {
      const url = item.targetRecord ? found.logos[item.targetRecord] : undefined
      if (url && !deadLogos.has(url)) setLogo(url)
    })
  }, [])

  // A fresh draft starts from the edits saved on the row, so what was
  // applied (by hand or from the chat) is still there after a reload.
  const draft = (id: string): Draft => drafts[id] ?? draftOfRow(items, id)
  // Edits and the reply draft as edited are kept on the row a moment after
  // they change (one save per item, the last one wins), so they are still
  // there after a reload. The live base is untouched until Accept.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const setDraft = useCallback(
    (
      id: string,
      patch: Partial<Draft>,
      why: 'edit' | 'undo' | 'redo' = 'edit'
    ) => {
      const was = draftsRef.current[id] ?? draftOfRow(itemsRef.current, id)
      const changed =
        (patch.edits !== undefined && !sameEdits(patch.edits, was.edits)) ||
        (patch.reply !== undefined && patch.reply !== was.reply)
      if (why !== 'undo' && changed) {
        historyRef.current.push({ id, before: was, at: Date.now() })
        if (historyRef.current.length > 50) historyRef.current.shift()
        if (why === 'edit') redoRef.current = []
      }
      setDrafts(prev => ({
        ...prev,
        [id]: { ...(prev[id] ?? FRESH), ...patch },
      }))
      if (!patch.edits && patch.reply === undefined) return
      const merged = { ...(draftsRef.current[id] ?? FRESH), ...patch }
      const row = itemsRef.current?.find(i => i.id === id)
      const body: Record<string, unknown> = {
        id,
        action: 'edit',
        edits: merged.edits,
      }
      if (patch.reply !== undefined && row?.replyDraft !== null) {
        // Back to "as it came" means the row's own draft is saved again.
        body.replyDraft = merged.reply ?? row?.replyDraft ?? ''
      }
      clearTimeout(saveTimers.current[id])
      saveTimers.current[id] = setTimeout(() => {
        void fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {
          // best effort: the edits are still on the page and go with Accept
        })
      }, 800)
    },
    []
  )

  const select = useCallback((id: string) => {
    setSelectedId(id)
    setShowDone(false)
    if (detailRef.current) detailRef.current.scrollTop = 0
    // After the render, so a row inside a page just unfolded is there too.
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-id="${id}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  }, [])

  /** Put an item in focus, opening the page it sits under if that is
   *  folded: W/Q and auto-advance walk into folded pages rather than past
   *  them (Bryce, 17 Sept 2026). */
  const reveal = useCallback(
    (item: QueueItem) => {
      const foldKey = ordered.foldOf.get(item.id)
      if (foldKey && foldedPages[foldKey]) foldPage(foldKey, false)
      select(item.id)
    },
    [ordered.foldOf, foldedPages, foldPage, select]
  )

  const move = useCallback(
    (delta: number) => {
      const walk = ordered.walk
      if (walk.length === 0) return
      const i = walk.findIndex(x => x.id === selectedId)
      const next = walk[Math.min(walk.length - 1, Math.max(0, i + delta))]
      if (next) reveal(next)
    },
    [ordered.walk, selectedId, reveal]
  )

  // After an accept: have the Mac agent save the reply draft in Gmail now,
  // and tell the toast and the row how it went. If the agent is not
  // reachable the worker does it within five minutes.
  const saveReply = useCallback(
    async (item: QueueItem) => {
      const res = agent
        ? await callAgent(agent, '/act', { id: item.id, action: 'gmail_draft' })
        : { ok: false, offline: true, replyStatus: null, detail: '' }
      if (agent) setAgentOnline(!res.offline)
      const sub = res.ok
        ? res.detail || 'Draft saved in Gmail'
        : res.offline
          ? OFFLINE_SUB
          : `Reply draft failed: ${res.detail}`
      if (res.replyStatus) {
        const status = res.replyStatus
        setItems(prev =>
          prev
            ? prev.map(i =>
                i.id === item.id
                  ? {
                      ...i,
                      replyStatus: status,
                      error: res.ok ? null : res.detail,
                    }
                  : i
              )
            : prev
        )
      }
      setToast(prev =>
        prev && prev.item.id === item.id ? { ...prev, sub } : prev
      )
    },
    [agent]
  )

  const act = useCallback(
    async (
      item: QueueItem,
      action: Action,
      extra: Record<string, unknown> = {}
    ) => {
      if (!canEdit) return
      setDraft(item.id, { busy: true, error: null })
      // The reply draft as it reads on the page goes with the accept, so
      // what reaches Gmail is what was approved.
      const reply = drafts[item.id]?.reply ?? null
      const replyDraft =
        action === 'accept' && reply !== null ? { replyDraft: reply } : {}
      const decision = action === 'accept' || action === 'reject'
      if (decision) {
        // The page moves on now; the write lands behind it. The previous
        // decision stops being U's target (the Done list still has it).
        lastDecidedRef.current = item.id
        decidedAtRef.current = Date.now()
        setUndoable(null)
        pendingRef.current = { ...pendingRef.current, [item.id]: action }
        setPending(pendingRef.current)
        setToast({
          item,
          no: action === 'reject',
          state: 'working',
          text: workingLabel(item, action),
        })
        // Auto-advance to the next open item that is not itself on its way,
        // opening its page if that is folded.
        const walk = ordered.walk
        const i = walk.findIndex(x => x.id === item.id)
        const free = (x: QueueItem) =>
          x.id !== item.id && !pendingRef.current[x.id]
        const next =
          walk.slice(i + 1).find(free) ??
          walk.slice(0, Math.max(0, i)).reverse().find(free)
        if (next) reveal(next)
      }
      const forget = () => {
        const rest = { ...pendingRef.current }
        delete rest[item.id]
        pendingRef.current = rest
        setPending(rest)
      }
      try {
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.id,
            action,
            ...replyDraft,
            ...extra,
          }),
        })
        const data = (await res.json()) as { item?: QueueItem; error?: string }
        if (!res.ok || !data.item) {
          throw new Error(data.error ?? `HTTP ${res.status}`)
        }
        // A read of the list that began before this landed would show the
        // row as it was: stale now.
        loadSeq.current++
        // The decision comes back without a logo lookup (kept quick); the
        // picture already on the page stays.
        const updated = { ...data.item, logo: data.item.logo ?? item.logo }
        // Accept wrote the edits and the flag, undo took them back: the
        // card built before either is out of date.
        forgetCard(updated)
        setItems(prev =>
          prev ? prev.map(i => (i.id === updated.id ? updated : i)) : prev
        )
        setDrafts(prev => {
          const next = { ...prev }
          delete next[item.id]
          return next
        })
        if (decision) {
          forget()
          const draftPending = action === 'accept' && wantsDraft(updated)
          const text =
            action === 'reject'
              ? `Rejected · ${updated.rejectReason ?? ''}`
              : doneLabel(updated)
          if (undoAfterRef.current.delete(item.id)) {
            // U was pressed while it was on its way: straight back.
            setToast(prev =>
              prev && prev.item.id === item.id
                ? {
                    ...prev,
                    item: updated,
                    state: 'done',
                    text,
                    sub: 'Undoing…',
                  }
                : prev
            )
            void actRef.current(updated, 'undo')
            return
          }
          if (lastDecidedRef.current === item.id) setUndoable(updated)
          // A newer decision owns the toast; an older one lands quietly and
          // its row moves to Done.
          setToast(prev =>
            prev && prev.item.id === item.id
              ? {
                  item: updated,
                  no: action === 'reject',
                  state: 'done',
                  text,
                  sub: draftPending
                    ? agent
                      ? 'Saving the reply draft in Gmail…'
                      : `Reply draft: ${WORKER_NOTE}`
                    : updated.source === 'Discord' && updated.replyDraft
                      ? 'Reply drafted · copy it and send it yourself on Discord'
                      : undefined,
                }
              : prev
          )
          if (draftPending) void saveReply(updated)
        } else if (action === 'undo') {
          setToast(null)
          setUndoable(null)
          select(updated.id)
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setDraft(item.id, { busy: false, error: message })
        if (decision) {
          forget()
          undoAfterRef.current.delete(item.id)
          // A failure takes the toast whatever it shows, and keeps it up
          // until Retry, Dismiss or the next decision. The item is still in
          // the list, with the error on it.
          setToast({
            item,
            no: action === 'reject',
            state: 'failed',
            text: `${action === 'reject' ? 'Reject' : acceptLabel(item)} failed · ${message}`,
            sub: 'Still in the list',
            retry: { action, extra },
          })
        }
      }
    },
    [ordered.walk, reveal, select, setDraft, drafts, agent, saveReply, canEdit]
  )
  actRef.current = act

  // Undo pressed on a decision still on its way: undone the moment it lands.
  const queueUndo = useCallback((id: string) => {
    undoAfterRef.current.add(id)
    setToast(prev =>
      prev && prev.item.id === id
        ? { ...prev, sub: 'Undoing as soon as it lands…' }
        : prev
    )
  }, [])

  useEffect(() => {
    // A decision on its way, or one that failed, stays up until dealt with.
    if (!toast || toast.state !== 'done') return
    const leave = setTimeout(
      () => setToastLeaving(true),
      TOAST_MS - TOAST_OUT_MS
    )
    const gone = setTimeout(() => {
      setToast(null)
      setToastLeaving(false)
    }, TOAST_MS)
    return () => {
      clearTimeout(leave)
      clearTimeout(gone)
      setToastLeaving(false)
    }
  }, [toast])

  useEffect(() => {
    if (!undoable) return
    const t = setTimeout(() => setUndoable(null), UNDO_MS)
    return () => clearTimeout(t)
  }, [undoable])

  // Keyboard: W/Q or arrows move, A/Enter accept, R reject, N note, U undo,
  // ? help, Esc cancel. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing =
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'z' &&
        !typing
      ) {
        // Cmd+Shift+Z: the last edit Cmd+Z took away comes back.
        e.preventDefault()
        const r = redoRef.current
        while (r.length) {
          const row = items?.find(i => i.id === r[r.length - 1].id)
          if (row && isOpen(row) && !draft(row.id).busy) break
          r.pop()
        }
        const top = r.pop()
        if (top) {
          setDraft(
            top.id,
            { edits: top.after.edits, reply: top.after.reply, editing: null },
            'redo'
          )
          select(top.id)
        }
        return
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'z' &&
        !typing
      ) {
        // Cmd+Z: the last edit on any open item, or the last decision when
        // that came later (what U does). Inside a text box the browser's own
        // undo keeps working.
        e.preventDefault()
        const h = historyRef.current
        while (h.length) {
          const row = items?.find(i => i.id === h[h.length - 1].id)
          if (row && isOpen(row) && !draft(row.id).busy) break
          h.pop()
        }
        const top = h[h.length - 1]
        const decision = undoable && !draft(undoable.id).busy ? undoable : null
        if (top && (!decision || top.at > decidedAtRef.current)) {
          h.pop()
          redoRef.current.push({ id: top.id, after: draft(top.id) })
          setDraft(
            top.id,
            { edits: top.before.edits, reply: top.before.reply, editing: null },
            'undo'
          )
          select(top.id)
        } else if (decision) {
          void act(decision, 'undo')
        } else if (toast?.state === 'working') {
          queueUndo(toast.item.id)
        }
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (typing) {
        if (e.key === 'Escape') (t as HTMLElement).blur()
        return
      }
      const item = selected
      const d = item ? draft(item.id) : FRESH
      switch (e.key) {
        case 'w':
        case 'ArrowDown':
          e.preventDefault()
          move(1)
          break
        case 'q':
        case 'ArrowUp':
          e.preventDefault()
          move(-1)
          break
        case 'a':
        case 'Enter':
          // Only A accepts (Bryce, 11 Sept 2026: Enter is too easy to hit);
          // Enter still confirms a reject once a reason is picked.
          if (
            e.key === 'a' &&
            item &&
            isOpen(item) &&
            item.status !== 'Revising' &&
            d.mode === 'idle' &&
            !d.busy
          ) {
            e.preventDefault()
            void act(item, 'accept', {
              edits: coerceEdits(
                d.edits,
                item.type === 'Change'
                  ? Object.fromEntries(item.changes.map(c => [c.field, c.to]))
                  : (live[item.id]?.fields ?? item.fields ?? {}),
                new Map((live[item.id]?.schema ?? []).map(f => [f.name, f]))
              ),
            })
          } else if (
            item &&
            d.mode === 'reject' &&
            (d.chip || d.other.trim() || item.type === 'Rule') &&
            !d.busy
          ) {
            e.preventDefault()
            void act(item, 'reject', { reason: d.chip ?? d.other.trim() })
          }
          break
        case 'r':
          if (
            canEdit &&
            item &&
            isOpen(item) &&
            item.status !== 'Revising' &&
            d.mode !== 'reject'
          ) {
            e.preventDefault()
            setDraft(item.id, { mode: 'reject' })
          }
          break
        case 'f':
          if (canEdit && item && agentChat) {
            e.preventDefault()
            setChatFocus(n => n + 1)
          }
          break
        case '1':
        case '2':
        case '3':
          if (item && d.mode === 'reject' && !d.busy) {
            const chip = item.rejectChips[Number(e.key) - 1]
            if (chip) {
              // the number picks the reason and rejects in one go
              e.preventDefault()
              setDraft(item.id, { chip })
              void act(item, 'reject', { reason: chip })
            }
          }
          break
        case 'u':
          if (undoable && !draft(undoable.id).busy) {
            e.preventDefault()
            void act(undoable, 'undo')
          } else if (toast?.state === 'working') {
            e.preventDefault()
            queueUndo(toast.item.id)
          }
          break
        case 's': {
          // The shown listing's own link, in a new tab (Bryce, 17 Sept
          // 2026: "make S open the link for the currently shown listing").
          const href = item ? listingLink(item, live[item.id]?.fields) : null
          if (href) {
            e.preventDefault()
            window.open(href, '_blank', 'noopener')
          }
          break
        }
        case 'd':
          // The page tag's link: the live page at this record's card, the
          // name copied on the way, as a click on the tag does (Bryce, 19
          // Sept 2026: "Make D open this link").
          if (item?.page) {
            e.preventDefault()
            copyListingName(item)
            window.open(livePageUrl(item), '_blank', 'noopener')
          }
          break
        case '?':
          e.preventDefault()
          setShowHelp(v => !v)
          break
        case 'Escape':
          if (showHelp) setShowHelp(false)
          else if (item && d.mode !== 'idle') {
            setDraft(item.id, { mode: 'idle', chip: null, other: '' })
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selected,
    drafts,
    move,
    act,
    undoable,
    toast,
    queueUndo,
    showHelp,
    setDraft,
    live,
    agentChat,
    items,
    select,
  ])

  const waiting = ordered.open
  const doneToday = ordered.done.length
  const total = waiting + doneToday
  const toastRetry = toast?.retry ?? null

  return (
    <div
      ref={rootRef}
      className={`${styles.queue} ${theme === 'dark' ? styles.dark : ''}`}
    >
      <div className={styles.top}>
        <div className={styles.topLeft}>
          <h1 className={styles.h1}>Queue</h1>
          <span className={styles.topMeta}>
            {items === null
              ? 'Loading…'
              : waiting === 0
                ? 'Nothing waiting'
                : `${waiting} waiting`}
            {doneToday > 0 && (
              <>
                {' · '}
                <button
                  className={`${styles.linkButton} ${showDone ? styles.linkButtonOn : ''}`}
                  onClick={() => setShowDone(v => !v)}
                >
                  {doneToday} done today
                </button>
              </>
            )}
          </span>
          <span
            className={styles.segmented}
            role="group"
            aria-label="Which kind of item to show"
          >
            {KINDS.map(k => (
              <button
                key={k.key}
                className={kind === k.key ? styles.segOn : ''}
                onClick={() => chooseKind(k.key)}
                title={k.title}
              >
                {k.label}
                <span className={styles.segCount}>
                  {ordered.perKind[k.key]}
                </span>
              </button>
            ))}
          </span>
        </div>
        <div className={styles.topRight}>
          {agent && (
            <span
              className={`${styles.agentDot} ${agentOnline ? styles.agentOn : agentOnline === false ? styles.agentOff : ''}`}
              title={
                agentOnline
                  ? 'The agent on your Mac is running: reply drafts reach Gmail the moment you accept.'
                  : agentOnline === false
                    ? 'The agent on your Mac is not answering: the worker saves reply drafts within five minutes.'
                    : 'Checking the agent on your Mac…'
              }
            >
              Mac
            </span>
          )}
          <button
            className={styles.ghost}
            onClick={() => setShowHelp(v => !v)}
            title="Keyboard shortcuts (?)"
          >
            <Icon src={ICON.question} />
          </button>
          <button className={styles.ghost} onClick={toggleTheme}>
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
        {total > 0 && (
          <div className={styles.progress} aria-hidden>
            <div
              className={styles.progressBar}
              style={{ width: `${Math.round((doneToday / total) * 100)}%` }}
            />
          </div>
        )}
      </div>

      {loadError && (
        <p className={styles.error}>
          Couldn&rsquo;t load the queue: {loadError}{' '}
          <button className={styles.linkButton} onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      {items && (
        <div className={styles.split}>
          <div className={styles.list} ref={listRef}>
            {SECTIONS.map(section => {
              const list = ordered.groups[section]
              if (
                list.length === 0 &&
                (section !== 'requests' || kind === 'rules')
              )
                return null
              return (
                <div key={section} className={styles.group}>
                  <button
                    className={styles.groupHead}
                    onClick={() => toggleGroup(section)}
                    aria-expanded={!collapsed[section]}
                  >
                    {SECTION_LABEL[section]}
                    <span className={styles.groupCount}>{list.length}</span>
                    <span
                      className={`${styles.groupChevron} ${collapsed[section] ? styles.groupChevronClosed : ''}`}
                    >
                      <Icon src={ICON.chevron} size={12} />
                    </span>
                  </button>
                  {collapsed[section] ? null : list.length === 0 ? (
                    <div className={styles.groupEmpty}>Nothing waiting</div>
                  ) : ordered.pages[section].length ? (
                    ordered.pages[section].map(page => {
                      const foldKey = `${section}:${page.key}`
                      const folded = foldedPages[foldKey] === true
                      return (
                        <div key={page.key} className={styles.pageGroup}>
                          <button
                            className={styles.pageHead}
                            onClick={() => togglePage(foldKey)}
                            aria-expanded={!folded}
                          >
                            {page.label}
                            <span className={styles.groupCount}>
                              {page.items.length}
                            </span>
                            <span
                              className={`${styles.groupChevron} ${folded ? styles.groupChevronClosed : ''}`}
                            >
                              <Icon src={ICON.chevron} size={12} />
                            </span>
                          </button>
                          {folded
                            ? null
                            : page.items.map(item => (
                                <Row
                                  key={item.id}
                                  item={item}
                                  active={item.id === selectedId && !showDone}
                                  working={pending[item.id] ?? null}
                                  failed={
                                    !pending[item.id] &&
                                    Boolean(draft(item.id).error)
                                  }
                                  showPage={false}
                                  onClick={() => select(item.id)}
                                  onLogoError={() => logoDied(item)}
                                />
                              ))}
                        </div>
                      )
                    })
                  ) : (
                    list.map(item => (
                      <Row
                        key={item.id}
                        item={item}
                        active={item.id === selectedId && !showDone}
                        working={pending[item.id] ?? null}
                        failed={
                          !pending[item.id] && Boolean(draft(item.id).error)
                        }
                        onClick={() => select(item.id)}
                        onLogoError={() => logoDied(item)}
                      />
                    ))
                  )}
                </div>
              )
            })}
          </div>

          <div className={styles.detail} ref={detailRef}>
            {showDone ? (
              <DoneList
                items={ordered.done}
                busyFor={id => draft(id).busy}
                errorFor={id => draft(id).error}
                onUndo={canEdit ? item => void act(item, 'undo') : null}
              />
            ) : selected ? (
              <Detail
                item={selected}
                live={live[selected.id] ?? null}
                onImage={(field, urls) => {
                  setLiveField(selected.id, field, urls)
                  forgetCard(selected)
                }}
                onWrote={() => {
                  forgetLive(selected.id)
                  forgetCard(selected)
                }}
                d={draft(selected.id)}
                setD={patch => setDraft(selected.id, patch)}
                act={(action, extra) => void act(selected, action, extra)}
                agentOnline={agent ? agentOnline : null}
                chatAgent={canEdit && agentChat ? agent : null}
                chatFocus={chatFocus}
                readOnly={!canEdit}
              />
            ) : (
              <div className={styles.emptyDetail}>
                {waiting === 0 ? 'All clear.' : 'Pick an item on the left.'}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        // Laid out like a list row (logo, name, the muted line) with a
        // bold tick or cross in front, so the eye reads it the same way.
        // While the decision is on its way the mark is a spinning ring.
        <div
          key={toast.item.id}
          className={`${styles.toast} ${toastLeaving ? styles.toastLeaving : ''}`}
          role="status"
        >
          <span
            className={`${styles.toastMark} ${toast.no ? styles.toastMarkNo : ''} ${
              toast.state === 'working' ? styles.toastMarkWorking : ''
            } ${toast.state === 'failed' ? styles.toastMarkFailed : ''}`}
          >
            {toast.state === 'failed' ? (
              '!'
            ) : toast.state === 'done' ? (
              <Icon src={toast.no ? ICON.x : ICON.check} size={16} />
            ) : null}
          </span>
          {toast.item.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.rowLogo} src={toast.item.logo} alt="" />
          ) : (
            <span className={`${styles.rowLogo} ${styles.rowLogoEmpty}`} />
          )}
          <span className={styles.toastBody}>
            <span className={styles.rowTitle}>
              {splitTitle(toast.item).name ?? toast.item.title}
            </span>
            <span className={styles.rowMeta}>
              <span>{toast.text}</span>
              {toast.item.page && <span>{toast.item.page}</span>}
              {toast.sub && <span>{toast.sub}</span>}
            </span>
          </span>
          {toast.state === 'done' &&
            toast.item.source === 'Discord' &&
            toast.item.replyDraft &&
            !toast.no && (
              <>
                <CopyReply
                  text={toast.item.replyDraft}
                  className={styles.toastUndo}
                />
                {toast.item.sourceLink && (
                  <OpenOnDiscord
                    href={toast.item.sourceLink}
                    className={styles.toastUndo}
                  />
                )}
              </>
            )}
          {toast.state === 'failed' ? (
            <>
              {toastRetry && (
                <button
                  className={styles.toastUndo}
                  onClick={() =>
                    void act(toast.item, toastRetry.action, toastRetry.extra)
                  }
                >
                  <Icon src={ICON.undo} size={12} className={styles.undoIcon} />
                  Retry
                </button>
              )}
              <button
                className={styles.toastUndo}
                onClick={() => select(toast.item.id)}
              >
                Open
              </button>
              <button
                className={styles.toastClose}
                aria-label="Dismiss"
                onClick={() => setToast(null)}
              >
                <Icon src={ICON.x} size={12} />
              </button>
            </>
          ) : (
            <button
              className={styles.toastUndo}
              disabled={toast.state === 'done' && draft(toast.item.id).busy}
              onClick={() =>
                toast.state === 'working'
                  ? queueUndo(toast.item.id)
                  : void act(toast.item, 'undo')
              }
            >
              <Icon src={ICON.undo} size={12} className={styles.undoIcon} />
              Undo <kbd>U</kbd>
            </button>
          )}
        </div>
      )}

      {showHelp && (
        <div className={styles.help} onClick={() => setShowHelp(false)}>
          <div className={styles.helpCard} onClick={e => e.stopPropagation()}>
            <div className={styles.helpTitle}>Keyboard</div>
            <dl className={styles.helpList}>
              <dt>
                <kbd>W</kbd> <kbd>Q</kbd>
              </dt>
              <dd>next / previous item</dd>
              <dt>
                <kbd>A</kbd>
              </dt>
              <dd>accept</dd>
              <dt>
                <kbd>R</kbd>
              </dt>
              <dd>
                reject, then <kbd>1</kbd>–<kbd>3</kbd> picks a reason and
                rejects at once; or type one and press <kbd>Enter</kbd>
              </dd>
              <dt>
                <kbd>F</kbd>
              </dt>
              <dd>talk to Fable about the item, or tell it what to change</dd>
              <dt>
                <kbd>S</kbd>
              </dt>
              <dd>open the listing&apos;s link in a new tab</dd>
              <dt>
                <kbd>D</kbd>
              </dt>
              <dd>
                open the listing&apos;s card on the live site (the page tag up
                top), copying its name
              </dd>
              <dt>
                <kbd>U</kbd>
              </dt>
              <dd>undo the last decision</dd>
              <dt>
                <kbd>⌘</kbd> <kbd>Z</kbd>
              </dt>
              <dd>
                undo the last change to a field or reply, or the last decision
                if that came later
              </dd>
              <dt>
                <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>Z</kbd>
              </dt>
              <dd>put back the change that was just undone</dd>
              <dt>
                <kbd>⌘</kbd> <kbd>Enter</kbd>
              </dt>
              <dd>finish a text box, keeping what you typed</dd>
              <dt>
                <kbd>Esc</kbd>
              </dt>
              <dd>cancel</dd>
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({
  item,
  active,
  working,
  failed,
  showPage = true,
  onClick,
  onLogoError,
}: {
  item: QueueItem
  active: boolean
  /** The decision on its way to Airtable, if one is. */
  working: Decision | null
  /** The last decision on it did not land; the error is on the detail. */
  failed: boolean
  /** Off under a page sub-head, which already names the page. */
  showPage?: boolean
  onClick: () => void
  /** The picture's link has stopped working. */
  onLogoError: () => void
}) {
  return (
    <button
      data-id={item.id}
      className={`${styles.row} ${active ? styles.rowActive : ''} ${working ? styles.rowBusy : ''}`}
      onClick={onClick}
    >
      {item.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.rowLogo}
          src={item.logo}
          alt=""
          // An expired link: the list drops the picture (the plain box
          // shows) and asks for a fresh one.
          onError={onLogoError}
        />
      ) : (
        <span
          className={`${styles.rowLogo} ${styles.rowLogoEmpty} ${dotClass(item)}`}
        >
          <Icon src={sourceIcon(item)} />
        </span>
      )}
      <span className={styles.rowBody}>
        <span className={styles.rowTitle}>
          {splitTitle(item).name ?? item.title}
        </span>
        <span className={styles.rowMeta}>
          {item.source !== 'Comb' && <span>{item.source}</span>}
          {showPage && item.page && <span>{pageLabel(item)}</span>}
          {item.verdict && (
            <span className={`${styles.withIcon} ${verdictClass(item)}`}>
              <Icon src={verdictIcon(item)} size={12} />
              {item.verdict}
            </span>
          )}
          {item.status === 'Revising' && (
            <span className={styles.withIcon}>
              <Icon src={ICON.timer} size={12} />
              revising
            </span>
          )}
          {working && (
            <span className={styles.withIcon}>
              <span className={styles.spinner} />
              {workingLabel(item, working).replace('…', '').toLowerCase()}
            </span>
          )}
          {failed && !working && (
            <span className={`${styles.withIcon} ${styles.no}`}>
              <Icon src={ICON.x} size={12} />
              failed
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

function dotClass(item: QueueItem): string {
  if (item.source === 'Email' || item.source === 'Form') return styles.dotEmail
  if (item.source === 'Discord') return styles.dotDiscord
  if (item.source === 'Broom') return styles.dotBroom
  if (item.type === 'Rule') return styles.dotRule
  return styles.dotComb
}

function verdictClass(item: QueueItem): string {
  if (item.verdict === 'Publish' || item.verdict === 'Fix') return styles.yes
  if (item.verdict === 'Unsure') return styles.maybe
  return styles.no
}

function Detail({
  item,
  live,
  onImage,
  onWrote,
  d,
  setD,
  act,
  agentOnline,
  chatAgent,
  chatFocus,
  readOnly,
}: {
  item: QueueItem
  live: { fields: Record<string, unknown>; schema: FieldInfo[] } | null
  onImage: (field: string, urls: string[]) => void
  /** Fable changed the record from the chat: re-read it. */
  onWrote: () => void
  d: Draft
  setD: (patch: Partial<Draft>) => void
  act: (action: Action, extra?: Record<string, unknown>) => void
  /** null: no agent configured; true/false: whether it answered a ping. */
  agentOnline: boolean | null
  /** The Mac agent, when it is up and can chat; null hides the panel. */
  chatAgent: AgentInfo | null
  chatFocus: number
  /** A view-only session: no editing, no deciding. */
  readOnly: boolean
}) {
  // Nothing on the item can be touched while Claude is revising it, and a
  // view-only session can never touch it.
  const revising = item.status === 'Revising' || readOnly
  const nothingToApply = item.type === 'Change' && item.changes.length === 0
  const reason = d.chip ?? d.other.trim()
  const editCount = Object.keys(d.edits).length
  const original: Record<string, unknown> =
    item.type === 'Change'
      ? Object.fromEntries(item.changes.map(c => [c.field, c.to]))
      : (live?.fields ?? item.fields ?? {})
  const types = new Map((live?.schema ?? []).map(f => [f.name, f]))
  const editsToSave = () => coerceEdits(d.edits, original, types)

  const hasCard =
    item.type === 'Change' && Boolean(item.targetTable && item.targetRecord)
  const showsCard =
    hasCard ||
    (item.type === 'Add' && Boolean(item.targetTable && item.targetRecord))
  // A Comb row's excerpt is where Comb found the listing, which the head
  // shows as its Source line; every other intake's is the words that
  // opened the item.
  const excerpt = item.source === 'Comb' ? null : item.sourceExcerpt
  const excerptBlock = excerpt ? (
    <section className={styles.block}>
      <h3 className={styles.h3}>
        {item.source === 'Broom' ? 'What Broom found' : 'What they wrote'}
      </h3>
      {item.source === 'Broom' ? (
        <div className={styles.finding}>
          <p className={styles.findingLead}>{splitExcerpt(excerpt).lead}</p>
          {splitExcerpt(excerpt).detail && (
            // Broom's evidence, folded away: the summary is what gets
            // read (Bryce, 11 Sept 2026); the rest is there on a click.
            <details className={styles.findingMore}>
              <summary>Details</summary>
              <p className={styles.findingDetail}>
                {splitExcerpt(excerpt).detail}
              </p>
            </details>
          )}
        </div>
      ) : item.saidBy ? (
        <Said by={item.saidBy} text={excerpt} />
      ) : (
        <blockquote className={styles.quote}>{excerpt}</blockquote>
      )}
    </section>
  ) : null

  // The reply draft sits beside what they wrote (an exchange), or under the
  // card row when a Change shows its card.
  const replyBlock = item.replyDraft ? (
    <section className={styles.block}>
      <h3 className={styles.h3}>
        Reply draft{item.replyTo ? ` to ${item.replyTo}` : ''}
        {item.source === 'Discord' &&
          d.reply !== null &&
          d.reply !== item.replyDraft && (
            <em className={styles.edited}>edited</em>
          )}
      </h3>
      {item.source === 'Discord' ? (
        // A Discord reply is not typed over here: one click puts it on the
        // clipboard, and Bryce pastes it in Discord (14 Sept 2026). The
        // chat can rewrite it, though.
        <CopyBox text={d.reply ?? item.replyDraft} />
      ) : d.editingReply ? (
        <textarea
          ref={fitToText}
          onInput={e => fitToText(e.currentTarget)}
          className={`${styles.input} ${styles.replyInput}`}
          rows={Math.min(
            14,
            Math.max(4, item.replyDraft.split('\n').length + 1)
          )}
          autoFocus
          defaultValue={d.reply ?? item.replyDraft}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault()
              setD({ editingReply: false })
            } else if (isDoneKey(e)) {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          onBlur={e => setD({ editingReply: false, reply: e.target.value })}
        />
      ) : (
        <ReplyDraft
          text={d.reply ?? item.replyDraft}
          edited={d.reply !== null && d.reply !== item.replyDraft}
          canEdit={!revising && isOpen(item)}
          onEdit={() => setD({ editingReply: true })}
        />
      )}
      {item.source !== 'Discord' && (
        <p className={styles.note}>
          {item.replyStatus === 'Saved' ? (
            <>
              Saved in Gmail as a draft
              {item.sourceLink && (
                <>
                  {' · '}
                  <a href={item.sourceLink} target="_blank" rel="noreferrer">
                    open the thread
                  </a>
                </>
              )}
              . Nothing was sent.
            </>
          ) : item.replyStatus === 'Failed' ? (
            `The draft could not be saved${item.error ? `: ${item.error}` : '.'}`
          ) : isOpen(item) ? (
            agentOnline ? (
              `${acceptLabel(item)} saves this as a Gmail draft at once. Nothing is sent.`
            ) : (
              `${acceptLabel(item)} saves this as a Gmail draft (${WORKER_NOTE}). Nothing is sent.`
            )
          ) : (
            replyLabel(item)
          )}
        </p>
      )}
    </section>
  ) : null

  // The side panel: the verdict with its reasons, and under it the chat
  // with Fable (when the Mac agent is up), which is there for every item.
  const hasVerdict = Boolean(item.verdict) || item.reasons.length > 0
  const showAside = hasVerdict || chatAgent !== null
  // Where Comb found the listing: the "Source:" line of its own Airtable
  // comment, read here as it is in Airtable (Bryce, 17 Sept 2026).
  const found =
    item.source === 'Comb' && item.sourceExcerpt
      ? foundLabel(item.sourceExcerpt)
      : null

  return (
    <div
      className={`${styles.detailInner} ${showAside ? styles.detailTwoCol : ''}`}
    >
      <div className={styles.detailMain}>
        <div className={styles.detailHead}>
          <div className={styles.pills}>
            <span className={`${styles.pill} ${dotClass(item)}`}>
              <Icon src={sourceIcon(item)} size={12} />
              {item.source}
            </span>
            {/* The verdict heads the panel on the right, so it is not
                repeated here. */}
            {item.page && (
              // The live page, landing on this record's card (every card
              // carries its record id as an anchor) so the change can be
              // checked on the site.
              <a
                className={styles.pageTag}
                href={livePageUrl(item)}
                target="_blank"
                rel="noreferrer"
                title="Opens the live card and copies the listing's name (D)"
                onClick={() => copyListingName(item)}
              >
                {pageLabel(item)}
              </a>
            )}
            <span className={styles.when}>{ago(item.createdAt)}</span>
            <div className={styles.links}>
              {item.sourceLink && (
                <a
                  href={item.sourceLink}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.withIcon}
                >
                  <Icon src={linkIcon(item.sourceLink)} size={12} />
                  {linkLabel(item.sourceLink)}
                </a>
              )}
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.withIcon}
                >
                  <Icon src={ICON.external} size={12} />
                  {item.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              )}
            </div>
          </div>
          {/* Where Comb found the listing heads the panel on the right;
              with no panel it sits here instead. */}
          {found && !showAside && (
            <p className={styles.found}>
              <span className={styles.foundLabel}>Source</span> {found}
            </p>
          )}
          {/* With a card on show the heading only repeats what Broom found
              (or the record's name), so it is left out. */}
          {!showsCard && (
            <h2 className={styles.title}>{splitTitle(item).heading}</h2>
          )}
        </div>

        {/* The record as the site shows it, with the proposed change laid
            over it, so the effect of Accept is visible. */}
        {hasCard && (
          <div className={styles.cardRow}>
            <SitePreview
              table={item.targetTable ?? ''}
              record={item.targetRecord ?? ''}
              edits={{
                ...Object.fromEntries(item.changes.map(c => [c.field, c.to])),
                ...editsToSave(),
              }}
            />
            <div className={styles.cardRowText}>{excerptBlock}</div>
          </div>
        )}

        {/* A request and its reply side by side, so the two read as one
            exchange (Bryce, 14 Sept 2026). */}
        {!hasCard &&
          (excerptBlock && replyBlock ? (
            <div className={styles.exchange}>
              {excerptBlock}
              {replyBlock}
            </div>
          ) : (
            excerptBlock
          ))}

        {/* Edits typed on the page, in the field's own shape. */}
        {item.type === 'Add' &&
          item.targetTable &&
          item.targetRecord &&
          (live || item.fields) && (
            <>
              <SitePreview
                table={item.targetTable ?? ''}
                record={item.targetRecord ?? ''}
                edits={editsToSave()}
              />
              <Fields
                item={item}
                fields={live?.fields ?? item.fields ?? {}}
                schema={live?.schema ?? []}
                onImage={onImage}
                d={d}
                setD={setD}
                readOnly={readOnly}
              />
            </>
          )}

        {item.type === 'Change' &&
          (nothingToApply ? (
            <p className={styles.note}>
              No field change proposed. Accept says the flag was right and you
              have dealt with it, and clears it in Airtable; Reject clears it as
              wrong; or ask Fable for a change.
            </p>
          ) : (
            <div className={styles.diff}>
              {item.changes.map(c => (
                <div key={c.field} className={styles.diffRow}>
                  <span className={styles.label}>
                    <FieldIcon
                      page={item.page}
                      name={c.field}
                      value={show(c.to)}
                      size={12}
                    />
                    {c.field}
                  </span>
                  <span className={styles.from}>
                    {(() => {
                      const pic = pictureOf(c.from, live?.fields[c.field])
                      return pic ? (
                        <Picture key={pic.url ?? ''} {...pic} />
                      ) : (
                        friendly(show(c.from))
                      )
                    })()}
                  </span>
                  <span className={styles.arrow}>
                    <Icon src={ICON.arrow} size={12} />
                  </span>
                  <span className={styles.to}>
                    {(() => {
                      // A proposed picture is shown, not its JSON, and
                      // is not typed over: it is taken or refused whole.
                      if (c.field in d.edits || d.editing === c.field) {
                        return null
                      }
                      const pic = pictureOf(c.to, null)
                      return pic ? (
                        <Picture key={pic.url ?? ''} {...pic} />
                      ) : null
                    })() ??
                      (d.editing === c.field ? (
                        <textarea
                          ref={fitToText}
                          onInput={e => fitToText(e.currentTarget)}
                          className={styles.input}
                          rows={2}
                          autoFocus
                          defaultValue={d.edits[c.field] ?? show(c.to)}
                          onKeyDown={e => {
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              setD({ editing: null })
                            } else if (isDoneKey(e)) {
                              e.preventDefault()
                              e.currentTarget.blur()
                            }
                          }}
                          onBlur={e => {
                            // Closing the box without changing anything is
                            // not an edit.
                            const text = e.target.value
                            const edits = { ...d.edits }
                            if (text === show(c.to)) delete edits[c.field]
                            else edits[c.field] = text
                            setD({ editing: null, edits })
                          }}
                        />
                      ) : (
                        <EditableValue
                          text={friendly(
                            c.field in d.edits ? d.edits[c.field] : show(c.to)
                          )}
                          edited={c.field in d.edits}
                          canEdit={!revising}
                          onEdit={() => setD({ editing: c.field })}
                        />
                      ))}
                  </span>
                </div>
              ))}
            </div>
          ))}

        {item.type === 'Rule' && (
          <section className={styles.block}>
            <h3 className={styles.h3}>What changes for the bots</h3>
            <p className={styles.summary}>
              {item.summary ?? 'No summary was written for this rule.'}
            </p>
            {item.appliesTo && (
              <p className={styles.note}>Applies to: {item.appliesTo}</p>
            )}
          </section>
        )}

        {(hasCard || !excerptBlock) && replyBlock}

        {(item.error || d.error) && (
          <p className={styles.error}>{d.error ?? item.error}</p>
        )}
      </div>

      {showAside && (
        <aside
          className={`${styles.detailAside} ${hasVerdict ? verdictClass(item) : ''}`}
          data-chat-scroll
        >
          {found && (
            <div className={styles.asideFound}>
              <span className={styles.verdictKicker}>Source</span>
              <span>{found}</span>
            </div>
          )}
          {item.verdict && (
            <div className={styles.verdictHead}>
              <span className={styles.verdictKicker}>Fable says</span>
              <span className={`${styles.verdictBig} ${styles.withIcon}`}>
                <Icon src={verdictIcon(item)} size={16} />
                {verdictWord(item)}
              </span>
            </div>
          )}
          {item.reasons.length > 0 && (
            <ul className={styles.reasons}>
              {item.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {chatAgent && (
            <Chat
              key={item.id}
              item={item}
              agent={chatAgent}
              edits={d.edits}
              reply={d.reply ?? item.replyDraft}
              canEditField={k =>
                !HOUSEKEEPING.test(k) &&
                !COMPUTED_TYPES.has(types.get(k)?.type ?? '')
              }
              onSetEdits={edits => setD({ edits })}
              onSetReply={text => setD({ reply: text })}
              onWrote={onWrote}
              focusTick={chatFocus}
            />
          )}
        </aside>
      )}

      <div className={styles.actions}>
        {readOnly ? (
          <p className={styles.note}>
            View only: accepting, rejecting and editing stay with people who can
            edit the Queue.
          </p>
        ) : revising ? (
          <p className={`${styles.note} ${styles.withIcon}`}>
            <Icon src={ICON.timer} size={12} />
            Claude is revising this{item.note ? ` (“${item.note}”)` : ''}.
          </p>
        ) : d.mode === 'reject' ? (
          <div className={styles.panel}>
            <div className={styles.chips}>
              {item.rejectChips.map((chip, i) => (
                // Picking a reason IS the rejection: no Confirm step after
                // it (Bryce, 11 Sept 2026). Confirm stays for a typed
                // reason and for rules, which need none.
                <button
                  key={chip}
                  className={`${styles.chip} ${d.chip === chip ? styles.chipOn : ''}`}
                  disabled={d.busy}
                  onClick={() => {
                    setD({ chip })
                    act('reject', { reason: chip })
                  }}
                >
                  <kbd>{i + 1}</kbd>
                  <span>{chip}</span>
                </button>
              ))}
              <input
                className={`${styles.input} ${styles.other}`}
                placeholder="Other reason…"
                value={d.other}
                onChange={e => setD({ other: e.target.value, chip: null })}
                onKeyDown={e => {
                  if (e.key === 'Enter' && reason) act('reject', { reason })
                }}
              />
            </div>
            <div className={styles.buttons}>
              <button
                className={`${styles.button} ${styles.danger}`}
                disabled={d.busy || (!reason && item.type !== 'Rule')}
                onClick={() => act('reject', { reason })}
              >
                <Icon src={ICON.x} size={12} />
                {d.busy ? 'Rejecting…' : 'Confirm reject'} <kbd>↵</kbd>
              </button>
              <button
                className={styles.ghost}
                disabled={d.busy}
                onClick={() => setD({ mode: 'idle', chip: null, other: '' })}
              >
                Cancel <kbd>Esc</kbd>
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.buttons}>
            <button
              className={`${styles.button} ${styles.primary}`}
              disabled={d.busy}
              onClick={() => act('accept', { edits: editsToSave() })}
            >
              <Icon
                src={item.type === 'Add' ? ICON.plus : ICON.check}
                size={12}
              />
              {d.busy ? 'Applying…' : acceptLabel(item)} <kbd>A</kbd>
            </button>
            <button
              className={`${styles.button} ${styles.danger}`}
              disabled={d.busy}
              onClick={() => setD({ mode: 'reject' })}
            >
              <Icon src={ICON.x} size={12} />
              Reject <kbd>R</kbd>
            </button>
            {editCount > 0 && (
              <span className={styles.note}>
                {editCount === 1 ? '1 edit goes' : `${editCount} edits go`} with
                it
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const IMAGE_URL =
  /\.(png|jpe?g|webp|gif|svg)(\?|$)|airtableusercontent\.com|blob\.vercel-storage\.com/i

function isImageList(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(x => typeof x === 'string' && IMAGE_URL.test(x))
  )
}

// Fields nobody edits from here: Airtable's own bookkeeping by name, and
// any column Airtable computes (formulas, lookups, counts, timestamps) by
// type. Left out of the list (Bryce, 11 Sept 2026: "only the fields I may
// plausibly want to edit").
const HOUSEKEEPING =
  /^(created|date added|last modified|created time|record id|submitter's email)$/i
const COMPUTED_TYPES = new Set([
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
])

// The icon the site's own card draws beside a field's value, so the grid
// reads the way the card does (Bryce, 17 Sept 2026: "where we have icons
// from the live site available for a field, let's put it next to it").
// Field names in lower case; a page's own entry beats the shared one; a
// few icons follow the value the way the card's do (src/app/<page>/card.ts).
const SHARED_ICONS: Record<string, string> = {
  location: 'pin',
  'location (if in-person)': 'pin',
  platform: 'computer',
  'start date': 'calendar',
  'start date (approximate)': 'calendar',
  'end date': 'calendar',
  'typical length': 'calendar',
  deadline: 'paper',
  'deadline type': 'paper',
  'applications not yet open?': 'paper-closed',
  'applications/registrations not yet open?': 'paper-closed',
  focus: 'target',
  host: 'person',
  'host name': 'person',
  'contact name': 'person',
  'contact email': 'mail',
  cost: 'tag',
  status: 'activity',
  organizer: 'author',
  category: 'category',
}
const PAGE_ICONS: Record<string, Record<string, string>> = {
  '/funding': { type: 'tag' },
  '/founders': { type: 'tag' },
  '/media-channels': { type: 'computer' },
  '/self-study': { type: 'type', 'course type': 'type' },
}

function fieldIcon(
  page: string | null,
  name: string,
  value: string
): string | null {
  const key = name.trim().toLowerCase()
  // The card folds Mode into its location row: a screen for online, a pin
  // for a place.
  if (key === 'mode') {
    return value === 'Online'
      ? '/images/icons/computer.svg'
      : '/images/icons/pin.svg'
  }
  if (key === 'entry bar') {
    const bar = value.toLowerCase()
    return ['low', 'mid', 'high'].includes(bar)
      ? `/images/icons/entry-${bar}.svg`
      : null
  }
  if (key === 'activity level') return activityIcon(value)
  if (key === 'stipend') {
    return value === 'No stipend'
      ? '/images/icons/money-off.svg'
      : '/images/icons/money.svg'
  }
  if (key === 'time commitment') {
    return value === 'Part-time'
      ? '/images/icons/timer-half.svg'
      : '/images/icons/timer.svg'
  }
  if (key === 'accepting applications?') {
    return isAcceptingApplications(value)
      ? '/images/icons/form-check.svg'
      : '/images/icons/form-pause.svg'
  }
  const file = PAGE_ICONS[page ?? '']?.[key] ?? SHARED_ICONS[key]
  return file ? `/images/icons/${file}.svg` : null
}

/** A training or event Type as the site's card shows it: one pill per
 *  type in the page's own colour (Bryce, 17 Sept 2026: "colour this the
 *  same way as the site"). Undefined for every other field, which stays
 *  plain text. */
function typePills(
  page: string | null,
  name: string,
  value: string
): React.ReactNode | undefined {
  if (name.trim().toLowerCase() !== 'type' || !value.trim()) return undefined
  const color =
    page === '/training'
      ? trainingTypeColor
      : page === '/events'
        ? eventTypeColor
        : null
  if (!color) return undefined
  const types = value
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
  return (
    <span className={styles.typePills}>
      {types.map(t => (
        // The site's colour class names its variable: color-orange → --orange.
        <span
          key={t}
          className={styles.typePill}
          style={
            {
              '--pill': `var(--${color(t).replace(/^color-/, '')})`,
            } as React.CSSProperties
          }
        >
          {t}
        </span>
      ))}
    </span>
  )
}

/** The site's icon for a field, or nothing when the site draws none. */
function FieldIcon({
  page,
  name,
  value,
  size,
}: {
  page: string | null
  name: string
  value: string
  size: 12 | 16
}) {
  const src = fieldIcon(page, name, value)
  return src ? (
    <Icon src={src} size={size} className={styles.fieldIcon} />
  ) : null
}

/** Editors that fit in a grid cell; a textarea or a chip picker wants
 *  the full row. */
const NARROW_EDITORS = new Set([
  'singleSelect',
  'date',
  'number',
  'url',
  'email',
])
const LONG_TEXT_TYPES = new Set(['multilineText', 'richText'])

/** Nothing there: no value, an empty list, or an unticked box. */
function isBlank(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    v === '' ||
    v === false ||
    (Array.isArray(v) && v.length === 0)
  )
}

function Fields({
  item,
  fields,
  schema,
  onImage,
  d,
  setD,
  readOnly,
}: {
  item: QueueItem
  fields: Record<string, unknown>
  schema: FieldInfo[]
  onImage: (field: string, urls: string[]) => void
  d: Draft
  setD: (patch: Partial<Draft>) => void
  readOnly: boolean
}) {
  // With the table's field list we show every column, empty ones included,
  // in the table's order (name, link and description first); without it,
  // only what the snapshot carries.
  const types = new Map(schema.map(f => [f.name, f.type]))
  const infos = new Map(schema.map(f => [f.name, f]))
  const all: Record<string, unknown> = {}
  if (schema.length) {
    for (const f of schema) all[f.name] = fields[f.name] ?? null
    for (const [k, v] of Object.entries(fields)) if (!(k in all)) all[k] = v
  } else {
    Object.assign(all, fields)
  }
  // What the page cannot do without and the record – with the edits typed
  // here – still leaves empty (Bryce, 17 Sept 2026: two events went out
  // with no Cost, "I had missed that"). Its name goes orange and bold where
  // it sits; and it is listed even before the table's field list arrives.
  const current: Record<string, unknown> = { ...all }
  for (const [k, v] of Object.entries(d.edits)) {
    current[k] = v === 'false' ? false : v
  }
  const missing = missingFields(item.page, current)
  const missingSet = new Set(missing)
  for (const k of missing) if (!(k in all)) all[k] = null
  const entries = Object.entries(all)
  const pick = (re: RegExp) => entries.filter(([k]) => re.test(k))
  const main = [...pick(NAME_KEYS), ...pick(URL_KEYS), ...pick(DESC_KEYS)]
  const seen = new Set(main.map(([k]) => k))
  const editable = ([k]: [string, unknown]) =>
    !HOUSEKEEPING.test(k) && !COMPUTED_TYPES.has(types.get(k) ?? '')
  const rest = entries.filter(e => !seen.has(e[0]) && editable(e))
  const revising = item.status === 'Revising' || readOnly

  // Name, link and description keep a row each, and so does every picture
  // (an empty logo slot is the point). Every other filled field sits in a
  // compact grid, and the empty ones fold into one line of names, each a
  // click from being set (Bryce, 17 Sept 2026: "overwhelmed by all the
  // fields"). An unticked box counts as empty; a field being edited, or
  // edited to empty, stays in the grid with its "edited" mark.
  const isPicture = ([k, v]: [string, unknown]) =>
    types.get(k) === 'multipleAttachments' || isImageList(v)
  const pictures = rest.filter(isPicture)
  const details = rest.filter(e => !isPicture(e))
  const inGrid = ([k, v]: [string, unknown]) =>
    !isBlank(v) || k in d.edits || d.editing === k
  const filled = details.filter(inGrid)
  const unset = details.filter(e => !inGrid(e))

  const valueOf = ([k, v]: [string, unknown], icon?: React.ReactNode) => {
    const info = infos.get(k)
    const isAttachment = types.get(k) === 'multipleAttachments'
    const empty =
      v === null ||
      v === undefined ||
      v === '' ||
      (Array.isArray(v) && v.length === 0)
    const edited = k in d.edits
    const value = edited ? d.edits[k] : show(v)
    const isUrl = typeof v === 'string' && /^https?:\/\//.test(v) && !edited
    if (d.editing === k) {
      return (
        <FieldEditor
          info={info}
          value={empty && !edited ? '' : value}
          onSave={text => {
            // Saving what was already there is not an edit.
            const same = text === (empty ? '' : show(v))
            const edits = { ...d.edits }
            if (same) delete edits[k]
            else edits[k] = text
            setD({ editing: null, edits })
          }}
          onCancel={() => setD({ editing: null })}
        />
      )
    }
    if (isAttachment || isImageList(v)) {
      return (
        <ImageSlot
          itemId={item.id}
          field={k}
          urls={isImageList(v) ? v : []}
          canUpload={isAttachment && !revising}
          onDone={urls => onImage(k, urls)}
        />
      )
    }
    if (info?.type === 'checkbox') {
      const on = edited ? d.edits[k] === 'true' : v === true
      return (
        <>
          {icon}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={on}
              disabled={revising}
              onChange={e => {
                // Back to how it was is not an edit.
                const edits = { ...d.edits }
                if (e.target.checked === (v === true)) delete edits[k]
                else edits[k] = e.target.checked ? 'true' : 'false'
                setD({ edits })
              }}
            />
            {on ? 'Yes' : 'No'}
            {edited && <em className={styles.edited}>edited</em>}
          </label>
        </>
      )
    }
    if (empty && !edited) {
      return (
        <EditableValue
          text="—"
          icon={icon}
          muted
          edited={false}
          canEdit={!revising}
          onEdit={() => setD({ editing: k })}
        />
      )
    }
    return (
      <EditableValue
        text={friendly(value)}
        href={isUrl ? (v as string) : undefined}
        body={typePills(item.page, k, value)}
        icon={icon}
        edited={edited}
        canEdit={!revising && isEditable(v) && !isAttachment}
        onEdit={() => setD({ editing: k })}
      />
    )
  }
  const row = (e: [string, unknown]) => (
    <div key={e[0]} className={styles.fieldRow}>
      <span
        className={`${styles.label} ${missingSet.has(e[0]) ? styles.labelMissing : ''}`}
      >
        {e[0]}
      </span>
      <span className={styles.value}>{valueOf(e)}</span>
    </div>
  )
  const cell = (e: [string, unknown]) => {
    const [k, v] = e
    const text = k in d.edits ? d.edits[k] : show(v)
    const type = types.get(k) ?? ''
    const wide =
      LONG_TEXT_TYPES.has(type) ||
      text.length > 40 ||
      (d.editing === k && !NARROW_EDITORS.has(type))
    // The icon is part of the value, so a long value wraps beside it
    // instead of dropping to the line below it.
    const icon =
      d.editing !== k ? (
        <FieldIcon page={item.page} name={k} value={text} size={16} />
      ) : undefined
    return (
      <div
        key={k}
        className={`${styles.fieldCell} ${wide ? styles.fieldWide : ''}`}
      >
        <span className={styles.label}>{k}</span>
        <span className={styles.value}>{valueOf(e, icon)}</span>
      </div>
    )
  }
  return (
    <div className={styles.fields}>
      {main.map(row)}
      {pictures.map(row)}
      {filled.length > 0 && (
        <div className={styles.fieldGrid}>{filled.map(cell)}</div>
      )}
      {unset.length > 0 && (
        <div className={styles.unset}>
          <span className={styles.label}>Not set</span>
          {unset.map(([k]) => {
            const box = infos.get(k)?.type === 'checkbox'
            return (
              <button
                key={k}
                type="button"
                className={`${styles.unsetChip} ${missingSet.has(k) ? styles.unsetMissing : ''}`}
                disabled={revising}
                title={box ? `Tick ${k}` : `Fill in ${k}`}
                onClick={() =>
                  box
                    ? setD({ edits: { ...d.edits, [k]: 'true' } })
                    : setD({ editing: k })
                }
              >
                <Icon src={ICON.plus} size={12} />
                {k}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The pictures in an attachment field – each with its file name, pixel
 *  size, bytes and type beside it – and a drop target: drag an image in or
 *  click to choose one, and it goes onto the record right away. Undo puts
 *  the picture it replaced back (the page held its bytes); Redo undoes
 *  the Undo. */
function ImageSlot({
  itemId,
  field,
  urls,
  canUpload,
  onDone,
}: {
  itemId: string
  field: string
  urls: string[]
  canUpload: boolean
  onDone: (urls: string[]) => void
}) {
  const [over, setOver] = useState(false)
  // What is on its way: a drop, or an undo/redo of one.
  const [busy, setBusy] = useState<'upload' | 'undo' | 'redo' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stashKey = `${itemId}/${field}`
  const stash = imageStash.get(stashKey) ?? null
  // Re-render after the stash (module state) changes.
  const [, setTick] = useState(0)

  /** One write to the field: a picture, or `clear` to empty it. What the
   *  write takes off the record is stashed for the next Undo. */
  const write = async (
    body: Record<string, unknown>,
    what: 'upload' | 'undo' | 'redo'
  ) => {
    setError(null)
    setBusy(what)
    try {
      const res = await fetch(UPLOAD_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: itemId, field, ...body }),
      })
      const data = (await res.json()) as {
        urls?: string[]
        attachments?: AttachmentInfo[]
        previous?: PreviousImage | null
        error?: string
      }
      if (!res.ok || !data.urls)
        throw new Error(data.error ?? `HTTP ${res.status}`)
      rememberAttachments({ [field]: data.attachments ?? [] })
      stashImage(stashKey, {
        file: data.previous ?? null,
        redo: what === 'undo',
      })
      setTick(t => t + 1)
      onDone(data.urls)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const send = async (file: File) => {
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError('That is not an image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Over 5 MB.')
      return
    }
    let base64: string
    try {
      base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => {
          const s = String(r.result)
          resolve(s.slice(s.indexOf(',') + 1))
        }
        r.onerror = () => reject(new Error('Could not read the file.'))
        r.readAsDataURL(file)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    await write(
      { filename: file.name, contentType: file.type, data: base64 },
      'upload'
    )
  }

  /** Undo puts the stashed picture back (or empties the field when there
   *  was none); Redo is the same move the other way. */
  const undo = () => {
    if (!stash) return
    const what = stash.redo ? 'redo' : 'undo'
    if (stash.file) {
      const { filename, contentType, base64 } = stash.file
      void write({ filename, contentType, data: base64 }, what)
    } else {
      void write({ clear: true }, what)
    }
  }

  // The whole slot — picture included — takes a drop; the new picture
  // replaces the old one. The box is also a button for the file picker.
  const dragProps = canUpload
    ? {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault()
          setOver(true)
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault()
          setOver(false)
          const file = e.dataTransfer.files[0]
          if (file) void send(file)
        },
      }
    : {}

  return (
    <span
      className={`${styles.imageSlot} ${over ? styles.imageSlotOver : ''}`}
      title={
        canUpload ? 'Drop an image anywhere here to replace it' : undefined
      }
      {...dragProps}
    >
      {urls.map(src => {
        const meta = attachmentMeta.get(src)
        const line = meta ? attachmentMetaLine(meta) : ''
        return (
          <span key={src} className={styles.thumbItem}>
            <span className={styles.thumbWrap}>
              <Image
                src={src}
                alt=""
                width={56}
                height={56}
                unoptimized
                className={styles.thumb}
              />
              {over && <span className={styles.thumbOverlay}>Replace</span>}
            </span>
            {meta && (meta.filename || line) && (
              <span className={styles.thumbDetails}>
                {meta.filename && (
                  <span className={styles.pictureName}>{meta.filename}</span>
                )}
                {line && <span className={styles.pictureMeta}>{line}</span>}
              </span>
            )}
          </span>
        )
      })}
      {canUpload && (
        <span
          className={`${styles.dropZone} ${over ? styles.dropZoneOver : ''} ${
            urls.length ? styles.dropZoneSmall : ''
          }`}
          role="button"
          tabIndex={0}
          title="Drop an image here, or click to choose one"
          onClick={() => inputRef.current?.click()}
          onKeyDown={e => {
            if (e.key === 'Enter') inputRef.current?.click()
          }}
        >
          {busy === 'upload'
            ? 'Uploading…'
            : urls.length
              ? 'Replace'
              : 'Drop image'}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) void send(file)
              e.target.value = ''
            }}
          />
        </span>
      )}
      {canUpload && stash && (
        <button
          type="button"
          className={`${styles.linkButton} ${styles.imageUndo}`}
          disabled={busy !== null}
          title={
            stash.redo
              ? 'Put the replacement back'
              : stash.file
                ? `Put ${stash.file.filename} back`
                : 'Take the picture off again'
          }
          onClick={undo}
        >
          {busy === 'undo'
            ? 'Undoing…'
            : busy === 'redo'
              ? 'Redoing…'
              : stash.redo
                ? 'Redo'
                : 'Undo'}
        </button>
      )}
      {!canUpload && urls.length === 0 && (
        <span className={styles.noImage}>none</span>
      )}
      {error && <span className={styles.noticeInline}>{error}</span>}
    </span>
  )
}

/** The right control for a field's Airtable type: a dropdown of the
 *  field's own options, toggle chips for a multi-select, a date or number
 *  input, else a text box. Values travel as text (lists comma-joined) and
 *  coerceEdits turns them back into the field's shape. */
function FieldEditor({
  info,
  value,
  onSave,
  onCancel,
}: {
  info: FieldInfo | undefined
  value: string
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const type = info?.type
  const choices = info?.choices ?? []
  const [picked, setPicked] = useState<string[]>(() =>
    value
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
  )
  // The editor settles exactly once: a select saves on change and must not
  // save again when it loses focus as it closes, and a blur that follows
  // Escape is not a save.
  const settled = useRef(false)
  const save = (text: string) => {
    if (settled.current) return
    settled.current = true
    onSave(text)
  }
  const cancel = () => {
    if (settled.current) return
    settled.current = true
    onCancel()
  }
  const esc = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }
  if (type === 'singleSelect' && choices.length) {
    return (
      <select
        className={styles.input}
        autoFocus
        defaultValue={value}
        onKeyDown={esc}
        onChange={e => save(e.target.value)}
        onBlur={e => save(e.target.value)}
      >
        <option value="">—</option>
        {choices.map(c => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    )
  }
  if (type === 'multipleSelects' && choices.length) {
    return (
      <span className={styles.panel} onKeyDown={esc}>
        <span className={styles.chips}>
          {choices.map(c => {
            const on = picked.includes(c)
            return (
              <button
                key={c}
                className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                onClick={() =>
                  setPicked(on ? picked.filter(x => x !== c) : [...picked, c])
                }
              >
                {c}
              </button>
            )
          })}
        </span>
        <span className={styles.buttons}>
          <button
            className={styles.button}
            autoFocus
            onClick={() => save(picked.join(', '))}
          >
            Done
          </button>
          <button className={styles.ghost} onClick={cancel}>
            Cancel <kbd>Esc</kbd>
          </button>
        </span>
      </span>
    )
  }
  if (
    type === 'date' ||
    type === 'number' ||
    type === 'url' ||
    type === 'email'
  ) {
    return (
      <input
        className={styles.input}
        type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'}
        autoFocus
        defaultValue={value}
        onKeyDown={e => {
          esc(e)
          if (e.key === 'Enter') save((e.target as HTMLInputElement).value)
        }}
        onBlur={e => save(e.target.value)}
      />
    )
  }
  return (
    <textarea
      ref={fitToText}
      onInput={e => fitToText(e.currentTarget)}
      className={styles.input}
      rows={value.length > 120 ? 5 : 2}
      autoFocus
      defaultValue={value}
      onKeyDown={e => {
        esc(e)
        if (isDoneKey(e)) {
          e.preventDefault()
          save(e.currentTarget.value)
        }
      }}
      onBlur={e => save(e.target.value)}
    />
  )
}

/** A value you can click to edit: a visible pencil, a hover tint, and a link
 *  that still opens when it is one. The field's icon, the value, its
 *  "edited" mark and the pencil run as one line of text, so a long value
 *  wraps with the icon at its start and the pencil after its last word
 *  (Bryce, 17 Sept 2026: the icon alone on the first line with the pencil
 *  floating beside two lines of text was "ugly"). */
function EditableValue({
  text,
  href,
  body,
  icon,
  edited,
  canEdit,
  muted,
  onEdit,
}: {
  text: string
  href?: string
  /** Shown in place of the text (e.g. the site's coloured type pills). */
  body?: React.ReactNode
  /** The site's icon for the field, drawn before the value. */
  icon?: React.ReactNode
  edited: boolean
  canEdit: boolean
  muted?: boolean
  onEdit: () => void
}) {
  const shown = href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  ) : (
    (body ?? <span className={muted ? styles.empty : undefined}>{text}</span>)
  )
  if (!canEdit)
    return (
      <>
        {icon}
        {shown}
      </>
    )
  return (
    <span
      className={styles.editable}
      role="button"
      tabIndex={0}
      title="Click to edit"
      onClick={e => {
        // A click on the link itself opens the link; anywhere else edits.
        if ((e.target as HTMLElement).tagName === 'A') return
        onEdit()
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onEdit()
        }
      }}
    >
      <span className={styles.editText}>
        {icon}
        {shown}
        {edited && <em className={styles.edited}>edited</em>}
        <span className={styles.editHint}>
          <Icon src={ICON.pencil} size={12} />
        </span>
      </span>
    </span>
  )
}

/** The reply draft as a block: click anywhere on it to edit. */
const LINK_RE = /https?:\/\/[^\s<>)\]]+/g

/** Text with its links clickable. */
function linkify(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(LINK_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push(text.slice(last, i))
    out.push(
      <a key={i} href={m[0]} target="_blank" rel="noreferrer">
        {m[0]}
      </a>
    )
    last = i + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** "12 September 2026, 04:12" in the viewer's own time. */
function whenLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${day}, ${time}`
}

// Older Discord rows carry the attribution as a first line of the excerpt
// ("veronica (@veronica0548) on Discord, 12 September 2026, 04:12 (DM):");
// the page lays the same facts out itself, so that line goes.
const OLD_HEADER_RE = /^[^\n]* on Discord, [^\n]*:\n/

/** A Discord message as a chat message: picture, name, handle, when, then
 *  the words, with links clickable. */
function Said({ by, text }: { by: SaidBy; text: string }) {
  const body = text.replace(OLD_HEADER_RE, '').trim()
  const meta = [
    by.when ? whenLabel(by.when) : null,
    by.how && by.how !== 'DM' ? by.how : null,
    by.where,
  ].filter(Boolean)
  return (
    <div className={styles.said}>
      {by.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.avatar}
          src={by.avatar}
          alt=""
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className={`${styles.avatar} ${styles.avatarEmpty}`} />
      )}
      <div className={styles.message}>
        <div className={styles.messageHead}>
          <span className={styles.messageName}>{by.name}</span>
          {by.handle && (
            <span className={styles.messageHandle}>{by.handle}</span>
          )}
          {meta.length > 0 && (
            <span className={styles.messageWhen}>{meta.join(' · ')}</span>
          )}
        </div>
        <div className={styles.messageBody}>{linkify(body)}</div>
      </div>
    </div>
  )
}

/** The reply as a box that copies itself on a click: no buttons, no editing
 *  here (Bryce, 14 Sept 2026) – click, then paste it in Discord. */
function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <pre
      className={`${styles.draft} ${styles.draftEditable} ${styles.draftCopy}`}
      role="button"
      tabIndex={0}
      title="Click to copy"
      onClick={copy}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          copy()
        }
      }}
    >
      {text}
      <span className={styles.draftHint}>
        {copied ? (
          <em className={styles.edited}>Copied</em>
        ) : (
          <Icon src={ICON.copy} size={16} />
        )}
      </span>
    </pre>
  )
}

/** Copies the reply so it can be pasted into Discord: replies from the
 *  Queue are drafts, never sent (Bryce, 14 Sept 2026). */
function CopyReply({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={className ?? styles.ghost}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
    >
      <Icon src={ICON.copy} size={16} />
      {copied ? 'Copied' : 'Copy reply'}
    </button>
  )
}

/** The conversation the request came from, in Discord. */
function OpenOnDiscord({
  href,
  className,
}: {
  href: string
  className?: string
}) {
  return (
    <a
      className={className ?? styles.ghost}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      <Icon src={ICON.external} size={16} />
      Open on Discord
    </a>
  )
}

function ReplyDraft({
  text,
  edited,
  canEdit,
  onEdit,
}: {
  text: string
  edited: boolean
  canEdit: boolean
  onEdit: () => void
}) {
  if (!canEdit) return <pre className={styles.draft}>{text}</pre>
  return (
    <pre
      className={`${styles.draft} ${styles.draftEditable}`}
      role="button"
      tabIndex={0}
      title="Click to edit"
      onClick={onEdit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onEdit()
        }
      }}
    >
      {text}
      <span className={styles.draftHint}>
        {edited && <em className={styles.edited}>edited</em>}
        <Icon src={ICON.pencil} size={12} />
      </span>
    </pre>
  )
}

function DoneList({
  items,
  busyFor,
  errorFor,
  onUndo,
}: {
  items: QueueItem[]
  busyFor: (id: string) => boolean
  errorFor: (id: string) => string | null
  /** Null for a view-only session: decisions are shown, not undone. */
  onUndo: ((item: QueueItem) => void) | null
}) {
  return (
    <div className={styles.detailInner}>
      <h2 className={`${styles.title} ${styles.withIcon}`}>
        <span className={styles.yes}>
          <Icon src={ICON.done} />
        </span>
        Done today
      </h2>
      <p className={styles.note}>
        Published listings and field changes reach the site within about three
        minutes.
      </p>
      <div className={styles.doneList}>
        {items.map(item => (
          <div key={item.id} className={styles.doneRow}>
            {item.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.rowLogo} src={item.logo} alt="" />
            ) : (
              <span
                className={`${styles.rowLogo} ${styles.rowLogoEmpty} ${dotClass(item)}`}
              >
                <Icon src={sourceIcon(item)} />
              </span>
            )}
            <span className={styles.rowBody}>
              <span className={styles.rowTitle}>
                {splitTitle(item).name ?? item.title}
              </span>
              <span className={styles.rowMeta}>
                {item.source !== 'Comb' && <span>{item.source}</span>}
                {item.page && <span>{pageLabel(item)}</span>}
                <span
                  className={`${styles.withIcon} ${item.status === 'Rejected' ? styles.no : styles.yes}`}
                >
                  <Icon
                    src={item.status === 'Rejected' ? ICON.x : ICON.check}
                    size={12}
                  />
                  {doneLabel(item)}
                </span>
                {item.rejectReason && <span>{item.rejectReason}</span>}
                {item.status !== 'Rejected' && replyLabel(item) && (
                  <span>{replyLabel(item)}</span>
                )}
                <span>{ago(item.decidedAt)}</span>
              </span>
            </span>
            <span className={styles.doneActions}>
              {errorFor(item.id) && (
                <span className={styles.error}>{errorFor(item.id)}</span>
              )}
              {item.source === 'Discord' &&
                item.replyDraft &&
                item.status !== 'Rejected' && (
                  <>
                    <CopyReply text={item.replyDraft} />
                    {item.sourceLink && (
                      <OpenOnDiscord href={item.sourceLink} />
                    )}
                  </>
                )}
              {onUndo && (
                <button
                  className={styles.ghost}
                  disabled={busyFor(item.id)}
                  onClick={() => onUndo(item)}
                >
                  <Icon src={ICON.undo} size={12} />
                  {busyFor(item.id) ? 'Undoing…' : 'Undo'}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
