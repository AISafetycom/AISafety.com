/** The general "Suggest a correction" form. ONE form shared by every resource
 *  page, used to UPDATE or fix an EXISTING listing (a wrong date, a dead link,
 *  changed details) — as opposed to submitting a brand-new listing, which uses
 *  the per-type forms below. Also the catch-all when the bot named no type or
 *  an unrecognized one. Same form linked site-wide in the footer. */
const CORRECTION_FORM =
  'https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form'

/** "Contact the team" form — for reaching a human with a request, question, or
 *  anything that needs a reply. */
const CONTACT_FORM =
  'https://airtable.com/appF8XfZUGXtfi40E/pagUmmzVb8OnVvTZS/form'

/** "Send feedback" form — for feedback or suggestions about the site itself
 *  (a feature wish, "it'd be nice if…", a complaint). */
const FEEDBACK_FORM =
  'https://airtable.com/appF8XfZUGXtfi40E/pageXZp18w3Sqm1Z7/form'

/** Airtable form to open for a given intent token. The per-listing-type entries
 *  are the main case — "Suggest a listing", keyed by the TYPE the bot is
 *  inviting the visitor to submit (the type it searched and found nothing for,
 *  NOT the page they're on), mirroring the "Suggest listing" button on each
 *  resource page; these strings match search_listings' `type` values. Below
 *  them are pseudo-type intents (correction / contact / feedback) that aren't
 *  listing types but reuse the same open-a-form button. Shared by the public
 *  widget and the admin playground.
 *
 *  `org` uses the field map's "Suggest entry" form. That form's URL is managed
 *  dynamically via an Airtable control row; the value here is a snapshot — if
 *  it's ever changed in Airtable, update it here too. `job` has no public
 *  submission form (listings come from external sources), so it falls back to
 *  the general correction form. */
const SUGGEST_FORMS: Record<string, string> = {
  community: 'https://airtable.com/appF8XfZUGXtfi40E/pagKhplUqu07DwVqC/form',
  event: 'https://airtable.com/appF8XfZUGXtfi40E/pagns0zQqcM713eKk/form',
  // The upcoming-programs form (the /training page's Recurring tab has its own
  // form, but a visitor suggesting a program is almost always suggesting a
  // dated round — the team re-routes the rare evergreen one).
  training: 'https://airtable.com/appF8XfZUGXtfi40E/pagSB4ucUn38CvXFD/form',
  funder: 'https://airtable.com/appF8XfZUGXtfi40E/pagBI1UdaBbFplw20/form',
  course: 'https://airtable.com/appF8XfZUGXtfi40E/pag6L4BzdkxocBzqr/form',
  'media-channel':
    'https://airtable.com/appF8XfZUGXtfi40E/pagSZ7vJj9MHyYmtS/form',
  'founder-resource':
    'https://airtable.com/appF8XfZUGXtfi40E/pag1OO5TrQkO96W7R/form',
  advisor: 'https://airtable.com/appF8XfZUGXtfi40E/pagTw6PRaIHUHh8ty/form',
  org: 'https://airtable.com/appF8XfZUGXtfi40E/pag2YaqdXhhR9Ey82/form',
  // Pseudo-types below: not listing types. They route the "update / contact /
  // give feedback" intents to their shared site-wide forms.
  correction: CORRECTION_FORM,
  contact: CONTACT_FORM,
  feedback: FEEDBACK_FORM,
}

/** Every listing type the bot may name in a [[suggest:TYPE:query]] token — the
 *  search_listings `type` values. `job` has no form of its own and resolves to
 *  the fallback below; it's still listed so the parser recognizes it. */
export const SUGGEST_TYPES = [
  'community',
  'event',
  'training',
  'funder',
  'course',
  'media-channel',
  'founder-resource',
  'advisor',
  'org',
  'job',
  // Pseudo-types (not listing types) for the update / contact / feedback
  // intents, so the parser recognizes them and the button can label itself
  // "Suggest a correction" / "Contact the team" / "Send feedback".
  'correction',
  'contact',
  'feedback',
] as const

/** The "Suggest a listing" Airtable form for the listing type the bot is
 *  inviting the visitor to submit. Falls back to the shared correction form
 *  when the bot named no type, an unrecognized one, or one without its own
 *  listing form (`job`). */
export function suggestFormUrl(type: string | null | undefined): string {
  if (!type) return CORRECTION_FORM
  return SUGGEST_FORMS[type.trim().toLowerCase()] ?? CORRECTION_FORM
}
