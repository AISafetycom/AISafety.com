import type { CardProps, ListingCardMeta } from '@/components/ListingCard'
import type { MapOrg } from '@/lib/data/map'
import {
  INACTIVE_CATEGORY,
  isInactive,
  placingCategory,
} from '@/lib/data/map-areas'

type MapCardOrg = Pick<
  MapOrg,
  'title' | 'description' | 'category' | 'status' | 'logo' | 'link'
>

// The icon beside each Status value, one per value the way /communities draws
// one per activity level. The Status filter uses the active one. Exported for
// the admin Queue, which draws the same icon beside the field.
export const STATUS_ICONS = {
  active: '/images/icons/check-in-circle.svg',
  inactive: '/images/icons/x-in-circle.svg',
}

// The ListingCard props for one org, exactly as the list under the field map
// renders it. Plain TS (no JSX) so the page's client component and the admin
// Queue's "how it will look on the site" preview build the same card.
export function mapOrgCardProps(org: MapCardOrg): CardProps {
  return {
    href: org.link !== '#' ? org.link : undefined,
    name: org.title,
    description: org.description,
    logo: org.logo,
    meta: cardMeta(org),
  }
}

// Every card shows the org's categories with the tag. A shut-down org also
// shows "No longer active" with the status icon. Its Status decides that, not
// a category: "No longer active" as a category only placed the logo in the
// Graveyard, which Status does now, so it's left out of the category line.
// Nearly every org is active, so active orgs get no "Active" line.
function cardMeta(org: MapCardOrg): ListingCardMeta[] {
  const categories = org.category
    .split(',')
    .map(c => c.trim())
    .filter(c => c && c !== INACTIVE_CATEGORY)
    .join(', ')
  return [
    ...(categories
      ? [
          {
            icon: '/images/icons/tag.svg',
            label: 'Category',
            value: categories,
          },
        ]
      : []),
    ...(isInactive(org.status)
      ? [
          {
            icon: STATUS_ICONS.inactive,
            label: 'Status',
            value: 'No longer active',
          },
        ]
      : []),
  ]
}

/** The org's map area for analytics: its FIRST category, or "No longer
 *  active" for a shut-down org. The dashboard groups Map-page activity by it. */
export function mapArea(
  org: Pick<MapOrg, 'category' | 'status'>
): string | undefined {
  return placingCategory(org.category, org.status) ?? undefined
}
