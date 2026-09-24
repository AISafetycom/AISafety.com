import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

// Where ActiveCampaign sends readers after they unsubscribe from one of the
// newsletters (each list's "Public Pages" redirect points at its own path),
// in place of ActiveCampaign's unbranded page and its "report this as abuse"
// survey. Unsubscribing has already happened by the time they land here.
const NEWSLETTERS = {
  events: { name: 'AI Safety Events', page: '/events' },
  training: { name: 'AI Safety Training', page: '/training' },
  funding: { name: 'AI Safety Funding', page: '/funding' },
} as const

type Key = keyof typeof NEWSLETTERS

export const dynamicParams = false

export function generateStaticParams() {
  return Object.keys(NEWSLETTERS).map(newsletter => ({ newsletter }))
}

export const metadata: Metadata = {
  title: 'Unsubscribed – AISafety.com',
  robots: { index: false, follow: false },
}

export default async function UnsubscribedPage({
  params,
}: {
  params: Promise<{ newsletter: string }>
}) {
  const { newsletter } = await params
  if (!(newsletter in NEWSLETTERS)) notFound()
  const { name, page } = NEWSLETTERS[newsletter as Key]

  return (
    <div className="container-narrow">
      <div className="flex justify-center">
        <div className="width-9-col-narrow padding-bottom-56px">
          <h1 className="padding-top-56px padding-bottom-40px">
            You&apos;ve unsubscribed
          </h1>
          <h2 className="padding-bottom-40px">
            You won&apos;t get any more emails from{' '}
            <span className="color-light-teal">{name}</span>.
          </h2>
          <p className="color-teal-300 padding-bottom-16px">
            Any other AISafety.com newsletters you get will keep coming – each
            one has its own unsubscribe link at the bottom of its emails.
          </p>
          <p className="color-teal-300">
            Unsubscribed by mistake? You can sign up again on{' '}
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
