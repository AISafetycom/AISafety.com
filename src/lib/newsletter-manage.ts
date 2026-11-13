/*
  The newsletters page (/newsletter): which newsletters a reader gets,
  changed from the "Manage subscriptions" link at the bottom of every
  issue, and signing up to several newsletters with one confirmation.

  The link carries the reader's settings key in the address's #fragment
  (https://aisafety.com/newsletter#k=<key>, src/lib/newsletter-manage-link.ts),
  so it never reaches a server log or a Referer header; the page reads it,
  takes it out of the address bar, and sends it to /api/newsletter/settings
  (the Matomo snippet in layout.tsx leaves the fragment out). The key
  is `<contact id>.<signature>`: the reader's ActiveCampaign contact number
  and an HMAC of it, so the site can check a key without looking anything
  up and nobody can make one for someone else. ActiveCampaign holds each
  reader's key in a hidden contact field (MANAGE_KEY_FIELD) and fills it
  into the link as %MANAGE_KEY% when it sends an issue.

  The HMAC's secret is derived from the ActiveCampaign API key, the same
  secret ~/Newsletter/manage_keys.py derives to fill in the keys: a key can
  only ever change someone's newsletters, which the API key itself can
  already do, so it adds no new secret to keep. Changing the API key
  changes every reader's key; manage_keys.py then writes the new ones,
  and links in older emails stop working (the page says so).

  Pure: no Next, no Upstash, no network.
*/

import { createHmac, timingSafeEqual } from 'node:crypto'
import { KEY_PATTERN } from './newsletter-manage-link'
import { SIGNUP_NEWSLETTERS, type SignupNewsletter } from './newsletter-signup'
import { WEB_NEWSLETTERS } from './newsletter-web'

/** ActiveCampaign's hidden contact field that holds each reader's key
 *  ("Newsletter settings key", made 26 October 2026; tag %MANAGE_KEY%). */
export const MANAGE_KEY_FIELD = '2'
export const MANAGE_KEY_TAG = '%MANAGE_KEY%'

/** The ActiveCampaign list of each newsletter. */
export const NEWSLETTER_LIST = Object.fromEntries(
  SIGNUP_NEWSLETTERS.map(n => [n, WEB_NEWSLETTERS[n].list])
) as Readonly<Record<SignupNewsletter, string>>

/** Mixed into the derived secret, so it is good for nothing but these keys.
 *  The same text is in ~/Newsletter/manage_keys.py: change both together
 *  (and every reader's key changes with it). */
const LABEL = 'aisafety.com newsletter settings key v1'
/** 22 base64url characters: 132 bits of the signature (KEY_PATTERN). */
const SIG_CHARS = 22
const CONTACT_ID = /^\d{1,12}$/

function secretFrom(acKey: string): Buffer {
  if (!acKey) throw new Error('no ActiveCampaign key to derive the secret from')
  return createHmac('sha256', acKey).update(LABEL).digest()
}

/** The settings key of a contact. */
export function manageKey(contactId: string, acKey: string): string {
  if (!CONTACT_ID.test(contactId))
    throw new Error(
      `not an ActiveCampaign contact id: ${contactId.slice(0, 20)}`
    )
  const sig = createHmac('sha256', secretFrom(acKey))
    .update(`contact:${contactId}`)
    .digest('base64url')
    .slice(0, SIG_CHARS)
  return `${contactId}.${sig}`
}

/** The contact a key belongs to, or null when it isn't a genuine key. The
 *  comparison takes the same time however much of the key is right. */
export function contactOfKey(key: unknown, acKey: string): string | null {
  if (typeof key !== 'string') return null
  const m = KEY_PATTERN.exec(key)
  if (!m) return null
  const want = Buffer.from(manageKey(m[1], acKey))
  const got = Buffer.from(key)
  return got.length === want.length && timingSafeEqual(got, want) ? m[1] : null
}

/** The address as the page shows it: the first character and the domain
 *  ("a•••@example.org"), so a forwarded email or a glance over a shoulder
 *  doesn't give the whole address away. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  return `${email[0]}•••${email.slice(at)}`
}

export type Subscriptions = Record<SignupNewsletter, boolean>

/** Which newsletters a contact gets, from their list statuses (list id →
 *  ActiveCampaign status: '1' active, '2' unsubscribed, '0' unconfirmed,
 *  '3' bounced). Only an active membership counts. */
export function subscriptionsFrom(
  statuses: Readonly<Record<string, string>>
): Subscriptions {
  const out = {} as Subscriptions
  for (const n of SIGNUP_NEWSLETTERS)
    out[n] = statuses[NEWSLETTER_LIST[n]] === '1'
  return out
}

/** What the reader asked for: true or false per newsletter, anything they
 *  left out unchanged. Null when it isn't that shape. */
export function parseWanted(v: unknown): Partial<Subscriptions> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Partial<Subscriptions> = {}
  for (const [k, on] of Object.entries(v)) {
    if (!(SIGNUP_NEWSLETTERS as readonly string[]).includes(k)) return null
    if (typeof on !== 'boolean') return null
    out[k as SignupNewsletter] = on
  }
  return out
}

export interface ListChange {
  newsletter: SignupNewsletter
  list: string
  /** 1 = subscribe, 2 = unsubscribe (ActiveCampaign's list statuses). */
  status: 1 | 2
}

/** The list changes that take `current` to `wanted`, in the newsletters'
 *  usual order. */
export function changesFor(
  current: Subscriptions,
  wanted: Partial<Subscriptions>
): ListChange[] {
  const out: ListChange[] = []
  for (const n of SIGNUP_NEWSLETTERS) {
    const want = wanted[n]
    if (want === undefined || want === current[n]) continue
    out.push({ newsletter: n, list: NEWSLETTER_LIST[n], status: want ? 1 : 2 })
  }
  return out
}

/** The newsletters a signup on the page picked: known ones, each once, in
 *  the usual order. Null when it isn't a non-empty list of them. */
export function parsePicks(v: unknown): SignupNewsletter[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 10) return null
  const picked = new Set<string>()
  for (const n of v) {
    if (!(SIGNUP_NEWSLETTERS as readonly unknown[]).includes(n)) return null
    picked.add(n as string)
  }
  return SIGNUP_NEWSLETTERS.filter(n => picked.has(n))
}
