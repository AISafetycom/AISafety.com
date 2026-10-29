'use client'

import Image from 'next/image'
import Icon from '@/components/Icon'
import { trackAirtableView, trackContributeClick } from '@/lib/analytics'
import styles from './ContributeButtons.module.css'

interface ExtraLink {
  label: string
  url: string
  /** Icon shape in /images/icons/ (rendered via <Icon>). Defaults to the star. */
  icon?: string
}

interface ContributeButtonsProps {
  suggestEntryUrl: string
  suggestCorrectionUrl: string
  noun: string
  /** Airtable grid/view URL for the "View data in Airtable" card. */
  airtableUrl?: string
  /** Extra line under "View data in Airtable", e.g. "(includes past events)". */
  airtableNote?: string
  /** Extra contribute actions beyond add + suggest correction. */
  extraLinks?: ExtraLink[]
  /** Render as the listing pages' right column (desktop only, offset to
      align with the listing grid beside it). */
  sidebar?: boolean
  /** Analytics page name (e.g. 'Events'). When set, every button click
   *  records a contribute_click event under this page. */
  trackingPage?: string
}

// "a" vs "an" for the "Add a …" label.
function article(noun: string) {
  return /^[aeiou]/i.test(noun) ? 'an' : 'a'
}

function ActionRow({
  href,
  icon,
  label,
  onClick,
}: {
  href: string
  icon: string
  label: string
  onClick?: () => void
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={`flex items-center gap-8px color-teal-bright-300 hover-white ${styles.row}`}
    >
      <span className={`bg-teal-bright-850 ${styles.badge}`}>
        <Icon src={icon} size={12} />
      </span>
      <span className="paragraph-xs">{label}</span>
    </a>
  )
}

export default function ContributeButtons({
  suggestEntryUrl,
  suggestCorrectionUrl,
  noun,
  airtableUrl = '#',
  airtableNote,
  extraLinks,
  sidebar,
  trackingPage,
}: ContributeButtonsProps) {
  const track = (action: string, label: string, url: string) => {
    if (trackingPage) trackContributeClick(trackingPage, action, label, url)
  }
  const addLabel = `Add ${article(noun)} ${noun}`
  const cards = (
    <div className="flex flex-col gap-16px">
      {/* Contribute card */}
      <div className={`border-only ${styles.card}`}>
        <p className="paragraph-xs color-teal-grey-300 padding-bottom-16px">
          Contribute to this page
        </p>

        <div className="flex flex-col gap-8px">
          <ActionRow
            href={suggestEntryUrl}
            icon="/images/icons/plus-small.svg"
            label={addLabel}
            onClick={() => track('add', addLabel, suggestEntryUrl)}
          />
          <ActionRow
            href={suggestCorrectionUrl}
            icon="/images/icons/pencil-small.svg"
            label="Suggest a correction"
            onClick={() =>
              track('correction', 'Suggest a correction', suggestCorrectionUrl)
            }
          />
          {extraLinks?.map(link => (
            <ActionRow
              key={link.url}
              href={link.url}
              icon={link.icon || '/images/icons/star-small.svg'}
              label={link.label}
              onClick={() => track('extra', link.label, link.url)}
            />
          ))}
        </div>
      </div>

      {/* View data in Airtable card */}
      <a
        href={airtableUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          if (trackingPage) trackAirtableView(trackingPage, airtableUrl)
        }}
        className={`border-only border-hover color-teal-grey-300 hover-white ${styles.airtableCard}`}
      >
        <Image
          src="/images/airtable-vector.svg"
          alt=""
          width={220}
          height={86}
          unoptimized
          className={styles.airtableImg}
        />
        <span className={`${styles.badge} ${styles.airtableArrow}`}>
          <Icon
            src="/images/icons/arrow-up-right-figma.svg"
            size={16}
            className="color-white"
          />
        </span>
        <div className={styles.airtableTextWrap}>
          <p className="paragraph-xs padding-left-16px padding-bottom-12px">
            View data in Airtable
            {airtableNote && (
              <>
                <br />
                {airtableNote}
              </>
            )}
          </p>
        </div>
      </a>
    </div>
  )

  if (!sidebar) return cards

  return (
    <div className={`hide-mobile width-3-col ${styles.sidebar}`}>{cards}</div>
  )
}
