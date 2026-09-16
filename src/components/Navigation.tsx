'use client'

import Image from 'next/image'
import Icon from './Icon'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { SearchButton, SearchProvider } from './SearchTrigger'
import {
  trackNavOverflowOpen,
  type NavOverflowOpenMethod,
} from '@/lib/analytics'
import styles from './Navigation.module.css'

const navItems = [
  {
    href: '/training',
    label: 'Training programs',
    icon: 'grad-cap.svg',
  },
  {
    href: '/events',
    label: 'Events',
    icon: 'calendar.svg',
  },
  { href: '/map', label: 'Field map', icon: 'map.svg' },
  { href: '/communities', label: 'Communities', icon: 'globe.svg' },
  { href: '/self-study', label: 'Self-study', icon: 'book.svg' },
  { href: '/jobs', label: 'Jobs', icon: 'briefcase.svg' },
  { href: '/funding', label: 'Funding', icon: 'coins.svg' },
  {
    href: '/media-channels',
    label: 'Media channels',
    icon: 'megaphone.svg',
  },
  { href: '/advisors', label: 'Advisors', icon: 'person.svg' },
  {
    href: '/projects',
    label: 'Volunteer projects',
    icon: 'clipboard.svg',
  },
  {
    href: '/founders',
    label: 'Founder toolkit',
    icon: 'rocket.svg',
  },
  { href: '/donation-guide', label: 'Donation guide', icon: 'heart.svg' },
]

// Caps the visible row at 6 items — Funding and below live in the +N menu
// (and the mobile menu, which always lists everything).
const MIN_OVERFLOW = 6

// How long the +N panel stays mounted after closing, for its exit animation.
// Must match the transition on .nav-dropdown-closing in the CSS.
const DROPDOWN_EXIT_MS = 100

