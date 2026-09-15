import { redirect } from 'next/navigation'
import { currentAccess, currentAdmin } from '@/lib/admin/auth'
import AdminHeader from '../../AdminHeader'
import { pendingRequestCount } from '@/lib/admin/users-store'
import { adminTabs, adminHomeHref } from '../../nav'
import styles from '../../admin.module.css'

// The editor sits in the (editor) route group so this admin chrome wraps
// it but not ../preview, which renders the public page as it is.
export default async function DonationGuideLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const access = await currentAccess()
  // Publishing changes the live page; view-only sessions may look, and the
  // page and the API keep every write behind the edit grant. Anyone signed
  // in without the area goes to the first area they do have; signed-out
  // sessions to login.
  if (!access.donationGuide) {
    redirect(adminHomeHref(access))
  }
  const who = await currentAdmin()
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
