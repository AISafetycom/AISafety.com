import type { CardProps, ListingCardMeta } from '@/components/ListingCard'
import type { Advisor } from '@/lib/data/advisors'
import { focusLabel, whoItsForLabel } from '@/lib/advisor-meta'

// Exported for the admin Queue, which draws the same icon beside the field.
export const APPLICATIONS_ICONS: Record<string, string> = {
  'Application required': '/images/icons/paper.svg',
  'Accepts everyone': '/images/icons/form-check.svg',
}

// The metadata lines on an advisor's card: who it's for, focus and
// applications, each left out when the advisor has no value for it. Shared by
// the grid cards and the featured cards.
export function advisorMeta(advisor: Advisor): ListingCardMeta[] {
  const who = whoItsForLabel(advisor.whoItsFor)
  const focus = focusLabel(advisor.focusAreas)
  const applicationsIcon = APPLICATIONS_ICONS[advisor.applications]
  return [
    ...(who ? [{ icon: '/images/icons/team.svg', value: who }] : []),
    ...(focus ? [{ icon: '/images/icons/target.svg', value: focus }] : []),
    ...(applicationsIcon
      ? [{ icon: applicationsIcon, value: advisor.applications }]
      : []),
  ]
}

// The ListingCard props for one advisor, exactly as the /advisors grid
// renders it. Plain TS (no JSX) so the page's client component and the admin
// Queue's "how it will look on the site" preview build the same card.
export function advisorCardProps(advisor: Advisor): CardProps {
  return {
    href: advisor.url !== '#' ? advisor.url : undefined,
    name: advisor.name,
    description: advisor.description,
    logo: advisor.logo,
    meta: advisorMeta(advisor),
  }
}
