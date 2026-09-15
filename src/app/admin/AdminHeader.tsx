'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { NAV_MENUS } from './nav'
import styles from './admin.module.css'

export interface AdminTab {
  href: string
  label: string
  /** Optional grouping key; a divider is drawn where it changes. */
  group?: string
}

interface Props {
  tabs?: AdminTab[]
  brand?: string
  brandHref?: string
  /** Name of the signed-in person (or the password role), shown by Sign out
   *  so it is always clear whose session this is. */
  signedInAs?: string
}

export default function AdminHeader({
  tabs,
  brand = 'AISafety.com Admin',
  brandHref = '/admin/chatbot/playground',
  signedInAs,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const handleLogout = async () => {
    try {
      await fetch('/api/admin/auth', { method: 'DELETE' })
    } catch {
      // ignore
    }
    router.push('/admin/login')
    router.refresh()
  }
  return (
    <header className={styles.adminHeader}>
      <div className={styles.adminHeaderInner}>
        <Link href={brandHref} className={styles.adminBrand}>
          {brand}
        </Link>
        <nav className={styles.adminNav}>
          {groupTabs(tabs ?? []).map((entry, i) => {
            const menuLabel = entry.group && NAV_MENUS[entry.group]
            return (
              <Fragment key={entry.tabs[0].href}>
                {i > 0 && (
                  <span className={styles.adminNavDivider} aria-hidden="true" />
                )}
                {menuLabel && entry.tabs.length > 1 ? (
                  <NavMenu
                    label={menuLabel}
                    tabs={entry.tabs}
                    pathname={pathname}
                  />
                ) : (
                  entry.tabs.map(tab => (
                    <Link
                      key={tab.href}
                      href={tab.href}
                      className={`${styles.adminNavLink} ${isActive(pathname, tab.href) ? styles.adminNavLinkActive : ''}`}
                    >
                      {tab.label}
                    </Link>
                  ))
                )}
              </Fragment>
            )
          })}
        </nav>
        <div className={styles.adminHeaderRight}>
          <a
            href="https://aisafety.com"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.adminBackLink}
          >
            Launch site
          </a>
          {signedInAs && (
            <>
              <span className={styles.adminNavDivider} aria-hidden="true" />
              <span className={styles.adminSignedInAs}>
                <span className={styles.adminSignedInLabel}>Signed in as</span>
                {signedInAs}
              </span>
            </>
          )}
          <button
            type="button"
            className={styles.adminLogoutButton}
            onClick={handleLogout}
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

/** Consecutive tabs with the same group, in order. */
function groupTabs(tabs: AdminTab[]): { group?: string; tabs: AdminTab[] }[] {
  const out: { group?: string; tabs: AdminTab[] }[] = []
  for (const tab of tabs) {
    const last = out[out.length - 1]
    if (last && last.group !== undefined && last.group === tab.group) {
      last.tabs.push(tab)
    } else {
      out.push({ group: tab.group, tabs: [tab] })
    }
  }
  return out
}

/** A dropdown of tabs: opens on hover or click, closes when the pointer
 *  leaves, on a pick, a click elsewhere or Escape. Lit like an active tab
 *  while one of its pages is open. */
function NavMenu({
  label,
  tabs,
  pathname,
}: {
  label: string
  tabs: AdminTab[]
  pathname: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  // Leaving is forgiven for a moment so the pointer can cross the small gap
  // between the button and the list.
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = tabs.some(t => isActive(pathname, t.href))
  const enter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = null
    setOpen(true)
  }
  const leave = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => setOpen(false), 150)
  }
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
    },
    []
  )

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      className={styles.adminNavMenu}
      ref={box}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <button
        type="button"
        className={`${styles.adminNavLink} ${styles.adminNavMenuButton} ${active ? styles.adminNavLinkActive : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {label}
        <span className={styles.adminNavCaret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className={styles.adminNavMenuList} role="menu">
          {tabs.map(tab => (
            <Link
              key={tab.href}
              role="menuitem"
              href={tab.href}
              className={`${styles.adminNavMenuItem} ${isActive(pathname, tab.href) ? styles.adminNavMenuItemActive : ''}`}
              onClick={() => setOpen(false)}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
