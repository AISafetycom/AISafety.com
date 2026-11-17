import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { Redis } from '@upstash/redis'
import { hasChangesSince } from '@/lib/data/changed-since'

// Force dynamic - this endpoint must run fresh on every cron invocation
export const dynamic = 'force-dynamic'

// Airtable tables whose changes should trigger a rebuild. The filter mirrors
// what the corresponding page actually displays, so internal-only edits on
// unpublished records don't cause unnecessary rebuilds. Filters reference
// fields by permanent field ID (rename-proof).
const TABLES: Array<{
  name: string
  tableId: string
  filter?: string
}> = [
  {
    name: 'communities',
    tableId: 'tbluI5Dll697WiSm8',
    filter: '{fldV8RYP1CVzOvHpf} = TRUE()', // Publish?
  },
  {
    name: 'funding',
    tableId: 'tblzMTLDZWZKqTxrq',
    filter: '{fldoH88AbtQLEViD7} = TRUE()', // Publish?
  },
  {
    name: 'self-study',
    tableId: 'tblRNYJ0m1cmJXKKk',
    filter: '{fldWShxP7GkMeh6rg} = TRUE()', // Publish?
  },
  { name: 'map', tableId: 'tblvzbGL9q9dOO9Nc' },
  {
    name: 'advisors',
    tableId: 'tblf3KKYnmgcjVGhD',
    filter: '{fldaOmFd67ORPMfTC} = TRUE()', // Publish?
  },
  {
    name: 'projects',
    tableId: 'tblHT29QNgMYKB8iW',
    filter: '{fldrGDtZxpFLQfjMz} = TRUE()', // Publish?
  },
  {
    name: 'media-channels',
    tableId: 'tblCTOMzyH3vILL5I',
    filter: '{fldMN0TF3kz41HTQc} = TRUE()', // Publish?
  },
  {
    name: 'founders',
    tableId: 'tbl59Ye8oxvPjoVJv',
    filter: '{fld9Epdrxu9n0FV20} = TRUE()', // Publish?
  },
  {
    name: 'events',
    tableId: 'tblXbN9swwldwq8f7',
    filter: '{flddgpgNm090Uftsq} = TRUE()', // Publish?
  },
  {
    name: 'training',
    tableId: 'tbli1YSCpIuNY2DvL',
    filter: '{fldqlN36P6BVFP151} = TRUE()', // Publish?
  },
  {
    name: 'recurring-training',
    tableId: 'tblEEIbj6dW5oS4cX',
    filter: '{fldpjcvh7n6w4cIsi} = TRUE()', // Publish?
  },
]

// Module-level cooldowns prevent hammering the Vercel deploy hook. The hook is
// rate-limited (~1 per 60s) and Vercel will temporarily lock it out under spam.
// These reset on cold start, which is fine — a new instance means time has
// passed anyway.
let lastTriggerAt = 0
let lastRateLimitedAt = 0
// After a successful trigger, suppress further triggers for this long so the
// in-flight build can finish and advance BUILD_TIME.
const POST_TRIGGER_COOLDOWN_MS = 10 * 60 * 1000
// After a 429, back off entirely so we stop adding to Vercel's rate-limit count.
const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000

// One rebuild at a time. The cooldowns above live in one function instance's
// memory, and in practice they don't hold from one cron run to the next (a
// run can land on a fresh instance, and a new deployment always starts
// empty): on 17 Nov 2026, while the owner worked through the Queue, one
// deployment triggered four rebuilds in four minutes. Builds
// that overlap share Airtable's five requests a second, lock each other out,
// and one of them failed. So the time of the last trigger is also kept in
// Upstash, where every instance of every deployment reads the same value.
// While that trigger is newer than this deployment's BUILD_TIME, the build it
// started isn't live yet, and another one would only overlap it. The edits
// that came in meanwhile aren't lost: once that build is live its own
// BUILD_TIME is the newer of the two, and the next check starts the next
// build. The key expires by itself, so a build that fails or never starts
// holds a rebuild up for six minutes at most (a build takes two to three).
const LAST_TRIGGER_KEY = 'aisafety:check-rebuild:last-trigger'
const BUILD_IN_FLIGHT_MS = 6 * 60 * 1000

// The same Upstash database the site's analytics use.
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

