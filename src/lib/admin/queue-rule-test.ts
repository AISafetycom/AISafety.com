// The test the Mac runs on each proposed rule before Bryce decides it: Fable
// replays the rule over his past decisions on the items that bot proposed
// and says which ones it would have changed (~/Queue/replay.py, 9 Oct 2026 –
// Mick Zijdel's idea, "some kind of eval validation loop … to test the new
// rules"). It rides on the Rule row's proposal as `replay`; a rule rewritten
// from the chat loses it and is tested again within minutes.

/** fixes = the bot got his call wrong and the rule would have got it right ·
 *  breaks = the rule would have gone against his call · keeps = the rule
 *  applies and his call stands · unclear = what the Queue holds can't say. */
export type RuleTestOutcome = 'breaks' | 'unclear' | 'fixes' | 'keeps'

const OUTCOMES: readonly RuleTestOutcome[] = [
  'breaks',
  'unclear',
  'fixes',
  'keeps',
]

export const OUTCOME_LABEL: Record<RuleTestOutcome, string> = {
  breaks: 'Goes against you',
  unclear: 'Can’t tell',
  fixes: 'Fixes',
  keeps: 'Same as you',
}

export interface RuleTestResult {
  /** The Queue row of the past decision. */
  row: string
  title: string
  outcome: RuleTestOutcome
  /** One plain sentence: what the bot would have done with the rule. */
  why: string
  /** One of the decisions the rule was written from. */
  taught: boolean
}

export interface RuleTest {
  /** How many past decisions it was tested on. */
  checked: number
  /** What they were, e.g. "your past decisions on /events additions". */
  pool: string
  counts: Record<RuleTestOutcome, number>
  /** Only the decisions the rule touches, "Goes against you" first. */
  results: RuleTestResult[]
  /** Fable's one-line take on whether the rule is safe to accept. */
  summary: string | null
  at: string | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function isOutcome(v: unknown): v is RuleTestOutcome {
  return typeof v === 'string' && (OUTCOMES as readonly string[]).includes(v)
}

/** The proposal's `replay` block as the card shows it, or null when the
 *  rule hasn't been tested (or the block is unreadable). */
export function ruleTestOf(v: unknown): RuleTest | null {
  if (!isRecord(v)) return null
  const checked = typeof v.checked === 'number' ? v.checked : null
  const pool = text(v.pool)
  if (checked === null || checked < 0 || !pool) return null
  const results: RuleTestResult[] = []
  for (const r of Array.isArray(v.results) ? v.results : []) {
    if (!isRecord(r) || !isOutcome(r.outcome)) continue
    const row = text(r.row)
    const why = text(r.why)
    if (!row || !why) continue
    results.push({
      row,
      title: text(r.title) ?? '(untitled)',
      outcome: r.outcome,
      why,
      taught: r.taught === true,
    })
  }
  results.sort(
    (a, b) =>
      OUTCOMES.indexOf(a.outcome) - OUTCOMES.indexOf(b.outcome) ||
      Number(b.taught) - Number(a.taught)
  )
  // Counted from the results the page will list, so the line and the list
  // can never disagree.
  const counts = { breaks: 0, unclear: 0, fixes: 0, keeps: 0 }
  for (const r of results) counts[r.outcome] += 1
  return {
    checked,
    pool,
    counts,
    results,
    summary: text(v.summary),
    at: text(v.at),
  }
}

const WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]

/** Numbers as words up to ten, the way the rest of the Queue writes them. */
function count(n: number): string {
  return WORDS[n] ?? String(n)
}

/** The card's one line: what the test found, in plain words. */
export function ruleTestHeadline(t: RuleTest): string {
  if (t.checked === 0) return 'There are no past decisions to test it on yet.'
  const { fixes, breaks, unclear } = t.counts
  const parts: string[] = []
  if (fixes) parts.push(`fixes ${count(fixes)} the bots got wrong`)
  parts.push(
    breaks ? `goes against you on ${count(breaks)}` : 'never goes against you'
  )
  let line = `Tested on ${t.checked} of ${t.pool}: it ${parts.join(' and ')}`
  if (unclear)
    line += `; ${count(unclear)} ${unclear === 1 ? 'is' : 'are'} unclear`
  return `${line}.`
}
