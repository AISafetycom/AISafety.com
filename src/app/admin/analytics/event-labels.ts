// What a recorded event is called in the dashboard's activity lists: the
// Recent activity feed (page.tsx) and the list beside a session replay.

import { newsletterErrorLabel } from '@/lib/analytics/events'
import { displayFilterGroup, displayFilterValue } from '@/lib/filter-tracking'

const EVENT_LABELS: Record<string, string> = {
  chatbot_open: 'Opened the chatbot',
  chatbot_message: 'Sent a message',
  chatbot_click: 'Clicked a result',
  analytics_optout: 'Turned analytics off',
  analytics_optin: 'Turned analytics back on',
}

/** Feed lines for search opens, by how the modal was opened. */
const SEARCH_OPEN_LABELS: Record<string, string> = {
  button: 'Opened search',
  'cmd-k': 'Opened search (⌘K)',
  slash: 'Opened search (/)',
}

export function pillFor(e: { page?: string; type: string }): string | null {
  // Chatbot/search first: their events carry the page they happened on too,
  // but in the feed they should read as chatbot/search activity, not clicks.
  if (e.type.startsWith('chatbot')) return 'Chatbot'
  if (e.type.startsWith('search')) return 'Search'
  // Footer clicks carry the raw path they happened on; 'Footer' reads better.
  if (e.type === 'footer_click') return 'Footer'
  // Likewise the +N menu: it belongs to the nav, whatever page it opened on.
  if (e.type === 'nav_overflow_open') return 'Nav'
  if (e.page) return e.page
  return null
}

export function labelFor(e: {
  label?: string
  type: string
  source?: string
  query?: string
  page?: string
}): string {
  if (e.type === 'nav_overflow_open')
    return e.source === 'tap'
      ? 'Opened the +N menu (tap)'
      : 'Opened the +N menu'
  if (e.type === 'search_open')
    return SEARCH_OPEN_LABELS[e.source ?? ''] ?? 'Opened search'
  if (e.type === 'search_query')
    return e.query ? `Searched for “${e.query}”` : 'Searched'
  // The /map search box: its events carry page 'Map', so the pill already
  // says where; the line says which control.
  if (e.type === 'map_search_open')
    return e.source === 'cmd-f'
      ? 'Opened the map search (⌘F)'
      : 'Opened the map search'
  if (e.type === 'map_search_query')
    return e.query ? `Searched the map for “${e.query}”` : 'Searched the map'
  if (e.type === 'map_search_pick')
    return e.label
      ? `Picked “${e.label}” from the map search`
      : 'Picked a map search result'
  if (e.type === 'filter_apply') {
    // Renamed filters log their original names; show the current wording.
    const page = e.page ?? ''
    const group = e.source ?? '?'
    const value = e.label ?? '?'
    return `Filtered by ${displayFilterGroup(page, group)}: ${displayFilterValue(page, group, value)}`
  }
  if (e.type === 'filter_remove') {
    const page = e.page ?? ''
    const group = e.source ?? '?'
    const value = e.label ?? '?'
    return `Removed filter ${displayFilterGroup(page, group)}: ${displayFilterValue(page, group, value)}`
  }
  // A newsletter signup error's reason is a short code; spell it out.
  if (e.type === 'newsletter_signup_error')
    return `Newsletter signup error: ${newsletterErrorLabel(e.source)}`
  // A rating's label is the bare value ('up' | 'down' | 'removed'), so spell
  // it out.
  if (e.type === 'chatbot_rating') {
    if (e.label === 'removed') return 'Took back a reply rating'
    return e.label === 'up' ? 'Rated a reply 👍' : 'Rated a reply 👎'
  }
  // The chatbot's paperclip and microphone: `source` says how it went and
  // `label` the kind of file or the reason it failed.
  if (e.type === 'chatbot_attach')
    return e.source === 'attached'
      ? `Attached a document (${e.label ?? 'file'})`
      : `Couldn’t attach a file (${e.label ?? 'unknown reason'})`
  if (e.type === 'chatbot_dictate') {
    if (e.source !== 'start')
      return `Dictation failed (${e.label ?? 'unknown reason'})`
    return e.label === 'shortcut'
      ? 'Started dictating (⌘D)'
      : 'Started dictating'
  }
  // search_click carries the result's title as its label, like listing clicks.
  return e.label ?? EVENT_LABELS[e.type] ?? e.type
}
