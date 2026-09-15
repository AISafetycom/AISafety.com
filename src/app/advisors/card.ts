import type { CardProps } from '@/components/ListingCard'
import type { Advisor } from '@/lib/data/advisors'

// The ListingCard props for one advisor, exactly as the /advisors grid
// renders it. Plain TS (no JSX) so the page's client component and the admin
// Queue's "how it will look on the site" preview build the same card.
export function advisorCardProps(advisor: Advisor): CardProps {
  return {
    href: advisor.url !== '#' ? advisor.url : undefined,
    name: advisor.name,
    description: advisor.description,
    logo: advisor.logo,
    meta: advisor.focus
      ? [{ icon: '/images/icons/target.svg', value: advisor.focus }]
      : [],
  }
}
