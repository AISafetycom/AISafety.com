import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

// Where ActiveCampaign sends readers after they click "Confirm subscription"
// in the email the signup boxes on /events and /training trigger (each
// form's confirmation redirect points at its own path), in place of
// ActiveCampaign's unbranded confirmation page. The subscription is already
// confirmed by the time they land here. The twin of /unsubscribed.
const NEWSLETTERS = {
  events: {
    name: 'AI Safety Events',
    page: '/events',
    what: 'upcoming events',
  },
  training: {
    name: 'AI Safety Training',
    page: '/training',
    what: 'upcoming training programs',
  },
} as const

type Key = keyof typeof NEWSLETTERS

export const dynamicParams = false

export function generateStaticParams() {
  return Object.keys(NEWSLETTERS).map(newsletter => ({ newsletter }))
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
  if (!(newsletter in NEWSLETTERS)) notFound()
  const { name, page, what } = NEWSLETTERS[newsletter as Key]

  return (
    <div className="container-narrow">
      <div className="flex justify-center">
        <div className="width-9-col-narrow padding-bottom-56px">
          <h1 className="padding-top-56px padding-bottom-40px">
            You&apos;re subscribed
          </h1>
          <h2 className="padding-bottom-40px">
            Thanks for confirming.{' '}
            <span className="color-light-teal">{name}</span> will arrive in your
            inbox once a week.
          </h2>
          <p className="color-teal-300 padding-bottom-16px">
            If it lands in spam or Promotions, move it to your inbox and it will
            stay there.
          </p>
          <p className="color-teal-300">
            In the meantime, see all {what} on{' '}
            <Link href={page} className="color-light-teal">
              AISafety.com{page}
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
