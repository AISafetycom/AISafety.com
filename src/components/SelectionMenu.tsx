'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import Button from '@/components/Button'
import { trackSelectionMenu, trackedPath } from '@/lib/analytics'
import { selectionFormLink } from '@/lib/selection-feedback'
import styles from './SelectionMenu.module.css'

// The small menu that appears by text a visitor selects in a page's main
// content: Copy, and a button that opens one of the site's forms with the
// selected text, where it came from and a link back already filled in.
// Text on a listing's card leads to the corrections form ("Suggest a
// correction"); text anywhere else to the feedback form ("Give feedback").

// Pages where the menu stays away: signed-in tools and private links.
const OFF_PATHS = ['/admin', '/work-test', '/stats']

// Space kept clear at the top of the screen for the nav bar: a selection
// nearer the top than this gets its menu underneath instead of above.
const NAV_CLEARANCE = 96

// How long "Copied" shows before the menu goes away.
const COPIED_SHOWN_MS = 1000

interface Menu {
  text: string
  /** The selection's box, in page coordinates. */
  box: { left: number; right: number; top: number; bottom: number }
  formHref: string
  /** The listing whose card the text is on, when it is on one. */
  listing?: { name: string; id?: string }
}

function readSelection(pathname: string): Menu | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return null
  const text = selection.toString().trim()
  if (!text) return null
  const range = selection.getRangeAt(0)
  const node = range.commonAncestorContainer
  const el = node instanceof Element ? node : node.parentElement
  if (!el?.closest('main')) return null
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null

  // A card's name is its title link's own text (the link also holds a
  // hidden "(opens in new tab)"); its id, where it has one, is the listing's
  // record id, which a link to the page scrolls to.
  const card = el.closest<HTMLElement>('[data-card]')
  const name = card?.querySelector('h3 a')?.firstChild?.textContent?.trim()
  const listing = card && name ? { name, id: card.id || undefined } : undefined

  const path = trackedPath(pathname)
  const view = new URLSearchParams(window.location.search).get('view')
  const link =
    window.location.origin +
    path +
    (view ? `?view=${encodeURIComponent(view)}` : '') +
    (listing?.id ? `#${listing.id}` : '')

  return {
    text,
    box: {
      left: rect.left + window.scrollX,
      right: rect.right + window.scrollX,
      top: rect.top + window.scrollY,
      bottom: rect.bottom + window.scrollY,
    },
    formHref: selectionFormLink({
      text,
      path,
      view,
      link,
      listingName: listing?.name,
    }),
    listing,
  }
}

export default function SelectionMenu() {
  const pathname = usePathname()
  const [menu, setMenu] = useState<Menu | null>(null)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // Whether the selection was made by touch: a phone shows its own menu
  // above the selection, so this one goes underneath.
  const touchRef = useRef(false)
  const off = OFF_PATHS.some(
    p => pathname === p || pathname.startsWith(`${p}/`)
  )

  useEffect(() => {
    if (off) return
    let pressing = false
    let timer: number | undefined
    let shownFor = ''

    function update() {
      const next = readSelection(pathname)
      setMenu(next)
      setCopied(false)
      // Counted once per selection, not each time it is looked at again.
      if (next && next.text !== shownFor)
        trackSelectionMenu('open', next.listing)
      shownFor = next?.text ?? ''
    }

    function onPointerDown(e: PointerEvent) {
      if (e.target instanceof Node && menuRef.current?.contains(e.target))
        return
      pressing = true
      touchRef.current = e.pointerType === 'touch'
      window.clearTimeout(timer)
      setMenu(null)
    }

    // The press is over: look once the browser has settled the selection
    // (a plain click clears it). A phone ends a long-press that selected
    // text with pointercancel.
    function onPointerEnd() {
      if (!pressing) return
      pressing = false
      window.clearTimeout(timer)
      timer = window.setTimeout(update, 0)
    }

    // Selecting with the keyboard, or by dragging a phone's selection
    // handles, sends no pointer events: wait for the selection to rest.
    function onSelectionChange() {
      if (pressing) return
      window.clearTimeout(timer)
      timer = window.setTimeout(update, 250)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenu(null)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerEnd, true)
    document.addEventListener('pointercancel', onPointerEnd, true)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onSelectionChange)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerEnd, true)
      document.removeEventListener('pointercancel', onPointerEnd, true)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onSelectionChange)
    }
  }, [pathname, off])

  // Centered over the selection and kept on screen. Above it, unless that
  // would put it under the nav bar or the selection was made by touch.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!menu || !el) return
    const touch = touchRef.current
    const gap = touch ? 24 : 8
    const { offsetWidth: width, offsetHeight: height } = el
    const pageLeft = window.scrollX + 8
    const pageRight =
      window.scrollX + document.documentElement.clientWidth - width - 8
    const centered = (menu.box.left + menu.box.right) / 2 - width / 2
    const left = Math.max(pageLeft, Math.min(centered, pageRight))
    const topAbove = menu.box.top - height - gap
    const above = !touch && topAbove - window.scrollY > NAV_CLEARANCE
    el.style.left = `${left}px`
    el.style.top = `${above ? topAbove : menu.box.bottom + gap}px`
  }, [menu, copied])

  // After a copy, "Copied" shows for a moment, then the menu goes: its job
  // is done. The selection stays, so it's clear what was copied.
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setMenu(null), COPIED_SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!menu) return null

  async function copy(text: string, listing: Menu['listing']) {
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      // No clipboard access (an old browser, or a page not served over
      // https): the browser's own copy still works on the selection, which
      // is kept while the menu is pressed.
      if (!document.execCommand('copy')) {
        console.warn('Selection menu: could not copy the selected text', error)
        return
      }
    }
    setCopied(true)
    trackSelectionMenu('copy', listing)
  }

  const formLabel = menu.listing ? 'Suggest a correction' : 'Give feedback'

  return createPortal(
    <div
      ref={menuRef}
      role="toolbar"
      aria-label="Selected text"
      className={`drop-shadow-dark ${styles.menu}`}
      // Pressing the menu must not clear the selection it is about.
      onMouseDown={e => e.preventDefault()}
    >
      <Button
        variant="clear"
        size="small"
        icon={copied ? '/images/icons/check.svg' : '/images/icons/copy.svg'}
        iconPosition="preceding"
        onClick={() => copy(menu.text, menu.listing)}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button
        as="a"
        href={menu.formHref}
        target="_blank"
        rel="noopener noreferrer"
        variant="clear"
        size="small"
        icon={
          menu.listing ? '/images/icons/pencil.svg' : '/images/icons/chat.svg'
        }
        iconPosition="preceding"
        onClick={() =>
          trackSelectionMenu(
            menu.listing ? 'correction' : 'feedback',
            menu.listing
          )
        }
      >
        {formLabel}
        <span className="visually-hidden"> (opens in new tab)</span>
      </Button>
    </div>,
    document.body
  )
}
