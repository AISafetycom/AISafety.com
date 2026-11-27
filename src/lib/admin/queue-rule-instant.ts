// A rule drafted minutes after the decision it came from (Bryce, 10 Nov
// 2026: "less friction if rules were to pop up at the time that they are
// created, because then I have the specific listing in mind already"). The
// Mac asks Fable for a rule as soon as he overrules it, rejects in his own
// words or edits a value (~/Queue/teach.py --instant), tests it on his past
// decisions, and stamps the Rule row's proposal `instant.ready`. The page
// then shows that rule once as a small card over whatever he is on.
//
// Since 17 Nov 2026 that is the only way a rule is suggested (Bryce, on 17
// waiting rules: "We really need all rule suggestions to be happening at the
// time of the decision which created it"). The page tells the Mac the moment
// a decision lands (agent /rule/draft) instead of waiting for its five-minute
// run, asks every few seconds whether the rule is written (/rule/status), and
// the Mac marks it ready as it is written: the card comes up while its test
// is still running, and the test fills in. A rule he doesn't answer there
// still waits on the Rules tab.
//
// A rule that changes what the site lists carries the sentence for the
// public listing policy in the same proposal (`public`), so one Apply covers
// both. The page records what he chose for that sentence under PUBLIC_KEY in
// the row's saved edits, and the Mac writes the sentence only when it reads
// "apply" there: public wording is never written unseen. He can retype the
// sentence on the card before he applies it (queue-rule-public.ts).

import { policyEditsOf, publicBoxText } from './queue-rule-public'

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
  /** What the card's edit box starts with: the words as they will be
   *  written on the page. Null when the card can't edit them
   *  (queue-rule-public.ts publicBoxText). */
  text: string | null
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
  const edits = policyEditsOf(v.edits)
  return {
    wording,
    was: text(v.was),
    text: edits ? publicBoxText(edits, wording) : null,
  }
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

/** What the Mac says of a decision it was asked to look for a rule in. */
export type RuleDraftState = 'drafting' | 'rule' | 'nothing' | 'error'

/** How long the page keeps asking about one decision. A draft takes one to
 *  four minutes; past this the Mac's own run has it, and the card still
 *  comes up on the page's next minute refresh. */
export const RULE_WATCH_MS = 15 * 60 * 1000

/** How often the page asks the Mac while a rule is being drafted. */
export const RULE_STATUS_MS = 4000

/** While a popped-up rule's test runs, how often the page reads the list
 *  again so the result fills in on the card. */
export const RULE_TEST_REFRESH_MS = 15000

/** The Mac's word on a decision, read loosely: anything unknown is still
 *  being drafted. */
export function ruleDraftStateOf(v: unknown): RuleDraftState {
  return v === 'rule' || v === 'nothing' || v === 'error' ? v : 'drafting'
}

/** The decisions to keep asking about, given what the Mac said of each
 *  (missing = not asked this time) and when each was decided on the page,
 *  plus the ones whose rule is now written (the page reads the list again
 *  for them). A decision whose look ended with no rule, or that has been
 *  watched for RULE_WATCH_MS, is let go. */
export function settleRuleWatch(
  watch: Readonly<Record<string, number>>,
  states: Readonly<Record<string, unknown>>,
  now: number
): { watch: Record<string, number>; written: string[] } {
  const next: Record<string, number> = {}
  const written: string[] = []
  for (const [id, since] of Object.entries(watch)) {
    const state = id in states ? ruleDraftStateOf(states[id]) : 'drafting'
    if (state === 'rule') written.push(id)
    else if (state === 'drafting' && now - since <= RULE_WATCH_MS)
      next[id] = since
  }
  return { watch: next, written }
}

/** True for a decision the Mac may learn a rule from: Publish or Reject on
 *  an addition or a change. The Mac decides whether it teaches anything. */
export function mayTeach(type: string, action: string): boolean {
  return (
    (type === 'Add' || type === 'Change') &&
    (action === 'accept' || action === 'reject')
  )
}
