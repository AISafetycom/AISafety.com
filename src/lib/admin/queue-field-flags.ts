/*
  Fable's field check on /admin/queue (Bryce, 16 Nov 2026, on Quorum: Fable
  had said Publish, he asked the chat "Is strategy the best category for
  this?" and the answer was no – "Let's make it so that if Fable says, yes,
  this thing should be added, then it checks all the fields and flags any
  fields that it thinks should be changed").

  The Mac (~/Queue/fieldcheck.py) makes a second, separate look at every
  open addition whose verdict is Publish or Unsure (Unsure since 17 Nov
  2026, Bryce: "Publish and Unsure"; a one-off pass the same day also
  checked the Don't publish ones, so an item he publishes against the verdict
  has its fields ready) and keeps its answer on the row's
  proposal as `field_flags` = {at, review, checked, flags: [{field, from,
  to, why}]}. The page lists the flags under the verdict, each with a Use
  button that puts the value into the page's edits – so, like any edit,
  nothing reaches the listing before Publish.

  `from` is the value the flag was judged against (the record with the
  page's edits over it). A flag whose field no longer reads that way has
  been overtaken – edited by hand, changed from the chat – and is dropped.

  A logo (17 Nov 2026 – Bryce, told the check never changed pictures: "Why
  not?") comes as a picture flag: `picture: true`, `from` and `to` naming
  files by name and size – the record's file, and the one Logo Prep made,
  which the Mac keeps on the row's Prepared logo field (queue-prepared.ts).
  A flag never holds an Airtable link: they expire within hours. The page
  shows the two side by side, and Use copies the prepared file onto the
  record the way a picture dropped into the logo slot is written (the
  record is unpublished; Publish takes it live). A site without this code
  skips such a flag: its `from` and `to` are not values.
*/

import { preparedNamed, type PreparedFile } from './queue-prepared'

/** The verdicts whose additions show the field check's flags. The Mac checks
 *  Publish and Unsure as they come (CHECKED_VERDICTS in ~/Queue/fieldcheck.py);
 *  a Don't publish item has flags only from a one-off pass (ALSO_VERDICTS). */
export const FLAG_VERDICTS: ReadonlySet<string> = new Set([
  'Publish',
  'Unsure',
  "Don't publish",
])

export type FlagValue = string | number | boolean | string[] | null

export interface FieldFlag {
  field: string
  from: FlagValue
  to: FlagValue
  /** One line: what is wrong and why the new value is right. */
  why: string
}

/** A file named by a picture flag: its name, and its size in bytes when
 *  the Mac knew it (two files Logo Prep names alike differ in size). */
export interface PictureSide {
  file: string
  size: number | null
}

export interface PictureFlag {
  field: string
  /** The record's file when the check ran; null: the field was empty. */
  from: PictureSide | null
  /** The prepared file on the row's Prepared logo field. */
  to: PictureSide & { width: number | null; height: number | null }
  /** Where the file came from, in plain words ("the site header of x.org"). */
  source: string | null
  /** What Logo Prep did to it ("background made transparent"). */
  prep: string | null
  why: string
}

export interface FieldFlags {
  /** When the check ran (ISO), if the Mac said. */
  at: string | null
  /** How many fields it went through. */
  checked: number
  flags: FieldFlag[]
  /** A proposed logo, one flag per logo field (/map has two). */
  pictures: PictureFlag[]
}

/** The proposal key the Mac writes. */
export const FIELD_FLAGS_KEY = 'field_flags'

/** Accept and Undo own these two; no flag may name them. */
const SWITCHES = new Set(['Publish?', 'Hide?'])
const MAX_FLAGS = 12

function asValue(v: unknown): FlagValue | undefined {
  if (v === null || v === undefined) return null
  if (
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
  ) {
    return v
  }
  if (Array.isArray(v) && v.every(x => typeof x === 'string')) {
    return v as string[]
  }
  return undefined
}

const PICTURE_FIELD_RE = /logo|image/i
const MAX_PICTURES = 2

function sideOf(v: unknown): PictureSide | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  const file = typeof r.file === 'string' ? r.file.trim() : ''
  if (!file || file.length > 200) return null
  const size =
    typeof r.size === 'number' && Number.isFinite(r.size) && r.size > 0
      ? r.size
      : null
  return { file, size }
}

