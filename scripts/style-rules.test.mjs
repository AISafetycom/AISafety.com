import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  addedTo,
  checkCss,
  checkTsx,
  inScope,
  parseCss,
  readDesignSystem,
} from './style-rules.mjs'

// The real design system, so these tests move with it.
const ds = readDesignSystem(readFileSync('src/app/globals.css', 'utf8'))

const PAGE = 'src/app/events/page.module.css'
const rulesIn = findings => findings.map(f => f.rule)
const css = (text, file = PAGE) => checkCss(text, ds, file)
const tsx = (text, file = 'src/app/events/EventsClient.tsx') =>
  checkTsx(text, ds, ts, file)

describe('what is checked', () => {
  it('covers user-facing styles and components', () => {
    expect(inScope('src/app/events/page.module.css')).toBe(true)
    expect(inScope('src/components/ListingCard.tsx')).toBe(true)
  })

  it('leaves out /admin, the design system itself, and non-style files', () => {
    expect(inScope('src/app/admin/queue/queue.module.css')).toBe(false)
    expect(inScope('src/app/admin/queue/QueueClient.tsx')).toBe(false)
    expect(inScope('src/lib/admin/newsletter/render.tsx')).toBe(false)
    expect(inScope('src/app/globals.css')).toBe(false)
    expect(inScope('src/lib/search.ts')).toBe(false)
    expect(inScope('docs/css-guidelines.md')).toBe(false)
  })
})

describe('reading CSS', () => {
  it('lists blocks with their lines, declarations and @-rules', () => {
    const { nodes } = parseCss(
      `/* a { color: red; } */\n.a {\n  color: var(--white);\n  background: url('x;y.svg');\n}\n@media (max-width: 991px) {\n  .a:hover { gap: 4px }\n}`
    )
    expect(nodes.map(n => [n.selector, n.line])).toEqual([
      ['.a', 2],
      ['@media (max-width: 991px)', 6],
      ['.a:hover', 7],
    ])
    expect(nodes[0].decls).toEqual([
      { prop: 'color', value: 'var(--white)', line: 3 },
      { prop: 'background', value: "url('x;y.svg')", line: 4 },
    ])
    expect(nodes[2].at).toEqual(['@media (max-width: 991px)'])
    expect(nodes[2].decls).toEqual([{ prop: 'gap', value: '4px', line: 7 }])
  })

  it('reads the palette and utility classes from globals.css', () => {
    expect(ds.colorVariables.get('a6dad9')).toContain('--teal-300')
    expect(ds.utilities.get('display: flex')).toEqual(['flex'])
    expect(ds.utilities.get('gap: 16px')).toEqual(['gap-16px'])
  })
})

