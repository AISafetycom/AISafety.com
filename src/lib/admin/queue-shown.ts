// What a decision was made on, as a fingerprint.
//
// A Change row's proposed changes and a Rule row's edits can be rewritten
// while they wait (the chat, a Mac duty, anyone who can write the row). So
// that what is applied is what the person deciding saw, every item carries
// a fingerprint of them (`shown`), the page sends back the one of the item
// it showed with each decision, and the site refuses the decision (412) and
// reads the item again when the row no longer matches. The fingerprint that
// passed is kept on the decision's History entry (`shown`), so the Mac's
// worker, which writes an applied rule into its file minutes later, can
// refuse one whose edits changed after the decision.
//
// An addition has no changes to fingerprint: what Publish puts on the site
// is the unpublished record itself, which a chat (a teammate's or his own)
// can rewrite while he looks at it. Its fingerprint is taken over that
// record instead, as the page showed it (the last part of this file).
//
// The recipe is shared with the Mac (~/Queue), which must compute the same
// value from the same row, so it is spelled out here and both sides hold
// the same test vectors (queue-shown.test.ts):
//
//   shown = lowercase hex of SHA-256 over the UTF-8 bytes of canon(value)
//
//   value, for a Change row:
//     {"changes": C, "record": R, "table": T}
//       C = the Proposal's `changes` when it is a list, else [], each
//       change as it is, except a picture copied from a record, which is
//       taken with its `to` as null: that holds an Airtable link, which
//       the Mac renews while the item waits, and `copy_from` already says
//       which picture it is. A change is one of those when BOTH hold
//       (28 Nov 2026; until then any change with a `copy_from` key was):
//         its `field` is a string with "logo" or "image" in it, in any
//         case (PICTURE_FIELD_RE, the Mac's test too), and
//         its `copy_from` is an object whose `record` is a string that
//         is a record id (^rec[A-Za-z0-9]{14}$).
//       Every other change is taken exactly as it is, `copy_from` and
//       all: a `copy_from` on a description, or one that names no record,
//       hides nothing.
//       R, T = the row's Target record and Target table fields (the text
//       of each, or null when empty)
//   value, for a Rule row:
//     {"edits": E, "public": P}
//       E = the Proposal's `edits` when it is a list, else []
//       P = the Proposal's `public.edits` when that is a list, else []
//
//   canon(v), a JSON text with nothing left to choice:
//     null, true, false   as in JSON
//     a number            a whole number as its digits with no fraction or
//                         exponent (52.0 is 52, -0 is 0); any other number
//                         in its shortest form that reads back the same,
//                         as JavaScript and Python both print it between
//                         0.0001 and 10^21 (37.7749)
//     a string            in double quotes, escaping only " as \", \ as \\,
//                         and the characters below U+0020 as \b \f \n \r \t
//                         or \u00XX (lower-case hex); every other character
//                         as itself, never \u-escaped
//     a list              [ items in order, joined by "," ]
//     an object           { "key":value pairs joined by ",", the keys
//                         sorted by Unicode code point }, with no space
//                         anywhere
//
// In Python that is json.dumps(v, ensure_ascii=False, sort_keys=True,
// separators=(",", ":")) once every float that is a whole number has been
// turned into an int.
import { createHash } from 'node:crypto'
import { pageShowsField } from './queue-fields'
import { PICTURE_FIELD_RE } from './queue-prepared'

/** Unicode code point order, which is how Python sorts strings; the
 *  default sort here goes by UTF-16 units and differs past U+FFFF. */
function byCodePoint(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  for (let i = 0; i < x.length && i < y.length; i++) {
    const d = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0)
    if (d !== 0) return d
  }
  return x.length - y.length
}

