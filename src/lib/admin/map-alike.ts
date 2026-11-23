/*
  Which listings on the Field map a new one is most like, so the Queue's map
  strip can put it beside them (map-spot.ts). Claude reads what each says
  about itself (name, categories, description) and names up to three of the
  listings already in the new one's area, most alike first. Word overlap
  was tried first and named the wrong neighbours too often (a policy center
  beside Redwood Research, the EU AI Office beside a campaign group); Claude
  sees what the work actually is.

  This file holds the pure parts, the question and the reading of the
  answer; map-alike-claude.ts sends it and /api/admin/queue/alike serves it.

  Pure module: no DOM, no next, no SDK.
*/

/** What a listing says about itself. */
export interface AlikeText {
  id: string
  /** Its long name. */
  name: string
  description: string | null
  /** Its categories, comma-joined: the first decides its area. */
  category: string
}

/** How many it names at most. */
export const MOST_ALIKE = 3
/** The most listings one question may carry (the largest area has about
 *  sixty) and the longest any one text may be, so a request stays small. */
export const ALIKE_LIMITS = { among: 150, text: 1000 } as const

/** The answer's shape, for structured output: the numbers of the listings
 *  named, most alike first. */
export const ALIKE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['like'],
  properties: { like: { type: 'array', items: { type: 'integer' } } },
} as const

function line(l: Omit<AlikeText, 'id'>): string {
  const text = (l.description ?? '').replace(/\s+/g, ' ').trim()
  return `${l.name} (${l.category})${text ? `: ${text}` : ''}`
}

/** The question for Claude: the new listing, then the area's listings
 *  numbered from 1. */
export function alikePrompt(
  listing: Omit<AlikeText, 'id'>,
  among: AlikeText[],
  area: string
): string {
  return `A new listing is joining the ${area} area of a map of the AI safety field, where similar organizations and resources sit near each other.

New listing:
${line(listing)}

Already in the area (numbered):
${among.map((l, i) => `${i + 1}. ${line(l)}`).join('\n')}

Which of the numbered listings are most like the new one in what they actually do: the kind of work and its focus, not just shared words? Name up to ${MOST_ALIKE}, most alike first, by number. Name fewer, or none, when nothing else is really alike.`
}

/** The ids the answer names, most alike first: numbers outside the list,
 *  and repeats, are dropped. */
export function readAlike(answer: string, among: AlikeText[]): string[] {
  const parsed = JSON.parse(answer) as { like?: unknown }
  if (!Array.isArray(parsed.like)) {
    throw new Error('Claude answer has no "like" list')
  }
  const ids: string[] = []
  for (const n of parsed.like) {
    const l = typeof n === 'number' ? among[n - 1] : undefined
    if (l && !ids.includes(l.id)) ids.push(l.id)
  }
  return ids.slice(0, MOST_ALIKE)
}

/** What the map strip sends: the new listing, its area, and the listings
 *  already there. */
export interface AlikeRequest {
  area: string
  listing: Omit<AlikeText, 'id'>
  among: AlikeText[]
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null
}

/** The request body as an AlikeRequest, or what is wrong with it. Texts
 *  are cut to ALIKE_LIMITS.text, and a list longer than ALIKE_LIMITS.among
 *  is refused. */
export function readAlikeRequest(
  body: unknown
): { ok: true; request: AlikeRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const max = ALIKE_LIMITS.text
  const area = text(b.area, 100)
  if (!area) return { ok: false, error: 'No area.' }
  const l = (b.listing ?? {}) as Record<string, unknown>
  const name = text(l.name, max)
  const category = text(l.category, max)
  if (!name || category === null) {
    return { ok: false, error: 'The listing needs a name and a category.' }
  }
  if (!Array.isArray(b.among)) return { ok: false, error: 'No listings.' }
  if (b.among.length > ALIKE_LIMITS.among) {
    return { ok: false, error: 'Too many listings.' }
  }
  const among: AlikeText[] = []
  for (const raw of b.among) {
    const a = (raw ?? {}) as Record<string, unknown>
    const id = text(a.id, 40)
    const aName = text(a.name, max)
    const aCategory = text(a.category, max)
    if (!id || !aName || aCategory === null) {
      return {
        ok: false,
        error: 'Each listing needs an id, a name and a category.',
      }
    }
    among.push({
      id,
      name: aName,
      category: aCategory,
      description: text(a.description, max),
    })
  }
  return {
    ok: true,
    request: {
      area,
      listing: { name, category, description: text(l.description, max) },
      among,
    },
  }
}
