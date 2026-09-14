import Image from 'next/image'
import Icon from '@/components/Icon'
import Link from 'next/link'
import RelativeDate from '@/components/RelativeDate'
import TrackedLink from '@/components/TrackedLink'
import CardLogo from '@/components/CardLogo'
import { fetchAllLastUpdated } from '@/lib/data/last-updated'
import { getTrainingPrograms, type TrainingProgram } from '@/lib/data/training'
import { selectFeatured, withRandomStandIns } from '@/lib/featured'
import styles from './page.module.css'

export const metadata = {
  alternates: { canonical: '/' },
}

// The training card's featured slot mirrors the top of /training: the
// best-ranked program in the Airtable Featured queue whose applications are
// still open, or a random stand-in from the page when the queue has none.
function pickFeaturedProgram(
  programs: TrainingProgram[]
): TrainingProgram | undefined {
  const isOpen = (p: TrainingProgram) => p.applicationStatus === 'Open'
  return withRandomStandIns(
    selectFeatured(programs, isOpen),
    programs,
    isOpen
  )[0]
}

// "16 October 2026" — full month name, matching the events card beside it.
function formatLongDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  const month = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  }).format(d)
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`
}

// The box's subtitle already says where a program runs, so the place is
// dropped from the round part of its name ("GCP: London November 2026" →
// "GCP: November 2026") to keep long names to two lines. Only the part after
// the last colon is touched, so a place inside the program's own name stays.
function nameWithoutPlace(program: TrainingProgram): string {
  const i = program.name.lastIndexOf(': ')
  if (i === -1) return program.name
  let round = program.name.slice(i + 2)
  for (const facet of program.location.split(' & ')) {
    const place = facet.split(',')[0].trim()
    if (!place) continue
    const escaped = place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    round = round.replace(new RegExp(`(?<!\\w)${escaped}(?!\\w)`), '')
  }
  round = round.replace(/\s+/g, ' ').replace(/^[\s,–-]+|[\s,–-]+$/g, '')
  return round
    ? `${program.name.slice(0, i + 2)}${round}`
    : program.name.slice(0, i)
}

// The line under the program's name — "Apply by DATE · PLACE": the
// application deadline when there is one, otherwise the start, then where
// it runs (Bryce wants the location kept even when the line wraps).
function programDateLine(program: TrainingProgram): string {
  let when: string | null = null
  if (program.notYetOpen) {
    when = 'Applications not yet open'
  } else if (program.applicationsClose) {
    when =
      program.applicationStatus === 'Open'
        ? `Apply by ${formatLongDate(program.applicationsClose)}`
        : 'Applications closed'
  } else if (program.startDateApprox) {
    when = `Starts ${program.startDateApprox}`
  } else if (program.startDate) {
    when = `Starts ${formatLongDate(program.startDate)}`
  }
  const where = program.mode === 'Online' ? 'Online' : program.location
  return [when, where].filter(Boolean).join(' · ')
}

// The featured box fits three lines, like the events card's blurb, while
// Airtable descriptions run longer. Show whole sentences up to that budget —
// never a cut-off sentence or an ellipsis. When even the first sentence is
// too long, end it at its last clause break instead ("…risks from advanced
// AI, for professionals…" → "…risks from advanced AI.").
function leadSentences(text: string, max = 125): string {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/)
  let out = ''
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence
    if (out && next.length > max) break
    out = next
  }
  if (out.length > max) {
    const clause = out.slice(0, max).replace(/[,;:]\s[^,;:]*$/, '')
    if (clause.length < out.length && clause.length >= max / 2) {
      return `${clause}.`
    }
  }
  return out
}

export default async function Home() {
  const [dates, programs] = await Promise.all([
    fetchAllLastUpdated(),
    getTrainingPrograms(),
  ])
  const featuredProgram = pickFeaturedProgram(programs)

  return (
    <div className="container-default home-page">
      <div className="flex flex-col-mobile items-start gap-40px padding-top-56px padding-bottom-80px">
        <h1 className="width-8-col">
          Find your place in the AI safety ecosystem
        </h1>
        <div className="width-4-col">
          <p className="padding-bottom-32px">
            Curated lists of events, communities, courses, and more – focused on
            preventing human extinction from AI.
          </p>
          <div className={styles.attribution}>
            <Image
              width={80}
              height={32}
              loading="lazy"
              alt="Community thumbnails"
              src="/images/team-thumbnails.png"
              className="margin-bottom-12px"
            />
            <p className="paragraph-xs">
              Maintained by{' '}
              <a href="/about" className="underline">
                AI safety community-builders
              </a>
            </p>
          </div>
        </div>
      </div>

      <div className={`${styles['card-full-width-1']} margin-bottom-40px`}>
        <div>
          <p className="paragraph-small-bold shadow-text padding-bottom-12px">
            Attend an event
          </p>
          <h2 className="shadow-text padding-bottom-40px">
            Conferences, talks, workshops, meetups, and competitions in AI
            safety – online and in person
          </h2>
          <Link href="/events" className="button-primary drop-shadow">
            View all events
          </Link>
          {dates.events && (
            <RelativeDate
              iso={dates.events}
              className={`${styles.date} paragraph-xs shadow-text`}
            />
          )}
        </div>
        <div className={styles['card-full-width-1-right-card']}>
          <Image
            loading="lazy"
            src="/images/bookmarks/bookmark-light.svg"
            alt=""
            className={styles.bookmark}
            width={24}
            height={32}
          />
          <div className="flex items-start gap-16px padding-bottom-16px">
            <div className="featured-img">
              <Image
                loading="lazy"
                src="/images/ea-global-logo.webp"
                alt="EA Global logo"
                width={64}
                height={64}
                className="card-image"
              />
            </div>
            <div>
              <h3 className="shadow-text padding-bottom-8px">
                EA Global: New York City 2026
              </h3>
              <p className="paragraph-small-bold shadow-text">
                {/* Location omitted – obvious from event name. Format: "DATE – CITY, COUNTRY" */}
                16–18 October 2026
              </p>
            </div>
          </div>
          <p className="padding-bottom-40px">
            3-day conference with talks, workshops, and networking in AI safety
            and other effective altruism cause areas.
          </p>
          <TrackedLink
            href="https://www.effectivealtruism.org/ea-global/events/ea-global-new-york-city-2026"
            target="_blank"
            rel="noopener noreferrer"
            className="button-secondary"
            trackingPage="Home"
            trackingName="EA Global: New York City 2026"
          >
            Learn more
          </TrackedLink>
        </div>
      </div>

      <div className={`${styles['card-full-width-2']} margin-bottom-40px`}>
        <div
          className={`${styles['card-full-width-2-left-card']} backdrop-blur-md`}
        >
          <p className="paragraph-small-bold shadow-text padding-bottom-12px">
            Explore the ecosystem
          </p>
          <h2 className="shadow-text padding-bottom-40px">
            A visual overview of the key organizations, programs, and projects
            in AI safety
          </h2>
          <Link href="/map" className="button-primary drop-shadow-light">
            View map
          </Link>
          {dates.map && (
            <RelativeDate
              iso={dates.map}
              className={`${styles.date} paragraph-xs shadow-text opacity-80`}
            />
          )}
        </div>
      </div>

      <div
        className={`${styles['card-full-width-1']} ${styles['card-full-width-training']} margin-bottom-40px`}
      >
        <div>
          <p className="paragraph-small-bold shadow-text padding-bottom-12px">
            Join a training program
          </p>
          <h2 className="shadow-text padding-bottom-40px">
            Fellowships, bootcamps, and courses to build skills and career
            capital in AI safety – online and in person
          </h2>
          <Link href="/training" className="button-primary drop-shadow">
            View all training programs
          </Link>
          {dates.training && (
            <RelativeDate
              iso={dates.training}
              className={`${styles.date} paragraph-xs shadow-text`}
            />
          )}
        </div>
        {featuredProgram && (
          <div className={styles['card-full-width-1-right-card']}>
            <Image
              loading="lazy"
              src="/images/bookmarks/bookmark-light.svg"
              alt=""
              className={styles.bookmark}
              width={24}
              height={32}
            />
            <div className="flex items-start gap-16px padding-bottom-16px">
              {featuredProgram.logo && (
                <CardLogo
                  src={featuredProgram.logo}
                  alt={`${featuredProgram.name} logo`}
                />
              )}
              <div>
                <h3 className="shadow-text padding-bottom-8px">
                  {nameWithoutPlace(featuredProgram)}
                </h3>
                <p className="paragraph-small-bold shadow-text">
                  {programDateLine(featuredProgram)}
                </p>
              </div>
            </div>
            <p className={`${styles['max-3-lines']} margin-bottom-40px`}>
              {leadSentences(featuredProgram.description)}
            </p>
            {featuredProgram.url !== '#' && (
              <TrackedLink
                href={featuredProgram.url}
                target="_blank"
                rel="noopener noreferrer"
                className="button-secondary"
                trackingPage="Home"
                trackingName={featuredProgram.name}
                trackingId={featuredProgram.id}
              >
                Learn more
              </TrackedLink>
            )}
          </div>
        )}
      </div>

      <div className={`${styles['card-full-width-3']} margin-bottom-40px`}>
        <div>
          <p className="paragraph-small-bold padding-bottom-12px">
            Join a community
          </p>
          <h2 className="padding-bottom-40px">
            Groups dedicated to discussing and contributing to AI safety, both
            online and in-person
          </h2>
          <Link
            href="/communities"
            className="button-primary drop-shadow-light"
          >
            View all communities
          </Link>
          {dates.communities && (
            <RelativeDate
              iso={dates.communities}
              className={`${styles.date} paragraph-xs`}
            />
          )}
        </div>
        <div className={styles['card-full-width-3-right-card-light']}>
          <Image
            loading="lazy"
            src="/images/bookmarks/bookmark-dark.svg"
            alt=""
            className={styles.bookmark}
            width={24}
            height={32}
          />
          <p className="paragraph-small-bold padding-bottom-12px">
            Largest real-time community
          </p>
          <div className={`${styles['icon-row']} padding-bottom-24px`}>
            <Image
              loading="lazy"
              src="/images/ai-alignment-slack.png"
              alt=""
              className={styles['icon-homepage']}
              width={56}
              height={56}
            />
            <h3>AI Alignment Slack</h3>
          </div>
          <p className="padding-bottom-32px">
            Join thousands of AI safety folks ready to answer questions, share
            opportunities, and connect.
          </p>
          <TrackedLink
            href="https://join.slack.com/t/ai-alignment/shared_invite/zt-46igeclhz-5mzaevYc__pKUIGX6Fe4lQ"
            target="_blank"
            rel="noopener noreferrer"
            className="button-secondary"
            trackingPage="Home"
            trackingName="AI Alignment Slack"
          >
            Join
          </TrackedLink>
        </div>
      </div>

      <div className={`${styles['cards-grid-2-col']} margin-bottom-40px`}>
        <div className={styles['card-half-width-1']}>
          <div className={styles['card-half-width-main-text']}>
            <p className="paragraph-small-bold padding-bottom-12px shadow-text">
              Learn
            </p>
            <h2 className="width-4-col padding-bottom-40px shadow-text">
              Self-study courses and curated study guides to deepen your
              expertise
            </h2>
            <Link href="/self-study" className="button-primary drop-shadow">
              View all self-study options
            </Link>
            {dates['self-study'] && (
              <RelativeDate
                iso={dates['self-study']}
                className={`${styles['date-alt']} paragraph-xs`}
              />
            )}
          </div>
          <div
            className={`${styles['card-half-width-bottom-card']} backdrop-blur-md`}
          >
            <Image
              loading="lazy"
              src="/images/bookmarks/bookmark-light.svg"
              alt=""
              className={styles.bookmark}
              width={24}
              height={32}
            />
            <p className="paragraph-small-bold padding-bottom-12px">
              Standard intro course
            </p>
            <div className={`${styles['icon-row']} padding-bottom-24px`}>
              <Image
                loading="lazy"
                src="/images/blue-dot-impact.svg"
                alt=""
                width={56}
                height={56}
              />
              <h3>BlueDot Impact: Technical &amp; Governance</h3>
            </div>
            <p className="padding-bottom-24px">
              Learn key concepts and research perspectives in AI safety, split
              into two main tracks.
            </p>
            <div className="block">
              <TrackedLink
                href="https://bluedot.org/courses"
                target="_blank"
                rel="noopener noreferrer"
                className="button-secondary"
                trackingPage="Home"
                trackingName="BlueDot Impact: Technical & Governance"
              >
                View curricula
              </TrackedLink>
            </div>
          </div>
        </div>

        <div className={styles['card-half-width-2']}>
          {dates.jobs && (
            <RelativeDate
              iso={dates.jobs}
              className={`${styles['date-alt']} paragraph-xs opacity-80`}
            />
          )}
          <p className="paragraph-small-bold padding-bottom-12px opacity-80">
            Find a job
          </p>
          <h2 className="width-4-col padding-bottom-40px">
            Open positions in research, policy, operations, and more
          </h2>
          <Link href="/jobs" className="button-primary drop-shadow">
            View all jobs
          </Link>
          {dates.jobs && (
            <RelativeDate
              iso={dates.jobs}
              className={`${styles['date-alt']} paragraph-xs opacity-80`}
            />
          )}
        </div>

        <div className={styles['card-half-width-3']}>
          <div className={styles['card-half-width-main-text']}>
            <p className="paragraph-small-bold padding-bottom-12px opacity-80">
              Stay informed
            </p>
            <h2 className="width-4-col padding-bottom-40px">
              Podcasts, newsletters, and more to keep you up to date in AI
              safety
            </h2>
            <Link href="/media-channels" className="button-primary drop-shadow">
              View all media channels
            </Link>
            {dates['media-channels'] && (
              <RelativeDate
                iso={dates['media-channels']}
                className={`${styles['date-alt']} paragraph-xs opacity-80`}
              />
            )}
          </div>
        </div>

        <div className={styles['card-half-width-4']}>
          <div className={styles['card-half-width-main-text']}>
            <p className="paragraph-small-bold padding-bottom-12px">
              Get funding
            </p>
            <h2 className="width-4-col padding-bottom-40px">
              Organizations offering financial support to AI safety projects
            </h2>
            <Link href="/funding" className="button-primary drop-shadow-light">
              View all funders
            </Link>
            {dates.funding && (
              <RelativeDate
                iso={dates.funding}
                className={`${styles['date-alt']} paragraph-xs`}
              />
            )}
          </div>
          <div className={styles['card-half-width-bottom-card-light']}>
            <Image
              loading="lazy"
              src="/images/bookmarks/bookmark-dark.svg"
              alt=""
              className={styles.bookmark}
              width={24}
              height={32}
            />
            <p className="paragraph-small-bold padding-bottom-12px">
              Best for mid- to large-scale projects
            </p>
            <div className={`${styles['icon-row']} padding-bottom-24px`}>
              <Image
                loading="lazy"
                src="/images/lightcone-commons.webp"
                alt=""
                width={51}
                height={56}
              />
              <h3>Lightcone Commons</h3>
            </div>
            <p className="padding-bottom-24px">
              New grantmaking platform coordinating large-scale philanthropy in
              quarterly rounds.
            </p>
            <TrackedLink
              href="https://www.lightconecommons.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="button-secondary"
              trackingPage="Home"
              trackingName="Lightcone Commons"
            >
              Learn more
            </TrackedLink>
          </div>
        </div>
      </div>

      <div className={`${styles['cards-grid-3-col']} padding-bottom-104px`}>
        <div className={styles['card-third-width-1']}>
          <div className={styles['card-half-width-main-text']}>
            <p className="paragraph-small-bold padding-bottom-8px shadow-text">
              Speak to an advisor
            </p>
            <h3 className="padding-bottom-32px shadow-text">
              Free 1-1 calls to help you contribute most effectively to AI
              safety
            </h3>
            <Link href="/advisors" className="button-primary drop-shadow">
              View all advisors
            </Link>
            {dates.advisors && (
              <RelativeDate
                iso={dates.advisors}
                className={`${styles['date-alt']} paragraph-xs shadow-text`}
              />
            )}
          </div>
        </div>

        <div className={styles['card-third-width-2']}>
          <div className={styles['card-half-width-main-text']}>
            <p className="paragraph-small-bold padding-bottom-8px">
              Found an organization
            </p>
            <h3 className="padding-bottom-32px">
              Resources for starting and growing an AI safety organization
            </h3>
            <Link href="/founders" className="button-primary drop-shadow">
              View founder toolkit
            </Link>
            {dates.founders && (
              <RelativeDate
                iso={dates.founders}
                className={`${styles['date-alt']} paragraph-xs`}
              />
            )}
          </div>
          <div className={styles['card-third-width-bottom-card']}>
            <Image
              loading="lazy"
              src="/images/bookmarks/bookmark-dark-small.svg"
              alt=""
              className={styles.bookmark}
              width={24}
              height={32}
            />
            <p className="paragraph-small-bold padding-bottom-12px">
              Featured fiscal sponsor
            </p>
            <div className={`${styles['icon-row']} padding-bottom-24px`}>
              <h3>Ashgro</h3>
            </div>
            <div className="block">
              <TrackedLink
                href="https://www.ashgro.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="button-secondary"
                trackingPage="Home"
                trackingName="Ashgro"
              >
                Learn more
              </TrackedLink>
            </div>
          </div>
        </div>

        <div className={styles['card-third-width-3']}>
          <div className={styles['card-half-width-main-text']}>
            <p className="paragraph-small-bold padding-bottom-8px opacity-80">
              Donate
            </p>
            <h3 className="padding-bottom-32px">
              How to donate effectively to the AI safety field
            </h3>
            <Link href="/donation-guide" className="button-primary drop-shadow">
              View guide
            </Link>
            {dates['donation-guide'] && (
              <RelativeDate
                iso={dates['donation-guide']}
                className={`${styles['date-alt']} paragraph-xs opacity-80`}
              />
            )}
          </div>
        </div>
      </div>

      <div className={styles['aisafety-info']}>
        <div className="width-6-col">
          <p className="color-teal paragraph-small-bold padding-bottom-12px">
            Visit AISafety.info
          </p>
          <h2 className="shadow-text">
            Learn what AI safety is, why it matters, and what you can do to help
          </h2>
        </div>
        <TrackedLink
          href="https://aisafety.info/"
          target="_blank"
          rel="noopener noreferrer"
          className="button-primary"
          trackingPage="Home"
          trackingName="AISafety.info"
        >
          <span>AISafety.info</span>
          <Icon
            src="/images/icons/arrow-up-right.svg"
            className="color-teal-bright-400"
          />
        </TrackedLink>
      </div>
    </div>
  )
}
