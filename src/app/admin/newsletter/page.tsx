import { canSendNewsletter } from '@/lib/admin/auth'
import NewsletterAdmin from './NewsletterAdmin'

// Nothing here is prerendered: the page reads ActiveCampaign live in the
// browser via /api/admin/newsletter.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function NewsletterAdminPage() {
  // Whether this session may approve is known from the cookie alone, so the
  // page shows the right notice at first paint instead of waiting for the
  // ActiveCampaign read (preview-only reviewers used to see the amber
  // "sends real emails" warning until the list arrived). The layout has
  // already turned away anyone who can neither approve nor preview.
  const canSend = await canSendNewsletter()
  return <NewsletterAdmin canSend={canSend} />
}