/** When any instance last triggered a rebuild (ms), or null when none did in
 *  the last six minutes. Also null when the store can't be read: a rebuild
 *  too many is better than a site that stays out of date. */
async function lastSharedTrigger(): Promise<number | null> {
  if (!store) return null
  try {
    const at = Number(await store.get(LAST_TRIGGER_KEY))
    return Number.isFinite(at) && at > 0 ? at : null
  } catch (err) {
    console.warn(
      `[check-rebuild] last trigger unreadable, so not holding back: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

async function rememberTrigger(now: number): Promise<void> {
  if (!store) return
  try {
    await store.set(LAST_TRIGGER_KEY, now, { px: BUILD_IN_FLIGHT_MS })
  } catch (err) {
    console.warn(
      `[check-rebuild] last trigger not saved, so the next check may start a second build: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export async function GET(request: Request) {
  // Vercel cron jobs include this auth header automatically
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID
  const deployHookUrl = process.env.VERCEL_DEPLOY_HOOK_URL
  const buildTime = process.env.BUILD_TIME

  if (!token || !baseId) {
    return NextResponse.json(
      { error: 'Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID' },
      { status: 500 }
    )
  }
  if (!deployHookUrl) {
    return NextResponse.json(
      { error: 'Missing VERCEL_DEPLOY_HOOK_URL' },
      { status: 500 }
    )
  }
  if (!buildTime) {
    return NextResponse.json(
      { error: 'Missing BUILD_TIME (check next.config.ts)' },
      { status: 500 }
    )
  }

  const buildDate = new Date(buildTime)

  // Check each table in parallel for any record modified after the build
  const results = await Promise.all(
    TABLES.map(async t => ({
      name: t.name,
      changed: await hasChangesSince(
        baseId,
        token,
        t.tableId,
        buildDate,
        t.filter
      ),
    }))
  )

  const changedTables = results.filter(r => r.changed).map(r => r.name)
  const shouldRebuild = changedTables.length > 0

  if (!shouldRebuild) {
    return NextResponse.json({
      triggered: false,
      buildTime: buildDate.toISOString(),
      changedTables: [],
    })
  }

  // Static pages get fresh data from the rebuild below, but runtime consumers
  // (assistant catalog, search index) read the shared data cache, which a
  // rebuild does not clear. Invalidate it here so they refetch on their next
  // request. Runs before the hook cooldowns on purpose: even when a rebuild
  // can't be triggered yet, runtime data should not stay stale. 'max' =
  // stale-while-revalidate; the cron re-fires every minute until the rebuild
  // lands, so the background refresh converges within a couple of requests.
  revalidateTag('airtable-records', 'max')

  const now = Date.now()

  const sharedTrigger = await lastSharedTrigger()
  if (
    sharedTrigger !== null &&
    sharedTrigger > buildDate.getTime() &&
    now - sharedTrigger < BUILD_IN_FLIGHT_MS
  ) {
    return NextResponse.json({
      triggered: false,
      reason: 'build-in-flight',
      buildTime: buildDate.toISOString(),
      changedTables,
    })
  }

  if (now - lastTriggerAt < POST_TRIGGER_COOLDOWN_MS) {
    return NextResponse.json({
      triggered: false,
      reason: 'recent-trigger-cooldown',
      buildTime: buildDate.toISOString(),
      changedTables,
    })
  }

  if (now - lastRateLimitedAt < RATE_LIMIT_COOLDOWN_MS) {
    return NextResponse.json({
      triggered: false,
      reason: 'rate-limit-cooldown',
      buildTime: buildDate.toISOString(),
      changedTables,
    })
  }

  const hookResponse = await fetch(deployHookUrl, { method: 'POST' })

  if (hookResponse.status === 429) {
    lastRateLimitedAt = now
    console.warn(
      `Deploy hook rate-limited (429); backing off for ${RATE_LIMIT_COOLDOWN_MS / 60000} min`
    )
    return NextResponse.json({
      triggered: false,
      reason: 'rate-limited',
      buildTime: buildDate.toISOString(),
      changedTables,
    })
  }

  if (!hookResponse.ok) {
    throw new Error(
      `Deploy hook failed: ${hookResponse.status} ${hookResponse.statusText}`
    )
  }

  lastTriggerAt = now
  await rememberTrigger(now)

  return NextResponse.json({
    triggered: true,
    buildTime: buildDate.toISOString(),
    changedTables,
  })
}
