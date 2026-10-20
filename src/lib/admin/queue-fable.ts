// What Fable changed on a Queue item's own listing straight in Airtable from
// the chat. The Mac reads the record before and after each reply and puts
// the difference on the reply as `changed`; the page lists it with the
// item's changed fields (Bryce, 4 Oct 2026: "when I ask Fable to change
// something and it does, that should be reflected in the changed fields
// thing").

/** One field Fable changed: what it held before, what it holds now. */
export interface FableChange {
  field: string
  from: unknown
  to: unknown
}

/** Pictures by their Airtable ids (the links change on every read). */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (
      Array.isArray(v) &&
      v.length > 0 &&
      v.every(x => typeof x === 'object' && x !== null && 'id' in x)
    ) {
      return v.map(x => (x as { id: unknown }).id)
    }
    return v === '' || v === false || (Array.isArray(v) && !v.length)
      ? null
      : (v ?? null)
  }
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

/** Every field the thread's replies changed: what it was before the first
 *  change, what it is after the last. A field changed and then changed
 *  back drops out. */
export function fableChangesOf(
  list: { changed?: FableChange[] }[]
): FableChange[] {
  const out = new Map<string, FableChange>()
  for (const m of list) {
    for (const c of m.changed ?? []) {
      const was = out.get(c.field)
      out.set(c.field, {
        field: c.field,
        from: was ? was.from : c.from,
        to: c.to,
      })
    }
  }
  return [...out.values()].filter(c => !sameValue(c.from, c.to))
}

/** On a decided item, the fields of a reply's ```edits block whose value is
 *  the one the row saved, and the decision wrote to the listing. Values are
 *  compared as the page's editors hold them (text, a list as one
 *  comma-separated string), ignoring spaces at the ends and around commas. */
export function wentOut(
  proposed: Record<string, string>,
  sent: Record<string, string>
): string[] {
  const norm = (s: string) => s.trim().replace(/\s*,\s*/g, ', ')
  return Object.keys(proposed).filter(
    k => k in sent && norm(sent[k]) === norm(proposed[k])
  )
}

/** What became of an edits card on a decided item, in one line: it went
 *  out with the decision ("Publish"), it was not applied, or some of each
 *  (8 Oct 2026: a decided item's cards all said "The suggested edits name
 *  fields the page cannot change", though Fable's Description had gone out
 *  with Publish). */
export function wentOutNote(
  fields: string[],
  went: string[],
  label: string
): string {
  const left = fields.filter(k => !went.includes(k))
  if (left.length === 0) return `Went out with ${label}`
  if (went.length === 0) return 'Not applied'
  return `${listed(went)} went out with ${label}; ${listed(left)} ${
    left.length === 1 ? 'was' : 'were'
  } not applied`
}

/** "A", "A and B", "A, B, and C". */
function listed(names: string[]): string {
  if (names.length < 3) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}
