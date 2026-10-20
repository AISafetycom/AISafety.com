// The rejection reply written in advance (Bryce, 5 Oct 2026: "I need the
// rejection reply to be written automatically in the same way as the accept
// reply"). The Mac worker writes one per reject chip into the row's Reject
// drafts; the page shows one under the accept reply and Reject sends the one
// it shows. These helpers decide which, so the page and its tests agree.

/** Reject drafts as stored on the row: JSON {chip: reply}. Anything else
 *  reads as none, so the page falls back to Fable writing after Reject. */
export function parseRejectDrafts(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [chip, text] of Object.entries(v)) {
    if (typeof text === 'string' && text.trim()) out[chip] = text.trim()
  }
  return out
}

/** The chip whose reply the page shows: the one the pointer or keyboard is
 *  on while the reasons are open, else the first reason that has a reply
 *  (Fable's main reason comes first). Null when none has one yet. */
export function shownDeclineChip(
  chips: string[],
  drafts: Record<string, string>,
  focus: string | null = null
): string | null {
  if (focus && drafts[focus]) return focus
  return chips.find(c => drafts[c]) ?? null
}

/** What Reject sends as the reply to save, exactly as the page showed it.
 *  - edited: the reply as retyped on the page wins, whatever the reason.
 *  - chip: the reply written for that reason.
 *  - a typed reason with no edit: null – Fable writes the reply from it.
 *  - no reason at all: the reply the page was showing. */
export function rejectReplyFor(opts: {
  chips: string[]
  drafts: Record<string, string>
  edited: string | null
  chip: string | null
  typed: string
}): string | null {
  const { chips, drafts, edited, chip, typed } = opts
  if (edited !== null) return edited.trim() || null
  if (chip) return drafts[chip] ?? null
  if (typed.trim()) return null
  const shown = shownDeclineChip(chips, drafts)
  return shown ? drafts[shown] : null
}
