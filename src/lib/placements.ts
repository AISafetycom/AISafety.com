// Shared, dependency-free helper for tagging a resource-page listing with the
// slot it sits in, so a click can be stamped with the rank that produced it.
// Kept in its own module (no server-only imports) so client components can use
// it without pulling Airtable/Node code into the browser bundle.

/** A listing that may be one of the two featured cards on a resource page. */
interface Placeable {
  id: string
  featured?: string | number | null
}

/** Each listing's slot on its page, keyed by record id: the featured cards
 *  (if the page has them) are 'F<rank>'; everything else is numbered '1', '2',
 *  '3'… in display order. Pages without featured cards just get the numbered
 *  list. Pass items in the order they render so the slot matches what the
 *  visitor saw.
 *
 *  Pages with a featured queue (/events, /training) pass `featured` — the
 *  cards their row actually displays, in display order — since a queued
 *  backup (rank 3+) renders as a normal grid card and must get a grid
 *  number, not an F-slot. A queued entry is stamped with its rank; a random
 *  stand-in has no rank, so it's stamped with its position in the row, like
 *  any other featured card. Without `featured`, ranks 1 and 2 count as
 *  featured (the fixed-slot pages). */
export function placementsById(
  items: Placeable[],
  featured?: Placeable[]
): Map<string, string> {
  const placements = new Map<string, string>()
  featured?.forEach((item, i) => {
    placements.set(item.id, `F${item.featured ?? i + 1}`)
  })
  let n = 0
  for (const item of items) {
    if (placements.has(item.id)) continue
    if (!featured && (item.featured === '1' || item.featured === '2')) {
      placements.set(item.id, `F${item.featured}`)
    } else {
      n += 1
      placements.set(item.id, String(n))
    }
  }
  return placements
}

/** The listings the grid below the featured row should render.
 *
 *  With no filter active the featured cards stay out of the grid: they
 *  already sit in the featured row just above, and seeing the same program
 *  twice on a fresh page load read as a mistake to visitors (feedback,
 *  September 2026). The moment any filter is on they come back, so a
 *  filtered grid is complete — someone narrowing to "Fellowship" must find
 *  the featured fellowship too, and by then the featured row may have
 *  scrolled out of view anyway. Nothing else moves: the grid keeps its
 *  full-order numbering and the featured cards keep their F-slots, so
 *  click analytics read the same either way.
 *
 *  `placements` is the page's placementsById() map — a card is featured
 *  when its slot is an F-slot, which covers both the fixed-slot pages
 *  (ranks 1 and 2) and the queue pages (whatever the row displays,
 *  random stand-ins included). */
export function gridListings<T extends { id: string }>(
  items: T[],
  placements: Map<string, string>,
  filtering: boolean
): T[] {
  if (filtering) return items
  return items.filter(item => !placements.get(item.id)?.startsWith('F'))
}
