/** Where a new listing sits on its page. Eight resource tables order their
 *  cards by a whole-number Sort field (Funding, Self-study, Communities,
 *  Media channels, Advisors, Projects, Founder toolkit, Recurring training),
 *  lowest first, with a record that has no Sort at the very top – which is
 *  where an addition landed until the Queue could place it (Bryce, 30 Sept
 *  2026: "we need a way of setting where in the list it's sorted to").
 *
 *  The page reads the published listings in the site's order and turns a
 *  chosen slot into a Sort value; accepting the addition makes room when
 *  that value is already taken. Pure, so the page and the server share it. */

/** One published listing, as the page lists it. */
export interface Placed {
  id: string
  name: string
  sort: number | null
  featured: boolean
}

/** The field every one of those tables keeps its order in. */
export const SORT_FIELD = 'Sort'

/** The slot (0 = top) a listing with this Sort takes among `order`: after
 *  every listing with a lower Sort and every one with none (Airtable puts
 *  those first), before the rest. A tie goes first, because accepting moves
 *  the listing that holds the value down one (roomFor). No Sort is the top. */
export function slotOf(order: Placed[], sort: number | null): number {
  if (sort === null) return 0
  return order.filter(p => p.sort === null || p.sort < sort).length
}

/** The Sort that puts a new listing at `slot` (0 = top, order.length =
 *  bottom), between the listings on either side of it: ten after the one
 *  above when the gap allows (the spacing the tables use), else halfway,
 *  else one after it – a value accepting frees by moving the next ones
 *  down (roomFor). Slots among the listings with no Sort count as the top
 *  of the numbered ones. */
export function sortForSlot(order: Placed[], slot: number): number {
  const s = Math.max(0, Math.min(slot, order.length))
  let above: number | null = null
  for (let i = s - 1; i >= 0; i--) {
    const v = order[i].sort
    if (v !== null) {
      above = v
      break
    }
  }
  let below: number | null = null
  for (let i = s; i < order.length; i++) {
    const v = order[i].sort
    if (v !== null) {
      below = v
      break
    }
  }
  if (above === null && below === null) return 10
  if (above === null) {
    const b = below as number
    if (b > 20) return b - 10
    if (b >= 2) return Math.floor(b / 2)
    return b
  }
  if (below === null) return above + 10
  const gap = below - above
  if (gap > 20) return above + 10
  if (gap >= 2) return above + Math.floor(gap / 2)
  return above + 1
}

/** The listings that move down one so `sort` is free for `self`: the one
 *  holding it and each one straight after with no gap (a new 1686 among
 *  1685, 1686, 1687, 1690 moves 1686 and 1687 to 1687 and 1688). Nothing
 *  when the value is free. */
export function roomFor(
  order: Placed[],
  sort: number,
  self?: string
): { id: string; name: string; sort: number }[] {
  const at = new Map<number, Placed[]>()
  for (const p of order) {
    if (p.id === self || p.sort === null) continue
    at.set(p.sort, [...(at.get(p.sort) ?? []), p])
  }
  const out: { id: string; name: string; sort: number }[] = []
  for (let n = sort; at.has(n); n++) {
    for (const p of at.get(n) ?? []) {
      out.push({ id: p.id, name: p.name, sort: n + 1 })
    }
  }
  return out
}

/** A Sort value as the page holds it (text, from an edit or the record)
 *  read back as a number; null for empty or anything that is not one. */
export function sortValue(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || !v.trim()) return null
  const n = Number(v.trim())
  return Number.isFinite(n) ? n : null
}