export default function Navigation({
  counts,
  preview = false,
}: {
  counts: Partial<Record<string, number>>
  preview?: boolean
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(
    navItems.length - MIN_OVERFLOW
  )
  const pathname = usePathname()

  // Close the mobile menu only once the new route is actually active.
  // Closing on link click instead snaps the overlay shut before the new
  // page has rendered, producing a flash of the previous page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: react to route change driven by Link clicks outside this component
    setIsMenuOpen(false)
  }, [pathname])
  const dropdownRef = useRef<HTMLDivElement>(null)

  // The +N pill opens on hover for mouse and trackpad users. Closing waits a
  // moment so the pointer can cross the gap into the panel (bridged by the
  // ::after strip in the CSS) or clip a corner without the menu snapping
  // shut. Touch pointers are ignored here and keep tap-to-toggle.
  const closeTimer = useRef<number | null>(null)
  const lastPointerType = useRef('')
  // How the current open happened, read by the analytics effect below.
  const openVia = useRef<NavOverflowOpenMethod>('hover')
  const cancelDropdownClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])
  const openDropdownOnHover = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === 'touch') return
      cancelDropdownClose()
      openVia.current = 'hover'
      setIsDropdownOpen(true)
    },
    [cancelDropdownClose]
  )
  const closeDropdownOnLeave = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === 'touch') return
      cancelDropdownClose()
      closeTimer.current = window.setTimeout(
        () => setIsDropdownOpen(false),
        150
      )
    },
    [cancelDropdownClose]
  )
  useEffect(() => cancelDropdownClose, [cancelDropdownClose])
  const navRef = useRef<HTMLElement>(null)
  const navOuterRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const itemWidths = useRef<number[]>([])
  const scrollInfo = useRef({
    lastY: 0,
    mode: 'top' as 'top' | 'scrolling' | 'hidden' | 'revealed',
  })
  const slideRaf = useRef(0)

  const visibleItems = navItems.slice(0, visibleCount)
  const overflowItems = navItems.slice(visibleCount)

  const calculateFromCachedWidths = useCallback(() => {
    if (!navRef.current || itemWidths.current.length === 0) return
    const navWidth = navRef.current.offsetWidth
    // Reserves space for both the +N pill and the standalone search icon.
    const overflowButtonWidth = 110
    const gap = 8
    let usedWidth = 0
    let count = 0

    for (let i = 0; i < itemWidths.current.length; i++) {
      const w = itemWidths.current[i] + gap
      if (usedWidth + w + overflowButtonWidth > navWidth) break
      usedWidth += w
      count++
    }

    const maxVisible = navItems.length - MIN_OVERFLOW
    setVisibleCount(Math.min(count, maxVisible))
  }, [])

  // Measure item widths and calculate before the browser paints — no jitter
  useLayoutEffect(() => {
    const widths: number[] = []
    for (const el of itemRefs.current) {
      if (!el) break
      widths.push(el.offsetWidth)
    }
    if (widths.length > 0) {
      itemWidths.current = widths
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: must set count before paint to prevent jitter
      calculateFromCachedWidths()
      // Reveal nav after correct count is set (CSS starts at opacity:0)
      if (navRef.current) navRef.current.style.opacity = '1'
    }
  }, [calculateFromCachedWidths])

  // Recalculate on resize using cached widths — no need to reset visibleCount
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      calculateFromCachedWidths()
    })
    if (navRef.current) observer.observe(navRef.current)
    return () => observer.disconnect()
  }, [calculateFromCachedWidths])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false)
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('click', handleClickOutside)
    }
    return () => document.removeEventListener('click', handleClickOutside)
  }, [isDropdownOpen])

  // Fade-out: after closing, the panel stays mounted with the closing class
  // for DROPDOWN_EXIT_MS. The flag is derived during render (React's
  // previous-render pattern) rather than in an effect: an effect ran one paint
  // too late, so the panel unmounted for a frame and remounted, replaying its
  // entrance animation as a flicker. Reopening mid-fade just drops the class,
  // so the panel snaps back without replaying the entrance.
  const [isDropdownClosing, setIsDropdownClosing] = useState(false)
  const [prevDropdownOpen, setPrevDropdownOpen] = useState(isDropdownOpen)
  if (prevDropdownOpen !== isDropdownOpen) {
    setPrevDropdownOpen(isDropdownOpen)
    if (!isDropdownOpen) setIsDropdownClosing(true)
  }
  useEffect(() => {
    if (!isDropdownClosing) return
    const timer = window.setTimeout(
      () => setIsDropdownClosing(false),
      DROPDOWN_EXIT_MS
    )
    return () => window.clearTimeout(timer)
  }, [isDropdownClosing])

  // Analytics: one nav_overflow_open per closed→open transition, however it
  // was opened. Hover jitter can't double-count — the 150 ms grace keeps the
  // panel open while the pointer crosses into it.
  useEffect(() => {
    if (isDropdownOpen) trackNavOverflowOpen(openVia.current)
  }, [isDropdownOpen])

  useLayoutEffect(() => {
    // A StickyBar toggle click announces its programmatic jump-to-top so the
    // upward scroll it causes doesn't reveal the nav over the fresh content.
    let suppressRevealUntil = 0
    const onScrollJump = () => {
      suppressRevealUntil = performance.now() + 500
    }

    const publishOffset = (el: HTMLElement) => {
      // The nav's live bottom edge — page-level sticky elements (the
      // events/training mode toggles) sit below it instead of under it.
      document.documentElement.style.setProperty(
        '--nav-offset',
        `${Math.max(0, el.getBoundingClientRect().bottom)}px`
      )
    }

    // Slide the nav with JS instead of a CSS transition: transitions advance
    // AFTER rAF callbacks run, so anything tracking the nav via --nav-offset
    // would read last frame's position and trail behind, opening a gap. One
    // rAF loop moves the nav and publishes its edge in the same frame.
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    const slideNav = (el: HTMLElement, to: number) => {
      cancelAnimationFrame(slideRaf.current)
      el.style.transition = 'none'
      const from = el.getBoundingClientRect().top
      const start = performance.now()
      const frame = (now: number) => {
        const p = Math.min(1, (now - start) / 300)
        // Whole pixels only: at fractional positions the nav's composited
        // transform and the sticky toggles' layout `top` get anti-aliased
        // differently, showing a hairline seam between their backdrops.
        const y = Math.round(from + (to - from) * easeInOutCubic(p))
        el.style.transform = `translateY(${y}px)`
        publishOffset(el)
        if (p < 1) slideRaf.current = requestAnimationFrame(frame)
      }
      slideRaf.current = requestAnimationFrame(frame)
    }

    const handleScroll = () => {
      const el = navOuterRef.current
      if (!el) return
      const y = window.scrollY
      const { lastY, mode } = scrollInfo.current
      const goingDown = y > lastY
      const goingUp = y < lastY

      if (y <= 0) {
        // At the very top - reset
        cancelAnimationFrame(slideRaf.current)
        el.style.transition = 'none'
        el.style.transform = 'translateY(0)'
        scrollInfo.current.mode = 'top'
      } else if (goingDown) {
        if (mode === 'top' || mode === 'scrolling') {
          // Scrolling down from top - move naturally with the page
          cancelAnimationFrame(slideRaf.current)
          const navHeight = el.offsetHeight
          if (y >= navHeight) {
            el.style.transition = 'none'
            el.style.transform = 'translateY(-100%)'
            scrollInfo.current.mode = 'hidden'
          } else {
            el.style.transition = 'none'
            el.style.transform = `translateY(-${y}px)`
            scrollInfo.current.mode = 'scrolling'
          }
        } else if (mode === 'revealed') {
          // Was revealed by scroll-up, now scrolling down again - animate away
          slideNav(el, -el.offsetHeight)
          scrollInfo.current.mode = 'hidden'
        }
        // 'hidden' stays hidden
      } else if (goingUp) {
        if (
          (mode === 'hidden' || mode === 'scrolling') &&
          performance.now() >= suppressRevealUntil
        ) {
          // Scrolling up - reveal with smooth animation
          slideNav(el, 0)
          scrollInfo.current.mode = 'revealed'
        }
        // Near the top, switch back to natural mode
        if (y <= 5) {
          scrollInfo.current.mode = 'top'
        }
      }

      // Blur background while the nav is revealed over content, and keep it on
      // through 'hidden' so it travels up *with* the nav during the slide-up
      // hide instead of popping off instantly (it's off-screen, so invisible,
      // except during that animation). Stays off at the top (over the hero) and
      // during the initial scroll-down slide-away ('scrolling'), where the nav
      // is still partly visible. Toggled on the DOM — no React render delay.
      const blurClass = styles['nav-blur']
      const m = scrollInfo.current.mode
      el.classList.toggle(blurClass, m === 'revealed' || m === 'hidden')

      publishOffset(el)

      scrollInfo.current.lastY = y
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('stickybar:scroll-jump', onScrollJump)
    handleScroll()
    document.documentElement.classList.remove('is-reload')
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('stickybar:scroll-jump', onScrollJump)
      cancelAnimationFrame(slideRaf.current)
    }
  }, [])
  return (
    <SearchProvider counts={counts} preview={preview}>
      <div ref={navOuterRef} className={`${styles.nav} ${styles['nav-fixed']}`}>
        <div className={styles['nav-container']}>
          <Link href="/" className="padding-right-24px">
            <Image
              src="/images/logo.svg"
              alt="AI Safety logo"
              width={139}
              height={24}
              className="block"
            />
          </Link>

          <nav ref={navRef} className={styles['nav-menu']}>
            {visibleItems.map((item, i) => (
              <Link
                key={item.href}
                href={item.href}
                className={styles['nav-item']}
                aria-current={pathname === item.href ? 'page' : undefined}
                ref={el => {
                  itemRefs.current[i] = el
                }}
              >
                <div className={styles['nav-item-icon']}>
                  <Icon
                    className="color-teal-bright-800"
                    src={`/images/icons/${item.icon}`}
                  />
                </div>
                <p className="paragraph-small-bold">{item.label}</p>
                {counts[item.href] && (
                  <p className="paragraph-xs color-teal-300">
                    {counts[item.href]}
                  </p>
                )}
              </Link>
            ))}

            <div
              ref={dropdownRef}
              className={styles['nav-item-last']}
              data-active-inside={
                overflowItems.some(item => item.href === pathname)
                  ? ''
                  : undefined
              }
              data-open={isDropdownOpen ? '' : undefined}
              onPointerEnter={openDropdownOnHover}
              onPointerLeave={closeDropdownOnLeave}
              onPointerDown={e => {
                lastPointerType.current = e.pointerType
              }}
              // Mouse users already opened it by hovering, so a click keeps it
              // open; touch has no hover, so a tap still toggles.
              onClick={() => {
                const touch = lastPointerType.current === 'touch'
                if (touch) openVia.current = 'tap'
                setIsDropdownOpen(open => (touch ? !open : true))
              }}
            >
              <p className="paragraph-small-bold">+{overflowItems.length}</p>
              {(isDropdownOpen || isDropdownClosing) && (
                <div
                  className={`${styles['nav-dropdown']} border-plus-fill${
                    !isDropdownOpen ? ` ${styles['nav-dropdown-closing']}` : ''
                  }`}
                >
                  {overflowItems.map(item => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={styles['nav-dropdown-item']}
                      aria-current={pathname === item.href ? 'page' : undefined}
                      style={{ marginBottom: '8px' }}
                      onClick={() => setIsDropdownOpen(false)}
                    >
                      <div className={styles['nav-item-icon']}>
                        <Icon
                          className="color-teal-bright-800"
                          src={`/images/icons/${item.icon}`}
                        />
                      </div>
                      <p className="paragraph-small-bold">{item.label}</p>
                      {counts[item.href] && (
                        <p className="paragraph-xs color-teal-300">
                          {counts[item.href]}
                        </p>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <SearchButton
              className={`${styles['nav-search-button']} flex items-center justify-center color-white`}
            >
              <Icon src="/images/icons/search-large.svg" size={24} />
            </SearchButton>
          </nav>

          <button
            className={styles['menu-button']}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle menu"
          >
            <span
              className={`${styles.hamburger} ${isMenuOpen ? styles['hamburger-open'] : ''}`}
            >
              <span className={styles['hamburger-bar']} />
              <span className={styles['hamburger-bar']} />
              <span className={styles['hamburger-bar']} />
            </span>
          </button>
        </div>
      </div>

      <div
        className={`${styles['mobile-menu']} ${isMenuOpen ? styles['mobile-menu-visible'] : ''}`}
      >
        <div className={styles['mobile-menu-header']}>
          <Link href="/">
            <Image
              src="/images/logo.svg"
              alt="AI Safety logo"
              width={139}
              height={24}
              className="block"
            />
          </Link>
          <button
            className={styles['menu-button']}
            onClick={() => setIsMenuOpen(false)}
            aria-label="Close menu"
          >
            <span className={`${styles.hamburger} ${styles['hamburger-open']}`}>
              <span className={styles['hamburger-bar']} />
              <span className={styles['hamburger-bar']} />
              <span className={styles['hamburger-bar']} />
            </span>
          </button>
        </div>
        <nav className={styles['mobile-menu-items']}>
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={styles['nav-item']}
              aria-current={pathname === item.href ? 'page' : undefined}
            >
              <div className={styles['nav-item-icon']}>
                <Icon
                  className="color-teal-bright-800"
                  src={`/images/icons/${item.icon}`}
                />
              </div>
              <p className="paragraph-default-bold">{item.label}</p>
              {counts[item.href] && (
                <p className="paragraph-small color-teal-300">
                  {counts[item.href]}
                </p>
              )}
            </Link>
          ))}
          <SearchButton
            className={styles['nav-item']}
            onClick={() => setIsMenuOpen(false)}
          >
            <div className={styles['nav-item-icon']}>
              <Icon
                className="color-teal-bright-800"
                src="/images/icons/search.svg"
              />
            </div>
            <p className="paragraph-default-bold">Search</p>
          </SearchButton>
        </nav>
      </div>
    </SearchProvider>
  )
}
