// Builds the link behind the selection menu's feedback button
// (SelectionMenu): one of the site's two Airtable forms, opened with the
// selected text, where it came from and a link back already filled in, so
// the visitor only has to add what's wrong.

const CORRECTIONS_FORM =
  'https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form'
const FEEDBACK_FORM =
  'https://airtable.com/appF8XfZUGXtfi40E/pageXZp18w3Sqm1Z7/form'

// The corrections form's "Resource" choice for each resource page. A page
// with no choice of its own (Jobs) leaves the field for the visitor.
const RESOURCE_BY_PATH: Record<string, string> = {
  '/training': 'Training programs',
  '/events': 'Events',
  '/map': 'Field map',
  '/communities': 'Communities',
  '/self-study': 'Self-study',
  '/funding': 'Funding',
  '/media-channels': 'Media channels',
  '/advisors': 'Advisors',
  '/founders': 'Founder toolkit',
}

/** Longest quote put into a form link, so the link stays a sane length. */
export const MAX_QUOTE_LENGTH = 500

/** The selected text as it goes into the form: on one line, and cut at a
 *  word boundary when it is very long. */
export function quoteForForm(selected: string): string {
  const text = selected.replace(/\s+/g, ' ').trim()
  if (text.length <= MAX_QUOTE_LENGTH) return text
  const cut = text.slice(0, MAX_QUOTE_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut
}

function formLink(base: string, fields: Record<string, string | undefined>) {
  const params = Object.entries(fields)
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
  return `${base}?${params.join('&')}`
}

export interface SelectionSource {
  /** The selected text. */
  text: string
  /** The page's path, e.g. '/training' (never a private page's token). */
  path: string
  /** The page's ?view=, when it has one (Training's recurring programs are
   *  their own choice on the corrections form). */
  view?: string | null
  /** A link back to where the text is. */
  link: string
  /** The listing whose card the text is on, when it is on one. */
  listingName?: string
}

/** The corrections form for text on a listing's card, the feedback form for
 *  text anywhere else. The quote and link come first in the form's text box
 *  and the visitor writes underneath. */
export function selectionFormLink(source: SelectionSource): string {
  const body = `"${quoteForForm(source.text)}"\n${source.link}\n\n`
  if (source.listingName) {
    const recurring = source.path === '/training' && source.view === 'recurring'
    return formLink(CORRECTIONS_FORM, {
      prefill_Resource: recurring
        ? 'Recurring training programs'
        : RESOURCE_BY_PATH[source.path],
      [`prefill_${encodeURIComponent('Listing name')}`]: source.listingName,
      prefill_Correction: body,
    })
  }
  // Page is filled in and hidden, as from the footer's feedback link.
  return formLink(FEEDBACK_FORM, {
    prefill_Page: source.path.replace(/^\//, '') || 'home',
    hide_Page: 'true',
    prefill_Feedback: body,
  })
}
