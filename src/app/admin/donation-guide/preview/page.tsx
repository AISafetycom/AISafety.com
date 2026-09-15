import { redirect } from 'next/navigation'
import { canViewDonationGuide } from '@/lib/admin/auth'
import DonationGuideClient from '@/app/donation-guide/DonationGuideClient'
import { readLiveGuide } from '@/lib/donation-guide/live'
import { guideStore } from '@/lib/donation-guide/store'
import styles from '../donation-guide.module.css'

// The real page with the draft in it, for the editor's preview panel and
// its "Open in new tab". Admin sessions with the area only; nobody else can
// see a draft. With no draft it shows what is live.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function DonationGuidePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  if (!(await canViewDonationGuide())) redirect('/admin/login')
  const [draft, live, params] = await Promise.all([
    guideStore.getDraft(),
    readLiveGuide(),
    searchParams,
  ])
  return (
    <div className={styles.previewPage}>
      <DonationGuideClient
        guide={draft?.guide ?? live.guide}
        lastUpdated={draft?.savedAt ?? live.publishedAt}
        initialTab={params.tab}
      />
    </div>
  )
}
