import { getLiveGuide } from '@/lib/donation-guide/live'
import DonationGuideClient from './DonationGuideClient'

// The guide's text is a JSON document edited at /admin/donation-guide and
// kept in the site's store (src/lib/donation-guide/store.ts); the copy built
// into the code (seed.ts) shows until the first publish and stands in if
// the store is unreachable. Prerendered; a publish revalidates this page.
export default async function DonationGuidePage() {
  const { guide, publishedAt } = await getLiveGuide()
  return <DonationGuideClient guide={guide} lastUpdated={publishedAt} />
}
