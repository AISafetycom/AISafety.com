import type { CardProps } from '@/components/ListingCard'
import type { EventListing } from '@/lib/data/events'
import { eventTypeColor } from '@/lib/event-types'

// Builds the card content for one event. Plain TS (no JSX) so the page's
// client component and the admin Queue's "how it will look on the site"
// preview build the same card. The date helpers live here because the card
// is what needs them; EventsClient imports them back for its month headings
// and featured row.

export function parseISO(date: string): Date {
  return new Date(date + 'T00:00:00Z')
}
function shortMonth(d: Date): string {
  // en-US, not en-GB: en-GB abbreviates September as "Sept".
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
  }).format(d)
}

function formatEventDate(
  startDate: string | null,
  endDate: string | null
): string | null {
  if (!startDate) return null
  const s = parseISO(startDate)
  const day = (d: Date) => d.getUTCDate()
  if (!endDate || endDate === startDate) {
    return `${day(s)} ${shortMonth(s)} ${s.getUTCFullYear()}`
  }
  const e = parseISO(endDate)
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear()
  const sameMonth = sameYear && s.getUTCMonth() === e.getUTCMonth()
  if (sameMonth) {
    return `${day(s)} – ${day(e)} ${shortMonth(e)} ${e.getUTCFullYear()}`
  }
  if (sameYear) {
    return `${day(s)} ${shortMonth(s)} – ${day(e)} ${shortMonth(e)} ${e.getUTCFullYear()}`
  }
  return `${day(s)} ${shortMonth(s)} ${s.getUTCFullYear()} – ${day(e)} ${shortMonth(e)} ${e.getUTCFullYear()}`
}

function formatEventTime(
  startTime: string | null,
  endTime: string | null
): string | null {
  if (!startTime) return null
  return endTime ? `${startTime} – ${endTime}` : startTime
}

function formatDeadline(event: EventListing): string | null {
  if (!event.deadlineType || !event.applicationsClose) return null
  const d = parseISO(event.applicationsClose)
  return `${event.deadlineType} by ${d.getUTCDate()} ${shortMonth(d)} ${d.getUTCFullYear()}`
}

export function titleMetaFor(event: EventListing) {
  const date = formatEventDate(event.startDate, event.endDate)
  const time = formatEventTime(event.startTime, event.endTime)
  const rows: { icon: string; value: string }[] = []
  // Online events say so via Mode rather than the Location text (mirroring
  // /training), so Location in Airtable can stay empty for them. Hybrid
  // events can be attended either way, so the card spells out both facets
  // ("Online & Oxford, UK") the way /training listings do. The raw location
  // stays city-only in Airtable so the city filter isn't polluted.
  if (event.mode === 'Online') {
    rows.push({ icon: '/images/icons/computer.svg', value: 'Online' })
  } else if (event.location) {
    rows.push({
      icon: '/images/icons/pin.svg',
      value:
        event.mode === 'Hybrid' ? `Online & ${event.location}` : event.location,
    })
  }
  if (date) rows.push({ icon: '/images/icons/calendar.svg', value: date })
  if (time) rows.push({ icon: '/images/icons/timer.svg', value: time })
  return rows
}

export function bottomMetaFor(event: EventListing) {
  const deadline = formatDeadline(event)
  const rows: { icon: string; value: string }[] = []
  if (event.host)
    rows.push({ icon: '/images/icons/person.svg', value: `By ${event.host}` })
  if (event.cost.length > 0)
    rows.push({ icon: '/images/icons/tag.svg', value: event.cost.join(', ') })
  if (deadline) rows.push({ icon: '/images/icons/paper.svg', value: deadline })
  return rows
}

// The ListingCard props for one event, exactly as the /events month grid
// renders it — the same in the In person and Online views (only the click's
// trackingSource differs). The featured row at the top of the page is a
// FeaturedCard instead: same title/bottom meta, plus a "Featured <type>"
// tagline and accent color, and no link when the URL is '#'. That variant
// isn't reproduced here.
export function eventCardProps(event: EventListing): CardProps {
  return {
    href: event.url,
    name: event.name,
    description: event.description,
    logo: event.logo,
    pills: event.type.map(t => ({
      label: t,
      colorClass: eventTypeColor(t),
    })),
    titleMeta: titleMetaFor(event),
    meta: bottomMetaFor(event),
  }
}
