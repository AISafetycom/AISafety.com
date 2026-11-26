// The site's own correction and feedback form (FeedbackPopover): what a
// visitor may send, and what it becomes. /api/site-feedback checks a
// submission with parseSubmission, saves airtableFields() as a row in the
// same Airtable table the old Airtable forms filled (Site corrections or
// Site feedback), and emails the owner ownerMail(), because Airtable only
// sends its "someone responded" email for its own forms.
//
// Pure: no fetch, no env. The browser imports the types and RESOURCE_CHOICES
// from here too.

export type FeedbackKind = 'correction' | 'feedback'

/** The Airtable tables and fields (by permanent id, so a rename in Airtable
 *  can't break the form). */
export const SITE_CORRECTIONS = {
  table: 'tblKm44KngUDniaDR',
  correction: 'fld7aBFN6bZntVnJu', // Correction
  resource: 'fldE915IDhW7dl6l7', // Resource
  listingName: 'fldD9QzddUt7ykaP6', // Listing name
  email: 'fldKzmpX8bHqQOgYD', // Submitter's email
  page: 'fldjbYKywTkcmgRVn', // Page (added 22 November 2026, for this form)
} as const

export const SITE_FEEDBACK = {
  table: 'tblzTFjkQ4v7G6saq',
  feedback: 'fldWHcUnzZARMJFg3', // Feedback
  email: 'fldz6XExBZiU9Cyvc', // Submitter's email
  page: 'fldJQYQx6QRAOZX5t', // Page
} as const

/** The corrections table's "Resource" choices a visitor can pick, in the
 *  order the nav lists the pages. "Volunteer projects" is left out: that page
 *  was retired in October 2026. */
export const RESOURCE_CHOICES = [
  'Events',
  'Training programs',
  'Recurring training programs',
  'Field map',
  'Communities',
  'Self-study',
  'Funding',
  'Media channels',
  'Advisors',
  'Founder toolkit',
] as const

/** The site's address in links put into Airtable and emails. Built on the
 *  server from the page's path, never taken from the visitor. */
export const SITE_ORIGIN = 'https://aisafety.com'

export const LIMITS = {
  text: 5000,
  quote: 600,
  listingName: 200,
  email: 320,
  path: 200,
} as const

export interface Submission {
  kind: FeedbackKind
  /** What the visitor wrote: what's wrong, or their feedback. */
  text: string
  /** The text they had selected on the page, when they came from the
   *  selection menu. */
  quote?: string
  /** The page's path, e.g. '/events'. */
  path: string
  /** The page's ?view=, when it has one (Training's recurring programs). */
  view?: string
  /** The card's listing, when the text was on one. */
  listingName?: string
  listingId?: string
  /** Corrections: the corrections table's Resource choice. */
  resource?: string
  email?: string
}

export type ParseResult =
  | { ok: true; submission: Submission }
  | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// A site path: letters, digits, dashes, underscores and slashes only. Keeps
// anything odd (a private stats token has its own route and is never sent)
// out of Airtable and the owner's email.
const PATH_RE = /^\/[A-Za-z0-9/_-]*$/
const VIEW_RE = /^[a-z-]{1,40}$/
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Check a submission from the browser. Every field is length-capped and
 *  shape-checked; anything wrong is refused rather than trimmed, so what
 *  reaches Airtable is exactly what the visitor saw. */
export function parseSubmission(body: unknown): ParseResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'not an object' }
  }
  const b = body as Record<string, unknown>
  const kind = b.kind
  if (kind !== 'correction' && kind !== 'feedback') {
    return { ok: false, error: 'unknown kind' }
  }

  const text = str(b.text)
  if (!text) return { ok: false, error: 'missing text' }
  if (text.length > LIMITS.text) return { ok: false, error: 'text too long' }

  const path = str(b.path)
  if (!PATH_RE.test(path) || path.length > LIMITS.path) {
    return { ok: false, error: 'bad path' }
  }

  const quote = str(b.quote).replace(/\s+/g, ' ')
  if (quote.length > LIMITS.quote) return { ok: false, error: 'quote too long' }

  const view = str(b.view)
  if (view && !VIEW_RE.test(view)) return { ok: false, error: 'bad view' }

  const listingName = str(b.listingName).replace(/\s+/g, ' ')
  if (listingName.length > LIMITS.listingName) {
    return { ok: false, error: 'listing name too long' }
  }

  const listingId = str(b.listingId)
  if (listingId && !RECORD_ID_RE.test(listingId)) {
    return { ok: false, error: 'bad listing id' }
  }

  const resource = str(b.resource)
  if (resource && !(RESOURCE_CHOICES as readonly string[]).includes(resource)) {
    return { ok: false, error: 'unknown resource' }
  }

  const email = str(b.email)
  if (email && (email.length > LIMITS.email || !EMAIL_RE.test(email))) {
    return { ok: false, error: 'bad email' }
  }

  return {
    ok: true,
    submission: {
      kind,
      text,
      path,
      ...(quote && { quote }),
      ...(view && { view }),
      ...(listingName && { listingName }),
      ...(listingId && { listingId }),
      ...(kind === 'correction' && resource && { resource }),
      ...(email && { email }),
    },
  }
}

