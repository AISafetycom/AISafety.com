/** Warm-up switch shared by the approval step (src/lib/admin/newsletter.ts)
 *  and the send watcher (src/lib/admin/newsletter-watch.ts). From the first
 *  real sends (8 October 2026): while on, a send to list 6, 7 or 8 with more
 *  than MAX_UNSEGMENTED_SEND active contacts must go to one wave (an AC
 *  segment), never the whole list in one press. */
export const NEWSLETTER_WARMUP = true
export const MAX_UNSEGMENTED_SEND = 50
