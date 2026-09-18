import type { CardProps } from '@/components/ListingCard'
import type { Course } from '@/lib/data/self-study'

// The ListingCard props for one course, exactly as the /self-study grid
// renders it. Plain TS (no JSX) so the page's client component and the admin
// Queue's "how it will look on the site" preview build the same card.
export function courseCardProps(course: Course): CardProps {
  return {
    href: course.url,
    name: course.name,
    description: course.description,
    logo: course.image,
    titleMeta: course.organizer
      ? [
          {
            icon: '/images/icons/author.svg',
            value: `By ${course.organizer}`,
          },
        ]
      : undefined,
    meta: [
      ...(course.category
        ? [
            {
              icon: '/images/icons/category.svg',
              value: course.category,
            },
          ]
        : []),
      ...(course.courseType
        ? [
            {
              icon: '/images/icons/type.svg',
              value: course.courseType,
            },
          ]
        : []),
    ],
  }
}
