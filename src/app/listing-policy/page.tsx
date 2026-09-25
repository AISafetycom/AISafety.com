import Link from 'next/link'
import { Fragment } from 'react'
import { LISTING_POLICY_MD } from '@/lib/listing-policy/text'
import { parseInline, parsePolicy } from '@/lib/listing-policy/parse'
import styles from './page.module.css'

export const metadata = {
  title: 'Listing policy – AISafety.com',
  description:
    'What AISafety.com lists on each resource page, and how suggestions are decided.',
  alternates: { canonical: '/listing-policy' },
}

const CONTACT_FORM =
  'https://airtable.com/appF8XfZUGXtfi40E/pagUmmzVb8OnVvTZS/form'
const CORRECTION_FORM =
  'https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form'

// A bold page path at the start of a line ("**/map** – …") links to that page.
const PAGE_PATHS = new Set([
  '/map',
  '/events',
  '/training',
  '/funding',
  '/communities',
  '/self-study',
  '/media-channels',
  '/founders',
  '/advisors',
  '/projects',
  '/jobs',
  '/donation-guide',
])

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        if (part.kind === 'text')
          return <Fragment key={i}>{part.text}</Fragment>
        if (part.kind === 'link') {
          return (
            <a
              key={i}
              href={part.href}
              target="_blank"
              rel="noopener noreferrer"
              className="color-light-teal"
            >
              {part.text}
            </a>
          )
        }
        if (PAGE_PATHS.has(part.text)) {
          return (
            <Link key={i} href={part.text} className={styles.pageLink}>
              {part.text}
            </Link>
          )
        }
        return <strong key={i}>{part.text}</strong>
      })}
    </>
  )
}

export default function ListingPolicyPage() {
  const blocks = parsePolicy(LISTING_POLICY_MD)
  const firstSection = blocks.findIndex(b => b.kind === 'h2')

  return (
    <div className="container-narrow">
      <div className="flex justify-center">
        <div className={`width-9-col-narrow ${styles.policy}`}>
          {blocks.map((block, i) => {
            switch (block.kind) {
              case 'h1':
                return (
                  <h1 key={i} className="padding-top-56px padding-bottom-40px">
                    {block.text}
                  </h1>
                )
              case 'h2':
                return (
                  <h3 key={i} className={styles.h2}>
                    {block.text}
                  </h3>
                )
              case 'h3':
                return (
                  <p key={i} className={styles.h3}>
                    {block.text}
                  </p>
                )
              case 'ul':
                return (
                  <ul key={i} className={styles.list}>
                    {block.items.map((item, j) => (
                      <li key={j}>
                        <Inline text={item} />
                      </li>
                    ))}
                  </ul>
                )
              case 'p': {
                // Before the first section: the intro line, then the note.
                const isNote = i < firstSection && block.text.startsWith('**')
                const isLastUpdated = block.text.startsWith('Last updated')
                const className = isNote
                  ? styles.note
                  : isLastUpdated
                    ? `paragraph-small ${styles.lastUpdated}`
                    : styles.p
                return (
                  <p key={i} className={className}>
                    <Inline text={block.text} />
                  </p>
                )
              }
            }
          })}

          <p className={`paragraph-small ${styles.footer}`}>
            <a
              href={CONTACT_FORM}
              target="_blank"
              rel="noopener noreferrer"
              className="color-light-teal"
            >
              Send us an email
            </a>
            {' · '}
            <a
              href={CORRECTION_FORM}
              target="_blank"
              rel="noopener noreferrer"
              className="color-light-teal"
            >
              Suggest a correction
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
