// The job board's page as data: everything on it, plus each job's clicks by
// day, as one JSON file that explains itself (jobsDataFile), for a
// spreadsheet or the board's AI assistant. Same link, same dates
// (?from=&to=), and it stops with the link. Fetching it isn't counted as a
// view of the page.

import { jobsDataFile } from '@/lib/analytics/jobs-source'
import { getShare, isShareToken } from '@/lib/analytics/org-shares'
import { jobsPageRange, loadJobsStats } from '../jobs-data'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ token: string }> }

const HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
}

/** 'YYYY-MM-DD' in UTC. */
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params
  const share = isShareToken(token) ? await getShare(token) : null
  if (share?.kind !== 'jobs')
    return new Response('Not found', { status: 404, headers: HEADERS })

  const now = Date.now()
  const { range } = jobsPageRange(
    Object.fromEntries(new URL(req.url).searchParams),
    now
  )
  try {
    const stats = await loadJobsStats(range, now)
    const from =
      range.from ?? (range.startMs != null ? utcDay(range.startMs) : null)
    const to = range.to ?? utcDay(Math.min(range.endMs ?? now, now))
    return Response.json(
      jobsDataFile(stats, {
        board: share.orgName,
        from,
        to,
        generatedAt: new Date(now).toISOString(),
      }),
      { headers: HEADERS }
    )
  } catch (err) {
    console.warn(
      `[stats] job board data file unavailable: ${err instanceof Error ? err.message : String(err)}`
    )
    return Response.json(
      { error: 'Couldn’t load the figures just now. Try again in a moment.' },
      { status: 503, headers: HEADERS }
    )
  }
}
