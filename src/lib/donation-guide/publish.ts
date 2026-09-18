// Publishing: the one path that changes the live page. Used by the Publish
// button and by Restore (which publishes an old snapshot as a new version).
// Server only: it revalidates the page caches and queues the owner's email.
import { revalidatePath, revalidateTag } from 'next/cache'
import { digestMail, mailConfigured, sendAdminMail } from '@/lib/admin/mail'
import { isRootAdmin, ROOT_ADMINS } from '@/lib/admin/users'
import { describeChanges, summarizeChanges } from './diff'
import { GUIDE_TAG } from './live'
import { SEED_GUIDE } from './seed'
import { guideStore, type PublishResult } from './store'
import type { Actor, Guide } from './types'

export type PublishOutcome =
  | { ok: true; live: PublishResult & { ok: true }; changes: string[] }
  | { ok: false; current: (PublishResult & { ok: false })['current'] }

/** Make `guide` live as the next version, refresh the public pages, and
 *  note the publish for the owner's digest when someone else did it. */
export async function publishGuide(
  guide: Guide,
  by: Actor,
  expectedVersion: number,
  opts: { note?: string; origin: string }
): Promise<PublishOutcome> {
  const previous = (await guideStore.getLive())?.guide ?? SEED_GUIDE
  const result = await guideStore.publish(guide, by, expectedVersion, {
    note: opts.note,
  })
  if (!result.ok) return { ok: false, current: result.current }

  // The page and the homepage card date are prerendered; this makes the
  // next request rebuild them from the new version.
  revalidateTag(GUIDE_TAG, 'max')
  revalidatePath('/donation-guide')
  revalidatePath('/')

  const changes = summarizeChanges(describeChanges(previous, guide))
  if (!isRootAdmin(by.email)) {
    await guideStore.queueDigest({
      version: result.live.version,
      by,
      at: result.live.publishedAt,
      changes,
    })
    await sendDigestIfDue(opts.origin)
  }
  return { ok: true, live: result, changes }
}

/** Email the owner about pending publishes if a day has passed since the
 *  last email (or none was ever sent). Returns how many publishes it
 *  covered; 0 when nothing was due. Never throws. */
export async function sendDigestIfDue(origin: string): Promise<number> {
  let due
  try {
    due = await guideStore.takeDigestIfDue()
  } catch (err) {
    console.error('[donation-guide] could not read the digest queue:', err)
    return 0
  }
  if (due.length === 0) return 0
  const mail = digestMail({
    publishes: due,
    adminUrl: `${origin}/admin/donation-guide`,
    pageUrl: `${origin}/donation-guide`,
  })
  let sent = false
  // The script only ever delivers "digest" mail to the owner's own address.
  for (const owner of ROOT_ADMINS) {
    if (await sendAdminMail('digest', owner.email, mail)) sent = true
  }
  if (!sent && mailConfigured()) {
    // The script was there but did not send: keep the entries for the next
    // attempt (the daily sweep) rather than lose them.
    for (const entry of due) await guideStore.queueDigest(entry)
    return 0
  }
  return due.length
}
