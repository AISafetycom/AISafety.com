'use client'

import { useEffect } from 'react'

// A listing card's link is its title alone, so a screen reader announces a
// short link name (#819). An invisible box (the title link's ::after) is
// stretched over the card. On a touch screen it catches the finger, so the
// card is simply the link and a long-press shows the link's menu. With a
// mouse it lets the pointer through to the text beneath, so every word on
// the card can be selected and copied by dragging. (A double-click can't
// select a word: its first click opens the link at once, as a click on any
// link does.) This makes the whole card (any element marked data-card) act
// as the link with a mouse:
// - a plain click or tap anywhere opens it, unless it was part of
//   selecting text
// - Cmd/Ctrl-click, Shift-click and middle-click open it in a new tab or
//   window, as on any link
// - a right-click shows the link's menu (Open link in new tab, Copy link
//   address), unless text on the card is selected, when it offers Copy

// Set on <html> while the box over each card should catch the pointer, so
// the browser finds a real link there: while Cmd or Ctrl is held, and for a
// right-click (the browser looks up what's under the pointer again for its
// menu, after the press).
const LINKS_ON = 'data-card-links'

// Anything on a card that is clickable in its own right.
const CONTROLS = 'a, button, input, select, textarea, label, summary'

function hasSelection() {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed
}

function cardOf(target: EventTarget | null) {
  const el = target instanceof Element ? target : null
  const card = el?.closest<HTMLElement>('[data-card]')
  const link = card?.querySelector<HTMLAnchorElement>('h3 a')
  return el && card && link ? { el, card, link } : null
}

// Hands a click on the card's text to its title link with the same button
// and keys, so the browser opens it exactly as it would a click on the link.
function forwardClick(link: HTMLAnchorElement, e: MouseEvent) {
  link.dispatchEvent(
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

export default function CardClicks() {
  useEffect(() => {
    // Whether text was selected when the press began: a click that only
    // clears a selection mustn't open the link either.
    let selectedAtPress = false
    let modifierHeld = false
    let rightPress = false
    // Browsers never start a text selection on a link, so while the mouse
    // button is down on a card's title the link is plain text (its href is
    // set aside) and a drag selects the title's words. The href comes back
    // the moment the button is released, before the click arrives, so a
    // plain click still opens the link. Touch screens keep the link as it
    // is, so a long-press shows the usual link menu.
    let heldHref: { link: HTMLAnchorElement; href: string } | null = null

    function syncLinksOn() {
      document.documentElement.toggleAttribute(
        LINKS_ON,
        modifierHeld || rightPress
      )
    }

    function restoreHref() {
      if (!heldHref) return
      heldHref.link.setAttribute('href', heldHref.href)
      heldHref = null
    }

    function onModifiers(e: KeyboardEvent | PointerEvent) {
      const held = e.metaKey || e.ctrlKey
      if (held === modifierHeld) return
      modifierHeld = held
      syncLinksOn()
    }

    function onBlur() {
      modifierHeld = false
      rightPress = false
      syncLinksOn()
      restoreHref()
    }

    function onPointerDown(e: PointerEvent) {
      restoreHref()
      selectedAtPress = hasSelection()
      const touch = e.pointerType === 'touch'
      const hit = cardOf(e.target)
      rightPress =
        !!hit &&
        e.button === 2 &&
        !(
          selectedAtPress && window.getSelection()!.containsNode(hit.card, true)
        )
      syncLinksOn()
      if (!hit || touch || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if (!hit.link.contains(hit.el)) return
      heldHref = { link: hit.link, href: hit.link.getAttribute('href')! }
      hit.link.removeAttribute('href')
    }

    function onContextMenu() {
      if (!rightPress) return
      // After the browser has looked up the link for its menu.
      window.setTimeout(() => {
        rightPress = false
        syncLinksOn()
      }, 0)
    }

    // Runs in the capture phase, before the link's own click handler, so a
    // click on the title that was selecting text can be stopped before it
    // opens or counts.
    function onClick(e: MouseEvent) {
      restoreHref()
      if (e.button !== 0 || e.defaultPrevented) return
      const hit = cardOf(e.target)
      if (!hit) return
      const { el, link } = hit
      // Part of selecting text (or the second click of a double-click, whose
      // first already opened the link): not a click on the card.
      const selecting = e.detail > 1 || selectedAtPress || hasSelection()
      const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
      if (link.contains(el)) {
        // Enter on the focused title and a forwarded click (both detail 0),
        // and a click asking for a new tab or window, always go through; so
        // does a plain click that wasn't selecting.
        if (e.detail === 0 || modified || !selecting) return
        e.preventDefault()
        e.stopPropagation()
      } else if (!selecting && !el.closest(CONTROLS)) {
        forwardClick(link, e)
      }
    }

    // A middle-click opens the link in a new tab.
    function onAuxClick(e: MouseEvent) {
      if (e.button !== 1 || e.defaultPrevented) return
      const hit = cardOf(e.target)
      if (!hit || hit.el.closest(CONTROLS)) return
      forwardClick(hit.link, e)
    }

    document.addEventListener('keydown', onModifiers, true)
    document.addEventListener('keyup', onModifiers, true)
    document.addEventListener('pointermove', onModifiers, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', restoreHref, true)
    document.addEventListener('pointercancel', restoreHref, true)
    document.addEventListener('contextmenu', onContextMenu, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('auxclick', onAuxClick, true)
    return () => {
      onBlur()
      document.removeEventListener('keydown', onModifiers, true)
      document.removeEventListener('keyup', onModifiers, true)
      document.removeEventListener('pointermove', onModifiers, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', restoreHref, true)
      document.removeEventListener('pointercancel', restoreHref, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('auxclick', onAuxClick, true)
    }
  }, [])

  return null
}
