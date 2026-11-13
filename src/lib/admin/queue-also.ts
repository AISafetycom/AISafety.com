// More than one person behind an item (Bryce, 24 Oct 2026, Mercial Research
// Fellowship: November 2026). Lachlan sent the round in through the Training
// form and Matt asked through Suggest a Correction to get it online; both
// became one item, and Accept saved a reply for Matt only. The Mac now keeps
// everyone after the item's own person in the proposal's `also_reply` (blocks
// shaped like `reply`) and saves each of them a draft in their own Gmail
// thread on Accept or Reject. The page names them all beside the draft.

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/** The proposal's `also_reply` blocks as "name <address>" or "address". */
export function replyAlsoOf(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter(isRecord).flatMap(b => {
    const to = typeof b.to === 'string' ? b.to.trim() : ''
    const who = typeof b.name === 'string' ? b.name.trim() : ''
    return to ? [who ? `${who} <${to}>` : to] : []
  })
}

/** Who a reply draft goes to, for its heading: "A", "A and B",
 *  "A, B, and C". Null when the item has no one to reply to. */
export function replyWho(item: {
  replyTo: string | null
  replyAlso: string[]
}): string | null {
  if (!item.replyTo) return null
  const all = [item.replyTo, ...item.replyAlso]
  return all.length <= 2
    ? all.join(' and ')
    : `${all.slice(0, -1).join(', ')}, and ${all.at(-1)}`
}
