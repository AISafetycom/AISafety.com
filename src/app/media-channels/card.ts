import type { CardProps } from '@/components/ListingCard'
import type { MediaChannel } from '@/lib/data/media-channels'

// The ListingCard props for one media channel, exactly as the /media-channels
// grid renders it. Plain TS (no JSX) so the page's client component and the
// admin Queue's "how it will look on the site" preview build the same card.
export function mediaChannelCardProps(channel: MediaChannel): CardProps {
  return {
    href: channel.url !== '#' ? channel.url : undefined,
    name: channel.name,
    description: channel.description,
    logo: channel.logo,
    meta: channel.type
      ? [{ icon: '/images/icons/computer.svg', value: channel.type }]
      : [],
  }
}
