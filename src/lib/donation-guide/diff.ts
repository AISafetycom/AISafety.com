// What changed between two versions of the guide, in words: for the Publish
// dialog, the History view and the digest email. Tabs and sections are
// matched by id, so a rename reads as a change rather than a removal plus
// an addition.
import { richTextLines } from './text'
import type { Guide, RichText, Section, Tab } from './types'

export interface Change {
  /** Where in the guide: "Intro", "$1–1,000", "$1–1,000 › 1–50 hours". */
  where: string
  kind: 'changed' | 'added' | 'removed' | 'moved'
  /** The text as it was and as it is, for changed entries; the text of an
   *  added or removed entry sits in `after` or `before` alone. */
  before?: string
  after?: string
}

function rich(rt: RichText): string {
  return richTextLines(rt, true).join('\n')
}

function sectionText(s: Section): string {
  return `${s.time}\n${rich(s.body)}`
}

function tabText(t: Tab): string {
  return [
    `${t.amount} donation`,
    t.lead,
    ...t.sections.map(s => `[${s.time}]\n${rich(s.body)}`),
  ].join('\n')
}

function sameOrder(before: string[], after: string[]): boolean {
  const common = new Set(after)
  const b = before.filter(id => common.has(id))
  const beforeSet = new Set(before)
  const a = after.filter(id => beforeSet.has(id))
  return b.join('\n') === a.join('\n')
}

function diffSections(where: string, before: Tab, after: Tab, out: Change[]) {
  const old = new Map(before.sections.map(s => [s.id, s]))
  const seen = new Set<string>()
  for (const s of after.sections) {
    seen.add(s.id)
    const was = old.get(s.id)
    const at = `${where} › ${s.time}`
    if (!was) {
      out.push({ where: at, kind: 'added', after: sectionText(s) })
      continue
    }
    if (was.time !== s.time) {
      out.push({
        where: `${where} › ${was.time}`,
        kind: 'changed',
        before: was.time,
        after: s.time,
      })
    }
    const b = rich(was.body)
    const a = rich(s.body)
    if (b !== a) out.push({ where: at, kind: 'changed', before: b, after: a })
  }
  for (const s of before.sections) {
    if (!seen.has(s.id)) {
      out.push({
        where: `${where} › ${s.time}`,
        kind: 'removed',
        before: sectionText(s),
      })
    }
  }
  if (
    !sameOrder(
      before.sections.map(s => s.id),
      after.sections.map(s => s.id)
    )
  ) {
    out.push({ where: `${where} › sections`, kind: 'moved' })
  }
}

export function describeChanges(before: Guide, after: Guide): Change[] {
  const out: Change[] = []
  const bi = rich(before.intro)
  const ai = rich(after.intro)
  if (bi !== ai)
    out.push({ where: 'Intro', kind: 'changed', before: bi, after: ai })

  const old = new Map(before.tabs.map(t => [t.id, t]))
  const seen = new Set<string>()
  for (const t of after.tabs) {
    seen.add(t.id)
    const was = old.get(t.id)
    if (!was) {
      out.push({ where: t.amount, kind: 'added', after: tabText(t) })
      continue
    }
    if (was.amount !== t.amount) {
      out.push({
        where: `${was.amount} › name`,
        kind: 'changed',
        before: was.amount,
        after: t.amount,
      })
    }
    if (was.lead !== t.lead) {
      out.push({
        where: `${t.amount} › lead`,
        kind: 'changed',
        before: was.lead,
        after: t.lead,
      })
    }
    diffSections(t.amount, was, t, out)
  }
  for (const t of before.tabs) {
    if (!seen.has(t.id)) {
      out.push({ where: t.amount, kind: 'removed', before: tabText(t) })
    }
  }
  if (
    !sameOrder(
      before.tabs.map(t => t.id),
      after.tabs.map(t => t.id)
    )
  ) {
    out.push({ where: 'Tabs', kind: 'moved' })
  }
  return out
}

/** One line per change, for the email and the publish confirmation. */
export function summarizeChanges(changes: Change[]): string[] {
  return changes.map(c => {
    switch (c.kind) {
      case 'added':
        return `Added: ${c.where}`
      case 'removed':
        return `Removed: ${c.where}`
      case 'moved':
        return `Reordered: ${c.where}`
      default:
        return `Changed: ${c.where}`
    }
  })
}
