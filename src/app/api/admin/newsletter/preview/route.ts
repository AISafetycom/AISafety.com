/*
  GET /api/admin/newsletter/preview?draft=<id>

  The draft's email HTML, as a subscriber will see it (personalisation tags
  neutralised), for the sandboxed preview frame on /admin/newsletter.
  Approvers and view-only reviewers (canViewNewsletter). Never cached.
*/

import { NextRequest } from 'next/server'
import { canViewNewsletter } from '@/lib/admin/auth'
import { isNewsletterConfigured, previewHtml } from '@/lib/admin/newsletter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // Only the admin page may frame this. (Not X-Frame-Options: the
        // sandboxed iframe has an opaque origin, which SAMEORIGIN would
        // refuse; frame-ancestors checks the embedding page instead.)
        // Belt and braces alongside the iframe's sandbox attribute: no scripts
        // run in the preview, links can't navigate the admin.
        'Content-Security-Policy':
          "frame-ancestors 'self'; sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
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
