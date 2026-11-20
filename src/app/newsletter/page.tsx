import type { Metadata } from 'next'
import PageHeader from '@/components/PageHeader'
import { NEWSLETTER_ABOUT, archivePath } from '@/lib/newsletter-archive'
import { SIGNUP_NEWSLETTERS, offeredNewsletters } from '@/lib/newsletter-signup'
import { WEB_NEWSLETTERS } from '@/lib/newsletter-web'
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
// Newsletters heading leads here. Updates is a box to tick like the others
// since it moved from Substack (November 2026). A visitor is only offered
// the newsletters whose signup forms exist in ActiveCampaign
// (offeredNewsletters); a reader managing their own sees them all.

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Newsletters – AISafety.com',
  description:
    'Free newsletters with new events, training programs, and funding opportunities addressing existential risk from AI. Sign up to one or all of them, or change which ones you get.',
  alternates: { canonical: '/newsletter' },
}

export default function NewslettersPage() {
  const newsletters = SIGNUP_NEWSLETTERS.map(key => ({
    key,
    name: WEB_NEWSLETTERS[key].sender,
    about: NEWSLETTER_ABOUT[key],
    archive: archivePath(key),
  }))
  return (
    // Centered on the narrow grid, like /listing-policy and /subscribed
    // (Melissa, 17 Nov 2026).
    <div className="container-narrow">
      <div className="flex justify-center">
        <div className="width-9-col-narrow padding-bottom-56px">
          <PageHeader
            title="Newsletters"
            description={
              <>
                <span className="color-teal-300">
                  New events, training programs, and funding opportunities
                </span>{' '}
                addressing existential risk from AI, in your inbox.
              </>
            }
          />
          <NewsletterChooser
            newsletters={newsletters}
            offered={offeredNewsletters()}
          />
        </div>
      </div>
    </div>
  )
}
