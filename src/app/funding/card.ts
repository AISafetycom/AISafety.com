import type { CardProps, ListingCardMeta } from '@/components/ListingCard'
import type { Funder } from '@/lib/data/funding'
import {
  applicationLabel,
  grantSizeLabel,
  whoCanApplyLabel,
} from '@/lib/funding-meta'

const STATUS_ICONS: Record<string, string> = {
  'Applications open': '/images/icons/form-check.svg',
  'Not currently accepting applications': '/images/icons/form-pause.svg',
  'Invite only, no applications': '/images/icons/paper-with-x.svg',
}

// The metadata lines on a funder's card: application status, who can apply and
// grant size, each left out when the funder has no value for it. Shared by the
// grid cards and the featured cards.
export function funderMeta(funder: Funder): ListingCardMeta[] {
  const status = applicationLabel(funder.applicationStatus, funder.deadline)
  const who = whoCanApplyLabel(funder.whoCanApply)
  const grant = grantSizeLabel(funder.grantSize)
  return [
    ...(status
      ? [{ icon: STATUS_ICONS[funder.applicationStatus], value: status }]
      : []),
    ...(who ? [{ icon: '/images/icons/team.svg', value: who }] : []),
    ...(grant ? [{ icon: '/images/icons/grant-size.svg', value: grant }] : []),
  ]
}

// The ListingCard props for one funder, exactly as the /funding grid renders
// it. Plain TS (no JSX) so the page's client component and the admin Queue's
// "how it will look on the site" preview build the same card.
export function funderCardProps(funder: Funder): CardProps {
  return {
    href: funder.url !== '#' ? funder.url : undefined,
    name: funder.name,
    description: funder.description,
    logo: funder.logo,
    meta: funderMeta(funder),
  }
}
