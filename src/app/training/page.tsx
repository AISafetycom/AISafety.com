import Link from 'next/link'
import { fetchLastUpdated } from '@/lib/data/last-updated'
import PageHeader from '@/components/PageHeader'
import { getTrainingPrograms, getRecurringPrograms } from '@/lib/data/training'
import TrainingClient from './TrainingClient'
import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

export const metadata = pageMetadata(SITE_PAGES.training)

export default async function TrainingPage() {
  const [programs, recurring, lastUpdated] = await Promise.all([
    getTrainingPrograms(),
    getRecurringPrograms(),
    fetchLastUpdated('training'),
  ])

  return (
    <div className="container-default">
      <PageHeader
        title="Training programs"
        lastUpdatedIso={lastUpdated.lastUpdated}
        newsletter
        newsletterTrackingPage="Training"
        description={
          <>
            Find{' '}
            <span className="color-teal-bright-300">
              fellowships, bootcamps, and courses
            </span>{' '}
            in AI safety to upskill and build career capital. Both online and in
            person.
          </>
        }
      >
        <Link href="/events" className="paragraph-small color-teal-300">
          For conferences, talks, workshops, and more go to{' '}
          <span className="color-white">Events</span>&nbsp;&rarr;
        </Link>
      </PageHeader>

      <TrainingClient programs={programs} recurring={recurring} />
    </div>
  )
}
