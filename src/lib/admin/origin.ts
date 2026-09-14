import type { NextRequest } from 'next/server'

/** The origin the browser actually used, as Google must see it in the
 *  redirect URI. Behind Vercel's proxy the forwarded headers carry the public
 *  host; locally it's whatever port the dev server is on. A forged Host
 *  header buys nothing: Google only redirects to URIs registered in the
 *  console, and a callback with a forged host is only fooling its sender. */
export function publicOrigin(req: NextRequest): string {
  const proto =
    req.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    req.nextUrl.protocol.replace(/:$/, '')
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
    req.headers.get('host') ||
    req.nextUrl.host
  return `${proto}://${host}`
}
