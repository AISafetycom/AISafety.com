// The guide's JSON as the page's markup: the same tags and classes the
// hand-written components used until 15 September 2026, so the page looks
// the same. Plain React with no hooks, so the public page, the admin
// preview and any server render can all use it.
import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import { withUtm } from '@/lib/utm'
import styles from '@/app/donation-guide/page.module.css'
import type { Inline, RichText, Tab } from './types'

const UTM_PAGE = 'Donation guide'

function renderInlines(
  inlines: Inline[],
  bold: 'strong' | 'highlight'
): ReactNode {
  return inlines.map((inline, i) => {
    let node: ReactNode = inline.text
    if (inline.bold) {
      node =
        bold === 'highlight' ? (
          <span className="color-light-teal">{node}</span>
        ) : (
          <strong>{node}</strong>
        )
    }
    if (inline.href) {
      const external = !inline.href.startsWith('/')
      node = (
        <Link
          href={external ? withUtm(inline.href, UTM_PAGE) : inline.href}
          target={external ? '_blank' : undefined}
          className="display-inline color-teal"
        >
          {node}
        </Link>
      )
    }
    return <Fragment key={i}>{node}</Fragment>
  })
}

/** The blocks of one section: paragraphs and lists, each but the last with
 *  the 12px gap the hand-written page had between its paragraphs. */
export function RichTextBlocks({ text }: { text: RichText }) {
  const last = text.blocks.length - 1
  return text.blocks.map((block, i) => {
    const gap = i < last ? 'padding-bottom-12px' : undefined
    if (block.type === 'paragraph') {
      return (
        <p key={i} className={gap}>
          {renderInlines(block.inlines, 'strong')}
        </p>
      )
    }
    const ListTag = block.type === 'numbers' ? 'ol' : 'ul'
    const listClass = block.type === 'numbers' ? styles.numbers : styles.bullets
    return (
      <ListTag key={i} className={gap ? `${listClass} ${gap}` : listClass}>
        {block.items.map((item, j) => (
          <li key={j}>{renderInlines(item, 'strong')}</li>
        ))}
      </ListTag>
    )
  })
}

/** The sentence under the page title; bold reads as the light-teal
 *  highlight it has always had. */
export function IntroHeading({ intro }: { intro: RichText }) {
  return (
    <h2 className="width-7-col padding-bottom-56px">
      {intro.blocks.map((block, i) => (
        <Fragment key={i}>
          {block.type === 'paragraph'
            ? renderInlines(block.inlines, 'highlight')
            : null}
        </Fragment>
      ))}
    </h2>
  )
}

function TimeSection({
  time,
  children,
  last,
}: {
  time: string
  children: ReactNode
  last?: boolean
}) {
  return (
    <div className={`${styles.timeRow} ${last ? styles.timeRowLast : ''}`}>
      <div className="width-3-col">
        <p className="color-teal-300 paragraph-small">If you have</p>
        <p className="paragraph-default-bold">{time}</p>
      </div>
      <div className="width-6-col">{children}</div>
    </div>
  )
}

/** One amount tab's content: heading, lead, and the time sections with a
 *  divider between each pair. */
export function TabContent({ tab }: { tab: Tab }) {
  const last = tab.sections.length - 1
  return (
    <>
      <h2 className="padding-bottom-24px">{tab.amount} donation</h2>
      <p className="padding-bottom-56px width-7-col">{tab.lead}</p>
      {tab.sections.map((section, i) => (
        <Fragment key={section.id}>
          {i > 0 && <div className={styles.divider} />}
          <TimeSection time={section.time} last={i === last}>
            <RichTextBlocks text={section.body} />
          </TimeSection>
        </Fragment>
      ))}
    </>
  )
}
