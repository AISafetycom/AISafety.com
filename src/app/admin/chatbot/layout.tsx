import { redirect } from 'next/navigation'
import { currentAccess, currentAdmin } from '@/lib/admin/auth'
import AdminHeader from '../AdminHeader'
import { pendingRequestCount } from '@/lib/admin/users-store'
import { adminTabs, adminHomeHref } from '../nav'
import styles from '../admin.module.css'

export default async function ChatbotAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const access = await currentAccess()
  // The chatbot section holds two tabs; either one is enough to enter it, and each page checks its own.
  // Anyone signed in without it goes to the first area they do have;
  // signed-out sessions to login.
  if (!(access.playground || access.conversationLog)) {
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