describe('CSS rules', () => {
  it('hard-coded colors, naming the variable to use', () => {
    const found = css('.x {\n  position: sticky;\n  color: #A6DAD9;\n}')
    expect(rulesIn(found)).toEqual(['hard-coded-color'])
    expect(found[0].line).toBe(3)
    expect(found[0].hint).toContain('var(--teal-300)')
  })

  it('rgb and rgba count too, with the see-through version spelled out', () => {
    const found = css(
      '.x { top: 0; border: 1px solid rgba(255, 255, 255, 0.25) }'
    )
    expect(rulesIn(found)).toEqual(['hard-coded-color'])
    expect(found[0].hint).toContain(
      'color-mix(in srgb, var(--white) 25%, transparent)'
    )
  })

  it('variables and url(#…) are not hard-coded colors', () => {
    expect(
      css(
        '.x { top: 0; border-color: var(--teal-300); mask: url(#fade); background: url("/a.svg#abc") }'
      )
    ).toEqual([])
  })

  it('new variables', () => {
    expect(rulesIn(css('.x { top: 0; --card-gap: 12px }'))).toEqual([
      'new-variable',
    ])
  })

  it('font-size, font-weight and font-family, naming the text class', () => {
    const found = css(
      '.x {\n  top: 0;\n  font-size: 15px;\n  font-weight: 600;\n  font-family: Inter;\n}'
    )
    expect(rulesIn(found)).toEqual(['font', 'font', 'font'])
    expect(found[0].hint).toContain('.paragraph-small')
    expect(css('.x { top: 0; font: inherit; font-size: inherit }')).toEqual([])
  })

  it('custom box-shadow, but not the shadow variables', () => {
    expect(rulesIn(css('.x { top: 0; box-shadow: 0 4px 12px black }'))).toEqual(
      ['box-shadow']
    )
    expect(
      css(
        '.x:hover { box-shadow: var(--shadow-dark) } .y:hover { box-shadow: none }'
      )
    ).toEqual([])
  })

  it('breakpoints other than 991px', () => {
    expect(rulesIn(css('@media (max-width: 767px) { .x { top: 0 } }'))).toEqual(
      ['breakpoint']
    )
    expect(rulesIn(css('@media (width <= 600px) { .x { top: 0 } }'))).toEqual([
      'breakpoint',
    ])
    expect(
      css(
        '@media (max-width: 991px) { .x { top: 0 } } @media (min-width: 992px) { .x { top: 1px } } @media (hover: hover) { .x:hover { top: 2px } } @media (prefers-reduced-motion: reduce) { .x { transition: none } }'
      )
    ).toEqual([])
  })

  it('a class that is an exact copy of one globals.css class', () => {
    const found = css('.newsDate {\n  color: var(--teal-grey-300);\n}')
    expect(rulesIn(found)).toEqual(['duplicate-class'])
    expect(found[0].hint).toContain('"color-teal-grey-300"')
  })

  it('a class made only of utility classes', () => {
    const found = css('.row { display: flex; align-items: center; gap: 16px }')
    expect(rulesIn(found)).toEqual(['duplicate-class'])
    expect(found[0].hint).toContain('className="flex items-center gap-16px"')
  })

  it('a class with a state or mobile override is a note, not a failure', () => {
    const found = css(
      '.row { display: flex }\n@media (max-width: 991px) { .row { display: none } }'
    )
    expect(rulesIn(found)).toEqual(['utility-available'])
  })

  it('hand-written spacing and flex inside a real class are notes', () => {
    const found = css(
      '.pill {\n  display: flex;\n  gap: 8px;\n  height: 40px;\n  padding: 0 16px 0 4px;\n  border-radius: 20px;\n}'
    )
    expect(rulesIn(found)).toEqual(['utility-available', 'utility-available'])
    expect(found[0].hint).toContain('"flex"')
    expect(found[1].hint).toContain('"gap-8px"')
  })

  it('a class that rebuilds a bigger global class is a note', () => {
    const found = css(
      '.rule { height: 1px; background-color: var(--teal-800); margin: 3px 0 }'
    )
    expect(rulesIn(found)).toEqual(['utility-available'])
    expect(found[0].what).toContain('.divider')
  })

  it('classes named like buttons, and button element selectors', () => {
    expect(
      rulesIn(
        css(
          '.submitButton { top: 0 } .my-button:hover { top: 1px } .cta-btn { top: 2px } .card button { top: 3px }'
        )
      )
    ).toEqual([
      'styled-button',
      'styled-button',
      'styled-button',
      'styled-button',
    ])
    expect(
      css(
        '.buttons { top: 0 } .buttonRow { top: 1px } :global(.mapboxgl-ctrl-attrib-button) { top: 2px }'
      )
    ).toEqual([])
    expect(
      css('.button { top: 0 }', 'src/components/Button.module.css')
    ).toEqual([])
  })
})

describe('TSX rules', () => {
  it('inline style colors', () => {
    const found = tsx(
      `export default function A() {\n  return <p style={{ color: '#a6dad9', top: 4 }}>x</p>\n}`
    )
    expect(rulesIn(found)).toEqual(['inline-style'])
    expect(found[0].line).toBe(2)
    expect(found[0].hint).toContain('var(--teal-300)')
  })

  it('inline style fonts, also through a const', () => {
    const found = tsx(
      `const label = { fontSize: 12, fontWeight: 600 }\nexport default function A({ on }: { on: boolean }) {\n  return <p style={on ? label : undefined}>x</p>\n}`
    )
    expect(rulesIn(found)).toEqual(['inline-style', 'inline-style'])
  })

  it('inline box-shadow written by hand', () => {
    expect(
      rulesIn(
        tsx(
          `export default function A() {\n  return <div style={{ boxShadow: '0 4px 12px black' }} />\n}`
        )
      )
    ).toEqual(['inline-style'])
  })

  it('leaves data-driven styles, variables and link-preview images alone', () => {
    expect(
      tsx(
        `export default function A({ c, w }: { c: string; w: number }) {\n  return <i style={{ color: c, width: w, background: 'var(--teal-850)', boxShadow: 'var(--shadow)' }} />\n}`
      )
    ).toEqual([])
    expect(
      tsx(
        `import { ImageResponse } from 'next/og'\nexport default function Image() {\n  return new ImageResponse(<div style={{ color: '#fff', fontSize: 64 }}>x</div>)\n}`
      )
    ).toEqual([])
  })

  it('hand-styled buttons and button-looking links', () => {
    const found = tsx(
      `import Link from 'next/link'\nimport styles from './page.module.css'\nexport default function A() {\n  return (\n    <>\n      <button className={styles.copyBtn}>Copy</button>\n      <Link href="/events" className={\`\${styles['cta-button']} flex\`}>Go</Link>\n      <a className="my-button">Get started</a>\n    </>\n  )\n}`
    )
    expect(rulesIn(found)).toEqual([
      'styled-button',
      'styled-button',
      'styled-button',
    ])
    expect(found[0].hint).toContain('<Button>')
  })

  it('a raw <button> with other classes is a note; <Button> is fine', () => {
    const found = tsx(
      `import Button from '@/components/Button'\nimport styles from './page.module.css'\nexport default function A({ kind }: { kind: string }) {\n  return (\n    <>\n      <button className={styles.chip}>Tag</button>\n      <Button className={styles.sendButton}>Send</Button>\n      <div className={kind === 'button' ? styles.buttons : styles.buttonRow} />\n    </>\n  )\n}`
    )
    expect(rulesIn(found)).toEqual(['raw-button'])
  })
})

