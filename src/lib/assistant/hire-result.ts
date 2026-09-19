import type { CitationRef } from './types'

/** What the assistant found for a /hire question, tiered so the page can
 *  float its best matches and fold the rest.
 *
 *  `primaryCandidateIds` are the candidates from the FIRST candidate search
 *  the model ran this turn — its most on-target attempt, before any
 *  broadening. `otherCandidateIds` are candidates that only showed up in a
 *  later, broadened search (see tools.ts's "WHEN STUCK" guidance, which has
 *  the model broaden with a fresh search rather than widen the first one) —
 *  already excludes anything in `primaryCandidateIds`. When the first
 *  search came back empty, the first search that DIDN'T is treated as
 *  primary instead, so "no exact match, here's the closest" still floats
 *  something rather than folding everything.
 *
 *  This is a heuristic tied to how the model actually calls the tool, not a
 *  structured signal from it — a single search mixing exact and stretch
 *  matches in one call won't be split. */
export interface HireAssistantResult {
  primaryCandidateIds: string[]
  otherCandidateIds: string[]
  /** Focus areas / countries among the PRIMARY tier only, used to check the
   *  matching Focus/Location filter boxes — the folded "other" tier isn't
   *  reflected there, since it's explicitly the broader, secondary set. */
  focusAreas: string[]
  countries: string[]
}

function idsOf(listings: CitationRef[]): string[] {
  return listings.map(l => l.id.replace(/^candidate:/, ''))
}

function focusAreasOf(listings: CitationRef[]): string[] {
  return [
    ...new Set(
      listings.flatMap(l =>
        (l.meta.focusArea ?? '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      )
    ),
  ]
}

function countriesOf(listings: CitationRef[]): string[] {
  return [
    ...new Set(
      listings.map(l => l.meta.country).filter((v): v is string => Boolean(v))
    ),
  ]
}

/** Builds a HireAssistantResult from the turn's candidate search rounds, in
 *  the order the model ran them. Each round holds only the candidates that
 *  round newly returned (not already seen in an earlier round) — see
 *  HireAssistantSearch, which does that deduping as rounds come in. Pure. */
export function deriveHireResult(rounds: CitationRef[][]): HireAssistantResult {
  const primaryIndex = rounds.findIndex(round => round.length > 0)
  if (primaryIndex === -1) {
    return {
      primaryCandidateIds: [],
      otherCandidateIds: [],
      focusAreas: [],
      countries: [],
    }
  }
  const primary = rounds[primaryIndex]
  const other = rounds.slice(primaryIndex + 1).flat()
  return {
    primaryCandidateIds: idsOf(primary),
    otherCandidateIds: idsOf(other),
    focusAreas: focusAreasOf(primary),
    countries: countriesOf(primary),
  }
}
