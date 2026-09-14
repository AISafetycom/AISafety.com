import type { CardProps } from '@/components/ListingCard'
import type { Funder } from '@/lib/data/funding'
import { isAcceptingApplications } from '@/lib/funding-status'

// The ListingCard props for one funder, exactly as the /funding grid renders
// it. Plain TS (no JSX) so the page's client component and the admin Queue's
// "how it will look on the site" preview build the same card.
export function funderCardProps(funder: Funder): CardProps {
  return {
    href: funder.url !== '#' ? funder.url : undefined,
    name: funder.name,
    description: funder.description,
    logo: funder.logo,
    meta: [
      ...(funder.acceptingApplications
        ? [
            {
              icon: isAcceptingApplications(funder.acceptingApplications)
                ? '/images/icons/form-check.svg'
                : '/images/icons/form-pause.svg',
              value: funder.acceptingApplications,
            },
          ]
        : []),
      ...(funder.type
        ? [{ icon: '/images/icons/tag.svg', value: funder.type }]
        : []),
    ],
  }
}
