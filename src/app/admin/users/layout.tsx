import { redirect } from 'next/navigation'
import { currentAccess, currentAdmin } from '@/lib/admin/auth'
import AdminHeader from '../AdminHeader'
import { pendingRequestCount } from '@/lib/admin/users-store'
import { adminTabs, adminHomeHref } from '../nav'
import styles from '../admin.module.css'

export default async function UsersAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const access = await currentAccess()
  // Who can sign in. View-only sessions see the list; changing it needs the
  // edit grant, which the page and the write routes check (the routes also
  // want a fresh session).
  // Anyone signed in without it goes to the first area they do have;
  // signed-out sessions to login.
  if (!access.manageUsers) {
    redirect(adminHomeHref(access))
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
