'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { trackSelectionMenu, trackedPath } from '@/lib/analytics'
import { openFeedbackForm } from '@/lib/feedback-form'
import { selectionLines, unionBox, type Box } from '@/lib/popover-placement'
import { selectionFormLink } from '@/lib/selection-feedback'
import styles from './SelectionMenu.module.css'

// The small menu that appears by text a visitor selects with a mouse or
// keyboard in a page's main content, the footer or the chatbot's messages:
// Copy, and a button that opens the site's correction or feedback
// form (FeedbackPopover) right there, with the selected text in it. Text on a
// listing's card leads to "Suggest a correction"; text anywhere else to
// "Give feedback".

// Pages where the menu stays away: signed-in tools and private links.
const OFF_PATHS = ['/admin', '/work-test', '/stats']

// Space kept clear at the top of the screen for the nav bar: a selection
// nearer the top than this gets its menu underneath instead of above.
const NAV_CLEARANCE = 96

// How long "Copied" shows before the menu goes away.
const COPIED_SHOWN_MS = 1000

// The menu's icons. They're drawn once, out of sight, as each page loads, so
// the browser already has them when the menu first appears; otherwise each
// arrives a moment after the menu. (A plain <link rel="preload"> isn't used
// by Chrome for an <Icon>, whose shape is a CSS mask.)
const ICONS = {
  copy: '/images/icons/copy.svg',
  copied: '/images/icons/check.svg',
  correction: '/images/icons/pencil.svg',
  feedback: '/images/icons/chat.svg',
}

interface Menu {
  text: string
  /** The selection's box, in page coordinates. */
  box: Box
  /** Its first and last lines, in page coordinates: the form's caret
   *  points at one of them. */
  lines?: { first: Box; last: Box }
  /** The Airtable form with the text filled in: offered by the site's form
   *  if sending fails. */
  formHref: string
  /** The listing whose card the text is on, when it is on one. */
  listing?: { name: string; id?: string }
}

/** The boxes of the selected text people can see, one per line of each
 *  text node, in screen coordinates. Text in a visually hidden label (a
 *  card's "(opens in new tab)") is left out: it is clipped to 1px, but its
 *  box runs on past the card, which put the form far to its right. */
function visibleTextRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer
  const nodes: Text[] = []
  if (root instanceof Text) nodes.push(root)
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  }
  const rects: DOMRect[] = []
  for (const node of nodes) {
    if (!node.data.trim() || !range.intersectsNode(node)) continue
    if (node.parentElement?.closest('.visually-hidden')) continue
    const part = document.createRange()
    part.selectNodeContents(node)
    if (node === range.startContainer) part.setStart(node, range.startOffset)
    if (node === range.endContainer) part.setEnd(node, range.endOffset)
    rects.push(...part.getClientRects())
  }
  return rects
}

