import { canReviewQueue, currentAdmin, requireAccess } from '@/lib/admin/auth'
import QueueAdmin from './QueueAdmin'

// Nothing here is prerendered: the page reads the queue live in the browser
// via /api/admin/queue.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function QueueAdminPage() {
  // Checked here, not only in the layout: see requireAccess.
  await requireAccess('queue')
  // View-only sessions get the same page without the deciding parts; the
  // API refuses their writes regardless.
  // The name this person's decisions are kept under (queue-history.ts), so
  // the page can tell their own from someone else's.
  const me = await currentAdmin()
  return (
    <QueueAdmin
      canEdit={await canReviewQueue()}
      me={me?.name || me?.email || null}
    />
  )
}
