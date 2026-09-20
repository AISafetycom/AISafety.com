'use client'

import { useState } from 'react'
import type { CitationRef, ListingType } from '@/lib/assistant/types'
import Icon from '@/components/Icon'
import styles from './Assistant.module.css'

interface Props {
  citation: CitationRef
  /** Optional bot-written annotation shown under the name/org (replaces the
   *  meta line) */
  note?: string
  onClick?: (c: CitationRef) => void
}

function TypeIcon({ type }: { type: ListingType }) {
  switch (type) {
    case 'job':
      return <Icon src="/images/icons/briefcase.svg" size={16} />
    case 'funder':
      return <Icon src="/images/icons/coins.svg" size={16} />
    case 'advisor':
      return <Icon src="/images/icons/person.svg" size={16} />
    case 'community':
      return <Icon src="/images/icons/globe.svg" size={16} />
    case 'course':
      return <Icon src="/images/icons/book.svg" size={16} />
    case 'founder-resource':
      return <Icon src="/images/icons/rocket.svg" size={16} />
    case 'project':
      return <Icon src="/images/icons/clipboard.svg" size={16} />
    case 'media-channel':
      return <Icon src="/images/icons/megaphone.svg" size={16} />
    case 'org':
      return <Icon src="/images/icons/building.svg" size={16} />
    case 'event':
      return <Icon src="/images/icons/calendar.svg" size={16} />
    case 'training':
      return <Icon src="/images/icons/grad-cap.svg" size={16} />
    case 'person':
      return <Icon src="/images/icons/person-alt.svg" size={16} />
  }
}

function metaSummary(c: CitationRef): string {
  const parts: string[] = []
  if (c.type === 'job') {
    if (c.meta.workLocation) parts.push(c.meta.workLocation)
    if (c.meta.minimumExperience) parts.push(c.meta.minimumExperience)
  } else if (c.type === 'funder') {
    if (c.meta.acceptingApplications) parts.push(c.meta.acceptingApplications)
  } else if (c.type === 'community') {
    if (c.meta.platform) parts.push(c.meta.platform)
  } else if (c.type === 'course') {
    if (c.meta.category) parts.push(c.meta.category)
  } else if (c.type === 'media-channel' || c.type === 'founder-resource') {
    if (c.meta.type) parts.push(c.meta.type)
  } else if (c.type === 'event') {
    if (c.meta.type) parts.push(c.meta.type)
    if (c.meta.cost) parts.push(c.meta.cost)
  } else if (c.type === 'training') {
    if (c.meta.type) parts.push(c.meta.type)
    if (c.meta.stipend) parts.push(c.meta.stipend)
  } else if (c.type === 'person') {
    if (c.meta.focus) parts.push(c.meta.focus)
    if (c.meta.location) parts.push(c.meta.location)
  }
  return parts.join(' · ')
}

export default function CitationCard({ citation, note, onClick }: Props) {
  const isExternal = /^https?:\/\//.test(citation.url)
  // Only a real web link (http/https) sends the user straight to the listing.
  // Anything else routes to the listing's resource page instead, so the click
  // lands somewhere useful and the user gets the full listing for context:
  //   - "#" — a listing with no link of its own (e.g. a community with no
  //     website or join link).
  //   - mailto: — volunteer projects expose only the contact's email; the user
  //     should read the project on the Projects page before emailing anyone.
  // The assistant is also prompted to point to the resource page in these cases.
  const href = isExternal ? citation.url : citation.pageUrl || citation.url
  const summary = metaSummary(citation)
  const [imgFailed, setImgFailed] = useState(false)
  const showLogo = citation.logo && !imgFailed

  return (
    <a
      href={href}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      className={styles.citationCard}
      onClick={() => onClick?.(citation)}
    >
      <span className={styles.citationLogo}>
        {showLogo ? (
          // Plain <img>: logos are tiny (36px), come from many third-party
          // hosts (favicons, cdn URLs we don't control), and we're not
          // benefiting from next/image's pipeline.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={citation.logo!}
            alt=""
            width={36}
            height={36}
            className={styles.citationLogoImg}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <TypeIcon type={citation.type} />
        )}
      </span>
      <span className={styles.citationBody}>
        <span className={styles.citationName}>{citation.name}</span>
        {/* The org behind the listing (jobs, courses) always renders, even
            when a note replaces the meta line — a job card without its hiring
            org is unidentifiable. */}
        {citation.organization &&
          citation.organization !== citation.name &&
          citation.organization !== note && (
            <span className={styles.citationMeta}>{citation.organization}</span>
          )}
        {note ? (
          <span className={styles.citationNote}>{note}</span>
        ) : summary ? (
          <span className={styles.citationMeta}>{summary}</span>
        ) : null}
      </span>
    </a>
  )
}
