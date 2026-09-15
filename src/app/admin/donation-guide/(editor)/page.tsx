import { canEditDonationGuide } from '@/lib/admin/auth'
import GuideEditor from './GuideEditor'

// Nothing here is prerendered: the editor loads the draft, the live version
// and the history in the browser via /api/admin/donation-guide.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function DonationGuideEditorPage() {
  // View-only sessions see the draft, the preview and the history with
  // nothing to change; the API refuses their writes regardless.
  return <GuideEditor canEdit={await canEditDonationGuide()} />
}
