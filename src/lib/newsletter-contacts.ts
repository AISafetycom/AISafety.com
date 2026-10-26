/*
  The few ActiveCampaign calls behind the newsletters page (/newsletter):
  find a reader's contact, read and change which newsletter lists they're
  on, and store their settings key (src/lib/newsletter-manage.ts). Used by
  /api/newsletter/settings, the several-newsletters signup in
  /api/subscribe and the cron that finishes those signups
  (src/lib/newsletter-pending.ts). Server only.

  Only the live site changes anything: a localhost or preview copy reads
  the real account (every worktree's .env.local holds the key) but logs
  what it would have written instead, the same rule the admin newsletter
  page keeps (canWriteRealListsHere in src/lib/admin/newsletter.ts). No
  change here ever emails anyone: the lists send no "you've unsubscribed"
  email (optoutconf 0) and no automation runs on them.
*/

import { MANAGE_KEY_FIELD, manageKey } from './newsletter-manage'

const READ_TIMEOUT_MS = 10_000
/** Writes give up after this and are never retried (the write may have
 *  landed). */
const WRITE_TIMEOUT_MS = 15_000

export function contactsConfigured(): boolean {
  return Boolean(
    process.env.ACTIVECAMPAIGN_URL && process.env.ACTIVECAMPAIGN_KEY
  )
}

/** Whether this copy of the site may change subscriptions: the live site
 *  only, never a dev server (even with VERCEL_ENV=production pulled into
 *  its .env.local). */
export function liveWrites(): boolean {
  return (
    process.env.VERCEL_ENV === 'production' &&
    process.env.NODE_ENV !== 'development'
  )
}

export function acKey(): string {
  const key = process.env.ACTIVECAMPAIGN_KEY
  if (!key) throw new Error('ACTIVECAMPAIGN_KEY is not set')
  return key
}

function v3url(path: string): URL {
  const base = (process.env.ACTIVECAMPAIGN_URL ?? '').replace(/\/+$/, '')
  if (!base) throw new Error('ACTIVECAMPAIGN_URL is not set')
  const root = `${base}/api/3/`
  const url = new URL(path, root)
  // Ids reach these calls from requests: refuse anything that would point
  // a call somewhere else.
  if (url.origin !== new URL(root).origin || !url.href.startsWith(root)) {
    throw new Error('ActiveCampaign request path escapes the API')
  }
  return url
}

function contactId(id: string): string {
  if (!/^\d{1,12}$/.test(id))
    throw new Error(`not an ActiveCampaign contact id: ${id.slice(0, 20)}`)
  return id
}

/** One v3 call. Throws on anything but a 2xx answer (a 404 as
 *  `NotFoundError`), naming the status but never the address. */
async function v3<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const method = init.method ?? 'GET'
  const res = await fetch(v3url(path), {
    method,
    headers: {
      'Api-Token': acKey(),
      ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(
      method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS
    ),
    cache: 'no-store',
  })
  if (res.status === 404) throw new NotFoundError()
  if (!res.ok) {
    throw new Error(
      `ActiveCampaign ${method} ${path.split('?')[0]} answered HTTP ${res.status}`
    )
  }
  return (await res.json()) as T
}

export class NotFoundError extends Error {
  constructor() {
    super('ActiveCampaign has no such contact')
    this.name = 'NotFoundError'
  }
}

export interface Contact {
  id: string
  email: string
}

/** The contact with this address, or null. ActiveCampaign keeps addresses
 *  in lowercase. */
export async function findContact(email: string): Promise<Contact | null> {
  const q = new URLSearchParams({ email: email.toLowerCase() })
  const data = await v3<{ contacts?: { id: string; email: string }[] }>(
    `contacts?${q}`
  )
  const c = data.contacts?.find(
    x => x.email.toLowerCase() === email.toLowerCase()
  )
  return c ? { id: String(c.id), email: c.email } : null
}

/** The contact, or null when there is none (deleted in ActiveCampaign). */
export async function readContact(id: string): Promise<Contact | null> {
  try {
    const data = await v3<{ contact: { id: string; email: string } }>(
      `contacts/${contactId(id)}`
    )
    return { id: String(data.contact.id), email: data.contact.email }
  } catch (err) {
    if (err instanceof NotFoundError) return null
    throw err
  }
}

/** The contact's list memberships: list id → status ('1' active, '2'
 *  unsubscribed, '0' unconfirmed, '3' bounced). */
export async function readStatuses(
  id: string
): Promise<Record<string, string>> {
  const data = await v3<{
    contactLists?: { list: string; status: string }[]
  }>(`contacts/${contactId(id)}/contactLists`)
  const out: Record<string, string> = {}
  for (const m of data.contactLists ?? [])
    out[String(m.list)] = String(m.status)
  return out
}

/** Subscribe the contact to a list (1) or unsubscribe them (2). Source 4
 *  is ActiveCampaign's marker for a subscription made through the API,
 *  which it needs to take back someone who unsubscribed before. Logs and
 *  writes nothing outside the live site. */
export async function setListStatus(
  id: string,
  list: string,
  status: 1 | 2
): Promise<void> {
  if (!liveWrites()) {
    console.log(
      `[newsletter-contacts] not the live site: would set contact ${id} on list ${list} to ${status === 1 ? 'subscribed' : 'unsubscribed'}`
    )
    return
  }
  await v3('contactLists', {
    method: 'POST',
    body: {
      contactList: {
        list,
        contact: contactId(id),
        status,
        ...(status === 1 && { sourceid: 4 }),
      },
    },
  })
}

/** Store the contact's settings key in their hidden field, so the next
 *  issue's link carries it. Writing it again only rewrites the same value
 *  (checked live, 26 October 2026: a second write updates the one value). */
export async function storeManageKey(id: string): Promise<void> {
  if (!liveWrites()) {
    console.log(
      `[newsletter-contacts] not the live site: would store contact ${id}'s settings key`
    )
    return
  }
  await v3('fieldValues', {
    method: 'POST',
    body: {
      fieldValue: {
        contact: contactId(id),
        field: MANAGE_KEY_FIELD,
        value: manageKey(id, acKey()),
      },
    },
  })
}
