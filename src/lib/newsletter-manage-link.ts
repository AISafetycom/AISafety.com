/*
  The "Manage subscriptions" link at the bottom of every issue:
  https://aisafety.com/newsletter#k=<key>. The parts the page itself needs
  to read it, kept apart from src/lib/newsletter-manage.ts (which makes and
  checks keys with node:crypto) so they can run in the browser.
*/

/** The page the link opens, and the fragment parameter that carries the
 *  reader's settings key. ~/Newsletter/render.py writes the same link. */
export const SETTINGS_PATH = '/newsletter'
export const KEY_PARAM = 'k'

/** `<contact id>.<22 base64url characters of signature>` */
export const KEY_PATTERN = /^(\d{1,12})\.([A-Za-z0-9_-]{22})$/

/** The key in a link's fragment ("#k=…"), or null. */
export function keyFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const key = params.get(KEY_PARAM)
  return key && KEY_PATTERN.test(key) ? key : null
}

/** Whether the fragment came from a settings link at all, even one whose
 *  key is missing (an email sent before the reader had one leaves it
 *  empty) or broken. */
export function hashHasKeyParam(hash: string): boolean {
  return new URLSearchParams(hash.replace(/^#/, '')).has(KEY_PARAM)
}
