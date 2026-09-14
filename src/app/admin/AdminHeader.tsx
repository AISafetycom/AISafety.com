'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
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
          {tabs?.map((tab, i) => {
            const active =
              pathname === tab.href || pathname.startsWith(tab.href + '/')
            const prev = tabs[i - 1]
            const divide = prev && prev.group !== tab.group
            return (
              <Fragment key={tab.href}>
                {divide && (
                  <span className={styles.adminNavDivider} aria-hidden="true" />
                )}
                <Link
                  href={tab.href}
                  className={`${styles.adminNavLink} ${active ? styles.adminNavLinkActive : ''}`}
                >
                  {tab.label}
                </Link>
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
