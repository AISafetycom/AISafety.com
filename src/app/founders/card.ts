import type { CardProps } from '@/components/ListingCard'
import type { FounderResource } from '@/lib/data/founders'

// The ListingCard props for one founder resource, exactly as the /founders
// grid renders it. Plain TS (no JSX) so the page's client component and the
// admin Queue's "how it will look on the site" preview build the same card.
export function founderResourceCardProps(resource: FounderResource): CardProps {
  return {
    href: resource.website !== '#' ? resource.website : undefined,
    name: resource.name,
    description: resource.description,
    logo: resource.image,
    meta: resource.type
      ? [{ icon: '/images/icons/tag.svg', value: resource.type }]
      : [],
  }
}
