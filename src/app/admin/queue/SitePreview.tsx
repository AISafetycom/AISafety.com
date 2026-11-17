'use client'

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import ListingCard, { type CardProps } from '@/components/ListingCard'
import { communityCardProps } from '@/app/communities/card'
import { eventCardProps } from '@/app/events/card'
import {
  recurringProgramCardProps,
  trainingCardProps,
} from '@/app/training/card'
import { courseCardProps } from '@/app/self-study/card'
import { funderCardProps } from '@/app/funding/card'
import { advisorCardProps } from '@/app/advisors/card'
import { founderResourceCardProps } from '@/app/founders/card'
import { mediaChannelCardProps } from '@/app/media-channels/card'
import { projectCardProps } from '@/app/projects/card'
import MapOrgCard from '@/app/map/MapOrgCard'
import type { Community } from '@/lib/data/communities'
import type { EventListing } from '@/lib/data/events'
import type { RecurringProgram, TrainingProgram } from '@/lib/data/training'
import type { Course } from '@/lib/data/self-study'
import type { Funder } from '@/lib/data/funding'
import type { Advisor } from '@/lib/data/advisors'
import type { FounderResource } from '@/lib/data/founders'
import type { MediaChannel } from '@/lib/data/media-channels'
import type { Project } from '@/lib/data/projects'
import type { MapOrg } from '@/lib/data/map'
import type { PreviewKind } from '@/lib/admin/queue'
import { isExpiredAttachment } from '@/lib/admin/attachment-url'
import styles from './queue.module.css'

// "How it will look on the site": the record is read live, the page's edits
// are laid over it, and the resource page's OWN record-to-listing mapper and
// card code build the card (src/lib/data/*.ts + src/app/<page>/card.ts or
// the page's card component). Bryce's ask, 9 Sept 2026: the preview must be
// exactly the site's card, not an approximation.

const PREVIEW_API = '/api/admin/queue/preview'

interface Preview {
  kind: PreviewKind | null
  listing?: unknown
}

// Built cards by target + edits, so switching back is instant and the next
// item's card can be fetched before it is opened.
const previews = new Map<string, Promise<Preview>>()
// The same cards once resolved, readable during render so a switch to a
// cached card paints it in the very first frame (no placeholder flash).
const ready = new Map<string, Preview>()

// A card holds Airtable picture links, which last a few hours. A cached card
// whose links have run out is built again the next time it is wanted – or
// its logo would quietly vanish, the way it did on a page left open all day
// (Bryce, 17 Sept 2026: "pressing undo doesn't bring back the logo").
function stale(preview: Preview): boolean {
  return listingImages(preview.listing).some(url => isExpiredAttachment(url))
}

// The cards for a record are dropped when the record changes under them (a
// picture dropped in, a write from the chat, a decision or its undo); every
// preview on the page hears of it and asks again.
const listeners = new Set<() => void>()
let generation = 0
function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
function generationNow(): number {
  return generation
}
export function forgetPreviews(table: string, record: string): void {
  const prefix = `${table}/${record}|`
  for (const key of [...previews.keys()]) {
    if (key.startsWith(prefix)) previews.delete(key)
  }
  for (const key of [...ready.keys()]) {
    if (key.startsWith(prefix)) ready.delete(key)
  }
  generation++
  for (const fn of listeners) fn()
}

function previewKey(table: string, record: string, editsKey: string): string {
  return `${table}/${record}|${editsKey}`
}

async function fetchPreview(
  table: string,
  record: string,
  editsKey: string
): Promise<Preview> {
  const key = previewKey(table, record, editsKey)
  const known = ready.get(key)
  if (known && stale(known)) {
    previews.delete(key)
    ready.delete(key)
  }
  const hit = previews.get(key)
  if (hit) return hit
  const p = (async () => {
    const res = await fetch(PREVIEW_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, record, edits: JSON.parse(editsKey) }),
    })
    const data = (await res.json()) as Preview & { error?: string }
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
    return data
  })()
  previews.set(key, p)
  p.then(
    data => {
      ready.set(key, data)
      warmImages(data)
    },
    () => previews.delete(key)
  )
  return p
}

// ─── Logo warm-up ────────────────────────────────────────────────────────────
// A built card still has to fetch its logo when drawn; these pull the
// pictures into the browser cache ahead of time, a few at once, in list
// order, so the card and its logo appear together.

const warmed = new Set<string>()
const warmQueue: string[] = []
let warming = 0
const WARM_AT_ONCE = 4

