import type { CardProps } from '@/components/ListingCard'
import type { Project } from '@/lib/data/projects'

// The ListingCard props for one volunteer project, exactly as the /projects
// grid renders it: a static card (projects have no external link) with the
// contact, email and status rows. Plain TS (no JSX) so the page's client
// component and the admin Queue's "how it will look on the site" preview
// build the same card.
export function projectCardProps(project: Project): CardProps {
  return {
    name: project.name,
    description: project.description,
    meta: [
      ...(project.contact
        ? [{ icon: '/images/icons/person.svg', value: project.contact }]
        : []),
      ...(project.email
        ? [{ icon: '/images/icons/mail.svg', value: project.email }]
        : []),
      { icon: '/images/icons/activity.svg', value: project.status },
    ],
  }
}
