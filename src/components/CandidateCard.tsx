'use client'

import Icon from '@/components/Icon'
import { trackListingClick } from '@/lib/analytics'
import { withUtm } from '@/lib/utm'
import { focusAreaColor, projectStatusColor } from '@/lib/people-filters'
import type { Person, PersonProject } from '@/lib/data/people'
import styles from './CandidateCard.module.css'

const TRACKING_PAGE = 'Hire'

interface CandidateCardProps {
  person: Person
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

// "Jul 2026" from "2026-07". en-US, not en-GB: en-GB abbreviates September
// as "Sept".
function monthLabel(yearMonth: string): string {
  const d = new Date(yearMonth + '-01T00:00:00Z')
  const month = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
  }).format(d)
  return `${month} ${d.getUTCFullYear()}`
}

function datesLabel(project: PersonProject): string {
  return project.ended
    ? `${monthLabel(project.joined)} – ${monthLabel(project.ended)}`
    : `Joined ${monthLabel(project.joined)}`
}

function ProjectRow({
  person,
  project,
  placement,
}: {
  person: Person
  project: PersonProject
  placement?: string
}) {
  return (
    <div className={styles.project}>
      <span
        className={`${styles.statusPill} ${projectStatusColor(project.status)}`}
      >
        {project.status}
      </span>
      <div className={styles.projectInfo}>
        <p className="paragraph-small-bold color-white">{project.title}</p>
        <p className="paragraph-xs color-teal-300">
          {project.organization
            ? `${project.role} · ${project.organization}`
            : project.role}
        </p>
      </div>
      <div className={styles.projectMeta}>
        <div className="flex items-center gap-8px color-teal-300">
          <Icon src="/images/icons/calendar.svg" />
          <p className="paragraph-xs">{datesLabel(project)}</p>
        </div>
      </div>
      <div className={styles.projectArtifacts}>
        {project.artifacts.length === 0 ? (
          <p className="paragraph-xs color-teal-400">No artifacts</p>
        ) : (
          project.artifacts.map(artifact => (
            <OutboundLink
              key={artifact.label + artifact.url}
              href={artifact.url}
              trackingName={`${person.displayName} – ${project.title} (${artifact.label})`}
              listingId={person.id}
              placement={placement}
              trackingSource="project-artifact"
              className={`paragraph-xs-bold color-light-teal ${styles.artifactLink}`}
            >
              {artifact.label}
              <Icon src="/images/icons/link-out.svg" size={16} />
            </OutboundLink>
          ))
        )}
      </div>
    </div>
  )
}

export default function CandidateCard({
  person,
  placement,
}: CandidateCardProps) {
  return (
    <div
      id={`person-${person.id}`}
      className={`card card-static ${styles.card}`}
    >
      <div className={styles.main}>
        <div className="flex items-start justify-between gap-16px padding-bottom-24px">
          <div className="flex items-start gap-16px">
            <div className={styles.avatar} aria-hidden="true">
              {person.avatarUrl ? (
                // Plain <img>: profile photos come from wherever the person
                // hosts them; next/image adds nothing for a 56px circle.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={person.avatarUrl}
                  alt=""
                  className={styles.avatarImg}
                />
              ) : (
                person.initials
              )}
            </div>
            <div>
              <h3>{person.displayName}</h3>
              <p className="paragraph-small color-teal-300">@{person.handle}</p>
            </div>
          </div>
          <OutboundLink
            href={person.profileUrl}
            trackingName={`${person.displayName} – Contact`}
            listingId={person.id}
            placement={placement}
            trackingSource="contact"
            className={`button-secondary ${styles.contactButton}`}
          >
            Contact
          </OutboundLink>
        </div>

        <p className="paragraph-small color-white padding-bottom-16px">
          {person.interests}
        </p>

        <div className="flex flex-wrap gap-8px padding-bottom-24px">
          {person.focusAreas.map(area => (
            <span
              key={area}
              className={`${styles.pill} ${focusAreaColor(area)}`}
            >
              {area}
            </span>
          ))}
        </div>

        <p className="paragraph-small-bold color-white padding-bottom-16px">
          Projects
        </p>
        <div className="flex flex-col gap-16px padding-bottom-24px">
          {person.projects.length === 0 ? (
            <p className="paragraph-small color-teal-300">
              No project history listed.
            </p>
          ) : (
            person.projects.map(project => (
              <ProjectRow
                key={project.id}
                person={person}
                project={project}
                placement={placement}
              />
            ))
          )}
        </div>

        <p className="paragraph-small-bold color-white padding-bottom-8px">
          What they want to work on
        </p>
        <p className="paragraph-small color-teal-300 padding-bottom-24px">
          {person.wantToWorkOn}
        </p>

        {person.links.length > 0 && (
          <div className="flex flex-wrap gap-8px">
            {person.links.map(link => (
              <OutboundLink
                key={link.label + link.url}
                href={link.url}
                trackingName={`${person.displayName} – ${link.label}`}
                listingId={person.id}
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
          {person.location && (
            <div className="flex items-center gap-8px color-teal-300">
              <Icon src="/images/icons/pin.svg" />
              <p className="paragraph-xs">{person.location}</p>
            </div>
          )}
          <div className="flex items-center gap-8px color-teal-300">
            <Icon src="/images/icons/globe.svg" />
            <p className="paragraph-xs">{person.timeZoneLabel}</p>
          </div>
          <div className="flex items-center gap-8px color-teal-300">
            <Icon src="/images/icons/briefcase.svg" />
            <p className="paragraph-xs">
              {person.maxConcurrentProjects == null
                ? 'Concurrent projects: not shared'
                : `Up to ${person.maxConcurrentProjects} project${person.maxConcurrentProjects === 1 ? '' : 's'} at once`}
            </p>
          </div>
          <div className="flex items-center gap-8px color-teal-300">
            <Icon src="/images/icons/timer.svg" />
            <p className="paragraph-xs">
              {person.maxHoursPerWeek == null
                ? 'Hours a week: not shared'
                : `Up to ${person.maxHoursPerWeek} hours a week`}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