function listingImages(listing: unknown): string[] {
  if (!listing || typeof listing !== 'object') return []
  const out: string[] = []
  for (const [k, v] of Object.entries(listing as Record<string, unknown>)) {
    if (/logo|image/i.test(k) && typeof v === 'string' && /^https?:/.test(v)) {
      out.push(v)
    }
  }
  return out
}

function warmNext(): void {
  while (warming < WARM_AT_ONCE && warmQueue.length) {
    const url = warmQueue.shift() as string
    warming++
    const img = document.createElement('img')
    img.onload = img.onerror = () => {
      warming--
      warmNext()
    }
    img.src = url
  }
}

function warmImages(preview: Preview): void {
  if (typeof document === 'undefined') return
  for (const url of listingImages(preview.listing)) {
    if (warmed.has(url)) continue
    warmed.add(url)
    warmQueue.push(url)
  }
  warmNext()
}

/** Put ready-built cards into the cache (from the bulk previews route). */
export function seedPreviews(
  entries: {
    table: string
    record: string
    edits: Record<string, unknown>
    preview: Preview
  }[]
): void {
  for (const e of entries) {
    const key = previewKey(e.table, e.record, JSON.stringify(e.edits))
    const cur = ready.get(key)
    if (!previews.has(key) || (cur && stale(cur))) {
      previews.set(key, Promise.resolve(e.preview))
      ready.set(key, e.preview)
    }
    warmImages(e.preview)
  }
}

/** Warm the cache for a card the admin is likely to open next. */
export function prefetchPreview(
  table: string,
  record: string,
  edits: Record<string, unknown>
): void {
  void fetchPreview(table, record, JSON.stringify(edits)).catch(() => {})
}

// ─── Selecting the card's text ───────────────────────────────────────────────
// On the site, a card's link is stretched over the whole card (a map card is
// one big link), so a drag on it drags the link and no word on the card can
// be selected. In the Queue the title link's stretched box lets the pointer
// through (.siteFrame in queue.module.css), and this:
// - selects text on a drag anywhere on the card, the title included (the
//   link's href is set aside while the button is down, since browsers never
//   start a selection on a link, and comes back before the click arrives)
// - still opens the listing from a plain click anywhere on the card
// - never opens it from a click that selected text or cleared a selection
// A double-click can't select a word: its first click opens the link, as a
// click on any link does. Dragging is the way to select. A card marked
// data-card is left alone: the site's own CardClicks (#867) does all of this
// for it once that lands.

// Anything on a card that is clickable in its own right.
const CONTROLS = 'a, button, input, select, textarea, label, summary'

function hasSelection(): boolean {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed
}

function useSelectableCard(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    let selectedAtPress = false
    let held: { link: HTMLAnchorElement; href: string } | null = null

    const cardOf = (target: EventTarget | null) => {
      const el = target instanceof Element ? target : null
      const card = el?.closest<HTMLElement>('.card')
      if (!el || !card || !root.contains(card)) return null
      if (card.hasAttribute('data-card')) return null
      const link =
        card instanceof HTMLAnchorElement
          ? card
          : card.querySelector<HTMLAnchorElement>('h3 a')
      return link ? { el, link } : null
    }

    const restore = () => {
      if (!held) return
      held.link.setAttribute('href', held.href)
      held = null
    }

    const onPointerDown = (e: PointerEvent) => {
      restore()
      selectedAtPress = hasSelection()
      const hit = cardOf(e.target)
      if (!hit || e.pointerType === 'touch' || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if (!hit.link.contains(hit.el)) return
      const href = hit.link.getAttribute('href')
      if (href === null) return
      held = { link: hit.link, href }
      hit.link.removeAttribute('href')
    }

    // In the capture phase, before the link's own click handler.
    const onClick = (e: MouseEvent) => {
      restore()
      if (e.button !== 0 || e.defaultPrevented) return
      const hit = cardOf(e.target)
      if (!hit) return
      // Part of selecting text, or the second click of a double-click.
      const selecting = e.detail > 1 || selectedAtPress || hasSelection()
      const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
      if (hit.link.contains(hit.el)) {
        // Enter on the focused link and a forwarded click (both detail 0)
        // go through, and so does any click that wasn't selecting.
        if (e.detail === 0 || modified || !selecting) return
        e.preventDefault()
        e.stopPropagation()
      } else if (!selecting && !hit.el.closest(CONTROLS)) {
        // A click on the card's text opens the title link, with the same
        // keys held.
        hit.link.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            button: e.button,
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
          })
        )
      }
    }

    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('click', onClick, true)
    // The button can come up anywhere on the page.
    document.addEventListener('pointerup', restore, true)
    document.addEventListener('pointercancel', restore, true)
    window.addEventListener('blur', restore)
    return () => {
      restore()
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('click', onClick, true)
      document.removeEventListener('pointerup', restore, true)
      document.removeEventListener('pointercancel', restore, true)
      window.removeEventListener('blur', restore)
    }
  }, [ref])
}

