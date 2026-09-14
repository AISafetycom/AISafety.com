/**
 * One entry per public page: the page title, the description that goes in
 * <meta> tags and link-preview cards, and the nav icon drawn on the card image.
 *
 * Consumed by `pageMetadata()` (src/lib/page-metadata.ts) for the <head> tags
 * and by `linkPreviewImage()` (src/lib/link-preview) for the per-page card
 * image that Slack, X, Discord etc. show when a link is shared.
 */
export type SitePage = {
  /** URL path, e.g. '/jobs'. */
  path: string
  /** Page name as shown on the page and in the nav, e.g. 'Field map'. */
  title: string
  /** One or two sentences, used for <meta name="description"> and the card. */
  description: string
  /** File name in public/images/icons, drawn on the preview card image. */
  icon: string
}

export const SITE_PAGES = {
  events: {
    path: '/events',
    title: 'Events',
    description:
      'Conferences, competitions, meetups, talks, and workshops in AI safety, both online and in person.',
    icon: 'calendar.svg',
  },
  training: {
    path: '/training',
    title: 'Training programs',
    description:
      'Fellowships, bootcamps, and courses in AI safety to upskill and build career capital. Both online and in person.',
    icon: 'grad-cap.svg',
  },
  map: {
    path: '/map',
    title: 'Field map',
    description:
      'Map displaying the main organizations, programs, and other resources in the AI safety space.',
    icon: 'map.svg',
  },
  communities: {
    path: '/communities',
    title: 'Communities',
    description:
      'Groups dedicated to discussing and contributing to AI safety, both online and in-person.',
    icon: 'globe.svg',
  },
  selfStudy: {
    path: '/self-study',
    title: 'Self-study',
    description:
      'Curricula and reading lists to dive deeper into AI safety through independent learning.',
    icon: 'book.svg',
  },
  jobs: {
    path: '/jobs',
    title: 'Jobs',
    description:
      "AI safety career opportunities. Many roles don't require technical skills.",
    icon: 'briefcase.svg',
  },
  funding: {
    path: '/funding',
    title: 'Funding',
    description:
      'Organizations offering financial support to organizations and individuals working on AI safety.',
    icon: 'coins.svg',
  },
  mediaChannels: {
    path: '/media-channels',
    title: 'Media channels',
    description:
      'Information sources to help you learn more about AI safety and stay up to date.',
    icon: 'megaphone.svg',
  },
  advisors: {
    path: '/advisors',
    title: 'Advisors',
    description:
      'Advisors offering free guidance calls to help you most effectively contribute to AI safety.',
    icon: 'person.svg',
  },
  projects: {
    path: '/projects',
    title: 'Volunteer projects',
    description:
      'Initiatives seeking your volunteer help, focused on supporting and improving the AI safety field.',
    icon: 'clipboard.svg',
  },
  founders: {
    path: '/founders',
    title: 'Founder toolkit',
    description:
      'Resources for starting and growing an AI safety organization, including incubators, fiscal sponsors, VCs, and practical tools.',
    icon: 'rocket.svg',
  },
  donationGuide: {
    path: '/donation-guide',
    title: 'Donation guide',
    description:
      'A short guide on how to donate most effectively to the AI safety field.',
    icon: 'heart.svg',
  },
} as const satisfies Record<string, SitePage>
