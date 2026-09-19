'use client'

import Icon from '@/components/Icon'
import { trackListingClick } from '@/lib/analytics'
import { withUtm } from '@/lib/utm'
import { focusAreaColorClass } from '@/lib/data/hire-focus-colors'
import type { Candidate, CandidateProject } from '@/lib/data/hire'
import styles from './CandidateCard.module.css'

const TRACKING_PAGE = 'Hire'

interface CandidateCardProps {
  candidate: Candidate
  /** The card's slot on the page ('1', '2'…), stamped onto every click. */
  placement?: string
}

function OutboundLink({
  href,
  trackingName,
  listingId,
  placement,
  trackingSource,
  children,
  className,
}: {
  href: string
  trackingName: string
  listingId: string
  placement?: string
  trackingSource: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <a
      href={withUtm(href, TRACKING_PAGE)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={() =>
        trackListingClick(
          TRACKING_PAGE,
          trackingName,
          href,
          listingId,
          placement,
          trackingSource
        )
      }
    >
      {children}
    </a>
  )
}

function statusLabel(status: CandidateProject['status']): string {
  return status
}

function websiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function formatJoinedDate(iso: string): string {
  const date = new Date(iso + 'T00:00:00')
  return `Joined ${date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
}

function ProjectRow({
  candidate,
  project,
  placement,
}: {
  candidate: Candidate
  project: CandidateProject
  placement?: string
}) {
  return (
    <div className={styles.project}>
      <span
        className={`${styles.statusPill} ${
          project.status === 'Current' || project.status === 'Active'
            ? 'color-bright-green'
            : 'color-teal-bright-400'
        }`}
      >
        {statusLabel(project.status)}
      </span>
      <div className={styles.projectInfo}>
        <p className="paragraph-small-bold color-white">{project.title}</p>
        <p className="paragraph-xs color-teal-300">
          {project.role}
          {project.endedReason ? ` · ${project.endedReason}` : ''}
        </p>
      </div>
      <div className={styles.projectMeta}>
        <div className="flex items-center gap-8px color-teal-300">
          <Icon src="/images/icons/calendar.svg" />
          <p className="paragraph-xs">{formatJoinedDate(project.joinedDate)}</p>
        </div>
      </div>
      <div className={styles.projectArtifacts}>
        {project.artifacts.map(artifact => (
          <OutboundLink
            key={artifact.url}
            href={artifact.url}
            trackingName={`${candidate.name} – ${project.title} (${artifact.label})`}
            listingId={candidate.id}
            placement={placement}
            trackingSource="project-artifact"
            className={`paragraph-xs-bold color-light-teal ${styles.artifactLink}`}
          >
            {artifact.label}
            <Icon src="/images/icons/link-out.svg" size={16} />
          </OutboundLink>
        ))}
      </div>
    </div>
  )
}

export default function CandidateCard({
  candidate,
  placement,
}: CandidateCardProps) {
  const linkButtons = [
    { label: 'LinkedIn', href: candidate.links.linkedin },
    { label: 'X', href: candidate.links.x },
    { label: 'GitHub', href: candidate.links.github },
    {
      label: candidate.links.website
        ? websiteLabel(candidate.links.website)
        : '',
      href: candidate.links.website,
    },
  ].filter((link): link is { label: string; href: string } =>
    Boolean(link.href)
  )

  return (
    <div id={candidate.id} className={`card card-static ${styles.card}`}>
      <div className={styles.main}>
        <div className="flex items-start justify-between gap-16px padding-bottom-24px">
          <div className="flex items-start gap-16px">
            <div className={styles.avatar}>{candidate.avatarInitials}</div>
            <div>
              <h3>{candidate.name}</h3>
              <p className="paragraph-small color-teal-300">
                {candidate.handle}
              </p>
            </div>
          </div>
          {candidate.links.linkedin && (
            <OutboundLink
              href={candidate.links.linkedin}
              trackingName={`${candidate.name} – Contact`}
              listingId={candidate.id}
              placement={placement}
              trackingSource="contact"
              className={`button-secondary ${styles.contactButton}`}
            >
              Contact
            </OutboundLink>
          )}
        </div>

        <p className="paragraph-small color-white padding-bottom-16px">
          {candidate.interests}
        </p>

        <div className="flex flex-wrap gap-8px padding-bottom-24px">
          {candidate.focusAreas.map(area => (
            <span
              key={area}
              className={`${styles.pill} ${focusAreaColorClass(area)}`}
            >
              {area}
            </span>
          ))}
        </div>

        <p className="paragraph-small-bold color-white padding-bottom-16px">
          Projects
        </p>
        <div className="flex flex-col gap-16px padding-bottom-24px">
          {candidate.projects.map(project => (
            <ProjectRow
              key={project.id}
              candidate={candidate}
              project={project}
              placement={placement}
            />
          ))}
        </div>

        <p className="paragraph-small-bold color-white padding-bottom-8px">
          What they want to work on
        </p>
        <p className="paragraph-small color-teal-300 padding-bottom-24px">
          {candidate.wantToWorkOn}
        </p>

        {linkButtons.length > 0 && (
          <div className="flex flex-wrap gap-8px">
            {linkButtons.map(link => (
              <OutboundLink
                key={link.label}
                href={link.href}
                trackingName={`${candidate.name} – ${link.label}`}
                listingId={candidate.id}
                placement={placement}
                trackingSource="links"
                className={`paragraph-xs-bold ${styles.linkChip}`}
              >
                {link.label}
                <Icon src="/images/icons/link-out.svg" size={16} />
              </OutboundLink>
            ))}
          </div>
        )}
      </div>

      <div className={styles.availability}>
        <p className="paragraph-small-bold color-white padding-bottom-16px">
          Availability
        </p>
        <div className="flex flex-col gap-12px">
          <div className="flex items-center gap-8px color-teal-300">
            <Icon src="/images/icons/globe.svg" />
            <p className="paragraph-xs">{candidate.availability.timezone}</p>
          </div>
          <div className="flex items-center gap-8px color-teal-300">
            <Icon src="/images/icons/briefcase.svg" />
            <p className="paragraph-xs">
              Up to {candidate.availability.maxConcurrentProjects} project
              {candidate.availability.maxConcurrentProjects === 1 ? '' : 's'} at
              once
            </p>
          </div>
          <div className="flex items-center gap-8px color-teal-300">
            <Icon src="/images/icons/timer.svg" />
            <p className="paragraph-xs">
              Up to {candidate.availability.maxHoursPerWeek} hours a week
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