/** The site's card for a listing. Its link opens in a new tab, as on the
 *  site; the admin page loads no analytics, so clicks are not counted. */
function Card({ kind, listing }: { kind: PreviewKind; listing: unknown }) {
  const listingCard = (props: CardProps) => (
    <ul role="list">
      <ListingCard {...props} trackingPage="admin-queue" />
    </ul>
  )
  switch (kind) {
    case 'community':
      return listingCard(communityCardProps(listing as Community))
    case 'event':
      return listingCard(eventCardProps(listing as EventListing))
    case 'training':
      return listingCard(trainingCardProps(listing as TrainingProgram))
    case 'recurring':
      return listingCard(recurringProgramCardProps(listing as RecurringProgram))
    case 'course':
      return listingCard(courseCardProps(listing as Course))
    case 'funder':
      return listingCard(funderCardProps(listing as Funder))
    case 'advisor':
      return listingCard(advisorCardProps(listing as Advisor))
    case 'founder':
      return listingCard(founderResourceCardProps(listing as FounderResource))
    case 'mediaChannel':
      return listingCard(mediaChannelCardProps(listing as MediaChannel))
    case 'project':
      return listingCard(projectCardProps(listing as Project))
    case 'mapOrg':
      return <MapOrgCard org={listing as MapOrg} />
  }
}

export default function SitePreview({
  table,
  record,
  edits,
}: {
  table: string
  record: string
  /** The admin's edits in the field's own shape (see coerceEdits). */
  edits: Record<string, unknown>
}) {
  const editsKey = JSON.stringify(edits)
  const key = previewKey(table, record, editsKey)
  const sectionRef = useRef<HTMLElement>(null)
  useSelectableCard(sectionRef)
  // The result is tagged with the request it answers, so a new record shows
  // "Building the card…" at once instead of the old card until the new one
  // arrives (cached cards come back within the same tick).
  const [result, setResult] = useState<{
    key: string
    preview?: Preview
    error?: string
  } | null>(null)
  // Bumped by forgetPreviews: the record changed, so look again.
  const gen = useSyncExternalStore(subscribe, generationNow, generationNow)
  const known = ready.get(key)
  const fresh = result?.key === key ? result.preview : known
  const error = result?.key === key ? result.error : undefined
  // While the card for the SAME record is rebuilt after an edit, the card
  // as it was stays up, so nothing on the page jumps (Bryce, 17 Sept 2026:
  // "the card disappears for a moment, making the content on the page
  // jump"). A different record still shows "Building the card…".
  const target = `${table}/${record}`
  const [shown, setShown] = useState<{
    target: string
    preview: Preview
  } | null>(null)
  // Remembered during render (the documented way to keep the previous
  // render's value), so the stale card is there in the very same frame.
  if (fresh && (shown?.preview !== fresh || shown.target !== target)) {
    setShown({ target, preview: fresh })
  }
  const preview =
    fresh ?? (!error && shown?.target === target ? shown.preview : undefined)

  useEffect(() => {
    const cached = ready.get(key)
    if (cached && !stale(cached)) return
    let live = true
    // Edits arrive keystroke by keystroke; wait for a pause before asking.
    const t = setTimeout(
      () => {
        fetchPreview(table, record, editsKey).then(
          data => {
            if (live) setResult({ key, preview: data })
          },
          e => {
            if (live) {
              setResult({
                key,
                error: e instanceof Error ? e.message : String(e),
              })
            }
          }
        )
      },
      previews.has(key) ? 0 : 250
    )
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [table, record, editsKey, key, gen])

  return (
    <section ref={sectionRef} className={styles.block}>
      {preview?.kind && preview.listing ? (
        <div className={styles.siteFrame}>
          {/* Keyed by its picture links: a fresh card is a fresh element,
              so an image hidden after a failed load does not stay hidden. */}
          <Card
            key={listingImages(preview.listing).join(' ')}
            kind={preview.kind}
            listing={preview.listing}
          />
        </div>
      ) : preview && !preview.kind ? (
        <p className={styles.note}>
          The site would skip this record as it stands (a name or description is
          missing, most likely).
        </p>
      ) : error ? (
        <p className={styles.error}>Couldn’t build the preview: {error}</p>
      ) : (
        <p className={styles.note}>Building the card…</p>
      )}
    </section>
  )
}
