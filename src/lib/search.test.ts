import { describe, expect, it } from 'vitest'
import type { SearchEntry, SearchType } from './data/search-index'
import { search, typeForPath, withLiveEntries } from './search'

function entry(type: SearchType, title: string): SearchEntry {
  return {
    type,
    title,
    subtitle: '',
    description: '',
    category: '',
    url: '/',
    logo: null,
  }
}

describe('typeForPath', () => {
  it('maps a resource page to the search type of its listings', () => {
    expect(typeForPath('/map')).toBe('map')
    expect(typeForPath('/self-study')).toBe('course')
    expect(typeForPath('/founders')).toBe('founder')
  })

  it('is null for pages without listings', () => {
    expect(typeForPath('/')).toBeNull()
    expect(typeForPath('/about')).toBeNull()
    expect(typeForPath('/admin/preview')).toBeNull()
  })
})

describe('withLiveEntries', () => {
  const index = [
    entry('advisor', 'A'),
    entry('map', 'Old 1'),
    entry('map', 'Old 2'),
    entry('media', 'M'),
    entry('page', 'Home'),
  ]
  const titles = (entries: SearchEntry[]) => entries.map(e => e.title)

  it("replaces the type's entries where they were", () => {
    const out = withLiveEntries(index, 'map', [
      entry('map', 'New 1'),
      entry('map', 'New 2'),
      entry('map', 'New 3'),
    ])
    expect(titles(out)).toEqual(['A', 'New 1', 'New 2', 'New 3', 'M', 'Home'])
  })

  it('drops the type when the live read has nothing (all unpublished)', () => {
    expect(titles(withLiveEntries(index, 'map', []))).toEqual([
      'A',
      'M',
      'Home',
    ])
  })

  it('appends a type the index did not have', () => {
    const out = withLiveEntries(index, 'job', [entry('job', 'J')])
    expect(titles(out)).toEqual(['A', 'Old 1', 'Old 2', 'M', 'Home', 'J'])
  })

  it('leaves the index it was given untouched', () => {
    const before = titles(index)
    withLiveEntries(index, 'map', [entry('map', 'New')])
    expect(titles(index)).toEqual(before)
  })
})

describe('search: name-only entries', () => {
  const policy: SearchEntry = {
    ...entry('page', 'Listing policy'),
    description: 'How suggestions are decided.',
    nameOnly: true,
  }
  const org = entry('map', 'Centre for AI Policy')
  const index = [org, policy]
  const titles = (query: string) => search(index, query, null).map(e => e.title)

  it('shows up for its name, or its start from the first whole word', () => {
    expect(titles('Listing policy')).toContain('Listing policy')
    expect(titles('  listing   POLICY ')).toContain('Listing policy')
    expect(titles('listing')).toContain('Listing policy')
    expect(titles('listing pol')).toContain('Listing policy')
  })

  it('stays out of searches for one of its words or its description', () => {
    expect(titles('policy')).toEqual(['Centre for AI Policy'])
    expect(titles('list')).toEqual([])
    expect(titles('policy listing')).toEqual([])
    expect(titles('suggestions')).toEqual([])
  })
})

