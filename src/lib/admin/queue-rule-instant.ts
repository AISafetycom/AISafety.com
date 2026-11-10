// A rule drafted minutes after the decision it came from (Bryce, 10 Nov
// 2026: "less friction if rules were to pop up at the time that they are
// created, because then I have the specific listing in mind already"). The
// Mac asks Fable for a rule as soon as he overrules it, rejects in his own
// words or edits a value (~/Queue/teach.py --instant), tests it on his past
// decisions, and stamps the Rule row's proposal `instant.ready`. The page
// then shows that rule once as a small card over whatever he is on.
//
// A rule that changes what the site lists carries the sentence for the
// public listing policy in the same proposal (`public`), so one Apply covers
// both. The page records what he chose for that sentence under PUBLIC_KEY in
// the row's saved edits, and the Mac writes the sentence only when it reads
// "apply" there: public wording is never written unseen.

/** Where an instantly drafted rule came from. */
export interface RuleInstant {
  /** The Queue row of the decision. */
  from: string
  /** That row's listing, as he saw it. */
  listing: string | null
  page: string | null
  /** When the Mac marked the rule ready to show (tested, or the test is
   *  overdue); null until then. */
  ready: string | null
}

/** The sentence(s) for aisafety.com/listing-policy that go in with a rule. */
export interface RulePublic {
  wording: string
  was: string | null
}

/** The key in a Rule row's saved edits (JSON) that holds his choice on the
 *  public wording; never a field name. */
export const PUBLIC_KEY = '(public)'

/** apply = the sentence goes on the public page with the rule · internal =
 *  the rule applies and the public page stays as it is. */
export type PublicChoice = 'apply' | 'internal'

/** How long after it is ready a rule may still pop up. Later than that the
 *  listing is no longer on his mind, and the rule waits on the Rules tab. */
export const POP_UP_FOR_MS = 60 * 60 * 1000

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** The proposal's `instant` block, or null for a rule from the nightly pass
 *  (or an unreadable block). */
export function ruleInstantOf(v: unknown): RuleInstant | null {
  if (!isRecord(v)) return null
  const from = text(v.from)
  if (!from) return null
  return {
    from,
    listing: text(v.listing),
    page: text(v.page),
    ready: text(v.ready),
  }
}

/** The proposal's `public` block as the card shows it, or null when the rule
 *  brings no public wording. A block with no edits changes nothing, so it
 *  counts as none. */
export function rulePublicOf(v: unknown): RulePublic | null {
  if (!isRecord(v)) return null
  const wording = text(v.wording)
  if (!wording || !Array.isArray(v.edits) || v.edits.length === 0) return null
  return { wording, was: text(v.was) }
}

/** His saved choice on the public wording, or null when none was recorded. */
export function publicChoiceOf(v: unknown): PublicChoice | null {
  return v === 'apply' || v === 'internal' ? v : null
}

/** What the page needs of an item to pick the rule to pop up. */
export interface PopUpCandidate {
  id: string
  type: string
  status: string
  ruleInstant: RuleInstant | null
}

/** The rule to pop up now, or null: a waiting rule the Mac marked ready
 *  within the last hour that he has not been shown and closed, the one
 *  ready longest first. A rule whose decision is open again (he pressed
 *  Undo) is left out; the Mac withdraws it within minutes. */
export function ruleToPopUp<T extends PopUpCandidate>(
  items: readonly T[],
  closed: ReadonlySet<string>,
  now: number
): T | null {
  const open = new Set(
    items
      .filter(
        i =>
          i.status === 'Pending' ||
          i.status === 'Revising' ||
          i.status === 'Failed'
      )
      .map(i => i.id)
  )
  let best: T | null = null
  let bestAt = Infinity
  for (const item of items) {
    if (item.type !== 'Rule' || item.status !== 'Pending') continue
    const ready = item.ruleInstant?.ready
    if (!ready || closed.has(item.id)) continue
    const at = Date.parse(ready)
    if (Number.isNaN(at) || at > now || now - at > POP_UP_FOR_MS) continue
    if (open.has(item.ruleInstant?.from ?? '')) continue
    if (at < bestAt) {
      best = item
      bestAt = at
    }
  }
  return best
}

/** The rules he has been shown and closed, as kept in the browser: the
 *  newest `keep`, so the list never grows without end. */
export function rememberClosed(
  closed: readonly string[],
  id: string,
  keep = 100
): string[] {
  return [...closed.filter(x => x !== id), id].slice(-keep)
}
