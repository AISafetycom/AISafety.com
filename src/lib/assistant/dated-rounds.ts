// Which dated training rounds in the catalog belong to which recurring
// program. /training lists evergreen programs ("MATS (Machine Alignment,
// Transparency, and Security)", "AI Security Bootcamp (AISB)") next to
// dated rounds of the same programs ("MATS: Winter 2027", "AI Security
// Bootcamp (AISB): London, December 2026") as separate records with no link
// between them. Without this, the chatbot read the program's dateless
// listing and told a visitor no round was scheduled while one was on the
// page (chatbot watch, 17 October 2026).
//
// Names vary between a program and its rounds, so a round belongs to a
// program when any of these holds:
// 1. its name starts with the program's name, the part before a bracket, or
//    the bracketed acronym ("AI Safety Camp (AISC): 12th edition");
// 2. it carries a bracketed acronym the program's name leads with or
//    brackets ("Institute for AI Policy and Strategy (IAPS) AI Policy
//    Fellowship" ↔ "IAPS AI Policy Fellowship");
// 3. every word of the program's name appears in it ("Anthropic AI Safety
//    Fellows Program: January 2027" ↔ "Anthropic Fellows Program").
// A round no program claims that way can still join a program on the same
// website whose name starts with the same word ("GovAI DC Winter
// Fellowship: 2027" ↔ "GovAI Fellowship", both on governance.ai), but never
// one another program already claimed, so "Iliad Fellowship" rounds don't
// land on "Iliad Intensive".

export interface RoundCandidate {
  id: string
  type: string
  name: string
  url: string
  meta: Record<string, string>
}

const isProgram = (l: RoundCandidate) =>
  l.type === 'training' && l.meta.recurring === 'Yes'
const isRound = (l: RoundCandidate) =>
  l.type === 'training' && l.meta.recurring !== 'Yes'

/** Bracketed all-caps acronyms of 3–8 characters, lower-cased. */
function bracketedAcronyms(name: string): string[] {
  return [...name.matchAll(/\(([A-Z0-9]{3,8})\)/g)].map(m => m[1].toLowerCase())
}

/** Lower-cased names a program goes by: the full name, the part before a
 *  bracket ("MATS (Machine …)" → "mats"), and a bracketed acronym. */
function programKeys(name: string): string[] {
  const full = name.toLowerCase().trim()
  const bracket = full.indexOf(' (')
  return [
    full,
    ...(bracket > 0 ? [full.slice(0, bracket).trim()] : []),
    ...bracketedAcronyms(name),
  ]
}

/** Acronyms a program is known by: bracketed ones plus a leading all-caps
 *  word ("IAPS AI Policy Fellowship" → "iaps"). */
function programAcronyms(name: string): string[] {
  const leading = /^([A-Z][A-Z0-9]{2,7})\b/.exec(name)?.[1].toLowerCase()
  return [...bracketedAcronyms(name), ...(leading ? [leading] : [])]
}

/** "ai safety camp (aisc): 12th edition" starts with "ai safety camp", but
 *  "sparks" does not start with "spar". */
function startsWithKey(roundName: string, key: string): boolean {
  const n = roundName.toLowerCase()
  return n.startsWith(key) && !/[a-z0-9]/.test(n.charAt(key.length))
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? []
}

/** The name with any bracketed part removed, as words. */
function nameWords(name: string): string[] {
  return words(name.replace(/\([^)]*\)/g, ' '))
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function claims(program: RoundCandidate, round: RoundCandidate): boolean {
  if (programKeys(program.name).some(k => startsWithKey(round.name, k))) {
    return true
  }
  const acronyms = programAcronyms(program.name)
  if (bracketedAcronyms(round.name).some(a => acronyms.includes(a))) {
    return true
  }
  const roundWords = new Set(words(round.name))
  const required = nameWords(program.name)
  return required.length > 0 && required.every(w => roundWords.has(w))
}

function joinsBySite(program: RoundCandidate, round: RoundCandidate): boolean {
  const host = hostOf(program.url)
  return (
    host !== null &&
    host === hostOf(round.url) &&
    words(program.name)[0] === words(round.name)[0]
  )
}

/** Program id → the dated rounds in `listings` that belong to it. Programs
 *  with no dated round are absent from the map. */
export function datedRoundsByProgram<T extends RoundCandidate>(
  listings: T[]
): Map<string, T[]> {
  const programs = listings.filter(isProgram)
  const rounds = listings.filter(isRound)
  const out = new Map<string, T[]>()
  const add = (program: T, round: T) =>
    out.set(program.id, [...(out.get(program.id) ?? []), round])

  for (const round of rounds) {
    const owners = programs.filter(p => claims(p, round))
    const fallback =
      owners.length > 0 ? [] : programs.filter(p => joinsBySite(p, round))
    for (const program of [...owners, ...fallback]) add(program, round)
  }
  return out
}
