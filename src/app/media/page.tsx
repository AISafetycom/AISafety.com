import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { fetchAllCounts } from '@/lib/data/counts'
import CopyButton from './CopyButton'
import JumpLink from './JumpLink'
import PressLink from './PressLink'
import {
  BOILERPLATE,
  COVERAGE_MISTAKES,
  LOGOS,
  PEOPLE,
  PRESS_BLOB,
  PRESS_EMAIL,
  PRESS_KIT_ZIP,
  SCREENSHOTS,
} from './content'
import { NEWS } from './news'
import styles from './page.module.css'

export const metadata: Metadata = {
  title: 'Press and media – AISafety.com',
  description:
    'Press kit, boilerplate, team bios and media contact for AISafety.com, plus expert sources, data and framing notes for journalists covering AI risk.',
  alternates: { canonical: '/media' },
}

/** Directory counts shown under Key facts, in this order. Each is the live
 *  number on that page (the same one the nav badge shows). */
const DIRECTORIES = [
  { path: '/jobs', label: 'Jobs listed' },
  { path: '/map', label: 'Organizations on the field map' },
  { path: '/communities', label: 'Communities' },
  { path: '/training', label: 'Training programs' },
  { path: '/events', label: 'Upcoming events' },
  { path: '/funding', label: 'Funding sources' },
  { path: '/media-channels', label: 'Media channels indexed' },
  { path: '/advisors', label: 'Advisors' },
] as const

/** When the press kit was last refreshed and how big the zip is, from the
 *  manifest the weekly Press Shots job uploads beside the files. */
async function getPressKitInfo(): Promise<{
  updatedAt: string
  zipBytes: number
} | null> {
  try {
    const response = await fetch(`${PRESS_BLOB}/manifest.json`, {
      next: { revalidate: 3600 },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data: unknown = await response.json()
    if (
      !data ||
      typeof data !== 'object' ||
      typeof (data as { updatedAt?: unknown }).updatedAt !== 'string' ||
      typeof (data as { zipBytes?: unknown }).zipBytes !== 'number'
    ) {
      throw new Error('unexpected manifest shape')
    }
    const { updatedAt, zipBytes } = data as {
      updatedAt: string
      zipBytes: number
    }
    return { updatedAt, zipBytes }
  } catch (error) {
    // Recoverable: the files are still there, the page just can't say when
    // they were refreshed or how big the zip is.
    console.warn(`Press kit manifest unavailable (${error})`)
    return null
  }
}

/** Words in a block of copy, shown beside each boilerplate version. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).length
}

/** "17 May 2024" — the site's date order. */
function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** What search engines and AI assistants read to answer "what is
 *  AISafety.com": https://schema.org/Organization. */
const ORGANIZATION_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'AISafety.com',
  url: 'https://aisafety.com',
  logo: 'https://aisafety.com/press/aisafety-com-logo-square-dark.png',
  description: BOILERPLATE[0].text,
  foundingDate: '2017',
  nonprofitStatus: 'Nonprofit',
  email: PRESS_EMAIL,
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'press',
    email: PRESS_EMAIL,
  },
  sameAs: [
    'https://aisafetycom.substack.com',
    'https://github.com/aisafetycom',
  ],
}

