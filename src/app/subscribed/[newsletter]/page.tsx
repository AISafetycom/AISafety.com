import type { Metadata } from 'next'
import { Fragment } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { COMBO_KEYS, type SignupNewsletter } from '@/lib/newsletter-signup'

// Where ActiveCampaign sends readers after they click "Confirm subscription"
// in the email the signup boxes on /events, /training and /funding trigger (each
// form's confirmation redirect points at its own path), in place of
// ActiveCampaign's unbranded confirmation page. The subscription is already
// confirmed by the time they land here. The twin of /unsubscribed.
// The newsletters page (/newsletter) signs up to several at once through a
// form per combination, which lands on /subscribed/events-funding and the
// like: the same page, naming each newsletter.
const NEWSLETTERS = {
  events: {
    name: 'AI Safety Events',
    page: '/events',
    what: 'upcoming events',
    when: 'once a week',
  },
  training: {
    name: 'AI Safety Training',
    page: '/training',
    what: 'upcoming training programs',
    when: 'once a week',
  },
  // No set rhythm: an issue goes out only when there's something new.
  funding: {
    name: 'AI Safety Funding',
    page: '/funding',
    what: 'funders in AI safety',
    when: 'whenever there are new funding opportunities',
  },
} as const

type Key = keyof typeof NEWSLETTERS

/** The newsletters a confirm page stands for: one, or a combination's. */
function newslettersOf(key: string): Key[] | null {
  if (key in NEWSLETTERS) return [key as Key]
  if ((COMBO_KEYS as readonly string[]).includes(key))
    return key.split('-') as SignupNewsletter[]
  return null
}

/** "A", "A and B", "A, B, and C". */
function listOf(parts: React.ReactNode[]): React.ReactNode {
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 &&
        (i === parts.length - 1
          ? parts.length > 2
            ? ', and '
            : ' and '
          : ', ')}
      {part}
    </Fragment>
  ))
}

export const dynamicParams = false

export function generateStaticParams() {
  return [...Object.keys(NEWSLETTERS), ...COMBO_KEYS].map(newsletter => ({
    newsletter,
  }))
}

export const metadata: Metadata = {
  title: 'Subscribed – AISafety.com',
  robots: { index: false, follow: false },
}

export default async function SubscribedPage({
  params,
}: {
  params: Promise<{ newsletter: string }>
}) {
  const { newsletter } = await params
  const keys = newslettersOf(newsletter)
  if (!keys) notFound()
  const picked = keys.map(k => NEWSLETTERS[k])
  const one = picked.length === 1 ? picked[0] : null

  return (
    <div className="container-narrow">
      <div className="flex justify-center">
        <div className="width-9-col-narrow padding-bottom-56px">
          <h1 className="padding-top-56px padding-bottom-40px">
            You&apos;re subscribed
          </h1>
          <h2 className="padding-bottom-40px">
            Thanks for confirming.{' '}
            {listOf(
              picked.map(n => (
                <span key={n.name} className="color-light-teal">
                  {n.name}
                </span>
              ))
            )}{' '}
            will arrive in your inbox{one ? ` ${one.when}` : ''}.
          </h2>
          <p className="color-teal-300 padding-bottom-16px">
            {one
              ? 'If it lands in spam or Promotions, move it to your inbox and it will stay there.'
              : 'If any of them lands in spam or Promotions, move it to your inbox and its next issues will stay there.'}
          </p>
          <p className="color-teal-300">
            In the meantime, see all{' '}
            {listOf(
              picked.map(n => (
                <Fragment key={n.page}>
                  {n.what} on{' '}
                  <Link href={n.page} className="color-light-teal">
                    AISafety.com{n.page}
                  </Link>
                </Fragment>
              ))
            )}
            .
          </p>
        </div>
      </div>
    </div>
  )
}
