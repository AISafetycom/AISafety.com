export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/** "31 Oct 2026": the short form card lines use, like /events and /training.
 *  en-US, not en-GB: en-GB abbreviates September as "Sept". */
export function formatShortDate(date: Date): string {
  const month = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
  }).format(date)
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`
}

/** Minute-level "x ago" for freshness readouts (the preview-mode banner's
 *  "site last rebuilt ..."), where formatRelativeDate's day granularity is
 *  too coarse. `now` is a parameter so the pure logic is testable. */
export function formatTimeAgo(isoDate: string, now: Date): string {
  const then = new Date(isoDate)
  if (isNaN(then.getTime())) {
    throw new Error(`formatTimeAgo: invalid date "${isoDate}"`)
  }
  const diffMinutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`
  }
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`
  }
  const diffDays = Math.floor(diffHours / 24)
  return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`
}

export function formatRelativeDate(isoDate: string): string {
  const lastUpdatedDate = new Date(isoDate)
  const now = new Date()

  const lastUpdatedDay = Date.UTC(
    lastUpdatedDate.getUTCFullYear(),
    lastUpdatedDate.getUTCMonth(),
    lastUpdatedDate.getUTCDate()
  )
  const nowDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  )

  const diffDays = Math.floor((nowDay - lastUpdatedDay) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Updated today'
  if (diffDays === 1) return 'Updated yesterday'
  if (diffDays < 7) return `Updated ${diffDays} days ago`
  if (diffDays < 14) return 'Updated 1 week ago'
  if (diffDays < 28) return `Updated ${Math.floor(diffDays / 7)} weeks ago`
  if (diffDays < 60) return 'Updated 1 month ago'
  if (diffDays < 365) return `Updated ${Math.floor(diffDays / 30)} months ago`
  if (diffDays < 730) return 'Updated 1 year ago'
  return `Updated ${Math.floor(diffDays / 365)} years ago`
}
