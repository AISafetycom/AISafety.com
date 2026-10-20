import { fetchLastUpdated } from '@/lib/data/last-updated'
import PageHeader from '@/components/PageHeader'
import FeaturedCard from '@/components/FeaturedCard'
import ProjectsClient from './ProjectsClient'
import { projectCardProps } from './card'
import { getProjects } from '@/lib/data/projects'
import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

// Retired on 19 October 2026: next.config.ts redirects /projects to /about,
// so this page is never served, and the nav, sitemap, search and chatbot no
// longer point here. The code stays for the rebuilt projects page.
export const metadata = pageMetadata(SITE_PAGES.projects)

export default async function ProjectsPage() {
  const [projects, lastUpdated] = await Promise.all([
    getProjects(),
    fetchLastUpdated('projects'),
  ])

  const featured = [
    projects.find(p => p.featured === '1'),
    projects.find(p => p.featured === '2'),
  ].filter((p): p is NonNullable<typeof p> => p != null)

  return (
    <div className="container-default">
      <PageHeader
        title="Volunteer projects"
        lastUpdatedIso={lastUpdated.lastUpdated}
        description={
          <>
            Initiatives{' '}
            <span className="color-light-teal">
              seeking your volunteer help
            </span>
            . These projects are focused on supporting and improving the AI
            safety field.
          </>
        }
      />

      <div className="flex flex-wrap gap-56px padding-bottom-80px">
        {featured.map((project, i) => (
          <FeaturedCard
            key={project.id}
            className="width-6-col"
            tagline={project.featuredTagline!}
            name={project.name}
            description={project.description}
            meta={projectCardProps(project).meta}
            trackingPage="Projects"
            trackingId={project.id}
            trackingPosition={`F${project.featured}`}
            trackingSource="cards"
            index={i}
            count={featured.length}
          />
        ))}
      </div>

      <ProjectsClient projects={projects} />
    </div>
  )
}
