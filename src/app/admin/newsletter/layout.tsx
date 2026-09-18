import { redirect } from 'next/navigation'
import {
  currentAccess,
  currentAdmin,
  hasFreshSession,
  NEWSLETTER_FRESH_SECONDS,
} from '@/lib/admin/auth'
import AdminHeader from '../AdminHeader'
import { pendingRequestCount } from '@/lib/admin/users-store'
import { adminTabs, adminHomeHref } from '../nav'
import styles from '../admin.module.css'

export default async function NewsletterAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const access = await currentAccess()
  // Approvers and view-only reviewers may open the page. Anyone signed in
  // without the area goes to the first area they do have; signed-out
  // sessions to login.
  if (!access.newsletter) {
    redirect(adminHomeHref(access))
  }
  // Approvals send real email, so an approver's session must have come
  // through Google recently. An older session takes one more trip through
  // Google's account chooser and lands straight back here. View-only
  // sessions can't send, so they aren't bounced.
  if (
    access.newsletter === 'edit' &&
    !(await hasFreshSession(NEWSLETTER_FRESH_SECONDS))
  ) {
    redirect('/api/admin/auth/google?next=/admin/newsletter')
  }
  const who = await currentAdmin()
  // Badge on the Admin admin tab: people waiting to be approved.
  const pendingRequests = access.manageUsers ? await pendingRequestCount() : 0
  return (
    <>
      <AdminHeader
        tabs={adminTabs(access, { pendingRequests })}
        brandHref={adminHomeHref(access)}
        signedInAs={who?.name}
      />
      <main className={styles.consoleWrap}>{children}</main>
    </>
  )
}
