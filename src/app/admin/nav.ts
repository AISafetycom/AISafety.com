// Shared admin navigation, used by every /admin section so the areas feel like
// one admin rather than several tools. The list of areas itself lives in
// src/lib/admin/access.ts; this file only turns a session's flags into tabs.
import { ACCESS_AREAS, canOpen, type AccessFlags } from '@/lib/admin/access'

export type AdminAccess = AccessFlags

export interface AdminNavTab {
  href: string
  label: string
  /** Tabs are grouped in the header; a divider is drawn where the group changes
   *  (so the two chatbot tabs read as a pair, separate from Analytics). */
  group: string
}

/** Tabs shown in the admin header, limited to the areas this session can
 *  actually open — a tab the session would only be bounced out of is worse than
 *  no tab at all. A view-only grant gets the same tab as an editing one; the
 *  page itself hides what the session can't do. */
export function adminTabs(
  access: AdminAccess,
  opts: { pendingRequests?: number } = {}
): AdminNavTab[] {
  const tabs: AdminNavTab[] = []
  for (const a of ACCESS_AREAS) {
    if (!canOpen(access, a.key)) continue
    tabs.push({
      href: a.href,
      label:
        a.key === 'manageUsers' && opts.pendingRequests
          ? `${a.label} (${opts.pendingRequests})`
          : a.label,
      group:
        a.key === 'playground' || a.key === 'conversationLog'
          ? 'chatbot'
          : a.key,
    })
  }
  return tabs
}

/** Where a session should land when it has no particular destination: the
 *  first area it can open. Used for the header brand link and the post-login
 *  bounce so nobody is sent somewhere they'll be redirected out of. */
export function adminHomeHref(access: AdminAccess): string {
  return ACCESS_AREAS.find(a => canOpen(access, a.key))?.href ?? '/admin/login'
}
