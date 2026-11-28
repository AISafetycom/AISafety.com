// The areas of the admin, one grant each. This file has no imports on purpose:
// the browser-side Admin admin page, the server-side gates and the nav all
// read the same list, so a new area is added here once and everything else
// follows (a tab, a checkbox, a capability).
//
// A grant is one of three things. `false`: no tab. `'view'`: the tab opens
// and everything on it can be read. `'edit'`: the tab's writes are allowed
// too — an accept on the Queue, a move on the Map editor, an approval on
// Newsletters, a change to who can sign in. Areas that only ever show things
// (Analytics, Site preview, …) stop at 'view'; the ones that can change the
// live site carry an `edit` note below, and the Admin admin page shows a
// "can edit" tick next to those.
//
// The Queue has one more: `'suggest'`, "can edit, Bryce checks first"
// (27 November 2026, for a new teammate's first weeks). Everything on the
// tab works as with 'edit', except that Publish or Apply, Reject, Delete and
// Review again in a week save a suggestion on the item instead of deciding
// it, and someone with 'edit' confirms it (queue-suggest.ts). It is a grant
// value rather than a separate setting so it fails closed: canEdit() is
// false for it, and code that does not know the value (an older deploy, a
// rollback) reads it as no Queue at all, never as 'edit'.

export type Grant = false | 'view' | 'edit' | QueueCheck

/** The Queue grants that let someone work on items while another person
 *  checks what they do. Phase 1 has one, 'suggest' (checked before it goes
 *  live). A later "Bryce checks after" grant joins this list, and
 *  queueModeOf() below, when it is built. */
export const QUEUE_CHECKS = ['suggest'] as const
export type QueueCheck = (typeof QUEUE_CHECKS)[number]

/** How a session works on the Queue: decides items ('edit'), suggests
 *  decisions for someone with 'edit' to confirm ('suggest'), or only looks
 *  ('view'). Null: no Queue tab. */
export type QueueMode = 'edit' | QueueCheck | 'view'

export interface AccessFlags {
  /** /admin/queue — proposed changes and additions to the directory.
   *  Edit: accept, reject or revise them; every accept writes to the live base. */
  queue: Grant
  /** /admin/chatbot/playground — try prompts against the live catalog. */
  playground: Grant
  /** /admin/chatbot/log — read visitors' chat transcripts, rate and label them. */
  conversationLog: Grant
  /** /admin/analytics — the dashboard. */
  analytics: Grant
  /** /admin/map — the Field map's logos. Edit: drag and resize them; every
   *  move writes x/y to Airtable. */
  mapEditor: Grant
  /** /admin/donation-guide — the guide's text. Edit: save drafts and
   *  publish; every publish changes the live page. */
  donationGuide: Grant
  /** /admin/preview — see live Airtable data on the real pages, this browser only. */
  preview: Grant
  /** /admin/newsletter — the drafted issues and their previews. Edit:
   *  approve them; every approval is a real send. */
  newsletter: Grant
  /** /admin/users — who can sign in. Edit: add, change or remove people. */
  manageUsers: Grant
}

export type AccessArea = keyof AccessFlags

export interface AreaInfo {
  key: AccessArea
  /** Tab label, also the checkbox label on the Admin admin page. */
  label: string
  href: string
  /** Present on areas that can change the live site: what 'edit' allows,
   *  in a few words, shown next to the "can edit" tick. Absent means the
   *  area only shows things and 'view' is as far as a grant goes. */
  edit?: string
}

/** In tab order. adminHomeHref() sends a session to the first one it has. */
export const ACCESS_AREAS: AreaInfo[] = [
  {
    key: 'queue',
    label: 'Queue',
    href: '/admin/queue',
    edit: 'accept, reject or revise suggestions; every accept publishes',
  },
  {
    key: 'playground',
    label: 'Bot playground',
    href: '/admin/chatbot/playground',
  },
  {
    key: 'conversationLog',
    label: 'Bot log',
    href: '/admin/chatbot/log',
  },
  { key: 'analytics', label: 'Analytics', href: '/admin/analytics' },
  {
    key: 'mapEditor',
    label: 'Map editor',
    href: '/admin/map',
    edit: 'move and resize logos on the live map',
  },
  {
    key: 'donationGuide',
    label: 'Donation guide editor',
    href: '/admin/donation-guide',
    edit: 'save drafts and publish; every publish changes the live page',
  },
  { key: 'preview', label: 'Site preview', href: '/admin/preview' },
  {
    key: 'newsletter',
    label: 'Newsletters',
    href: '/admin/newsletter',
    edit: 'approve issues; every approval is a real send',
  },
  {
    key: 'manageUsers',
    label: 'Admin admin',
    href: '/admin/users',
    edit: 'add, change or remove people',
  },
]

export const ACCESS_KEYS: AccessArea[] = ACCESS_AREAS.map(a => a.key)

const AREA_BY_KEY = new Map(ACCESS_AREAS.map(a => [a.key, a]))

/** True for areas whose tab can do more than show things. */
export function isEditableArea(key: AccessArea): boolean {
  return Boolean(AREA_BY_KEY.get(key)?.edit)
}

