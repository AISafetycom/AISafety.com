/** The dates under the dashboard's charts (the Org lookup's ClicksChart and
 *  the tiles' TrendChart): which columns get one, what each says, and which
 *  ones a narrower chart drops so they never collide. Works the same for
 *  per-day and per-week columns, and for hours (chartHourLabels). */

/** Roughly how many dates a full-width chart shows. */
export const DATE_LABEL_TARGET = 13

/** The top of the chart's scale: the smallest round number at or above the
 *  busiest column (0 stays 0), from 1, 1.5, 2, 2.5, 3, 4, 5, 6 and 8 × 10ⁿ,
 *  so the tallest bar always fills at least two thirds of the height (211 →
 *  250, where 1, 2 and 5 alone gave 500 and less than half). */
export function scaleTop(max: number): number {
  if (max <= 0) return 0
  const p = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8])
    if (m * p >= max) return m * p
  return 10 * p
}

/** A full-width chart shows every label, a narrower one every 2nd, a
 *  phone-width one every 4th and the narrowest phones every 8th, always
 *  counting back from the newest so the last column keeps its date. */
export type LabelThinning = 1 | 2 | 4 | 8

const THINNINGS: readonly LabelThinning[] = [1, 2, 4, 8]

export type ChartDateLabel = {
  /** The column it sits under, from 0 (the oldest). */
  index: number
  /** "3 Oct": the day, then the month. */
  text: string
  /** "2027" when the label carries its year at some width, else null. */
  year: string | null
  /** The sparsest thinning that still shows it: 8 stays at every width, 4
   *  hides on the narrowest phones, 2 on a phone-width chart, and 1 shows
   *  only on a full-width one. */
  keep: LabelThinning
  /** The year shows once the chart thins to this or sparser (1 means at
   *  every width). Null when `year` is. */
  yearFrom: LabelThinning | null
}

/** Columns between labels: about DATE_LABEL_TARGET labels across the chart
 *  (90 days → every 7th, 30 → every 3rd, 7 → each one). */
export function labelStep(columns: number): number {
  return Math.max(1, Math.ceil(columns / DATE_LABEL_TARGET))
}

/** The labels for a series whose columns start on these days ('YYYY-MM-DD',
 *  oldest first), in column order. The newest column is always labeled and
 *  the rest step back from it, so neighbors are exactly labelStep() apart.
 *  A label carries its year when the label before it is in another year, or
 *  when it is the first one shown and the series crosses into a new year;
 *  that is worked out for each thinning, since a narrower chart may hide the
 *  label that carried it. */
export function chartDateLabels(days: readonly string[]): ChartDateLabel[] {
  const n = days.length
  if (n === 0) return []
  const step = labelStep(n)
  const indices: number[] = []
  for (let i = n - 1; i >= 0; i -= step) indices.unshift(i)
  const parsed = indices.map(i => parseDay(days[i]))
  const spansYears = parseDay(days[0]).year !== parseDay(days[n - 1]).year
  const last = indices.length - 1
  return indices.map((index, k) => {
    const fromEnd = last - k
    const keep: LabelThinning =
      fromEnd % 8 === 0 ? 8 : fromEnd % 4 === 0 ? 4 : fromEnd % 2 === 0 ? 2 : 1
    const { year, month, day } = parsed[k]
    // At thinning t the label shown before this one is t labels back. Once
    // the year shows at one thinning it shows at every sparser one too (the
    // label before is only further back), so the first match is enough.
    const yearFrom =
      THINNINGS.find(
        t => t <= keep && (k < t ? spansYears : parsed[k - t].year !== year)
      ) ?? null
    return {
      index,
      text: `${day} ${MONTHS[month - 1]}`,
      year: yearFrom == null ? null : String(year),
      keep,
      yearFrom,
    }
  })
}

/** The labels for a series of hours (epoch ms, oldest first; Today on the
 *  trend charts): "09:00", UTC, picked and thinned the same way as days. */
export function chartHourLabels(hours: readonly number[]): ChartDateLabel[] {
  const n = hours.length
  if (n === 0) return []
  const step = labelStep(n)
  const indices: number[] = []
  for (let i = n - 1; i >= 0; i -= step) indices.unshift(i)
  const last = indices.length - 1
  return indices.map((index, k) => {
    const fromEnd = last - k
    const keep: LabelThinning =
      fromEnd % 8 === 0 ? 8 : fromEnd % 4 === 0 ? 4 : fromEnd % 2 === 0 ? 2 : 1
    const hour = new Date(hours[index]).getUTCHours()
    return {
      index,
      text: `${String(hour).padStart(2, '0')}:00`,
      year: null,
      keep,
      yearFrom: null,
    }
  })
}

/** American abbreviations, so September is "Sep" (en-GB would write
 *  "Sept"). */
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function parseDay(day: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  const month = m ? Number(m[2]) : 0
  if (!m || month < 1 || month > 12)
    throw new Error(`Chart date "${day}" isn't a YYYY-MM-DD day`)
  return { year: Number(m[1]), month, day: Number(m[3]) }
}
