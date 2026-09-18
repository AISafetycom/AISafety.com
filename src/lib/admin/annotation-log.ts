// The conversation log's "who did what" trail. Every annotation change made
// in the admin (a rating, a label, the notes) becomes one line in the row's
// Review log field, oldest first, so anyone reading a conversation later can
// see who rated or labelled it and when. Pure functions; the Airtable side is
// in airtable.ts.

export interface AnnotationBefore {
  review: string
  tags: string[]
  notes: string
}

export interface AnnotationPatch {
  review?: string | null
  tags?: string[]
  notes?: string
  /** A new signed note entry (see appendNote). */
  addNote?: string
  /** An existing entry to remove, identified by position and header. */
  deleteNote?: { index: number; at: string; actor: string }
}

/** Human-readable descriptions of what `patch` changes relative to `before`.
 *  Empty when nothing actually changes (saving identical notes, re-sending
 *  the same labels). */
export function describeAnnotationChanges(
  before: AnnotationBefore,
  patch: AnnotationPatch
): string[] {
  const out: string[] = []
  if (patch.review !== undefined) {
    const next = patch.review ?? ''
    if (next !== before.review) {
      if (!next) out.push(`cleared the ${before.review} rating`)
      else if (!before.review) out.push(`rated ${next}`)
      else out.push(`changed the rating from ${before.review} to ${next}`)
    }
  }
  if (patch.tags !== undefined) {
    const was = new Set(before.tags)
    const now = new Set(patch.tags)
    for (const t of patch.tags)
      if (!was.has(t)) out.push(`added the label "${t}"`)
    for (const t of before.tags)
      if (!now.has(t)) out.push(`removed the label "${t}"`)
  }
  if (patch.notes !== undefined && patch.notes !== before.notes) {
    if (!before.notes.trim()) out.push('wrote notes')
    else if (!patch.notes.trim()) out.push('cleared the notes')
    else out.push('edited the notes')
  }
  if (patch.addNote !== undefined && patch.addNote.trim()) {
    out.push('added a note')
  }
  if (patch.deleteNote) {
    out.push(`deleted a note by ${patch.deleteNote.actor}`)
  }
  return out
}

/** "2026-09-05 11:42 UTC · Bryce · rated Good" — one line per change. */
export function formatLogLines(
  actor: string,
  changes: string[],
  at: Date = new Date()
): string[] {
  const stamp = at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  return changes.map(c => `${stamp} · ${actor} · ${c}`)
}

/** Append lines to an existing log (which may be empty). */
export function appendLog(existing: string, lines: string[]): string {
  if (lines.length === 0) return existing
  const base = existing.trimEnd()
  return (base ? base + '\n' : '') + lines.join('\n')
}

export interface LogEntry {
  at: string
  actor: string
  what: string
}

/** Parse the field back into entries, newest first, for the admin UI. Lines
 *  that don't match the format (hand edits) come through as `what` alone. */
export function parseLog(log: string): LogEntry[] {
  const out: LogEntry[] = []
  for (const raw of log.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC) · ([^·]+?) · (.+)$/.exec(
      line
    )
    out.push(
      m
        ? { at: m[1], actor: m[2].trim(), what: m[3].trim() }
        : { at: '', actor: '', what: line }
    )
  }
  return out.reverse()
}

// ─── Signed notes ────────────────────────────────────────────────────────────
// The Notes field holds signed entries, each a header line followed by the
// text, entries separated by a blank line:
//
//     2026-09-05 12:10 UTC · Bryce
//     Looks like a hallucination in turn 2.
//
// Anything written before the first header (notes from before signing
// existed, or typed straight into Airtable) is kept as one unsigned block.

export interface NoteEntry {
  at: string
  actor: string
  text: string
}

export interface ParsedNotes {
  /** Unsigned text from before the first entry, '' when none. */
  legacy: string
  /** Oldest first, as stored. */
  entries: NoteEntry[]
}

const NOTE_HEADER = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC) · (.+)$/

export function noteHeader(actor: string, at: Date = new Date()): string {
  const stamp = at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  return `${stamp} · ${actor}`
}

export function parseNotes(field: string): ParsedNotes {
  const lines = field.replace(/\r\n?/g, '\n').split('\n')
  const legacy: string[] = []
  const entries: NoteEntry[] = []
  let current: NoteEntry | null = null
  for (const line of lines) {
    const m = NOTE_HEADER.exec(line.trim())
    if (m) {
      current = { at: m[1], actor: m[2].trim(), text: '' }
      entries.push(current)
    } else if (current) {
      current.text += (current.text ? '\n' : '') + line
    } else {
      legacy.push(line)
    }
  }
  for (const e of entries) e.text = e.text.trim()
  return { legacy: legacy.join('\n').trim(), entries }
}

/** The field with one more signed entry on the end. */
export function appendNote(
  field: string,
  actor: string,
  text: string,
  at: Date = new Date()
): string {
  const body = text.replace(/\r\n?/g, '\n').trim()
  if (!body) return field
  const base = field.trimEnd()
  return (base ? base + '\n\n' : '') + `${noteHeader(actor, at)}\n${body}`
}

/** The field text for a legacy block plus entries, the inverse of parseNotes. */
export function serializeNotes(parsed: ParsedNotes): string {
  const parts: string[] = []
  if (parsed.legacy.trim()) parts.push(parsed.legacy.trim())
  for (const e of parsed.entries) parts.push(`${e.at} · ${e.actor}\n${e.text}`)
  return parts.join('\n\n')
}

/** The field with one entry removed. The entry must still sit at `index`
 *  with the given header, so a stale page can't delete someone else's newer
 *  note by accident; null when it doesn't match. */
export function removeNote(
  field: string,
  target: { index: number; at: string; actor: string }
): string | null {
  const parsed = parseNotes(field)
  const e = parsed.entries[target.index]
  if (!e || e.at !== target.at || e.actor !== target.actor) return null
  parsed.entries.splice(target.index, 1)
  return serializeNotes(parsed)
}

/** The Date behind a stored "2026-09-05 11:42 UTC" stamp; null when the text
 *  isn't one (a hand-written line). */
export function stampToDate(stamp: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) UTC$/.exec(stamp.trim())
  if (!m) return null
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]))
}