/** A box in screen coordinates, moved to page coordinates. */
function onPage(b: Box): Box {
  return {
    left: b.left + window.scrollX,
    right: b.right + window.scrollX,
    top: b.top + window.scrollY,
    bottom: b.bottom + window.scrollY,
  }
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
  // Both ends in a page's content, the footer or the chatbot's messages
  // (marked data-selection-menu), never the nav or a text box. Both ends,
  // not their common parent: a selection running from the page into the
  // footer has the whole page as its parent.
  const inScope = (n: Node) =>
    !!(n instanceof Element ? n : n.parentElement)?.closest(
      'main, footer, [data-selection-menu]'
    )
  if (!inScope(range.startContainer) || !inScope(range.endContainer))
    return null
  const rects = visibleTextRects(range)
  const rect = unionBox(rects)
  const lines = selectionLines(rects)
  if (!rect || !lines) return null

  // A card's name is its title link's own text (the link also holds a
  // hidden "(opens in new tab)"); its id, where it has one, is the listing's
  // record id, which a link to the page scrolls to.
  const card = el?.closest<HTMLElement>('[data-card]')
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
    box: onPage(rect),
    lines: { first: onPage(lines.first), last: onPage(lines.last) },
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
  // The last menu stays in the page after it closes, so it can fade out.
  const [menu, setMenu] = useState<Menu | null>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // Whether the selection was made by touch. A phone shows its own menu
  // (Copy, Look up) by the selection, so this one stays away rather than
  // sit on top of it (Bryce, 24 November 2026).
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
      const next = touchRef.current ? null : readSelection(pathname)
      if (next) {
        setMenu(next)
        setCopied(false)
      }
      setOpen(!!next)
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
      setOpen(false)
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
      if (e.key === 'Escape') setOpen(false)
    }

    // The menu sits in the page, so it moves with the page's own scrolling.
    // Anything else scrolling (the chatbot's messages, or the page under the
    // chatbot, which stays put) would leave it behind: it goes instead, and
    // comes back with the next selection.
    function onScroll(e: Event) {
      const page = e.target === document
      const selection = window.getSelection()
      const node = selection?.rangeCount ? selection.anchorNode : null
      const el = node instanceof Element ? node : node?.parentElement
      if (!page || el?.closest('[data-selection-menu]')) setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerEnd, true)
    document.addEventListener('pointercancel', onPointerEnd, true)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onSelectionChange)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerEnd, true)
      document.removeEventListener('pointercancel', onPointerEnd, true)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onSelectionChange)
    }
  }, [pathname, off])

  // Centered over the selection and kept on screen. Above it, unless that
  // would put it under the nav bar.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!menu || !open || !el) return
    const gap = 8
    const { offsetWidth: width, offsetHeight: height } = el
    const pageLeft = window.scrollX + 8
    const pageRight =
      window.scrollX + document.documentElement.clientWidth - width - 8
    const centered = (menu.box.left + menu.box.right) / 2 - width / 2
    const left = Math.max(pageLeft, Math.min(centered, pageRight))
    const topAbove = menu.box.top - height - gap
    const above = topAbove - window.scrollY > NAV_CLEARANCE
    el.style.left = `${left}px`
    el.style.top = `${above ? topAbove : menu.box.bottom + gap}px`
  }, [menu, open, copied])

  // After a copy, "Copied" shows for a moment, then the menu goes: its job
  // is done. The selection stays, so it's clear what was copied.
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setOpen(false), COPIED_SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (off) return null

  const icons = (
    <span className="visually-hidden">
      {Object.values(ICONS).map(src => (
        <Icon key={src} src={src} />
      ))}
    </span>
  )

  if (!menu) return icons

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

  const menuEl = createPortal(
    <div
      ref={menuRef}
      role="toolbar"
      aria-label="Selected text"
      className={`drop-shadow-dark border-plus-fill items-center ${styles.menu} ${open ? styles.open : ''}`}
      // While it fades out it can't be pressed, and screen readers skip it.
      inert={!open}
      // Pressing the menu must not clear the selection it is about.
      onMouseDown={e => e.preventDefault()}
    >
      <Button
        variant="clear"
        size="small"
        icon={copied ? ICONS.copied : ICONS.copy}
        iconPosition="preceding"
        onClick={() => copy(menu.text, menu.listing)}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button
        variant="clear"
        size="small"
        icon={menu.listing ? ICONS.correction : ICONS.feedback}
        iconPosition="preceding"
        aria-haspopup="dialog"
        onClick={e => {
          const kind = menu.listing ? 'correction' : 'feedback'
          trackSelectionMenu(kind, menu.listing)
          // The form takes the menu's place by the selected text, which it
          // keeps marked (the selection itself goes when the form's text
          // box takes the focus).
          setOpen(false)
          const selection = window.getSelection()
          openFeedbackForm({
            kind,
            entry: 'selection',
            trigger: e.currentTarget,
            anchor: menu.box,
            anchorLines: menu.lines,
            quote: menu.text,
            range: selection?.rangeCount
              ? selection.getRangeAt(0).cloneRange()
              : undefined,
            listing: menu.listing,
            fallbackHref: menu.formHref,
          })
        }}
      >
        {formLabel}
      </Button>
    </div>,
    document.body
  )

  return (
    <>
      {icons}
      {menuEl}
    </>
  )
}
