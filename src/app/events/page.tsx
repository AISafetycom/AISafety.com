import Link from 'next/link'
import { fetchLastUpdated } from '@/lib/data/last-updated'
import PageHeader from '@/components/PageHeader'
import { getEvents } from '@/lib/data/events'
import EventsClient from './EventsClient'
import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

export const metadata = pageMetadata(SITE_PAGES.events)

export default async function EventsPage() {
  const [events, lastUpdated] = await Promise.all([
    getEvents(),
    fetchLastUpdated('events'),
  ])

  return (
    <div className="container-default">
      <PageHeader
        title="Events"
        lastUpdatedIso={lastUpdated.lastUpdated}
        newsletter
        newsletterTrackingPage="Events"
        description={
          <>
            Find{' '}
            <span className="color-teal-bright-300">
              conferences, talks, workshops, meetups, and competitions
            </span>{' '}
            in AI safety, both online and in person.
          </>
        }
      >
        <Link href="/training" className="paragraph-small color-teal-300">
          For fellowships, bootcamps, and courses go to{' '}
          <span className="color-white">Training programs</span>&nbsp;&rarr;
        </Link>
      </PageHeader>

      <EventsClient events={events} />
    </div>
  )
}
