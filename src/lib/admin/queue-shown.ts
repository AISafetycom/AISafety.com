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
// The recipe is shared with the Mac (~/Queue), which must compute the same
// value from the same row, so it is spelled out here and both sides hold
// the same test vectors (queue-shown.test.ts):
//
//   shown = lowercase hex of SHA-256 over the UTF-8 bytes of canon(value)
//
//   value, for a Change row:
//     {"changes": C, "record": R, "table": T}
//       C = the Proposal's `changes` when it is a list, else [], each
//       change as it is, except that one with a `copy_from` key (a
//       picture copied from elsewhere) is taken with its `to` as null:
//       that holds an Airtable link, which the Mac renews while the item
//       waits, and `copy_from` already says which picture it is
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
        isRecord(c) && 'copy_from' in c ? { ...c, to: null } : c
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

/** A fingerprint as this file makes them. */
export function isShown(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
}
