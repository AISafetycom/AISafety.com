import { fetchLastUpdated } from '@/lib/data/last-updated'
import PageHeader from '@/components/PageHeader'
import FeaturedCard from '@/components/FeaturedCard'
import SelfStudyClient from './SelfStudyClient'
import { getCourses } from '@/lib/data/self-study'
import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

export const metadata = pageMetadata(SITE_PAGES.selfStudy)

export default async function SelfStudyPage() {
  const [courses, lastUpdated] = await Promise.all([
    getCourses(),
    fetchLastUpdated('self-study'),
  ])

  const featuredCourses = [
    courses.find(c => c.featured === '1'),
    courses.find(c => c.featured === '2'),
  ].filter((c): c is NonNullable<typeof c> => c != null)

  return (
    <div className="container-default">
      <PageHeader
        title="Self-study"
        lastUpdatedIso={lastUpdated.lastUpdated}
        description={
          <>
            These curricula and reading lists enable you to{' '}
            <span className="color-teal-bright-300">
              dive deeper into AI safety{' '}
            </span>
            through independent learning.
          </>
        }
      />

      {/* Featured Cards: two width-6-col cards tile to the full row with the
          56px column gutter (gap-56px), and stack on mobile (width-6-col goes
          full-width there). gap-56px must match GRID_GAP in FeaturedCard so the
          shared gradient lines up. */}
      <div className="flex flex-wrap gap-56px padding-bottom-80px">
        {featuredCourses.map((course, i) => (
          <FeaturedCard
            key={course.id}
            className="width-6-col"
            href={course.url !== '#' ? course.url : undefined}
            tagline={course.featuredTagline!}
            name={course.name}
            description={course.description}
            logo={course.image ?? undefined}
            titleMeta={
              course.organizer
                ? [
                    {
                      icon: '/images/icons/author.svg',
                      value: `By ${course.organizer}`,
                    },
                  ]
                : undefined
            }
            meta={[
              ...(course.category
                ? [
                    {
                      icon: '/images/icons/category.svg',
                      value: course.category,
                    },
                  ]
                : []),
              ...(course.courseType
                ? [{ icon: '/images/icons/type.svg', value: course.courseType }]
                : []),
            ]}
            trackingPage="Self-study"
            trackingId={course.id}
            trackingPosition={`F${course.featured}`}
            index={i}
            count={featuredCourses.length}
          />
        ))}
      </div>

      {/* Main Content with Search, Cards, and Filters */}
      <SelfStudyClient courses={courses} />
    </div>
  )
}
