// One-off generator, run on 15 September 2026 with GENERATE_SEED=1 to turn
// the React components in src/app/donation-guide/content.tsx into seed.ts,
// and to capture the old chatbot extractor's output as the fixture that
// seed.test.ts checks the JSON against. Skipped in an ordinary test run.
import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactNode } from 'react'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { withUtm } from '@/lib/utm'
import { validateGuide } from './validate'
import type { Guide, Inline, Section, Tab } from './types'

const run = process.env.GENERATE_SEED === '1' ? describe : describe.skip

type El = {
  type: unknown
  props: Record<string, unknown> & { children?: ReactNode }
}

function el(node: ReactNode): El | null {
  return isValidElement(node) ? (node as unknown as El) : null
}

function childList(children: ReactNode): ReactNode[] {
  if (children == null) return []
  return Array.isArray(children) ? children.flat() : [children]
}

function cleanHref(href: string): string {
  if (href.startsWith('/')) return href
  const u = new URL(href)
  for (const k of [...u.searchParams.keys()]) {
    if (k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k)
  }
  return u.toString()
}

function plainText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(plainText).join('')
  const e = el(node)
  return e ? plainText(e.props.children) : ''
}

function pushText(out: Inline[], text: string) {
  if (!text) return
  const last = out[out.length - 1]
  if (last && !last.href && !last.bold) last.text += text
  else out.push({ text })
}

function inlinesOf(children: ReactNode, where: string): Inline[] {
  const out: Inline[] = []
  for (const c of childList(children)) {
    if (typeof c === 'string') {
      pushText(out, c)
      continue
    }
    const e = el(c)
    if (!e) continue
    if (typeof e.props.href === 'string') {
      const rendered = e.props.href
      const href = cleanHref(rendered)
      // Prove the stored address renders back to exactly today's href.
      expect(withUtm(href, 'Donation guide'), where).toBe(rendered)
      const external = !href.startsWith('/')
      expect(e.props.target === '_blank', `${where} target`).toBe(external)
      expect(String(e.props.className), where).toMatch(
        /^display-inline color-(teal|white)$/
      )
      out.push({ text: plainText(e.props.children), href })
      continue
    }
    throw new Error(`${where}: unexpected element ${String(e.type)}`)
  }
  return out
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

run('generate seed', () => {
  it('writes seed.ts and the old extractor fixture', async () => {
    const content = await import('@/app/donation-guide/content')
    const old = await import('@/lib/assistant/donation-guide')
    const oldText = old.getDonationGuideText()

    const tabs: Tab[] = content.DONATION_TABS.map(t => {
      const root = el(t.Content())!
      const kids = childList(root.props.children).map(el)
      const tab: Tab = { id: t.key, amount: t.label, lead: '', sections: [] }
      for (const k of kids) {
        if (!k) continue
        if (k.type === 'h2') {
          expect(plainText(k.props.children)).toMatch(/ donation$/)
          continue
        }
        if (k.type === 'p') {
          expect(k.props.className).toBe('padding-bottom-56px width-7-col')
          tab.lead = plainText(k.props.children)
          continue
        }
        if (typeof k.type === 'function' && 'time' in k.props) {
          const time = String(k.props.time)
          const section: Section = {
            id: `${t.key}-${slug(time)}`,
            time,
            body: { blocks: [] },
          }
          const paras = childList(k.props.children).map(el)
          paras.forEach((p, i) => {
            if (!p) return
            expect(p.type).toBe('p')
            const expectClass =
              i < paras.length - 1 ? 'padding-bottom-12px' : undefined
            expect(p.props.className, `${t.key} ${time} p${i}`).toBe(
              expectClass
            )
            section.body.blocks.push({
              type: 'paragraph',
              inlines: inlinesOf(p.props.children, `${t.key} ${time} p${i}`),
            })
          })
          tab.sections.push(section)
          continue
        }
        if (typeof k.type === 'function') continue // Divider
        throw new Error(`unexpected child ${String(k.type)}`)
      }
      return tab
    })

    const guide: Guide = {
      intro: {
        blocks: [
          {
            type: 'paragraph',
            inlines: [
              {
                text: 'This guide can help you determine the most effective way to ',
              },
              { text: 'financially support work on AI safety,', bold: true },
              { text: ' given the funds and time you have available.' },
            ],
          },
        ],
      },
      tabs,
    }
    const v = validateGuide(guide)
    expect(v.ok, v.ok ? '' : v.error).toBe(true)

    const dir = path.dirname(new URL(import.meta.url).pathname)
    writeFileSync(
      path.join(dir, 'seed.ts'),
      `// The donation guide as it read on 15 September 2026, generated from the\n` +
        `// React components it used to live in (seed.generate.test.ts, in the git\n` +
        `// history). Version 0: what the page shows until the first publish, and\n` +
        `// what it falls back to if the store is ever unreachable.\n` +
        `import type { Guide } from './types'\n\n` +
        `export const SEED_GUIDE: Guide = ${JSON.stringify(guide, null, 2)}\n`
    )
    writeFileSync(
      path.join(dir, 'seed-old-extractor.fixture.ts'),
      `// What src/lib/assistant/donation-guide.ts produced from the React\n` +
        `// components on 15 September 2026, kept so seed.test.ts can prove the\n` +
        `// JSON seed reads the same. Generated by seed.generate.test.ts.\n` +
        `export const OLD_EXTRACTOR_TEXT = ${JSON.stringify(oldText)}\n`
    )
  })
})
