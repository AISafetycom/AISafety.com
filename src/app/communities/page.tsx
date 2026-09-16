import { fetchLastUpdated } from '@/lib/data/last-updated'
import PageHeader from '@/components/PageHeader'
import FeaturedCard from '@/components/FeaturedCard'
import CommunitiesClient from './CommunitiesClient'
import CommunitiesMap from './CommunitiesMap'
import CardsViewTracker from '@/components/CardsViewTracker'
import styles from './page.module.css'
import { getCommunities } from '@/lib/data/communities'
import { activityIcon } from './activity-icon'
import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

export const metadata = pageMetadata(SITE_PAGES.communities)

export default async function CommunitiesPage() {
  const [communities, lastUpdated] = await Promise.all([
    getCommunities(),
    fetchLastUpdated('communities'),
  ])

  const featuredCommunities = [
    communities.find(c => c.featured === '1'),
    communities.find(c => c.featured === '2'),
  ].filter((c): c is NonNullable<typeof c> => c != null)

  return (
    <div>
      <div className={styles.mapWrapper}>
        <CommunitiesMap communities={communities} />
        <h2 className={`${styles.mapTitleOverlay} shadow-text`}>
          In-person AI safety communities
        </h2>
      </div>
      <div className="container-default">
        <CardsViewTracker page="Communities" />
        <PageHeader
          title="Communities"
          lastUpdatedIso={lastUpdated.lastUpdated}
          id="communities"
          topPadding="padding-top-40px"
          description={
            <>
              There are many groups dedicated to discussing and contributing to
              AI safety, both{' '}
              <span className="color-light-teal">online and in-person.</span> We
              recommend joining a few.
            </>
          }
        />

        {/* Featured Communities: two width-6-col cards fill the row; gap-56px
            must match GRID_GAP in FeaturedCard so the shared gradient lines up.
            (The "Related resources" links live in CommunitiesClient's sidebar.) */}
        <div className="flex flex-wrap gap-56px padding-bottom-80px">
          {featuredCommunities.map((community, i) => (
            <FeaturedCard
              key={community.id}
              className="width-6-col"
              href={community.joinLink !== '#' ? community.joinLink : undefined}
              tagline={community.featuredTagline!}
              name={community.name}
              description={community.description}
              logo={community.logo ?? undefined}
              meta={[
                {
                  icon: '/images/icons/computer.svg',
                  value:
                    community.platformText || community.platform.join(', '),
                },
                ...(community.activityLevel
                  ? [
                      {
                        icon: activityIcon(community.activityLevel),
                        value: community.activityLevel,
                      },
                    ]
                  : []),
                ...(community.focus
                  ? [
                      {
                        icon: '/images/icons/target.svg',
                        value: community.focus,
                      },
                    ]
                  : []),
              ]}
              trackingPage="Communities"
              trackingId={community.id}
              trackingPosition={`F${community.featured}`}
              trackingSource="cards"
              index={i}
              count={featuredCommunities.length}
            />
          ))}
        </div>

        {/* Main Content with Search, Cards, and Filters */}
        <CommunitiesClient communities={communities} />
      </div>
    </div>
  )
}
