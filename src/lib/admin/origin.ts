import type { NextRequest } from 'next/server'

/** The origin the browser actually used, as Google must see it in the
 *  redirect URI. Behind Vercel's proxy the forwarded headers carry the public
 *  host; locally it's whatever port the dev server is on. A forged Host
 *  header buys nothing: Google only redirects to URIs registered in the
 *  console, and a callback with a forged host is only fooling its sender. */
export function publicOrigin(req: NextRequest): string {
  return originFrom(req.headers, req.nextUrl)
}

function originFrom(
  headers: Headers,
  url: { protocol: string; host: string }
): string {
  const proto =
    headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    url.protocol.replace(/:$/, '')
  const host =
    headers.get('x-forwarded-host')?.split(',')[0].trim() ||
    headers.get('host') ||
    url.host
  return `${proto}://${host}`
}

/** A POST that changes something must come from the admin page itself. The
 *  session cookie is SameSite=Lax, which keeps other sites out but not a
 *  page on another subdomain of aisafety.com (the same "site"), so this
 *  checks the origin too: the browser's own Sec-Fetch-Site, which no page
 *  can set, and Origin for older browsers without it. A request with
 *  neither isn't a browser's, so it carries nobody's cookie. */
export function isSameOriginRequest(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site != null) return site === 'same-origin'
  const origin = req.headers.get('origin')
  if (origin == null) return true
  return origin === originFrom(req.headers, new URL(req.url))
}
