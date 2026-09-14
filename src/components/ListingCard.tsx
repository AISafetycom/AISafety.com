'use client'

import Image from 'next/image'
import Icon from './Icon'
import { trackListingClick } from '@/lib/analytics'
import { withUtm } from '@/lib/utm'
import styles from './ListingCard.module.css'

export interface ListingCardMeta {
  /** Path to a 16×16 svg icon in /images (already teal-300 tinted). */
  icon: string
  value: string
}

export interface ListingCardPill {
  label: string
  /** Optional color utility class, e.g. 'color-teal-bright-400'. */
  colorClass?: string
}

export interface ListingCardProps {
  /** External link. Omit for a static, non-clickable card (e.g. projects). */
  href?: string
  name: string
  /** Overrides the name the click is tracked under, so a card can show a short
   *  title but keep a stable, unambiguous analytics name (e.g. jobs track as
   *  'Research Engineer – Anthropic'). Defaults to `name`. */
  trackingName?: string
  description: string
  logo?: string | null
  /** Pills shown above the logo (e.g. a category or type). */
  pills?: ListingCardPill[]
  /** Metadata rows shown directly under the title (e.g. event date/time). */
  titleMeta?: ListingCardMeta[]
  /** Metadata rows shown at the bottom of the card. */
  meta: ListingCardMeta[]
  /** Small, icon-less note pinned below the meta rows with a gap (e.g. a
   *  job's "Posted:" date). */
  footnote?: string
  trackingPage: string
  /** Airtable record id, stamped onto the click event. */
  listingId?: string
  /** The card's slot on the page ('F1', 'F2', '1', '2'…) at click time. */
  placement?: string
  /** Click source recorded with the event — the active view's slug on pages
   *  with a view toggle (e.g. 'online' / 'in-person' on Events). */
  trackingSource?: string
}

/** What a resource page's card.ts builds from one listing: the card's
 *  content, minus the tracking and placement props the page adds when it
 *  renders. The admin Queue's site preview renders the same content. */
export type CardProps = Omit<
  ListingCardProps,
  'trackingPage' | 'listingId' | 'placement' | 'trackingSource'
>

function MetaRows({ rows }: { rows: ListingCardMeta[] }) {
  return (
    <div className="flex flex-col gap-4px">
      {rows.map((field, i) => (
        <div key={i} className="flex items-center gap-8px color-teal-300">
          <Icon src={field.icon} />
          <p className="paragraph-xs">{field.value}</p>
        </div>
      ))}
    </div>
  )
}

// The card used in the listing grids on the data-driven sub-pages
// (self-study, communities, events …). Replaces the markup that used to be
// copy-pasted into every *Client component.
export default function ListingCard({
  href,
  name,
  trackingName,
  description,
  logo,
  pills,
  titleMeta,
  meta,
  footnote,
  trackingPage,
  listingId,
  placement,
  trackingSource,
}: ListingCardProps) {
  const inner = (
    <>
      {pills && pills.length > 0 && (
        <div className="flex gap-8px padding-bottom-24px">
          {pills.map((pill, i) => (
            <span
              key={i}
              className={`${styles.pill} ${pill.colorClass ?? 'color-teal-bright-400'}`}
            >
              {pill.label}
            </span>
          ))}
        </div>
      )}

      <div
        className={`flex gap-16px padding-bottom-24px ${
          titleMeta && titleMeta.length > 0 ? 'items-start' : 'items-center'
        }`}
      >
        {logo && (
          <div className="featured-img">
            <Image
              src={logo}
              alt=""
              className="card-image"
              width={64}
              height={64}
              unoptimized
              loading="eager"
              onError={e => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          </div>
        )}
        <div>
          <h3>{name}</h3>
          {titleMeta && titleMeta.length > 0 && (
            <div className="padding-top-8px">
              <MetaRows rows={titleMeta} />
            </div>
          )}
        </div>
      </div>

      <p className="paragraph-small color-white padding-bottom-24px">
        {description}
      </p>

      <MetaRows rows={meta} />

      {footnote && (
        <p className="paragraph-xs color-teal-500 padding-top-16px">
          {footnote}
        </p>
      )}
    </>
  )

  // No link → a static, non-clickable card (e.g. projects have no external URL).
  if (!href) {
    return (
      <div id={listingId} className="card card-static">
        {inner}
      </div>
    )
  }

  return (
    <a
      id={listingId}
      href={withUtm(href, trackingPage)}
      target="_blank"
      rel="noopener noreferrer"
      className="card"
      onClick={() =>
        trackListingClick(
          trackingPage,
          trackingName ?? name,
          href,
          listingId,
          placement,
          trackingSource
        )
      }
    >
      {inner}
    </a>
  )
}
