import { fetchLastUpdated } from '@/lib/data/last-updated'
import PageHeader from '@/components/PageHeader'
import FeaturedCard from '@/components/FeaturedCard'
import MediaChannelsClient from './MediaChannelsClient'
import { getMediaChannels } from '@/lib/data/media-channels'
import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

export const metadata = pageMetadata(SITE_PAGES.mediaChannels)

export default async function MediaChannelsPage() {
  const [channels, lastUpdated] = await Promise.all([
    getMediaChannels(),
    fetchLastUpdated('media-channels'),
  ])

  const featured = [
    channels.find(c => c.featured === '1'),
    channels.find(c => c.featured === '2'),
  ].filter((c): c is NonNullable<typeof c> => c != null)

  return (
    <div className="container-default">
      <PageHeader
        title="Media channels"
        lastUpdatedIso={lastUpdated.lastUpdated}
        description={
          <>
            <span className="color-light-teal">
              The AI safety space is changing rapidly.
            </span>{' '}
            These information sources can help you learn more and stay up to
            date.
          </>
        }
      />

      <div className="flex flex-wrap gap-56px padding-bottom-80px">
        {featured.map((channel, i) => (
          <FeaturedCard
            key={channel.id}
            className="width-6-col"
            href={channel.url !== '#' ? channel.url : undefined}
            tagline={channel.featuredTagline!}
            name={channel.name}
            description={channel.description}
            logo={channel.logo ?? undefined}
            meta={
              channel.type
                ? [{ icon: '/images/icons/computer.svg', value: channel.type }]
                : []
            }
            trackingPage="Media channels"
            trackingId={channel.id}
            trackingPosition={`F${channel.featured}`}
            trackingSource="cards"
            index={i}
            count={featured.length}
          />
        ))}
      </div>

      <MediaChannelsClient channels={channels} />
    </div>
  )
}
