/** Warm-up switch and wave timing, shared by the approval step
 *  (src/lib/admin/newsletter.ts), the send watcher
 *  (src/lib/admin/newsletter-watch.ts) and the approval page. No imports:
 *  the page loads this file too. From the first real sends (8 October
 *  2026): while the warm-up is on, a send to list 6, 7 or 8 with more than
 *  MAX_UNSEGMENTED_SEND active contacts must go out in waves (AC segments),
 *  never to the whole list in one go. */
export const NEWSLETTER_WARMUP = true
export const MAX_UNSEGMENTED_SEND = 50

/* ─── Approve once (8 October 2026) ───────────────────────────────────────
   One approval schedules every wave still to go: the first one
   sendDelayMinutes after the press (or later, see below), each later one
   WAVE_SPACING_HOURS after the one before it starts. The send watcher judges
   each wave 18 hours after it finished and cancels the waves still scheduled
   after it when the verdict is red, or when a wave is about to start and the
   one before it has no verdict. */

/** Real lists: each wave starts this long after the one before it. */
export const WAVE_SPACING_HOURS = 24
/** Test lists 4/5 (Bryce's aliases): ten minutes, so a live test of the
 *  whole run finishes in an hour. Also the gap after a finished wave there,
 *  since the watcher never judges a test list. */
export const WAVE_SPACING_MINUTES_TEST = 10

/** The lists whose waves the send watcher judges 18 hours after they finish
 *  (Events and Training: the lists the imported readers are on). Only their
 *  waves wait for a verdict; Funding's would go on their schedule. */
export const HEALTH_CHECK_LISTS: readonly string[] = ['6', '7']

/** The watcher cancels a wave (and every later one) that starts within this
 *  many minutes while the wave before it has no verdict. */
export const FAIL_CLOSED_MINUTES = 60

/** While the previous wave's verdict isn't in, the first wave of an approval
 *  starts no sooner than this many minutes after that wave's 18 hours are
 *  up: the watcher works the verdict out on its first run after the 18 hours
 *  (it runs every 10 minutes), which leaves it time to be in before the
 *  FAIL_CLOSED_MINUTES window opens. */
export const VERDICT_LEAD_MINUTES = 90

/** One wave of an approval and when it starts (epoch ms). */
export interface WaveSlot {
  wave: number
  startsAt: number
}

/** Pure: when each wave of an approval starts. `from` = the first wave it
 *  schedules (the next one), `waves` = how many the list has (N); `now` and
 *  every time are epoch ms. `notBefore` = the earliest the first wave may
 *  start (null: no earlier wave, or nothing holds it): the first goes at
 *  whichever is later, `now + delayMs` or `notBefore`, and each later wave
 *  `spacingMs` after the one before it. */
export function waveSchedule(p: {
  from: number
  waves: number
  now: number
  notBefore: number | null
  delayMs: number
  spacingMs: number
}): WaveSlot[] {
  const first = Math.max(p.now + p.delayMs, p.notBefore ?? -Infinity)
  const out: WaveSlot[] = []
  for (let wave = p.from; wave <= p.waves; wave++)
    out.push({ wave, startsAt: first + (wave - p.from) * p.spacingMs })
  return out
}

/** Pure: "waves 2–4", or "wave 4" for one. */
export function wavesLabel(from: number, to: number): string {
  return from === to ? `wave ${from}` : `waves ${from}–${to}`
}
