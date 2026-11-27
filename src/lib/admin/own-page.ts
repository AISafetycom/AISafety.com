// Is this request from the admin's own page? The admin signs in with a
// cookie, and a browser sends that cookie with requests other pages make
// too: a form on another site, or a script on another host under the same
// domain (the cookie is SameSite=Lax, which lets same-site requests
// through). So a route that changes something, or hands back something
// private, checks two things a foreign page cannot fake:
//
// - a write must be JSON. A page elsewhere can only send the "simple"
//   content types (a form, plain text) without asking the server first, and
//   this server never says yes to that question.
// - the browser's own word on where the request came from. `Sec-Fetch-Site`
//   must be `same-origin` (or `none`: typed by the person); failing that, an
//   `Origin` header must name this site. Browsers set both themselves; a
//   page's script cannot change them.
//
// A request with neither header (curl, a script holding a session it was
// given) passes on the content type alone: there is no browser in it to
// have been tricked. Pure: no Next imports, so it tests by itself.

export interface OwnPageCheck {
  /** The request's headers. */
  get(name: string): string | null
}

/** Why the request is refused, or null when it may go ahead. `hosts` are
 *  the names this site answers to for this request (its Host header, and
 *  the forwarded one behind a proxy). */
export function notOwnPage(
  headers: OwnPageCheck,
  hosts: readonly (string | null | undefined)[],
  opts: { json: boolean }
): string | null {
  if (opts.json) {
    const type = (headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (type !== 'application/json') return 'not JSON'
  }
  const site = (headers.get('sec-fetch-site') ?? '').trim().toLowerCase()
  if (site === 'same-origin' || site === 'none') return null
  if (site) return `sent from another site (${site})`
  const origin = headers.get('origin')
  if (origin === null) return null
  let host = ''
  try {
    host = new URL(origin).host.toLowerCase()
  } catch {
    return 'sent from an unreadable origin'
  }
  const own = hosts
    .filter((h): h is string => Boolean(h))
    .map(h => h.trim().toLowerCase())
  return host && own.includes(host) ? null : 'sent from another origin'
}

/** The same, for a route: reads the hosts off the request. */
export function notOwnPageRequest(
  req: { headers: OwnPageCheck; nextUrl: { host: string } },
  opts: { json: boolean }
): string | null {
  return notOwnPage(
    req.headers,
    [
      req.headers.get('host'),
      req.headers.get('x-forwarded-host'),
      req.nextUrl.host,
    ],
    opts
  )
}