function dimension(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

function shortText(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

/** Pure: one picture flag, or null when it is not well formed. `from`
 *  null means the field was empty; a `from` that is there but unreadable
 *  makes the flag unusable (its state could not be told). */
function pictureFlagOf(f: Record<string, unknown>): PictureFlag | null {
  const field = typeof f.field === 'string' ? f.field.trim() : ''
  const why = typeof f.why === 'string' ? f.why.trim() : ''
  if (!field || field.length > 100 || !PICTURE_FIELD_RE.test(field)) {
    return null
  }
  const to = sideOf(f.to)
  const from = f.from === null || f.from === undefined ? null : sideOf(f.from)
  if (!why || !to || (from === null && f.from !== null && f.from !== undefined))
    return null
  const t = f.to as Record<string, unknown>
  return {
    field,
    from,
    to: { ...to, width: dimension(t.width), height: dimension(t.height) },
    source: shortText(f.source, 200),
    prep: shortText(f.prep, 200),
    why: why.slice(0, 400),
  }
}

/** Pure: the proposal's `field_flags` block, or null when the check has
 *  not run (or the block is malformed). A flag that is not well formed is
 *  left out; the rest stand. */
export function fieldFlagsOf(v: unknown): FieldFlags | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (!Array.isArray(r.flags)) return null
  const flags: FieldFlag[] = []
  const pictures: PictureFlag[] = []
  const seen = new Set<string>()
  for (const x of r.flags) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue
    const f = x as Record<string, unknown>
    if (f.picture === true) {
      const p = pictureFlagOf(f)
      if (p && !seen.has(p.field) && pictures.length < MAX_PICTURES) {
        seen.add(p.field)
        pictures.push(p)
      }
      continue
    }
    const field = typeof f.field === 'string' ? f.field.trim() : ''
    const why = typeof f.why === 'string' ? f.why.trim() : ''
    const from = asValue(f.from)
    const to = asValue(f.to)
    if (!field || field.length > 100 || SWITCHES.has(field) || seen.has(field))
      continue
    if (!why || from === undefined || to === undefined) continue
    seen.add(field)
    flags.push({ field, from, to, why: why.slice(0, 400) })
    if (flags.length >= MAX_FLAGS) break
  }
  return {
    at: typeof r.at === 'string' ? r.at : null,
    checked:
      typeof r.checked === 'number' && r.checked > 0
        ? Math.floor(r.checked)
        : 0,
    flags,
    pictures,
  }
}

/** The file a logo field holds now, as the page knows it: undefined until
 *  the record has been read, null when the field is empty. */
export type PictureNow = { filename: string | null; size: number | null }

function holds(now: PictureNow, side: PictureSide): boolean {
  return (
    now.filename === side.file &&
    (side.size === null || now.size === null || now.size === side.size)
  )
}

/** Pure: where a picture flag stands. used: the record holds the prepared
 *  file. open: it still holds the file the flag was judged against (or is
 *  still empty) – and before the record has been read it counts as open:
 *  Use checks the record again before writing. gone: the logo has been
 *  changed some other way (dropped in by hand, fixed from the chat). */
export function pictureState(
  flag: PictureFlag,
  now: PictureNow | null | undefined
): FlagState {
  if (now === undefined) return 'open'
  if (now && holds(now, flag.to)) return 'used'
  if (flag.from === null) return now === null ? 'open' : 'gone'
  return now && holds(now, flag.from) ? 'open' : 'gone'
}

/** Pure: the picture flags to show – not overtaken, on a field the page
 *  can edit, and with their prepared file still on the row – each with
 *  where it stands and that file. */
export function shownPictures(
  flags: PictureFlag[],
  nowOf: (field: string) => PictureNow | null | undefined,
  files: PreparedFile[],
  canEdit: (field: string) => boolean = () => true
): { flag: PictureFlag; state: 'open' | 'used'; file: PreparedFile }[] {
  const out: {
    flag: PictureFlag
    state: 'open' | 'used'
    file: PreparedFile
  }[] = []
  for (const flag of flags) {
    if (!canEdit(flag.field)) continue
    const file = preparedNamed(flag.to.file, flag.to.size, files)
    if (!file) continue
    const state = pictureState(flag, nowOf(flag.field))
    if (state !== 'gone') out.push({ flag, state, file })
  }
  return out
}

/** Pure: a flag's value as the page's editors hold values – text, a list
 *  as one comma-separated string, a tick as "true" / "false", empty as "". */
export function flagText(v: FlagValue): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