describe('search: matching what the cards show', () => {
  const listing = (
    type: SearchType,
    title: string,
    fields: Partial<SearchEntry> = {}
  ): SearchEntry => ({ ...entry(type, title), ...fields })
  const titles = (index: SearchEntry[], query: string) =>
    search(index, query, null).map(e => e.title)

  it('finds a listing by its subtitle and its unshown keywords', () => {
    const index = [
      listing('course', 'AI Risk Fundamentals', { subtitle: 'Lens Academy' }),
      listing('training', 'MATS', { keywords: 'Stipend included · Part-time' }),
    ]
    expect(titles(index, 'lens')).toEqual(['AI Risk Fundamentals'])
    expect(titles(index, 'stipend')).toEqual(['MATS'])
    expect(titles(index, 'part-time')).toEqual(['MATS'])
  })

  it('ignores punctuation at the ends of typed words', () => {
    const index = [
      listing('map', 'Center for AI Safety (CAIS)'),
      listing('map', 'Institute for Law & AI (LawAI)'),
      listing('job', 'Engineer', { keywords: 'Skillset: C++' }),
    ]
    expect(titles(index, 'Center for AI Safety (CAIS)')).toEqual([
      'Center for AI Safety (CAIS)',
    ])
    expect(titles(index, 'institute for law & ai')).toEqual([
      'Institute for Law & AI (LawAI)',
    ])
    expect(titles(index, 'cais?')).toEqual(['Center for AI Safety (CAIS)'])
    expect(titles(index, 'c++')).toEqual(['Engineer'])
    expect(titles(index, '&')).toEqual([])
  })

  it('matches across accents and other scripts', () => {
    const index = [
      listing('community', 'AI Safety Tübingen'),
      listing('community', 'AI Safety Uniandes', {
        category: 'Bogotá, Colombia',
      }),
      listing('community', 'AI Safety 東京 (Tokyo)'),
      listing('map', 'FAR\u2024AI YouTube channel'),
    ]
    expect(titles(index, 'tubingen')).toEqual(['AI Safety Tübingen'])
    expect(titles(index, 'Tübingen')).toEqual(['AI Safety Tübingen'])
    expect(titles(index, 'bogotá')).toEqual(['AI Safety Uniandes'])
    expect(titles(index, 'bogota')).toEqual(['AI Safety Uniandes'])
    expect(titles(index, '東京')).toEqual(['AI Safety 東京 (Tokyo)'])
    expect(titles(index, 'far.ai youtube')).toEqual([
      'FAR\u2024AI YouTube channel',
    ])
  })

  it('lets a plural find the singular the card shows', () => {
    const index = [
      listing('media', 'Dwarkesh', { category: 'Podcast' }),
      listing('founder', 'Catalyze Impact', { category: 'Incubator' }),
      listing('community', 'AI Safety New York'),
      listing('course', 'Atlas', { category: 'Studies' }),
    ]
    expect(titles(index, 'podcasts')).toEqual(['Dwarkesh'])
    expect(titles(index, 'incubators')).toEqual(['Catalyze Impact'])
    // Short words are left alone: "news" isn't "new".
    expect(titles(index, 'news')).toEqual([])
    expect(titles(index, 'study')).toEqual([])
  })

  it('lets a word naming the listing type narrow the results', () => {
    const index = [
      listing('job', 'Research Engineer', { category: 'London, UK' }),
      listing('community', 'AI Safety London'),
      listing('event', 'EAG London', { category: 'London, UK' }),
      listing('job', 'Policy Analyst', { category: 'Remote (Global)' }),
      listing('job', 'Operations Lead, London', {
        description: 'Run our events and retreats.',
      }),
      listing('event', 'Summit', { category: 'London, UK' }),
    ]
    expect(titles(index, 'london jobs')).toEqual([
      'Operations Lead, London',
      'Research Engineer',
    ])
    // The named type leads, though a job's title and text match better.
    expect(titles(index, 'london events')).toEqual([
      'EAG London',
      'Summit',
      'Operations Lead, London',
    ])
    // A type word alone, or with only other type words, matches by text only.
    expect(titles(index, 'jobs')).toEqual([])
    expect(titles(index, 'jobs job')).toEqual([])
  })

  it('lets small words be missing, but not question words', () => {
    const index = [
      listing('training', 'GovAI Fellowship', { category: 'London, UK' }),
      listing('course', 'Intro', { description: 'What is alignment?' }),
      listing('community', 'Alignment Club'),
    ]
    expect(titles(index, 'fellowship in london')).toEqual(['GovAI Fellowship'])
    expect(titles(index, 'the govai fellowship')).toEqual(['GovAI Fellowship'])
    expect(titles(index, 'what is alignment')).toEqual(['Intro'])
  })

  it('evens out dates, numbers, initials and hyphens', () => {
    const index = [
      listing('event', 'EA Global', { category: '16 – 18 Oct 2026' }),
      listing('advisor', '80,000 Hours'),
      listing('training', 'Horizon Fellowship', {
        category: 'Washington D.C., USA',
      }),
      listing('community', 'Tutke', { description: 'A nonprofit in Finland.' }),
    ]
    expect(titles(index, 'october')).toEqual(['EA Global'])
    expect(titles(index, '80000 hours')).toEqual(['80,000 Hours'])
    expect(titles(index, '80k')).toEqual(['80,000 Hours'])
    expect(titles(index, 'washington dc')).toEqual(['Horizon Fellowship'])
    expect(titles(index, 'washington d.c.')).toEqual(['Horizon Fellowship'])
    expect(titles(index, 'non-profit')).toEqual(['Tutke'])
  })

  it('finds a category word from its start while typing', () => {
    const index = [
      listing('founder', 'Lionheart Ventures', {
        category: 'Venture capitalist',
      }),
    ]
    expect(titles(index, 'venture capital')).toEqual(['Lionheart Ventures'])
  })

  it('only completes most of a category word, as the last of several words', () => {
    const index = [
      listing('job', 'Policy Analyst', {
        category: 'Washington, DC metro area, USA',
      }),
      listing('founder', 'Lionheart', { category: 'Venture capitalist' }),
    ]
    expect(titles(index, 'capital')).toEqual([])
    expect(titles(index, 'lionheart capital')).toEqual(['Lionheart'])
    expect(titles(index, 'metr')).toEqual([])
    expect(titles(index, 'policy metr')).toEqual([])
  })

  it('tries names written as one word', () => {
    const index = [
      listing('map', 'Google DeepMind'),
      listing('community', 'LessWrong'),
    ]
    expect(titles(index, 'deep mind')).toEqual(['Google DeepMind'])
    expect(titles(index, 'less wrong')).toEqual(['LessWrong'])
  })

  it('puts the title typed out in full first', () => {
    const index = [
      listing('job', 'Research Scientist', { subtitle: 'Org A' }),
      listing('job', 'Senior Research Scientist', { subtitle: 'Org B' }),
      listing('map', 'Research Scientists'),
      listing('media', 'Frontier AI Safety', {
        description: 'Talks on frontier AI.',
      }),
      listing('media', 'AI Safety at the Frontier'),
    ]
    expect(titles(index, 'research scientists')[0]).toBe('Research Scientists')
    expect(titles(index, 'ai safety at the frontier')[0]).toBe(
      'AI Safety at the Frontier'
    )
  })

  it('uses small words to break ties', () => {
    const index = [
      listing('community', 'AI Safety Club', { category: 'Berlin' }),
      listing('community', 'AI Safety Hub', {
        category: 'Berlin',
        description: 'Meets in person.',
      }),
    ]
    expect(titles(index, 'ai safety in berlin')).toEqual([
      'AI Safety Hub',
      'AI Safety Club',
    ])
  })

  it('keeps the page a one-word search names, however many listings match', () => {
    const funders = Array.from({ length: 60 }, (_, i) =>
      listing('funder', `Fund ${i} Grants`)
    )
    const index = [
      ...funders,
      listing('page', 'Funding', {
        description: 'Grants and funders supporting AI safety work.',
      }),
    ]
    const results = titles(index, 'grants')
    expect(results[0]).toBe('Funding')
    expect(results).toHaveLength(51)
  })

  it("doesn't read a different word into a plural or a description", () => {
    const index = [
      listing('job', 'Engineer', { category: 'Full-time' }),
      listing('community', 'AI Safety London', {
        description: 'Thinking about the future.',
      }),
      listing('map', 'AI Futures Project'),
    ]
    expect(titles(index, 'times')).toEqual([])
    expect(titles(index, 'ai futures')).toEqual(['AI Futures Project'])
  })

  it('never completes a short start of a label word', () => {
    const index = [
      listing('community', 'AI Safety Club', { category: 'Discord · Active' }),
      listing('map', 'EU AI Act Newsletter'),
    ]
    expect(titles(index, 'ai act')).toEqual(['EU AI Act Newsletter'])
  })

  it('ranks card text the row shows above card text it leaves out', () => {
    const index = [
      listing('training', 'MATS', { keywords: 'Stipend included' }),
      listing('job', 'Fellow', { description: 'Comes with a stipend.' }),
    ]
    expect(titles(index, 'stipend')).toEqual(['Fellow', 'MATS'])
  })

  it('finds contractions and short months typed either way', () => {
    const index = [
      listing('map', "Don't Worry About the Vase"),
      listing('training', 'PIBBSS Fellowship', { category: 'November 2026' }),
    ]
    expect(titles(index, 'dont worry')).toEqual(["Don't Worry About the Vase"])
    expect(titles(index, "don't worry")).toEqual(["Don't Worry About the Vase"])
    expect(titles(index, 'nov fellowship')).toEqual(['PIBBSS Fellowship'])
  })

  it('still ranks a title hit above hits in other fields', () => {
    const index = [
      listing('job', 'Co-Founder', { subtitle: 'Lens Academy' }),
      listing('map', 'Lens Academy'),
      listing('course', 'Reading list', {
        description: 'Lens Academy reading list.',
      }),
    ]
    expect(titles(index, 'lens academy')).toEqual([
      'Lens Academy',
      'Co-Founder',
      'Reading list',
    ])
  })
})
