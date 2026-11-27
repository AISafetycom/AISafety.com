// The sentence a rule brings for aisafety.com/listing-policy, edited by hand
// on the rule's card (Bryce, 27 Nov 2026: "make the listing policy section
// editable by me").
//
// The Mac writes the rule's `public` block as edits to
// ~/Comb/listing-policy.md ({file, find, replace}, ~/Queue rulebook.py
// build_public) plus `wording`, the part of `replace` the card shows. An
// edit on the card rewrites that part of `replace` and the `wording` to
// match; `find` stays as it is, so the Mac still places the edit where it
// was checked to fit. The Mac reads only `edits` when it writes the page,
// on Apply with "(public)": "apply" (rulebook.apply). The block's `diff` is
// dropped, as it would describe the old words.
//
// Dependency-free, so the page and the server share it.

/** One edit to the listing policy, as the Mac writes it. */
export interface PolicyEdit {
  file: string
  find: string
  replace: string
}

/** Longest wording the card takes: a few sentences, never a section. */
export const PUBLIC_TEXT_MAX = 1500

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The block's edits when each one reads as an edit; null otherwise. */
export function policyEditsOf(v: unknown): PolicyEdit[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const out: PolicyEdit[] = []
  for (const e of v) {
    if (
      !isRecord(e) ||
      typeof e.file !== 'string' ||
      typeof e.find !== 'string' ||
      typeof e.replace !== 'string'
    ) {
      return null
    }
    out.push({ file: e.file, find: e.find, replace: e.replace })
  }
  return out
}

/** Rulebook text as the card shows it: hard-wrapped lines joined back into
 *  sentences, indentation and **bold** markers dropped; bullets, headings
 *  and blank lines kept. Mirrors readable() in ~/Queue/rulebook.py. */
export function readable(text: string): string {
  const out: string[] = []
  for (const line of text.replaceAll('**', '').split('\n')) {
    const s = line.trim()
    const starts = /^([-*•–]\s|#|\d+[.)]\s|[A-Z][A-Z ]{3,}:)/.test(s)
    if (!s) out.push('')
    else if (out.length > 0 && out[out.length - 1] && !starts) {
      out[out.length - 1] += ' ' + s
    } else out.push(s)
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Where in `replace` the words the card shows sit, as [start, end): the
 *  shown wording itself when `replace` holds it exactly once, else the
 *  lines between what the edit keeps of `find` at its start and at its
 *  end. Null when the edit adds nothing (it only takes words out). */
export function publicSpan(
  edit: PolicyEdit,
  wording: string
): [number, number] | null {
  const { find, replace } = edit
  const at = wording ? replace.indexOf(wording) : -1
  if (at >= 0 && at === replace.lastIndexOf(wording)) {
    return [at, at + wording.length]
  }
  const a = find.split('\n')
  const b = replace.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++
  }
  const mid = b.slice(head, b.length - tail)
  if (mid.length === 0 || !mid.join('\n').trim()) return null
  const start = b.slice(0, head).reduce((n, line) => n + line.length + 1, 0)
  return [start, start + mid.join('\n').length]
}

/** What the card's edit box starts with: the words the rule adds to the
 *  page, as they will be written there. Null when they can't be edited on
 *  the card: a rule that changes the page in more than one place, or only
 *  takes words out (the chat can still change those). */
export function publicBoxText(
  edits: readonly PolicyEdit[],
  wording: string
): string | null {
  if (edits.length !== 1) return null
  const span = publicSpan(edits[0], wording)
  return span ? edits[0].replace.slice(span[0], span[1]) : null
}

/** Why the new words can't go on the page, or null when they can. */
export function publicTextProblem(text: string): string | null {
  if (!text.trim()) {
    return 'The wording is empty. To leave the public page as it is, tick Keep it internal.'
  }
  if (text.length > PUBLIC_TEXT_MAX) {
    return `That is longer than the ${PUBLIC_TEXT_MAX} characters the card takes. Shorten it, then save again.`
  }
  // The site holds the page as one template literal (listing-policy/text.ts)
  // and rulebook.build_public refuses these for the same reason.
  if (text.includes('`') || text.includes('${')) {
    return 'The public page can’t hold a backtick (`) or ${. Take it out, then save again.'
  }
  if (/^\s*Last updated:/m.test(text)) {
    return 'The Last updated line is set when the page goes live. Take that line out, then save again.'
  }
  return null
}

/** The `public` block with the card's words in place of the ones it
 *  showed: the edit's `replace` and the `wording` change, `find` and `was`
 *  stay, `diff` goes. Null when the words are the same as before. Throws an
 *  Error with a sentence for the page when they can't go in. */
export function rewritePublic(
  block: Record<string, unknown>,
  text: string
): Record<string, unknown> | null {
  const edits = policyEditsOf(block.edits)
  const wording = typeof block.wording === 'string' ? block.wording.trim() : ''
  if (!edits || edits.length !== 1) {
    throw new Error(
      'This rule changes the public page in more than one place, so its wording can only be changed in the chat.'
    )
  }
  const span = publicSpan(edits[0], wording)
  if (!span) {
    throw new Error(
      'This rule only takes words off the public page, so there is nothing to edit here.'
    )
  }
  // The box's line ends, without the blank space a paste leaves around it.
  const next = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
  const problem = publicTextProblem(next)
  if (problem) throw new Error(problem)
  const { find, replace } = edits[0]
  if (replace.slice(span[0], span[1]) === next) return null
  const replaced = replace.slice(0, span[0]) + next + replace.slice(span[1])
  if (replaced.trim() === find.trim()) {
    throw new Error(
      'That is what the public page says already. To leave it as it is, tick Keep it internal.'
    )
  }
  const out: Record<string, unknown> = {
    ...block,
    edits: [{ ...edits[0], replace: replaced }],
    wording: readable(next),
  }
  delete out.diff
  return out
}
