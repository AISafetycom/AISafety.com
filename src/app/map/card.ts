import type { CardProps } from '@/components/ListingCard'
import type { MapOrg } from '@/lib/data/map'

type MapCardOrg = Pick<
  MapOrg,
  'title' | 'description' | 'category' | 'logo' | 'link'
>

// The ListingCard props for one org, exactly as the list under the field map
// renders it. Plain TS (no JSX) so the page's client component and the admin
// Queue's "how it will look on the site" preview build the same card.
export function mapOrgCardProps(org: MapCardOrg): CardProps {
  return {
    href: org.link !== '#' ? org.link : undefined,
    name: org.title,
    description: org.description,
    logo: org.logo,
    meta: org.category
      ? [
          {
            icon: '/images/icons/tag.svg',
            label: 'Category',
            value: org.category,
          },
        ]
      : [],
  }
}

/** The org's map area for analytics: its FIRST category. The dashboard groups
 *  Map-page activity by it. */
export function mapArea(org: Pick<MapOrg, 'category'>): string | undefined {
  return org.category.split(',')[0].trim() || undefined
}