/** `v` as canonical JSON (see the top of this file). */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'null'
    // JSON.stringify prints a whole number without a fraction, and any
    // other in its shortest form.
    return Object.is(v, -0) ? '0' : JSON.stringify(v)
  }
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter(k => o[k] !== undefined)
      .sort(byCodePoint)
      .map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`
  }
  return 'null'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null

const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/

/** A change that proposes a picture copied from a record (see the recipe
 *  at the top): the one kind whose `to` is left out of the fingerprint. */
function copiedPicture(c: unknown): boolean {
  if (!isRecord(c) || typeof c.field !== 'string') return false
  if (!PICTURE_FIELD_RE.test(c.field)) return false
  const from = c.copy_from
  return (
    isRecord(from) &&
    typeof from.record === 'string' &&
    RECORD_ID_RE.test(from.record)
  )
}

/** What the fingerprint covers on a row: the parsed Proposal and, for a
 *  change, the listing it is about. */
export interface ShownRow {
  type: string
  proposal: unknown
  targetTable?: unknown
  targetRecord?: unknown
}

/** The value a row's fingerprint is taken over; null for a row that has
 *  none (an addition: what it publishes is the record itself). */
export function shownValue(row: ShownRow): Record<string, unknown> | null {
  const p = isRecord(row.proposal) ? row.proposal : {}
  if (row.type === 'Change') {
    return {
      changes: list(p.changes).map(c =>
        // A copied picture: its link is renewed while the item waits.
        copiedPicture(c) ? { ...(c as object), to: null } : c
      ),
      record: text(row.targetRecord),
      table: text(row.targetTable),
    }
  }
  if (row.type === 'Rule') {
    return {
      edits: list(p.edits),
      public: isRecord(p.public) ? list(p.public.edits) : [],
    }
  }
  return null
}

/** The row's fingerprint: 64 hex characters, or null for a row that has
 *  none. */
export function shownOf(row: ShownRow): string | null {
  const value = shownValue(row)
  return value === null
    ? null
    : createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

// ─── An addition: the record the page showed ────────────────────────────────
//
// The site's own recipe, which the Mac never checks (it reads `shown` on
// marked rules and on changes a chat filed, nothing else):
//
//   shown = the same hash over canon({"fields": F, "record": R, "table": T})
//     F = the record's fields that the page shows, by name: every field
//       the page's two rules keep (queue-fields.ts: not Airtable's
//       bookkeeping, not a computed type) whose value the page is handed
//       (text, a number, a tick, a list of texts, or files) and that is not
//       empty. An empty field is left out, as Airtable itself leaves it
//       out of a record, so "empty" and "not there" read the same.
//       A file field counts as the ids of its files (or, for a file with
//       no id, its name and size): the links to them change with every
//       read and say nothing about which files they are.
//     R, T = the record's id and its table's id
//
// Computed fields are left out because some move by themselves (a formula
// on today's date), which would refuse a Publish nobody caused; anything a
// person or a chat can write is in.

/** One record as Airtable returned it, with what is known of its table. */
export interface ShownRecord {
  table: string
  record: string
  /** The record's fields by name, raw. */
  fields: Record<string, unknown>
  /** Each field's Airtable type by name; empty when the table's field
   *  list could not be read (then only the names rule applies, as on the
   *  page). */
  types: ReadonlyMap<string, string>
  /** Fields the page is never handed, whatever they hold (Publish?, Hide?). */
  never?: ReadonlySet<string>
}

function isFile(v: unknown): v is Record<string, unknown> {
  return isRecord(v) && typeof v.url === 'string'
}

/** A field's value as the fingerprint takes it; undefined for one the page
 *  is not handed, or an empty one. */
function shownFieldValue(v: unknown): unknown {
  if (typeof v === 'string') return v === '' ? undefined : v
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (v === true) return true
  if (!Array.isArray(v) || v.length === 0) return undefined
  if (v.every(x => typeof x === 'string')) return v
  if (v.every(isFile)) {
    return v.map(f =>
      typeof f.id === 'string' && f.id
        ? f.id
        : [
            typeof f.filename === 'string' ? f.filename : null,
            typeof f.size === 'number' ? f.size : null,
          ]
    )
  }
  return undefined
}

/** The value an addition's fingerprint is taken over. */
export function shownRecordValue(r: ShownRecord): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(r.fields)) {
    if (r.never?.has(name)) continue
    if (!pageShowsField(name, r.types.get(name))) continue
    const value = shownFieldValue(raw)
    if (value !== undefined) fields[name] = value
  }
  return { fields, record: r.record, table: r.table }
}

/** An addition's fingerprint: its record as the page shows it. */
export function shownOfRecord(r: ShownRecord): string {
  return createHash('sha256')
    .update(canonicalJson(shownRecordValue(r)), 'utf8')
    .digest('hex')
}

/** A fingerprint as this file makes them. */
export function isShown(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
}
