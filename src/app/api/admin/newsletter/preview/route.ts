/*
  GET /api/admin/newsletter/preview?draft=<id>

  The draft's email HTML, as a subscriber will see it (personalisation tags
  neutralised), for the sandboxed preview frame on /admin/newsletter.
  Approvers and view-only reviewers (canViewNewsletter). Never cached.
*/

import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { canViewNewsletter } from '@/lib/admin/auth'
import { isNewsletterConfigured, previewHtml } from '@/lib/admin/newsletter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Runs inside the preview frame. Scrolls to `#y=<px>` once the email is laid
 *  out (again after images load, unless the reader has scrolled meanwhile)
 *  and posts `{ aisafetyPreviewScroll: px }` to the admin page as the reader
 *  scrolls. */
const SCROLL_SCRIPT = `(function(){var m=/[#&]y=(\\d+)/.exec(location.hash),y=m?+m[1]:0,moved=false;function go(){if(y&&!moved)window.scrollTo(0,y)}document.addEventListener('DOMContentLoaded',go);addEventListener('load',go);['wheel','touchstart','keydown','mousedown'].forEach(function(e){addEventListener(e,function(){moved=true},{passive:true})});var t;addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){parent.postMessage({aisafetyPreviewScroll:Math.round(scrollY)},'*')},120)},{passive:true})})()`

export async function GET(req: NextRequest) {
  if (!(await canViewNewsletter())) {
    return new Response('unauthorized', { status: 401 })
  }
  if (!isNewsletterConfigured()) {
    return new Response('ActiveCampaign not configured', { status: 503 })
  }
  // `draft`, not `campaign`: ad blockers refuse URLs with a campaign= query
  // (seen as net::ERR_BLOCKED_BY_CLIENT on the first local test).
  const id = req.nextUrl.searchParams.get('draft') ?? ''
  if (!/^\d+$/.test(id)) return new Response('bad draft id', { status: 400 })
  try {
    const html = await previewHtml(id)
    if (html == null)
      return new Response('not a pipeline draft', { status: 404 })
    // Every link opens in a new tab: inside the sandboxed frame a click
    // would otherwise try to load the site in the frame itself and land on
    // a blank page (Bryce, 16 Sept 2026). The one script is the page's own
    // (nonce below): it reports the scroll position to the admin page and
    // goes back to `#y=` after a reload, so saving an edit doesn't throw the
    // preview back to the top (Bryce, 25 Sept 2026).
    const nonce = randomBytes(16).toString('base64')
    const framed = html.replace(
      /<head[^>]*>/i,
      m =>
        `${m}<base target="_blank"><script nonce="${nonce}">${SCROLL_SCRIPT}</script>`
    )
    return new Response(framed, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // Only the admin page may frame this. (Not X-Frame-Options: the
        // sandboxed iframe has an opaque origin, which SAMEORIGIN would
        // refuse; frame-ancestors checks the embedding page instead.)
        // Belt and braces alongside the iframe's sandbox attribute: the only
        // script that can run is the scroll keeper above (nonce; the frame
        // has an opaque origin, so it can't reach the admin's cookies or
        // page — it can only post a number up), links can't navigate the
        // admin — they may open a new tab, and that tab is an ordinary one
        // (the target site needs its scripts).
        'Content-Security-Policy': `frame-ancestors 'self'; sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'nonce-${nonce}'; img-src https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter] preview ${id} failed: ${message}`)
    return new Response('Preview failed; details are in the server log.', {
      status: 502,
    })
  }
}
