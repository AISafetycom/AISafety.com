import { fetchLastUpdated } from '@/lib/data/last-updated'
import PageHeader from '@/components/PageHeader'
import FeaturedCard from '@/components/FeaturedCard'
import AdvisorsClient from './AdvisorsClient'
import { getAdvisors } from '@/lib/data/advisors'
import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

export const metadata = pageMetadata(SITE_PAGES.advisors)

export default async function AdvisorsPage() {
  const [advisors, lastUpdated] = await Promise.all([
    getAdvisors(),
    fetchLastUpdated('advisors'),
  ])

  const featured = [
    advisors.find(a => a.featured === '1'),
    advisors.find(a => a.featured === '2'),
  ].filter((a): a is NonNullable<typeof a> => a != null)

  return (
    <div className="container-default">
      <PageHeader
        title="Advisors"
        lastUpdatedIso={lastUpdated.lastUpdated}
        description={
          <>
            <span className="color-light-teal">
              Connecting with human experts can be invaluable.
            </span>{' '}
            These advisors offer free guidance calls to help you most
            effectively contribute to AI safety.
          </>
        }
      />

      <div className="flex flex-wrap gap-56px padding-bottom-80px">
        {featured.map((advisor, i) => (
          <FeaturedCard
            key={advisor.id}
            className="width-6-col"
            href={advisor.url !== '#' ? advisor.url : undefined}
            tagline={advisor.featuredTagline!}
            name={advisor.name}
            description={advisor.description}
            logo={advisor.logo ?? undefined}
            meta={
              advisor.focus
                ? [{ icon: '/images/icons/target.svg', value: advisor.focus }]
                : []
            }
            trackingPage="Advisors"
            trackingId={advisor.id}
            trackingPosition={`F${advisor.featured}`}
            trackingSource="cards"
            index={i}
            count={featured.length}
          />
        ))}
      </div>

      <AdvisorsClient advisors={advisors} />
    </div>
  )
}
