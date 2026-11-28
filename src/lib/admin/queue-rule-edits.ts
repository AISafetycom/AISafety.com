// What a rule's Apply actually writes, read off its edits.
//
// A Rule row's Proposal holds the change twice: as `edits`, the list of
// {file, find, replace} the Mac's worker carries out, and as free text
// about them (`summary`, `wording`, `was`, `diff`, `applies_to`). For a
// rule Fable drafted on the Mac the two come from one hand. A rule that
// carries the `bryce_applies` mark came by way of a teammate (proposed in
// their Fable chat, or drafted from a decision they made), and there the
// text is only somebody's account of the edits: it could say one thing
// while the edits do another. So for a marked rule the card is drawn from
// the edits themselves, here, and the free text is shown only as the row's
// own description.
//
// Dependency-free but for two pure helpers, so the page and the server
// share it.
import { policyEditsOf, type PolicyEdit } from './queue-rule-public'
import { tidyName } from './queue-team-chat'

/** One edit to a rulebook file, as the worker reads it. */
export type RuleEdit = PolicyEdit

/** The mark on a rule that goes in only on the owner's own Apply
 *  (`bryce_applies`, written by the Mac): whether it came from a
 *  teammate's chat, and the name beside it when the row carries one. */
export interface RuleMark {
  /** Proposed or rewritten in a teammate's Fable chat. Otherwise: drafted
   *  from a decision a teammate made. */
  chat: boolean
  name: string | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** The Proposal's `bryce_applies` as the card reads it; null when the rule
 *  has no mark. The address the mark holds is never read out. */
export function ruleMarkOf(v: unknown): RuleMark | null {
  if (!isRecord(v)) return null
  return {
    chat: typeof v.chat === 'string' && v.chat.trim() !== '',
    name: typeof v.name === 'string' ? tidyName(v.name) || null : null,
  }
}

/** The edits when every one reads as an edit; null when there are none or
 *  one is not {file, find, replace} text, which the worker would refuse. */
export function ruleEditsOf(v: unknown): RuleEdit[] | null {
  return policyEditsOf(v)
}

/** An edit as the card shows it: which file, the lines it takes out and
 *  the lines it puts in. The lines `find` and `replace` share at their
 *  start and end only say where in the file the change goes, and are left
 *  out: they are the same before and after. */
export interface ShownEdit {
  /** The file as the row names it, less a leading "~/". */
  file: string
  /** The lines taken out; '' when the edit only adds. */
  out: string
  /** The lines put in; '' when the edit only takes out. */
  in: string
}

export function shownEdit(edit: RuleEdit): ShownEdit {
  const a = edit.find.split('\n')
  const b = edit.replace.split('\n')
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
  return {
    file: edit.file.replace(/^~\//, ''),
    out: a.slice(head, a.length - tail).join('\n'),
    in: b.slice(head, b.length - tail).join('\n'),
  }
}

/** Whether an edit changes anything at all. */
export function editChanges(edit: RuleEdit): boolean {
  return edit.find !== edit.replace
}
