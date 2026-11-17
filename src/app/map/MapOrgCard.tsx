'use client'

import Image from 'next/image'
import type { MapOrg } from '@/lib/data/map'
import { trackListingClick } from '@/lib/analytics'
import { withUtm } from '@/lib/utm'
// The title link's keyboard focus ring around the whole card.
import cardStyles from '@/components/ListingCard.module.css'

interface MapOrgCardProps {
  org: Pick<
    MapOrg,
    'id' | 'title' | 'description' | 'category' | 'logo' | 'link'
  >
  /** The card's slot on the page ('1', '2'…) at click time. */
  placement?: string
}

// The card in the list under the field map: hand-written rather than
// ListingCard because it shows a labelled Category row. The admin Queue's
// "how it will look on the site" preview renders this same component.
export default function MapOrgCard({ org, placement }: MapOrgCardProps) {
  return (
    // Only the title is a link, as on ListingCard, so the rest of the text
    // can be selected; a click anywhere on the card opens it (CardClicks).
    <div id={org.id} className="card" data-card="">
      <div className="flex items-center gap-16px padding-bottom-24px">
        <div className="featured-img">
          {org.logo && (
            <Image
              src={org.logo}
              alt=""
              className="card-image"
              width={64}
              height={64}
              unoptimized
              onError={e => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          )}
        </div>
        <h3>
          <a
            href={withUtm(org.link, 'Map')}
            target="_blank"
            rel="noopener noreferrer"
            className={cardStyles.titleLink}
            onClick={() =>
              trackListingClick(
                'Map',
                org.title,
                org.link,
                org.id,
                placement,
                'cards',
                // First category = the org's map area; the dashboard groups
                // Map-page activity by it.
                org.category.split(',')[0].trim() || undefined
              )
            }
          >
            {org.title}
            <span className="visually-hidden"> (opens in new tab)</span>
          </a>
        </h3>
      </div>
      <p className="paragraph-small padding-bottom-24px">{org.description}</p>
      <p className="paragraph-xs-bold color-teal-grey-300 padding-bottom-4px">
        Category
      </p>
      <p className="paragraph-small">{org.category}</p>
    </div>
  )
}
