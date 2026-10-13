import { describe, expect, it } from 'vitest'
import {
  type ChartDateLabel,
  type LabelThinning,
  chartDateLabels,
  labelStep,
} from './chart-dates'

const DAY_MS = 86_400_000

/** `n` consecutive days (or weeks, with `every` 7) ending on `last`. */
function series(last: string, n: number, every = 1): string[] {
  const end = Date.parse(`${last}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) =>
    new Date(end - (n - 1 - i) * every * DAY_MS).toISOString().slice(0, 10)
  )
}

/** What a chart thinned to every `t`th label shows, years included. */
function shown(labels: ChartDateLabel[], t: LabelThinning): string[] {
  return labels
    .filter(l => l.keep >= t)
    .map(l =>
      l.yearFrom != null && l.yearFrom <= t ? `${l.text} ${l.year}` : l.text
    )
}

const indices = (labels: ChartDateLabel[]) => labels.map(l => l.index)

describe('labelStep', () => {
  it('aims for about 13 labels', () => {
    expect(labelStep(91)).toBe(7)
    expect(labelStep(90)).toBe(7)
    expect(labelStep(92)).toBe(8)
    expect(labelStep(31)).toBe(3)
    expect(labelStep(30)).toBe(3)
    expect(labelStep(14)).toBe(2)
    expect(labelStep(13)).toBe(1)
    expect(labelStep(7)).toBe(1)
    expect(labelStep(1)).toBe(1)
    expect(labelStep(0)).toBe(1)
  })
})

describe('chartDateLabels', () => {
  it('has nothing to label in an empty series', () => {
    expect(chartDateLabels([])).toEqual([])
  })

  it('labels a single column', () => {
    expect(chartDateLabels(['2026-10-13'])).toEqual([
      { index: 0, text: '13 Oct', year: null, keep: 8, yearFrom: null },
    ])
  })

  it('labels every column of a short series', () => {
    expect(indices(chartDateLabels(series('2026-10-13', 2)))).toEqual([0, 1])
    const week = chartDateLabels(series('2026-10-13', 7))
    expect(indices(week)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(shown(week, 1)).toEqual([
      '7 Oct',
      '8 Oct',
      '9 Oct',
      '10 Oct',
      '11 Oct',
      '12 Oct',
      '13 Oct',
    ])
  })

  it('steps back from the newest column', () => {
    expect(indices(chartDateLabels(series('2026-10-13', 14)))).toEqual([
      1, 3, 5, 7, 9, 11, 13,
    ])
    expect(indices(chartDateLabels(series('2026-10-13', 30)))).toEqual([
      2, 5, 8, 11, 14, 17, 20, 23, 26, 29,
    ])
    expect(indices(chartDateLabels(series('2026-10-13', 31)))).toEqual([
      0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30,
    ])
    expect(indices(chartDateLabels(series('2026-10-13', 92)))).toEqual([
      3, 11, 19, 27, 35, 43, 51, 59, 67, 75, 83, 91,
    ])
  })

  it('labels a 91-day range weekly, ending on the last day', () => {
    const labels = chartDateLabels(series('2026-10-13', 91))
    expect(indices(labels)).toEqual([
      6, 13, 20, 27, 34, 41, 48, 55, 62, 69, 76, 83, 90,
    ])
    expect(shown(labels, 1)).toEqual([
      '21 Jul',
      '28 Jul',
      '4 Aug',
      '11 Aug',
      '18 Aug',
      '25 Aug',
      '1 Sep',
      '8 Sep',
      '15 Sep',
      '22 Sep',
      '29 Sep',
      '6 Oct',
      '13 Oct',
    ])
  })

  it('thins out from the newest label, which always stays', () => {
    const labels = chartDateLabels(series('2026-10-13', 91))
    expect(labels.map(l => l.keep)).toEqual([
      4, 1, 2, 1, 8, 1, 2, 1, 4, 1, 2, 1, 8,
    ])
    expect(shown(labels, 2)).toEqual([
      '21 Jul',
      '4 Aug',
      '18 Aug',
      '1 Sep',
      '15 Sep',
      '29 Sep',
      '13 Oct',
    ])
    expect(shown(labels, 4)).toEqual(['21 Jul', '18 Aug', '15 Sep', '13 Oct'])
    expect(shown(labels, 8)).toEqual(['18 Aug', '13 Oct'])
    // Even when the count doesn't divide evenly.
    const short = chartDateLabels(series('2026-10-13', 30))
    expect(shown(short, 4)).toEqual(['19 Sep', '1 Oct', '13 Oct'])
  })

  it('labels weekly columns the same way, in weeks', () => {
    const twenty = chartDateLabels(series('2026-10-12', 20, 7))
    expect(indices(twenty)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19])
    expect(shown(twenty, 1).at(-1)).toBe('12 Oct')

    const sixty = chartDateLabels(series('2026-10-12', 60, 7))
    expect(indices(sixty)).toEqual([
      4, 9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59,
    ])
    expect(shown(sixty, 1)).toEqual([
      '22 Sep 2025',
      '27 Oct',
      '1 Dec',
      '5 Jan 2026',
      '9 Feb',
      '16 Mar',
      '20 Apr',
      '25 May',
      '29 Jun',
      '3 Aug',
      '7 Sep',
      '12 Oct',
    ])
  })

  it('adds the year where it changes, at every thinning', () => {
    const labels = chartDateLabels(series('2027-02-12', 90))
    expect(shown(labels, 1)).toEqual([
      '20 Nov 2026',
      '27 Nov',
      '4 Dec',
      '11 Dec',
      '18 Dec',
      '25 Dec',
      '1 Jan 2027',
      '8 Jan',
      '15 Jan',
      '22 Jan',
      '29 Jan',
      '5 Feb',
      '12 Feb',
    ])
    expect(shown(labels, 2)).toEqual([
      '20 Nov 2026',
      '4 Dec',
      '18 Dec',
      '1 Jan 2027',
      '15 Jan',
      '29 Jan',
      '12 Feb',
    ])
    // "1 Jan" is hidden here, so the next label shown carries the year.
    expect(shown(labels, 4)).toEqual([
      '20 Nov 2026',
      '18 Dec',
      '15 Jan 2027',
      '12 Feb',
    ])
  })

  it('dates the first label when the series crosses a new year', () => {
    // Starts on 31 December, but the first label lands on 1 January.
    expect(shown(chartDateLabels(series('2027-01-13', 14)), 1)).toEqual([
      '1 Jan 2027',
      '3 Jan',
      '5 Jan',
      '7 Jan',
      '9 Jan',
      '11 Jan',
      '13 Jan',
    ])
  })

  it('keeps its promises for every series length', () => {
    for (let n = 1; n <= 200; n++) {
      const labels = chartDateLabels(series('2026-10-13', n))
      const step = labelStep(n)
      expect(labels.at(-1)!.index).toBe(n - 1)
      expect(labels.at(-1)!.keep).toBe(8)
      expect(labels.length).toBeLessThanOrEqual(13)
      if (n >= 7) expect(labels.length).toBeGreaterThanOrEqual(7)
      for (let k = 1; k < labels.length; k++)
        expect(labels[k].index - labels[k - 1].index).toBe(step)
      expect(labels[0].index).toBeLessThan(step)
    }
  })

  it('refuses a day that is not YYYY-MM-DD', () => {
    expect(() => chartDateLabels(['2026-10-13', '13 Oct'])).toThrow(
      /isn't a YYYY-MM-DD day/
    )
    expect(() => chartDateLabels(['2026-13-01'])).toThrow()
  })
})
