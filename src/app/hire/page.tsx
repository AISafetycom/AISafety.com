import PageHeader from '@/components/PageHeader'
import HireClient from './HireClient'
import { getPeople } from '@/lib/data/people'
import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

export const metadata = pageMetadata(SITE_PAGES.hire)

// The data source credit under the title links to where the members'
// profiles actually live (Mangrove One), per src/lib/data/people.ts.
const DATA_SOURCE_NAME = 'Mangrove One'
const DATA_SOURCE_URL = 'https://try.mangrove.one'

export default async function HirePage() {
  const people = await getPeople()

  return (
    <div className="container-default">
      <PageHeader
        title="Hire"
        updatedLine={
          <>
            Updated today with data from{' '}
            <a href={DATA_SOURCE_URL} className="color-light-teal">
              {DATA_SOURCE_NAME}
            </a>
          </>
        }
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
      />

      <HireClient people={people} />
    </div>
  )
}