describe('exceptions', () => {
  it('an allow comment with a reason turns a finding into a listed exception', () => {
    const found = css(
      '.x {\n  top: 0;\n  /* style-check: allow box-shadow (focus ring, agreed with Melissa) */\n  box-shadow: 0 0 0 2px var(--teal-300);\n}'
    )
    expect(rulesIn(found)).toEqual(['exception'])
    expect(found[0].hint).toContain('focus ring, agreed with Melissa')
  })

  it('without a reason, or for another rule, it does nothing', () => {
    expect(
      rulesIn(
        css(
          '.x {\n  top: 0;\n  /* style-check: allow box-shadow */\n  box-shadow: 0 0 0 2px black;\n}'
        )
      )
    ).toEqual(['box-shadow'])
    expect(
      rulesIn(
        css(
          '.x {\n  top: 0;\n  /* style-check: allow font (brand lockup) */\n  box-shadow: 0 0 0 2px black;\n}'
        )
      )
    ).toEqual(['box-shadow'])
  })

  it('works in TSX', () => {
    const found = tsx(
      `export default function A() {\n  return (\n    <p\n      // style-check: allow inline-style (partner's brand color)\n      style={{ color: '#ff1493' }}\n    >\n      x\n    </p>\n  )\n}`
    )
    expect(rulesIn(found)).toEqual(['exception'])
  })
})

describe('only what a change adds', () => {
  const old = '.title {\n  font-size: 14px;\n  color: #123456;\n}\n'

  it('passes a file that is untouched, reworded or reordered', () => {
    expect(addedTo(PAGE, old, old, ds)).toEqual([])
    expect(
      addedTo(
        PAGE,
        old,
        '.heading {\n  color: #123456;\n  font-size: 18px;\n}\n',
        ds
      )
    ).toEqual([])
  })

  it('passes a file that got cleaner', () => {
    expect(addedTo(PAGE, old, '.title {\n  color: #123456;\n}\n', ds)).toEqual(
      []
    )
  })

  it('reports only the new line when a file gets one more', () => {
    const found = addedTo(
      PAGE,
      old,
      `${old}.date {\n  font-size: 12px;\n}\n`,
      ds
    )
    expect(found.map(f => [f.rule, f.line, f.was, f.now])).toEqual([
      ['font', 6, 1, 2],
    ])
  })

  it('reports everything in a new file', () => {
    expect(rulesIn(addedTo(PAGE, '', old, ds))).toEqual([
      'font',
      'hard-coded-color',
    ])
  })

  it('a class that was already there never becomes a "new" duplicate', () => {
    // .muted existed with another color; a palette rename makes it match a
    // utility. Nobody added a class, so it is a note, not a failure.
    expect(
      rulesIn(
        addedTo(
          PAGE,
          '.muted { color: var(--teal-grey-400) }',
          '.muted { color: var(--teal-grey-300) }',
          ds
        )
      )
    ).toEqual(['utility-available'])
    expect(
      rulesIn(
        addedTo(
          PAGE,
          '.muted { color: var(--teal-grey-400) }',
          '.muted { color: var(--teal-grey-400) }\n.date { color: var(--teal-grey-300) }',
          ds
        )
      )
    ).toEqual(['duplicate-class'])
  })

  it('works for TSX', () => {
    const before = `export default function A() {\n  return <p style={{ color: '#111111' }}>x</p>\n}`
    const after = `export default function A() {\n  return (\n    <p style={{ color: '#111111' }}>\n      <b style={{ fontWeight: 700 }}>x</b>\n    </p>\n  )\n}`
    expect(addedTo('src/app/a/A.tsx', before, before, ds, ts)).toEqual([])
    expect(
      addedTo('src/app/a/A.tsx', before, after, ds, ts).map(f => f.line)
    ).toEqual([4])
  })

  it('new variables in globals.css are a note', () => {
    const found = addedTo(
      'src/app/globals.css',
      ':root { --teal-300: #a6dad9 }',
      ':root { --teal-300: #a6dad9; --brand-pink: #ff1493 }',
      ds
    )
    expect(found.map(f => [f.rule, f.what])).toEqual([
      ['design-system-variable', '--brand-pink'],
    ])
  })
})