/** Pure: a flag's value as people read it. */
export function flagShown(v: FlagValue): string {
  if (v === null || v === '') return 'empty'
  if (v === true) return 'ticked'
  if (v === false) return 'unticked'
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'empty'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T00:00:00Z`)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    }
  }
  return String(v)
}

function asList(v: unknown): string[] {
  const items = Array.isArray(v) ? v : String(v ?? '').split(',')
  return items.map(x => String(x).trim()).filter(Boolean)
}

function asText(v: unknown): string {
  // An unticked box, an empty list and an empty field all read as nothing.
  if (v === null || v === undefined || v === false || v === 'false') return ''
  if (v === true) return 'true'
  if (Array.isArray(v)) return asList(v).join(', ')
  return String(v).replace(/\s+/g, ' ').trim()
}

/** Pure: whether two values of one field read the same – a record's own
 *  value (typed), an edit (text) or a flag's. Spacing does not count; the
 *  order of a list does (the first option of a multiple choice can decide
 *  where a listing sits). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = asList(a)
    const y = asList(b)
    return x.length === y.length && x.every((v, i) => v === y[i])
  }
  return asText(a) === asText(b)
}

/** open: the field still reads as it did when Fable flagged it. used: the
 *  page's edit holds Fable's value. gone: the field has moved on (edited by
 *  hand, changed on the record) – the flag no longer applies. */
export type FlagState = 'open' | 'used' | 'gone'

/** Pure: where one flag stands, given the record's value for its field and
 *  the page's edit for it (undefined: none). */
export function flagState(
  flag: FieldFlag,
  live: unknown,
  edit: string | undefined
): FlagState {
  if (edit !== undefined && sameValue(edit, flag.to)) return 'used'
  const now = edit !== undefined ? edit : live
  if (sameValue(now, flag.to)) return 'gone' // the record already says so
  return sameValue(now, flag.from) ? 'open' : 'gone'
}

/** Pure: the page's edits with these flags' values put in. Only flags
 *  still open move anything. */
export function withFlags(
  flags: FieldFlag[],
  live: Record<string, unknown>,
  edits: Record<string, string>
): Record<string, string> {
  const next = { ...edits }
  for (const f of flags) {
    if (flagState(f, live[f.field], edits[f.field]) === 'open') {
      next[f.field] = flagText(f.to)
    }
  }
  return next
}

/** Pure: the page's edits with one used flag taken back off – the field
 *  reads as it did before (the record's own value, or the earlier edit the
 *  flag was judged against). */
export function withoutFlag(
  flag: FieldFlag,
  live: Record<string, unknown>,
  edits: Record<string, string>
): Record<string, string> {
  const next = { ...edits }
  if (sameValue(live[flag.field], flag.from)) delete next[flag.field]
  else next[flag.field] = flagText(flag.from)
  return next
}

/** Pure: the flags to show – not overtaken, and on a field the page can
 *  edit – each with where it stands. */
export function shownFlags(
  flags: FieldFlag[],
  live: Record<string, unknown>,
  edits: Record<string, string>,
  canEdit: (field: string) => boolean = () => true
): { flag: FieldFlag; state: 'open' | 'used' }[] {
  const out: { flag: FieldFlag; state: 'open' | 'used' }[] = []
  for (const flag of flags) {
    if (!canEdit(flag.field)) continue
    const state = flagState(flag, live[flag.field], edits[flag.field])
    if (state !== 'gone') out.push({ flag, state })
  }
  return out
}

export interface DiffPart {
  kind: 'same' | 'cut' | 'new'
  text: string
}

/** Pure: a longer text change word by word – what was cut and what is new
 *  – so a reworded description can be read at a glance. Null when either
 *  side is not text, the texts are short (old → new reads fine), or they
 *  share too little for a word-by-word reading to help. */
export function wordDiff(from: FlagValue, to: FlagValue): DiffPart[] | null {
  if (typeof from !== 'string' || typeof to !== 'string') return null
  if (from.length < 60 || to.length < 60) return null
  const a = from.trim().split(/\s+/)
  const b = to.trim().split(/\s+/)
  // Longest common run of words, by the usual table.
  const rows = a.length + 1
  const cols = b.length + 1
  const lcs = new Uint16Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * cols + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * cols + j + 1] + 1
          : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1])
    }
  }
  if (lcs[0] * 2 < Math.min(a.length, b.length)) return null
  const parts: DiffPart[] = []
  const push = (kind: DiffPart['kind'], word: string) => {
    const last = parts[parts.length - 1]
    if (last && last.kind === kind) last.text += ` ${word}`
    else parts.push({ kind, text: word })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1]) {
      push('cut', a[i++])
    } else {
      push('new', b[j++])
    }
  }
  while (i < a.length) push('cut', a[i++])
  while (j < b.length) push('new', b[j++])
  return parts
}