/** A link back to where the visitor was: the page, its view, and the card
 *  when the text was on one. */
export function pageLink(s: Submission): string {
  return (
    SITE_ORIGIN +
    s.path +
    (s.view ? `?view=${encodeURIComponent(s.view)}` : '') +
    (s.listingId ? `#${s.listingId}` : '')
  )
}

/** The text that goes into the Correction or Feedback field. From the
 *  selection menu it starts with the quote and the link back, as the
 *  prefilled Airtable form did, so the Queue reads it the same way. */
export function messageText(s: Submission): string {
  if (!s.quote) return s.text
  return `"${s.quote}"\n${pageLink(s)}\n\n${s.text}`
}

/** The page as both tables' Page field records it ('events', 'home'), the
 *  same as the footer's feedback link always did. */
export function pageValue(path: string): string {
  return path.replace(/^\//, '') || 'home'
}

/** The Airtable table and the row's fields, by field id. */
export function airtableFields(s: Submission): {
  table: string
  fields: Record<string, string>
} {
  if (s.kind === 'correction') {
    const f = SITE_CORRECTIONS
    return {
      table: f.table,
      fields: {
        [f.correction]: messageText(s),
        [f.page]: pageValue(s.path),
        ...(s.resource && { [f.resource]: s.resource }),
        ...(s.listingName && { [f.listingName]: s.listingName }),
        ...(s.email && { [f.email]: s.email }),
      },
    }
  }
  const f = SITE_FEEDBACK
  return {
    table: f.table,
    fields: {
      [f.feedback]: messageText(s),
      [f.page]: pageValue(s.path),
      ...(s.email && { [f.email]: s.email }),
    },
  }
}

/** Marks the owner's email as one from this form, so the Queue can find it
 *  the way it finds Airtable's own form emails (the record link is in it). */
export const OWNER_MAIL_TAG = '(site form)'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The email to the owner about a new submission: what was sent, from where,
 *  and the Airtable row. */
export function ownerMail(
  s: Submission,
  recordUrl: string
): { subject: string; text: string; html: string } {
  const correction = s.kind === 'correction'
  const about = correction
    ? s.listingName || s.resource || 'a listing'
    : `/${pageValue(s.path)}`
  const subject =
    `${correction ? 'Correction' : 'Feedback'} ${OWNER_MAIL_TAG}: ${about}`.slice(
      0,
      200
    )
  const rows: [string, string][] = [
    ['Page', pageLink(s)],
    ...(correction && s.resource
      ? ([['Resource', s.resource]] as [string, string][])
      : []),
    ...(s.listingName
      ? ([['Listing', s.listingName]] as [string, string][])
      : []),
    ['Email', s.email || 'none given'],
  ]
  const heading = correction
    ? 'Someone suggested a correction on the site.'
    : 'Someone sent feedback on the site.'
  const text = [
    heading,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    ...(s.quote ? [`Selected text: "${s.quote}"`, ''] : []),
    correction ? "What's wrong:" : 'Feedback:',
    s.text,
    '',
    `Airtable: ${recordUrl}`,
  ].join('\n')
  const html = [
    `<p>${escapeHtml(heading)}</p>`,
    `<p>${rows.map(([k, v]) => `<b>${k}</b>: ${escapeHtml(v)}`).join('<br>')}</p>`,
    ...(s.quote
      ? [`<p><b>Selected text</b>: &ldquo;${escapeHtml(s.quote)}&rdquo;</p>`]
      : []),
    `<p><b>${correction ? 'What&rsquo;s wrong' : 'Feedback'}</b>:<br>${escapeHtml(s.text).replace(/\n/g, '<br>')}</p>`,
    `<p><a href="${escapeHtml(recordUrl)}">Open it in Airtable</a></p>`,
  ].join('\n')
  return { subject, text, html }
}
