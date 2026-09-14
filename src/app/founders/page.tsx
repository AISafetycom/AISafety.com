import { fetchLastUpdated } from '@/lib/data/last-updated'
import PageHeader from '@/components/PageHeader'
import FeaturedCard from '@/components/FeaturedCard'
import FoundersClient from './FoundersClient'
import { getFounderResources } from '@/lib/data/founders'
import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

export const metadata = pageMetadata(SITE_PAGES.founders)

export default async function FoundersPage() {
  const [resources, lastUpdated] = await Promise.all([
    getFounderResources(),
    fetchLastUpdated('founders'),
  ])

  const featured = [
    resources.find(r => r.featured === '1'),
    resources.find(r => r.featured === '2'),
  ].filter((r): r is NonNullable<typeof r> => r != null)

  return (
    <div className="container-default">
      <PageHeader
        title="Founder toolkit"
        lastUpdatedIso={lastUpdated.lastUpdated}
        description={
          <>
            Resources for{' '}
            <span className="color-light-teal">starting and growing</span> an AI
            safety organization – including incubators, fiscal sponsors, VCs,
            and practical tools.
          </>
        }
      />

      <div className="flex flex-wrap gap-56px padding-bottom-80px">
        {featured.map((resource, i) => (
          <FeaturedCard
            key={resource.id}
            className="width-6-col"
            href={resource.website !== '#' ? resource.website : undefined}
            tagline={resource.featuredTagline!}
            name={resource.name}
            description={resource.description}
            logo={resource.image ?? undefined}
            meta={
              resource.type
                ? [{ icon: '/images/icons/tag.svg', value: resource.type }]
                : []
            }
            trackingPage="Founders"
            trackingId={resource.id}
            trackingPosition={`F${resource.featured}`}
            trackingSource="cards"
            index={i}
            count={featured.length}
          />
        ))}
      </div>

      <FoundersClient resources={resources} />
    </div>
  )
}