/** The most an area can be granted: 'edit' where the tab writes, else 'view'. */
export function topGrant(key: AccessArea): Grant {
  return isEditableArea(key) ? 'edit' : 'view'
}

/** The tab opens (at either level). */
export function canOpen(a: AccessFlags, key: AccessArea): boolean {
  return a[key] !== false
}

/** The tab's writes are allowed. Never true for a view-only area, nor for
 *  the Queue's 'suggest' (see queueModeOf). */
export function canEdit(a: AccessFlags, key: AccessArea): boolean {
  return a[key] === 'edit'
}

/** What the Queue grant lets this person do there. */
export function queueModeOf(a: AccessFlags): QueueMode | null {
  switch (a.queue) {
    case 'edit':
      return 'edit'
    case 'suggest':
      return 'suggest'
    // A "Bryce checks after" grant would read here.
    case 'view':
      return 'view'
    default:
      return null
  }
}

/** May write to the Queue at all: decide, or suggest decisions. */
export function canWorkQueue(a: AccessFlags): boolean {
  const mode = queueModeOf(a)
  return mode === 'edit' || mode === 'suggest'
}

/** Flags with the given areas open at 'view' and, of those, `edit` raised to
 *  'edit' (view-only areas stay at 'view' whatever the second list says). */
export function accessFrom(
  view: readonly AccessArea[],
  edit: readonly AccessArea[] = []
): AccessFlags {
  const out = {} as AccessFlags
  for (const k of ACCESS_KEYS) {
    out[k] =
      edit.includes(k) && isEditableArea(k)
        ? 'edit'
        : view.includes(k) || edit.includes(k)
          ? 'view'
          : false
  }
  return out
}

/** Every area at its top grant. */
export const ALL_ACCESS: AccessFlags = accessFrom(ACCESS_KEYS, ACCESS_KEYS)
export const NO_ACCESS: AccessFlags = accessFrom([])

/** What the Add someone form and a sign-in request start with: nothing
 *  ticked, so every tab a person gets is one the owner chose on purpose. */
export const DEFAULT_NEW_ACCESS: AccessFlags = NO_ACCESS

export function hasAnyAccess(a: AccessFlags): boolean {
  return ACCESS_KEYS.some(k => a[k] !== false)
}

/** One grant out of untrusted input. `true` is how the flags were stored
 *  before grants had levels (a tick meant everything the tab could do), so it
 *  reads as the area's top grant; 'edit' on a view-only area is clamped. */
function parseGrant(key: AccessArea, v: unknown): Grant {
  if (v === true || v === 'edit') return topGrant(key)
  if (v === 'view') return 'view'
  // Only the Queue knows 'suggest'. Anywhere else, and any value this file
  // does not know, is no tab at all: never more than was meant.
  if (key === 'queue' && v === 'suggest') return 'suggest'
  return false
}

/** Read flags out of untrusted input: every known key becomes a grant,
 *  unknown keys are dropped. Null when the input isn't an object at all.
 *  Also reads the shape stored before 11 September 2026, when Newsletters
 *  was two booleans (`newsletter` to send, `newsletterPreview` to look). */
export function parseAccess(input: unknown): AccessFlags | null {
  if (!input || typeof input !== 'object') return null
  const body = input as Record<string, unknown>
  const out = {} as AccessFlags
  for (const k of ACCESS_KEYS) out[k] = parseGrant(k, body[k])
  if (body.newsletterPreview === true && out.newsletter === false) {
    out.newsletter = 'view'
  }
  return out
}

/** Whose check a 'suggest' grant waits for: the owner, the built-in admin
 *  in users.ts (that file reads the user store, so the page can't import
 *  it). */
export const CHECKER_NAME = 'Bryce'

/** The words for 'suggest' wherever a grant is described. */
export const SUGGEST_LABEL = `${CHECKER_NAME} checks first`

/** Labels for a set of flags, "Queue (can edit)" style, in tab order. */
export function describeAccess(a: AccessFlags): string[] {
  return ACCESS_AREAS.filter(x => a[x.key] !== false).map(x =>
    a[x.key] === 'edit'
      ? `${x.label} (can edit)`
      : a[x.key] === 'suggest'
        ? `${x.label} (can edit, ${SUGGEST_LABEL})`
        : x.label
  )
}

/** A set of flags for a log line: "queue:edit,analytics:view". */
export function summariseAccess(a: AccessFlags): string {
  return Object.entries(a)
    .filter(([, grant]) => grant)
    .map(([k, grant]) => `${k}:${grant}`)
    .join(',')
}

/** The areas a change moved, old value to new ("queue:edit→suggest"), for
 *  the log line when someone's access changes: what they had before as well
 *  as after. */
export function accessChange(
  was: AccessFlags | null,
  now: AccessFlags
): string {
  if (!was) return `access=${summariseAccess(now)}`
  const moved = ACCESS_KEYS.filter(k => was[k] !== now[k]).map(
    k => `${k}:${was[k] || 'none'}→${now[k] || 'none'}`
  )
  return moved.length ? moved.join(',') : 'no change'
}
