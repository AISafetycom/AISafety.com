import { canReviewQueue } from '@/lib/admin/auth'
import QueueAdmin from './QueueAdmin'

// Nothing here is prerendered: the page reads the queue live in the browser
// via /api/admin/queue.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function QueueAdminPage() {
  // View-only sessions get the same page without the deciding parts; the
  // API refuses their writes regardless.
  // The base id lets Q open the shown listing's record in Airtable.
  return (
    <QueueAdmin
      canEdit={await canReviewQueue()}
      airtableBase={process.env.AIRTABLE_BASE_ID ?? null}
    />
  )
}
