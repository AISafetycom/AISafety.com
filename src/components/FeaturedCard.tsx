import Image from 'next/image'
import Icon from './Icon'
import CardLogo from './CardLogo'
import TrackedLink from './TrackedLink'
import type { ListingCardMeta } from './ListingCard'
import styles from './FeaturedCard.module.css'

interface FeaturedCardProps {
  href?: string
  tagline: string
  name: string
  description: string
  logo?: string | null
  /** Metadata rows shown directly under the title (e.g. the creator). */
  titleMeta?: ListingCardMeta[]
  /** Metadata rows shown at the bottom of the card. */
  meta: ListingCardMeta[]
  trackingPage: string
  /** Position among the featured cards in the row (0-based). */
  index: number
  /** Total featured cards in the row. */
  count: number
  /** Extra classes for the card root (e.g. a width utility). */
  className?: string
  accentClass?: string
  /** Airtable record id of the featured listing, recorded with the click so it
   *  can be joined back to the source record. */
  trackingId?: string
  /** Slot this featured card occupies ('F1'/'F2'), recorded with the click. */
  trackingPosition?: string
  /** Click source ('cards' on map pages), so map vs card clicks can be split. */
  trackingSource?: string
}

// Gap between featured cards — must match the row's gap-56px utility so the
// shared gradient lines up across cards.
const GRID_GAP = 56

function MetaRows({ rows }: { rows: ListingCardMeta[] }) {
  return (
    <div className="flex flex-col gap-4px">
      {rows.map((field, i) => (
        <div key={i} className="flex items-center gap-8px color-teal-grey-300">
          <Icon src={field.icon} />
          <p className="paragraph-xs">
            {field.label && (
              <span className="visually-hidden">{field.label}: </span>
            )}
            {field.value}
          </p>
        </div>
      ))}
    </div>
  )
}

// The redesigned featured card used at the top of the data-driven sub-pages.
// Renders an <li>, so its parent must be a <ul role="list">, as ListingCard's.
export default function FeaturedCard({
  href,
  tagline,
  name,
  description,
  logo,
  titleMeta,
  meta,
  trackingPage,
  index,
  count,
  className,
  accentClass,
  trackingId,
  trackingPosition,
  trackingSource,
}: FeaturedCardProps) {
  // One radial gradient shared across the whole row: each card paints its own
  // slice of a background sized to span every card plus the gaps between them
  // (left card → left slice … right card → right slice). A single card just
  // uses the gradient at its natural size.
  const gradientStyle =
    count > 1
      ? {
          backgroundSize: `calc(${count * 100}% + ${(count - 1) * GRID_GAP}px) 100%`,
          backgroundPosition: `${(index / (count - 1)) * 100}% top`,
        }
      : undefined

  return (
    <li
      className={`${styles.card} ${href ? '' : styles.cardStatic} ${className ?? ''}`}
      style={gradientStyle}
    >
      {accentClass ? (
        <span
          className={`${styles.bookmark} ${styles.bookmarkAccent} ${accentClass}`}
          aria-hidden="true"
        />
      ) : (
        <Image
          src="/images/bookmarks/bookmark-small.svg"
          alt=""
          className={styles.bookmark}
          width={16}
          height={24}
          unoptimized
        />
      )}

      <div
        className={`flex gap-16px padding-top-24px padding-bottom-24px ${
          titleMeta && titleMeta.length > 0 ? 'items-start' : 'items-center'
        }`}
      >
        {/* alt is empty because the name sits right beside the logo. */}
        {logo && <CardLogo src={logo} alt="" />}
        <div>
          <h3>
            {href ? (
              <TrackedLink
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.titleLink}
                trackingPage={trackingPage}
                trackingName={name}
                trackingId={trackingId}
                trackingPosition={trackingPosition}
                trackingSource={trackingSource}
              >
                {name}
                <span className="visually-hidden"> (opens in new tab)</span>
              </TrackedLink>
            ) : (
              name
            )}
          </h3>
          {titleMeta && titleMeta.length > 0 && (
            <div className="padding-top-8px">
              <MetaRows rows={titleMeta} />
            </div>
          )}
        </div>
      </div>

      {/* After the title in the page source, so a screen reader reads the
          title first; CSS order puts the tagline back at the top. */}
      <span
        className={`${styles.pill} ${accentClass ? styles.pillAccent : ''} paragraph-xs-bold ${accentClass ?? 'color-teal-grey-300'} inline-flex items-center gap-8px padding-left-8px padding-right-8px`}
      >
        <span
          className={`${styles.dot} ${accentClass ? styles.dotAccent : ''}`}
        />
        {tagline}
      </span>

      <p className="color-white padding-bottom-24px">{description}</p>

      <MetaRows rows={meta} />
    </li>
  )
}
