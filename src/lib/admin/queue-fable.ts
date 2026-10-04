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
