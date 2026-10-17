import { describe, expect, it } from 'vitest'
import { datedRoundsByProgram, type RoundCandidate } from './dated-rounds'

let n = 0
const program = (
  name: string,
  url = 'https://example.org/'
): RoundCandidate => ({
  id: `training:p${++n}`,
  type: 'training',
  name,
  url,
  meta: { recurring: 'Yes' },
})
const round = (name: string, url = 'https://example.org/'): RoundCandidate => ({
  id: `training:r${++n}`,
  type: 'training',
  name,
  url,
  meta: { startDate: '2027-01-10' },
})

/** Names of the rounds matched to `p`. */
function roundsOf(p: RoundCandidate, listings: RoundCandidate[]): string[] {
  return (datedRoundsByProgram(listings).get(p.id) ?? []).map(r => r.name)
}

describe('datedRoundsByProgram', () => {
  it("matches a round named after the program's full name", () => {
    const aisb = program('AI Security Bootcamp (AISB)', 'https://aisb.dev/')
    const london = round(
      'AI Security Bootcamp (AISB): London, December 2026',
      'https://aisb.dev/2026/dec/london'
    )
    expect(roundsOf(aisb, [aisb, london])).toEqual([london.name])
  })

  it('matches on the part of the name before a bracket', () => {
    const mats = program('MATS (Machine Alignment, Transparency, and Security)')
    const winter = round('MATS: Winter 2027')
    expect(roundsOf(mats, [mats, winter])).toEqual([winter.name])
  })

  it('matches a bracketed acronym against a leading one', () => {
    const iaps = program(
      'IAPS AI Policy Fellowship',
      'https://www.iaps.ai/fellowship'
    )
    const spring = round(
      'Institute for AI Policy and Strategy (IAPS) AI Policy Fellowship: Spring 2027',
      'https://www.iaps.ai/fellowship-2027'
    )
    expect(roundsOf(iaps, [iaps, spring])).toEqual([spring.name])
  })

  it("matches a round containing every word of the program's name", () => {
    const anthropic = program(
      'Anthropic Fellows Program',
      'https://alignment.anthropic.com/fellows'
    )
    const january = round(
      'Anthropic AI Safety Fellows Program: January 2027',
      'https://job-boards.greenhouse.io/anthropic/jobs/1'
    )
    expect(roundsOf(anthropic, [anthropic, january])).toEqual([january.name])
  })

  it('falls back to the same website and first word', () => {
    const govai = program(
      'GovAI Fellowship',
      'https://www.governance.ai/opportunities'
    )
    const dc = round(
      'GovAI DC Winter Fellowship: 2027',
      'https://www.governance.ai/dc'
    )
    const elsewhere = round(
      'GovAI Summit: 2027',
      'https://govai-summit.example/'
    )
    expect(roundsOf(govai, [govai, dc, elsewhere])).toEqual([dc.name])
  })

  it("never gives a sibling program's rounds to another program on the same site", () => {
    const intensive = program(
      'Iliad Intensive',
      'https://www.iliad.ac/intensive'
    )
    const fellowship = program(
      'Iliad Fellowship',
      'https://www.iliad.ac/fellowship'
    )
    const fellowshipRound = round(
      'Iliad Fellowship: November 2026',
      'https://www.iliad.ac/fellowship'
    )
    const intensiveRound = round(
      'Iliad Intensive: January 2027',
      'https://www.iliad.ac/intensive'
    )
    const listings = [intensive, fellowship, fellowshipRound, intensiveRound]
    expect(roundsOf(intensive, listings)).toEqual([intensiveRound.name])
    expect(roundsOf(fellowship, listings)).toEqual([fellowshipRound.name])
  })

  it('does not match a longer word that only starts with the name', () => {
    const spar = program('SPAR (Supervised Program for Alignment Research)')
    const sparks = round('Sparks Fellowship: 2027', 'https://sparks.example/')
    expect(roundsOf(spar, [spar, sparks])).toEqual([])
  })

  it('ignores other recurring programs and other listing types', () => {
    const tarbell = program('Tarbell Fellowship')
    const otherProgram = program('Tarbell Fellowship Alumni Network')
    const event = {
      ...round('Tarbell Fellowship: info session'),
      type: 'event',
    }
    expect(roundsOf(tarbell, [tarbell, otherProgram, event])).toEqual([])
  })
})
