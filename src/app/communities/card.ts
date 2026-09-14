import type { CardProps } from '@/components/ListingCard'
import type { Community } from '@/lib/data/communities'

// The ListingCard props for one community, exactly as the /communities grid
// renders it. Plain TS (no JSX) so the page's client component and the admin
// Queue's "how it will look on the site" preview build the same card.
export function communityCardProps(community: Community): CardProps {
  return {
    href: community.joinLink !== '#' ? community.joinLink : undefined,
    name: community.name,
    description: community.description,
    logo: community.logo,
    meta: [
      {
        icon: '/images/icons/computer.svg',
        value: community.platformText || community.platform.join(', '),
      },
      ...(community.activityLevel
        ? [
            {
              icon: '/images/icons/activity.svg',
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
    ],
  }
}
