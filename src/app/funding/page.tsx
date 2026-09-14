import { fetchLastUpdated } from '@/lib/data/last-updated'
import PageHeader from '@/components/PageHeader'
import FeaturedCard from '@/components/FeaturedCard'
import FundingClient from './FundingClient'
import { getFunders } from '@/lib/data/funding'
import { isAcceptingApplications } from '@/lib/funding-status'
import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

export const metadata = pageMetadata(SITE_PAGES.funding)

export default async function FundingPage() {
  const [funders, lastUpdated] = await Promise.all([
    getFunders(),
    fetchLastUpdated('funding'),
  ])

  const featured = [
    funders.find(f => f.featured === '1'),
    funders.find(f => f.featured === '2'),
  ].filter((f): f is NonNullable<typeof f> => f != null)

  return (
    <div className="container-default">
      <PageHeader
        title="Funding"
        lastUpdatedIso={lastUpdated.lastUpdated}
        newsletter
        newsletterHeading="Get notified when new funding opportunities are announced"
        newsletterSubscribeUrl="https://aisafetyfunding.substack.com/subscribe"
        newsletterTrackingPage="Funding"
        description={
          <>
            These organizations offer{' '}
            <span className="color-light-teal">financial support</span> to
            organizations and individuals working on AI safety.
          </>
        }
      />

      <div className="flex flex-wrap gap-56px padding-bottom-80px">
        {featured.map((funder, i) => (
          <FeaturedCard
            key={funder.id}
            className="width-6-col"
            href={funder.url !== '#' ? funder.url : undefined}
            tagline={funder.featuredTagline!}
            name={funder.name}
            description={funder.description}
            logo={funder.logo ?? undefined}
            meta={[
              ...(funder.acceptingApplications
                ? [
                    {
                      icon: isAcceptingApplications(
                        funder.acceptingApplications
                      )
                        ? '/images/icons/form-check.svg'
                        : '/images/icons/form-pause.svg',
                      value: funder.acceptingApplications,
                    },
                  ]
                : []),
              ...(funder.type
                ? [{ icon: '/images/icons/tag.svg', value: funder.type }]
                : []),
            ]}
            trackingPage="Funding"
            trackingId={funder.id}
            trackingPosition={`F${funder.featured}`}
            trackingSource="cards"
            index={i}
            count={featured.length}
          />
        ))}
      </div>

      <FundingClient funders={funders} />
    </div>
  )
}