export default async function MediaPage() {
  const [counts, kit] = await Promise.all([fetchAllCounts(), getPressKitInfo()])
  const news = [...NEWS].sort((a, b) => b.date.localeCompare(a.date))
  const announcements = news.filter(n => n.kind === 'announcement')
  const coverage = news.filter(n => n.kind === 'coverage')
  const mailto = `mailto:${PRESS_EMAIL}`

  return (
    <div className={`container-narrow ${styles.page}`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(ORGANIZATION_SCHEMA),
        }}
      />

      <h1 className="padding-top-56px padding-bottom-40px">Press and media</h1>

      <h2 className="width-9-col-narrow padding-bottom-56px">
        AISafety.com is a nonprofit resource hub for AI existential safety. This
        page has{' '}
        <span className="color-light-teal">
          what you need to write about us, and what you need to write about the
          field.
        </span>
      </h2>

      <div className={`${styles.entryCards} flex-col-mobile`}>
        <div className={styles.entryCard}>
          <p className="color-white paragraph-default-bold">
            Writing about AISafety.com?
          </p>
          <p className="paragraph-small color-teal-300">
            Boilerplate, team bios, key numbers and logos are below. Press
            contact:{' '}
            <PressLink
              href={mailto}
              action="contact"
              label="Emailed the press inbox"
              newTab
              className={styles.inlineLink}
            >
              {PRESS_EMAIL}
            </PressLink>
            .
          </p>
          <JumpLink
            targetId="boilerplate"
            label="Jumped to the boilerplate"
            className="button-secondary"
          >
            Start with the boilerplate
          </JumpLink>
        </div>
        <div className={styles.entryCard}>
          <p className="color-white paragraph-default-bold">
            Writing about AI risk?
          </p>
          <p className="paragraph-small color-teal-300">
            Skip to the reporter resources: where to find expert contacts, the
            field map, open data, and the mistakes we see most often in
            coverage.
          </p>
          <JumpLink
            targetId="covering-ai-safety"
            label="Jumped to the reporter resources"
            className="button-secondary"
          >
            Reporter resources
          </JumpLink>
        </div>
      </div>

      {/* Boilerplate */}
      <section id="boilerplate" className={styles.section}>
        <h2>Boilerplate</h2>
        <p className={`paragraph-small ${styles.lead}`}>
          Meant to be copied and pasted without editing.
        </p>
        <div className={styles.copyBlocks}>
          {BOILERPLATE.map(block => (
            <div key={block.id} className={styles.copyBlock}>
              <div className={`${styles.copyHead} paragraph-small-bold`}>
                <div>
                  {block.label} <span>· {wordCount(block.text)} words</span>
                </div>
                <CopyButton text={block.text} label={block.trackingName} />
              </div>
              <p className={`paragraph-small ${styles.copyText}`}>
                {block.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Key facts */}
      <section id="key-facts" className={styles.section}>
        <h2>Key facts</h2>
        <p className={`paragraph-small ${styles.lead}`}>
          Directory counts are live: they are the same numbers the site shows
          today, and they change as listings are added and removed.
        </p>
        <dl className={`paragraph-small ${styles.facts}`}>
          <dt>Founded</dt>
          <dd>
            Domain acquired in 2017 by Søren Elverlin; site in its current form
            built out since 2023
          </dd>
          <dt>Legal status</dt>
          <dd>Nonprofit</dd>
          <dt>Team</dt>
          <dd>
            One full-time and one part-time salaried role, plus 30+ volunteers
          </dd>
          <dt>Annual budget</dt>
          <dd>About $100,000 USD</dd>
          <dt>Funding</dt>
          <dd>
            Grants from the{' '}
            <a
              href="https://survivalandflourishing.fund/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Survival and Flourishing Fund
            </a>
          </dd>
          {DIRECTORIES.map(({ path, label }) => {
            const count = counts[path]
            if (typeof count !== 'number') return null
            return (
              <FactRow key={path} label={label}>
                <Link href={path}>{count.toLocaleString('en-US')}</Link>
              </FactRow>
            )
          })}
          <dt>Sister site</dt>
          <dd>
            <a
              href="https://aisafety.info"
              target="_blank"
              rel="noopener noreferrer"
            >
              AISafety.info
            </a>
            , an explainer and FAQ project
          </dd>
        </dl>
      </section>

      {/* Who to talk to */}
      <section id="who-to-talk-to" className={styles.section}>
        <h2>Who to talk to</h2>
        <p className={`paragraph-small ${styles.lead}`}>
          Our team speaks about the AI safety field and about our own work. We
          do not speak on behalf of the organizations we list. To reach any of
          us, email{' '}
          <PressLink
            href={mailto}
            action="contact"
            label="Emailed the press inbox"
            newTab
            className={styles.inlineLink}
          >
            {PRESS_EMAIL}
          </PressLink>
          .
        </p>
        <div className={styles.people}>
          {PEOPLE.map(person => (
            <div key={person.name} className={styles.person}>
              <div className={styles.personHead}>
                <Image
                  src={person.photo}
                  alt={person.name}
                  width={72}
                  height={72}
                />
                <div>
                  <p className="paragraph-default-bold padding-bottom-4px">
                    {person.name}
                  </p>
                  <p className="paragraph-small color-teal-300">
                    {person.role}
                  </p>
                </div>
              </div>
              <p className="paragraph-small">
                <strong className="color-white">Can speak to: </strong>
                {person.speaksTo}
              </p>
              <p className="paragraph-small">{person.bio}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Covering AI safety */}
      <section id="covering-ai-safety" className={styles.section}>
        <h2>Covering AI safety? Start here</h2>
        <p className={`paragraph-small ${styles.lead}`}>
          Most of what we maintain is useful to you whether or not you ever
          mention us. Here is the short version of where to look.
        </p>
        <div className={`paragraph-small ${styles.topics}`}>
          <div className={styles.topic}>
            <p className="paragraph-default-bold color-white">
              You need someone to talk to.
            </p>
            <p>
              Our{' '}
              <Link href="/map" className={styles.inlineLink}>
                field map
              </Link>{' '}
              lists organizations by what they actually work on, so you can find
              the lab, policy shop or research group whose work bears on your
              story rather than emailing the three names that always get quoted.
            </p>
            <p>
              If you are looking for a researcher working on a specific
              question, email us and we will point you to people.
            </p>
          </div>

          <div className={styles.topic}>
            <p className="paragraph-default-bold color-white">
              You need to understand a claim before you quote it.
            </p>
            <p>
              <a
                href="https://aisafety.info"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.inlineLink}
              >
                AISafety.info
              </a>{' '}
              answers the standard questions (what “alignment” means, why anyone
              thinks this is urgent, what the main disagreements are) without
              assuming a technical background.
            </p>
            <p>
              Our{' '}
              <Link href="/self-study" className={styles.inlineLink}>
                self-study list
              </Link>{' '}
              points to the primary material.
            </p>
          </div>

          <div className={styles.topic}>
            <p className="paragraph-default-bold color-white">
              You need to know who is arguing with whom.
            </p>
            <p>
              This field disagrees with itself, loudly, about timelines, about
              whether existential risk is the right frame, and about what
              regulation should do. Our directories are deliberately broad, and
              a listing is not an endorsement.
            </p>
          </div>

          <div className={styles.topic}>
            <p className="paragraph-default-bold color-white">
              You are writing about money, jobs or influence.
            </p>
            <p>
              Our{' '}
              <Link href="/funding" className={styles.inlineLink}>
                funding
              </Link>{' '}
              and{' '}
              <Link href="/jobs" className={styles.inlineLink}>
                jobs
              </Link>{' '}
              directories are the closest thing to a public record of where
              resources in this field are going and who is hiring for what.
            </p>
            <p>
              Our{' '}
              <Link href="/donation-guide" className={styles.inlineLink}>
                donation guide
              </Link>{' '}
              walks donors through where a gift of $100 or $100,000 does the
              most good in AI safety.
            </p>
          </div>

          <div className={styles.topic}>
            <p className="paragraph-default-bold color-white">
              Anything here is yours to use.
            </p>
            <p>
              Cite us or don’t. If you need a cut of our data that the site
              doesn’t give you – a list filtered a particular way, a historical
              snapshot – ask and we will do our best to share it.
            </p>
            <p>
              Every directory is also open data: the{' '}
              <Link href="/developers" className={styles.inlineLink}>
                Data API
              </Link>{' '}
              serves the same listings as JSON, free, under a CC BY license.
            </p>
          </div>
        </div>

        <h3 className={styles.subhead}>
          Five things coverage tends to get wrong
        </h3>
        <p className={`paragraph-small ${styles.lead}`}>
          Offered in good faith, not as a complaint. These are the corrections
          we find ourselves making most often.
        </p>
        <ol className={`paragraph-small ${styles.mistakes}`}>
          {COVERAGE_MISTAKES.map(item => (
            <li key={item.claim}>
              <strong>{item.claim}</strong> {item.text}
            </li>
          ))}
        </ol>
      </section>

      {/* Brand assets */}
      <section id="brand-assets" className={styles.section}>
        <h2>Brand assets</h2>
        <p className={`paragraph-small ${styles.lead}`}>
          Write the name <strong className="color-white">AISafety.com</strong>:
          one word, capital A, capital S, lowercase “com”. Not “AI Safety.com”,
          and not “aisafety.com” mid-sentence. Use the logo to refer to us.
          Don’t alter the colors, stretch it, or place it so it reads as an
          endorsement of something. If you need a variant we haven’t provided,
          ask.
        </p>

        <div className={styles.assetGrid}>
          {LOGOS.map(logo => (
            <div key={logo.id} className={styles.assetCard}>
              <div
                className={`${styles.assetPreview} ${
                  logo.on === 'dark'
                    ? styles.onDark
                    : logo.on === 'light'
                      ? styles.onLight
                      : styles.onTile
                }`}
              >
                {logo.on === 'tile' ? (
                  <Image
                    src={logo.png}
                    alt={`AISafety.com ${logo.label.toLowerCase()}`}
                    width={logo.id === 'square' ? 1522 : 1790}
                    height={logo.id === 'square' ? 1522 : 880}
                    sizes="(max-width: 991px) 100vw, 280px"
                  />
                ) : (
                  <Image
                    src={logo.svg}
                    alt={`AISafety.com ${logo.label.toLowerCase()}`}
                    width={139}
                    height={24}
                    unoptimized
                  />
                )}
              </div>
              <div className={`paragraph-small ${styles.assetMeta}`}>
                <span className="paragraph-small-bold">{logo.label}</span>
                <span className={`paragraph-xs ${styles.assetNote}`}>
                  {logo.note}
                </span>
                <div className={`paragraph-xs ${styles.assetLinks}`}>
                  {'svg' in logo && (
                    <PressLink
                      href={logo.svg}
                      action="download"
                      label={`Downloaded logo (${logo.id} SVG)`}
                      download
                    >
                      SVG
                    </PressLink>
                  )}
                  <PressLink
                    href={logo.png}
                    action="download"
                    label={`Downloaded logo (${logo.id} PNG)`}
                    download
                  >
                    PNG
                  </PressLink>
                </div>
              </div>
            </div>
          ))}
        </div>

        <h3 className={styles.subhead}>Screenshots</h3>
        <p className={`paragraph-small ${styles.lead}`}>
          Re-shot from the live site every week
          {kit ? `, last on ${formatDate(kit.updatedAt.slice(0, 10))}` : ''}.
          Each is 2880 × 1800 pixels; click one to open the full-size file.
        </p>
        <div className={styles.shotGrid}>
          {SCREENSHOTS.map(shot => (
            <div key={shot.id} className={styles.shot}>
              <PressLink
                href={shot.file}
                action="download"
                label={`Opened screenshot (${shot.id})`}
                newTab
              >
                <Image
                  src={shot.thumb}
                  alt={`AISafety.com ${shot.label.toLowerCase()} screenshot`}
                  width={1440}
                  height={900}
                  unoptimized
                />
              </PressLink>
              <span className="paragraph-xs color-teal-300">{shot.label}</span>
            </div>
          ))}
        </div>

        <div className={styles.kitRow}>
          <PressLink
            href={PRESS_KIT_ZIP}
            action="download"
            label="Downloaded press kit"
            className="button-primary"
          >
            Download everything (zip
            {kit ? `, ${(kit.zipBytes / 1_000_000).toFixed(1)} MB` : ''})
          </PressLink>
          <span className="paragraph-xs color-teal-300">
            All logos and screenshots above, in one file.
          </span>
        </div>
      </section>

      {/* News */}
      <section id="news" className={styles.section}>
        <h2>News</h2>
        <p className={`paragraph-small ${styles.lead}`}>
          What we have launched, and where it was announced. Our{' '}
          <a
            href="https://aisafetycom.substack.com/"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.inlineLink}
          >
            updates newsletter
          </a>{' '}
          goes out when we launch something new, about every two months.
        </p>
        {coverage.length > 0 && (
          <>
            <h3 className="padding-bottom-16px">Coverage</h3>
            <NewsList items={coverage} />
            <h3 className={styles.subhead}>Announcements</h3>
          </>
        )}
        <NewsList items={announcements} />
      </section>

      {/* Get in touch */}
      <section id="get-in-touch" className={styles.section}>
        <h2>Get in touch</h2>
        <div className={styles.contactGrid}>
          <div className={styles.contactCard}>
            <p className="color-white paragraph-default-bold">
              Press inquiries
            </p>
            <PressLink
              href={mailto}
              action="contact"
              label="Emailed the press inbox"
              newTab
              className={styles.email}
            >
              {PRESS_EMAIL}
            </PressLink>
            <p className="paragraph-small color-teal-300">
              We are a small team, so please include your deadline in the
              subject line. We aim to reply within two working days.
            </p>
          </div>
          <div className={`paragraph-small ${styles.prose}`}>
            <div>
              <p className="color-white paragraph-small-bold padding-bottom-8px">
                What we can help with
              </p>
              <ul className={styles.contactList}>
                <li>Context on the field and how it is organized</li>
                <li>Pointers to researchers working on a specific question</li>
                <li>Data from our directories</li>
                <li>Background on our own work</li>
              </ul>
            </div>
            <div>
              <p className="color-white paragraph-small-bold padding-bottom-8px">
                What we can’t
              </p>
              <ul className={styles.contactList}>
                <li>Speak for the organizations we list</li>
                <li>Recommend one research agenda over another</li>
                <li>Comment on a specific company’s safety practices</li>
              </ul>
            </div>
            <p>
              Not a journalist?{' '}
              <a
                href="https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.inlineLink}
              >
                Suggest a correction
              </a>
              , or find the team on the{' '}
              <Link href="/about" className={styles.inlineLink}>
                about page
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function FactRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function NewsList({ items }: { items: typeof NEWS }) {
  return (
    <ul className={`paragraph-small ${styles.newsList}`}>
      {items.map(item => (
        <li key={item.url} className={styles.newsItem}>
          <span className={styles.newsDate}>{formatDate(item.date)}</span>
          <span className={styles.newsTitle}>
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {item.title}
            </a>
            <span className={styles.newsOutlet}> · {item.outlet}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
