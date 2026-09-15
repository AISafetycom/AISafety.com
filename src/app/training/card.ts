import type { CardProps } from '@/components/ListingCard'
import type {
  ProgramBase,
  RecurringProgram,
  TrainingProgram,
} from '@/lib/data/training'
import { trainingTypeColor } from '@/lib/training-types'

// Builds the card content for one training program. Plain TS (no JSX) so
// the page's client component and the admin Queue's "how it will look on the
// site" preview build the same card. The date helpers live here because the
// card is what needs them; TrainingClient imports titleMetaFor/bottomMetaFor
// back for its featured row.

function parseISO(date: string): Date {
  return new Date(date + 'T00:00:00Z')
}

function formatShortDate(date: string): string {
  const d = parseISO(date)
  // en-US, not en-GB: en-GB abbreviates September as "Sept".
  const month = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
  }).format(d)
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`
}

// "1 year", "3 months", "8 weeks", "6 days" — rounded to whichever unit
// reads most naturally for the span.
function durationLabel(
  startDate: string | null,
  endDate: string | null
): string | null {
  if (!startDate || !endDate || endDate < startDate) return null
  const start = parseISO(startDate).getTime()
  const end = parseISO(endDate).getTime()
  const days = Math.round((end - start) / 86_400_000) + 1
  if (days >= 330) {
    const years = Math.max(1, Math.round(days / 365.25))
    return years === 1 ? '1 year' : `${years} years`
  }
  const months = Math.round(days / 30.44)
  // Anything over 8 weeks reads better in months ("33 weeks" -> "8 months");
  // under that, use months only when the span is within days of a whole month.
  if (days > 56 || (months >= 1 && Math.abs(days - months * 30.44) <= 4)) {
    return months === 1 ? '1 month' : `${months} months`
  }
  if (days >= 14) {
    return `${Math.round(days / 7)} weeks`
  }
  return days === 1 ? '1 day' : `${days} days`
}

export function titleMetaFor(program: ProgramBase, upcoming?: TrainingProgram) {
  const rows: { icon: string; value: string }[] = []
  if (program.mode === 'Online') {
    rows.push({ icon: '/images/icons/computer.svg', value: 'Online' })
  } else if (program.location) {
    rows.push({ icon: '/images/icons/pin.svg', value: program.location })
  }
  const startText =
    upcoming?.startDateApprox ??
    (upcoming?.startDate ? formatShortDate(upcoming.startDate) : null)
  if (upcoming && startText) {
    const duration = durationLabel(upcoming.startDate, upcoming.endDate)
    const starts = `Starts ${startText}`
    rows.push({
      icon: '/images/icons/calendar.svg',
      value: duration ? `${duration} · ${starts}` : starts,
    })
  } else {
    // Recurring programs have no dates, but most run a consistent length.
    const typical = (program as RecurringProgram).typicalLength
    if (typical) {
      rows.push({ icon: '/images/icons/calendar.svg', value: typical })
    }
  }
  return rows
}

export function bottomMetaFor(
  program: ProgramBase,
  upcoming?: TrainingProgram
) {
  const rows: { icon: string; value: string }[] = []
  if (program.stipend) {
    rows.push({
      icon:
        program.stipend === 'No stipend'
          ? '/images/icons/money-off.svg'
          : '/images/icons/money.svg',
      value: program.stipend,
    })
  }
  if (program.timeCommitment) {
    rows.push({
      icon:
        program.timeCommitment === 'Part-time'
          ? '/images/icons/timer-half.svg'
          : '/images/icons/timer.svg',
      value: program.timeCommitment,
    })
  }
  if (program.entryBar) {
    rows.push({
      icon: `/images/icons/entry-${program.entryBar.toLowerCase()}.svg`,
      value: `Entry bar: ${program.entryBar.toLowerCase()}`,
    })
  }
  if (program.focus.length > 0) {
    rows.push({
      icon: '/images/icons/target.svg',
      value: `Focus: ${program.focus.map(f => f.toLowerCase()).join(', ')}`,
    })
  }
  if (upcoming) {
    if (upcoming.notYetOpen) {
      rows.push({
        icon: '/images/icons/paper-closed.svg',
        value: 'Applications not yet open',
      })
    } else if (upcoming.applicationsClose) {
      const open = upcoming.applicationStatus === 'Open'
      rows.push({
        icon: open
          ? '/images/icons/paper.svg'
          : '/images/icons/paper-closed.svg',
        value: open
          ? `Apply by ${formatShortDate(upcoming.applicationsClose)}`
          : 'Applications closed',
      })
    }
  }
  return rows
}

// The ListingCard props for one dated (Upcoming) program, exactly as the
// /training grid renders it.
export function trainingCardProps(program: TrainingProgram): CardProps {
  return {
    href: program.url,
    name: program.name,
    description: program.description,
    logo: program.logo,
    pills: program.type.map(t => ({
      label: t,
      colorClass: trainingTypeColor(t),
    })),
    titleMeta: titleMetaFor(program, program),
    meta: bottomMetaFor(program, program),
  }
}

// The ListingCard props for one Recurring program, exactly as the /training
// grid renders it under the Recurring toggle.
export function recurringProgramCardProps(
  program: RecurringProgram
): CardProps {
  return {
    href: program.url,
    name: program.name,
    description: program.description,
    logo: program.logo,
    pills: program.type.map(t => ({
      label: t,
      colorClass: trainingTypeColor(t),
    })),
    titleMeta: titleMetaFor(program),
    meta: bottomMetaFor(program),
  }
}
