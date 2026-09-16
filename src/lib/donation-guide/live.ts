// The guide the public page and the chatbot read. Cached for an hour under
// the 'donation-guide' tag; a publish revalidates the tag and the pages, so
// the site updates within seconds without a deploy. If the store is ever
// unreachable this returns the last copy this process read, or the seed
// built into the code, and never an error.
import { unstable_cache } from 'next/cache'
import { DONATION_GUIDE_LAST_UPDATED } from '@/lib/donation-guide-date'
import { SEED_GUIDE } from './seed'
import { guideStore } from './store'
import type { Guide } from './types'

export const GUIDE_TAG = 'donation-guide'

export interface PublicGuide {
  /** 0 until the first publish. */
  version: number
  guide: Guide
  /** ISO time of the publish, or the seed's date. */
  publishedAt: string
}

const seed: PublicGuide = {
  version: 0,
  guide: SEED_GUIDE,
  publishedAt: DONATION_GUIDE_LAST_UPDATED,
}

let lastGood: PublicGuide | null = null

/** Straight from the store, no cache: the admin preview and the routes. */
export async function readLiveGuide(): Promise<PublicGuide> {
  try {
    const live = await guideStore.getLive()
    const out: PublicGuide = live
      ? {
          version: live.version,
          guide: live.guide,
          publishedAt: live.publishedAt,
        }
      : seed
    lastGood = out
    return out
  } catch (err) {
    console.error('[donation-guide] could not read the live guide:', err)
    return lastGood ?? seed
  }
}

export const getLiveGuide = unstable_cache(readLiveGuide, ['donation-guide'], {
  revalidate: 3600,
  tags: [GUIDE_TAG],
})
