import type { Metadata } from 'next'
import PageHeader from '@/components/PageHeader'
import { NEWSLETTER_ABOUT, archivePath } from '@/lib/newsletter-archive'
import { SIGNUP_NEWSLETTERS } from '@/lib/newsletter-signup'
import { WEB_NEWSLETTERS } from '@/lib/newsletter-web'
import { withUtm } from '@/lib/utm'
import NewsletterChooser from './NewsletterChooser'

// /newsletter: every AISafety.com newsletter on one page. A visitor ticks
// the ones they want and signs up once (one confirmation email covers them
// all, /api/subscribe). A reader who follows the "Manage subscriptions"
// link at the bottom of an issue (#k=<key>, src/lib/newsletter-manage.ts)
// sees the newsletters they get instead, and can change them or leave them
// all. The page is the same static file for everyone: the reader's own
// view is drawn in the browser, from /api/newsletter/settings.
//
// Each newsletter's own page (/newsletter/events, …) stays the one to link
// for that newsletter; this one is for all of them, and the footer's
// Newsletters heading leads here. The Updates newsletter is still on
// Substack, so it's a link rather than a box to tick.

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Newsletters – AISafety.com',
  description:
    'Free newsletters with new events, training programs, and funding opportunities addressing existential risk from AI. Sign up to one or all of them, or change which ones you get.',
  alternates: { canonical: '/newsletter' },
}

const UPDATES_URL = 'https://aisafetycom.substack.com/'

export default function NewslettersPage() {
  const newsletters = SIGNUP_NEWSLETTERS.map(key => ({
    key,
    name: WEB_NEWSLETTERS[key].sender,
    about: NEWSLETTER_ABOUT[key],
    archive: archivePath(key),
  }))
  return (
    <div className="container-default">
      <PageHeader
        title="Newsletters"
        description="New events, training programs, and funding opportunities addressing existential risk from AI, in your inbox."
      />
      <div className="width-7-col padding-bottom-56px">
        <NewsletterChooser
          newsletters={newsletters}
          updates={{
            name: 'AISafety.com Updates',
            about:
              'goes out when AISafety.com launches something new, about every two months. It’s on Substack.',
            url: withUtm(UPDATES_URL, 'Newsletters'),
          }}
        />
      </div>
    </div>
  )
}
