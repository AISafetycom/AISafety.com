import PageHeader from '@/components/PageHeader'
import HireClient from './HireClient'
import { getCandidates } from '@/lib/data/hire'
import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

export const metadata = pageMetadata(SITE_PAGES.hire)

export default async function HirePage() {
  const candidates = await getCandidates()

  return (
    <div className="container-default">
      <PageHeader
        title="Hire"
        description={
          <>
            Find{' '}
            <span className="color-light-teal">
              people who are actively working on AI safety projects
            </span>
            , evaluate their contributions, and see referrals from
            collaborators.
          </>
        }
      >
        {/* Mock data (see src/lib/data/hire.ts) has no real freshness
            signal, so there's no lastUpdatedIso to show here yet. This
            "Updated today with data from Mangrove One" line matches the
            mockup, but names a data partner that doesn't exist yet — copy
            to confirm with Bryce/Melissa before this page goes live. */}
        <p className="paragraph-small color-teal-300 padding-bottom-40px">
          Updated today with data from{' '}
          <span className="color-light-teal">Mangrove One</span>.
        </p>
      </PageHeader>

      <HireClient candidates={candidates} />
    </div>
  )
}
