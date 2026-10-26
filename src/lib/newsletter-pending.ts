/*
  Signing up to several newsletters with one confirmation (/newsletter).

  Each newsletter has its own double opt-in form in ActiveCampaign, and each
  form sends its own confirmation email, so posting a signup to all three
  would send three emails to click. Instead /api/subscribe posts only the
  first newsletter picked (in the usual order) that the reader doesn't get
  yet, and keeps the rest here: the contact, the list whose confirmation
  it waits for, and the lists to add. A cron (/api/newsletter/pending,
  every ten minutes) checks each one: once that list shows the reader as
  subscribed, they have clicked the link, so they are added to the rest
  directly (they proved the inbox is theirs and asked for them), and the
  record goes. A signup nobody confirms simply expires after PENDING_DAYS.

  Kept in Upstash, the database the signup limits use. Records are filed
  per environment, so a test signup on localhost or a preview is never
  finished by the live site's cron. Holds no address: the contact number
  stands for the reader.
*/

import { Redis } from '@upstash/redis'
import {
  NotFoundError,
  readStatuses,
  setListStatus,
  storeManageKey,
} from './newsletter-contacts'

export const PENDING_DAYS = 14

const ENV = process.env.VERCEL_ENV ?? 'local'
const PREFIX = `aisafety:newsletter:pending:${ENV}`
/** The contacts with a record, so the cron needn't scan the database. */
const INDEX = `${PREFIX}:ids`

// Same env fallbacks as src/lib/newsletter-signup-limits.ts.
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

function store(): Redis {
  if (!restUrl || !restToken)
    throw new Error("Upstash isn't configured, so nothing can be kept")
  return new Redis({ url: restUrl, token: restToken })
}

export interface PendingSignup {
  /** The list whose confirmation this waits for. */
  waitFor: string
  /** The lists to add once it's confirmed. */
  add: string[]
  /** When the signup was made, ISO. */
  at: string
}

/** Keep a signup's other newsletters until its confirmation. A second
 *  signup by the same reader replaces the first. */
export async function savePending(
  contactId: string,
  waitFor: string,
  add: string[]
): Promise<void> {
  const redis = store()
  const record: PendingSignup = { waitFor, add, at: new Date().toISOString() }
  await redis.set(`${PREFIX}:${contactId}`, record, {
    ex: PENDING_DAYS * 86_400,
  })
  await redis.sadd(INDEX, contactId)
}

export interface PendingRun {
  /** Confirmed, and added to the rest. */
  finished: number
  /** Not confirmed yet. */
  waiting: number
  /** Expired, or the contact is gone. */
  dropped: number
  /** Couldn't be checked or finished this time; tried again next run. */
  failed: number
}

/** Check every kept signup once (the cron). */
export async function finishPending(): Promise<PendingRun> {
  const redis = store()
  const run: PendingRun = { finished: 0, waiting: 0, dropped: 0, failed: 0 }
  const ids = (await redis.smembers(INDEX)).map(String)
  // One at a time: ActiveCampaign allows five requests a second.
  for (const id of ids) {
    const key = `${PREFIX}:${id}`
    const record = await redis.get<PendingSignup>(key)
    if (!record) {
      await redis.srem(INDEX, id)
      run.dropped++
      continue
    }
    try {
      const statuses = await readStatuses(id)
      if (statuses[record.waitFor] !== '1') {
        run.waiting++
        continue
      }
      for (const list of record.add) {
        if (statuses[list] !== '1') await setListStatus(id, list, 1)
      }
      await storeManageKey(id)
      console.log(
        `[newsletter-pending] contact ${id} confirmed list ${record.waitFor}; added to ${record.add.join(', ')}`
      )
      await redis.del(key)
      await redis.srem(INDEX, id)
      run.finished++
    } catch (err) {
      if (err instanceof NotFoundError) {
        await redis.del(key)
        await redis.srem(INDEX, id)
        run.dropped++
        continue
      }
      console.warn(
        `[newsletter-pending] contact ${id}: ${err instanceof Error ? err.message : String(err)}`
      )
      run.failed++
    }
  }
  return run
}
