export interface PageInfo {
  path: string
  title: string
  purpose: string
  audience: string
  greeting: string
  chips: string[]
}

export const PAGES: PageInfo[] = [
  {
    path: '/',
    title: 'Home',
    purpose:
      'Top-level entry point with cards linking to events, the field map, communities, courses, jobs, funders, advisors, projects, donation guide, and AISafety.info for conceptual learning.',
    audience: 'Anyone arriving for the first time.',
    greeting:
      'What are you looking for? I can point you to jobs, funders, communities, courses, and other curated listings, or answer a quick question about AI safety.',
    chips: [
      "I'm new to AI safety",
      'Communities near me',
      "Who's working on AI policy?",
    ],
  },
  {
    path: '/jobs',
    title: 'Jobs',
    purpose:
      "Pursuing a career in AI safety can be one of the most impactful ways to contribute. Many roles don't require technical skills.",
    audience:
      'Career-changers, students, and professionals exploring AI safety roles.',
    greeting:
      'Looking for a role in AI safety? Tell me what kind of work, seniority, or location you want.',
    chips: [
      'Remote technical roles',
      'Policy and governance jobs',
      'Entry-level roles',
      'Jobs for non-technical people',
    ],
  },
  {
    path: '/funding',
    title: 'Funding',
    purpose:
      'These organizations offer financial support to organizations and individuals working on AI safety.',
    audience: 'Researchers, organizers, and founders seeking funding.',
    greeting:
      'Looking for funding? I can match funders by what you do, your stage, and whether they are open to applications.',
    chips: [
      'Funders accepting applications now',
      'Grants for individual researchers',
      'Funding for new orgs',
    ],
  },
  {
    path: '/donation-guide',
    title: 'Donation guide',
    purpose:
      'This guide can help you determine the most effective way to financially support work on AI safety, given the funds and time you have available.',
    audience: 'Donors trying to give effectively.',
    greeting:
      'Want to give to AI safety effectively? Tell me roughly how much you want to donate and how much time you have.',
    chips: [
      'I want to donate a few thousand dollars',
      'Best fund for a small donation',
      'Where do major donors give?',
    ],
  },
  {
    path: '/advisors',
    title: 'Advisors',
    purpose:
      'Connecting with human experts can be invaluable. These advisors offer free guidance calls to help you most effectively contribute to AI safety.',
    audience: 'Anyone looking for human guidance on getting into AI safety.',
    greeting:
      'Want a one-on-one chat with someone in the field? Tell me your focus and I can match you to an advisor.',
    chips: [
      'Talk to a career advisor',
      'Advisors for technical research',
      "I'm not sure how I can contribute",
    ],
  },
  {
    path: '/communities',
    title: 'Communities',
    purpose:
      'There are many groups dedicated to discussing and contributing to AI safety, both online and in-person. We recommend joining a few.',
    audience: 'People wanting to connect with others in AI safety.',
    greeting:
      'Looking for a community? Tell me your platform, focus, or topic and I can find a fit.',
    chips: [
      'Communities near me',
      'Active online discussion groups',
      'Beginner-friendly communities',
    ],
  },
  {
    path: '/self-study',
    title: 'Self-study',
    purpose:
      'These curricula and reading lists enable you to dive deeper into AI safety through independent learning.',
    audience: 'People who want to learn AI safety independently.',
    greeting:
      'Want to learn AI safety on your own? I can suggest a course, curriculum, or reading guide.',
    chips: [
      'Best intro course',
      'Technical alignment curriculum',
      'AI governance reading',
    ],
  },
  {
    path: '/events',
    title: 'Events',
    purpose:
      'Upcoming AI safety events – conferences, hackathons, meetups, talks, and workshops, online and in-person. These can help you meet people in the field and discover opportunities.',
    audience: 'People looking for events to attend.',
    greeting:
      'Looking for an AI safety event? Tell me a topic, a place, or a date and I can find conferences, hackathons, meetups, and more.',
    chips: [
      'Events near me',
      'Online events I can join from anywhere',
      'Conferences I can still register for',
    ],
  },
  {
    path: '/training',
    title: 'Training programs',
    purpose:
      'AI safety training programs – fellowships, facilitated courses, and bootcamps, online and in-person, including recurring programs that run several times a year. A common route into working on AI safety.',
    audience: 'People looking for a structured program to apply to.',
    greeting:
      'Looking for a training program? Tell me your background and how much time you have, and I can find fellowships, courses, and bootcamps you can still apply to.',
    chips: [
      'Programs I can still apply to',
      'Part-time programs I can do alongside work',
      'Programs for beginners',
      'Fellowships with a stipend',
    ],
  },
  {
    path: '/founders',
    title: 'Founder toolkit',
    purpose:
      'Resources for starting and growing an AI safety organization – including incubators, fiscal sponsors, VCs, and practical tools.',
    audience: 'Founders starting AI safety nonprofits or projects.',
    greeting:
      'Starting an AI safety project or org? I can find incubators, fiscal sponsors, and other founder resources.',
    chips: [
      'Incubators I can apply to',
      'Fiscal sponsors',
      "I'm starting an AI safety nonprofit",
    ],
  },
  {
    path: '/projects',
    title: 'Volunteer projects',
    purpose:
      'Initiatives seeking your volunteer help. These projects are focused on supporting and improving the AI safety field.',
    audience: 'People with time to volunteer on AI safety work.',
    greeting:
      'Want to volunteer on AI safety work? I can match you to an active project.',
    chips: [
      'I can code – show me projects',
      'Non-technical ways to volunteer',
      'Projects needing the least time',
    ],
  },
  {
    path: '/media-channels',
    title: 'Media channels',
    purpose:
      'The AI safety space is changing rapidly. These information sources can help you learn more and stay up to date.',
    audience: 'People who want to follow the field.',
    greeting:
      'Want to follow AI safety news and ideas? I can suggest podcasts, newsletters, and blogs.',
    chips: [
      'Best AI safety podcasts',
      'Newsletters to stay up to date',
      'YouTube channels worth following',
    ],
  },
  {
    path: '/map',
    title: 'Field map',
    purpose:
      'An overview of the key organizations, programs, and other resources in the AI safety space – an illustrated map, with a searchable card view of the same listings below it (the "View cards" button scrolls there).',
    audience: 'Anyone who wants a bird-eye view of the ecosystem.',
    greeting:
      'Exploring the AI safety landscape? I can find orgs, projects, media, and more by category or focus.',
    chips: [
      'Alignment research orgs',
      'Advocacy organizations',
      'Blogs and podcasts',
    ],
  },
  {
    path: '/hackathon',
    title: 'Hackathon 2026',
    // The page's copy, essentially verbatim.
    purpose: `The annual AISafety.com hackathon. A four-day, in-person hackathon to improve the AI safety resource hub.
  When: Thursday 17th September – Sunday 20th September 2026.
  Where: CEEALAR (the EA Hotel) in Blackpool, England.
  Cost: Free, including accommodation and all meals. Travel in general isn't covered, but for very strong applicants it may be considered.
  Applications: CLOSED on 14 August 2026 (decisions by 21 August). We may still consider late applications from very strong candidates – the form on this page (asks for name, email, skills/experience, personal links, anything else) still accepts late applications, but no decision or decision date is promised. Don't tell people applications are open or encourage everyone to apply; do say that someone who thinks they'd be a very strong fit is welcome to submit a late application.
  Once a year, the core AISafety.com team gets together with a group of amazing volunteers and spends an extended weekend getting a bunch of stuff done to improve the site. We also do some relaxed fun activities between work sessions.
  Who we're looking for: Product managers and designers – to execute the vision for new projects, build out design mockups, conduct user research, offer consulting, and brainstorm product solutions. Project managers – to lead and organize project efforts and run sprints. Developers – to work with product managers, designers, and AI tools to bring some amazing new things to life. Connectors, people with an audience, and subject-matter experts – to help us with targeted community outreach, general outreach, social media, and to give takes to product managers and designers. Promotion people – to help us spread awareness of the site and each resource page in various ways, maybe including SEO. Anything else – just tell us how you can help!
  On the first day of the hackathon we will divide everyone into small teams by project (the project list: https://app.notion.com/p/15aaef8c3f9640018d6b256d39b4ee8a?pvs=21). Participants will get to decide which projects they work on and in what way they contribute. We're also open to new project suggestions.
  Why it's worth it: build your resume, gain career capital, and make connections (everyone at the EA hotel, beyond just our hackathon, is working on something high-impact – mostly AI safety); have fun beyond just the work – we'll set aside time each day for beach walks, games, etc.; help save the world!
  If you have any questions, please message Bryce on the AISafety.com Discord server at @bryceerobertson, or email bryceerobertson@gmail.com.`,
    audience:
      'Volunteers who want to spend a long weekend improving AISafety.com in person.',
    greeting:
      'Curious about the hackathon? Ask me anything about the event. Applications closed on 14 August, but very strong late applicants may still be considered.',
    chips: [
      'What happens at the hackathon?',
      'Who is the hackathon looking for?',
      'Can I still apply?',
    ],
  },
  {
    path: '/about',
    title: 'About',
    purpose: 'About the AISafety.com team and mission.',
    audience: 'Anyone curious about who runs the site.',
    greeting:
      'What are you looking for? I can point you to jobs, funders, communities, courses, and other curated listings, or answer a quick question about AI safety.',
    chips: ['Who maintains this site?', 'How is this site funded?'],
  },
  {
    path: '/listing-policy',
    title: 'Listing policy',
    purpose:
      'What the site lists on each resource page, and how suggestions are decided.',
    audience:
      'People deciding whether to suggest a listing, or asking why one was declined.',
    greeting:
      'Wondering whether something would be listed? Tell me what it is and which page it fits, and I can check it against the policy.',
    chips: [
      'Would my local group qualify?',
      'Why was my suggestion declined?',
      'What counts as AI safety here?',
    ],
  },
]

export const DEFAULT_GREETING =
  'What are you looking for? I can point you to jobs, funders, communities, courses, and other curated listings, or answer a quick question about AI safety.'

export const DEFAULT_CHIPS = [
  'How do I get started?',
  'I want to donate effectively',
  'I want a job in AI safety',
  "I'm starting an AI safety project",
]

export function findPage(path: string): PageInfo | undefined {
  if (!path) return undefined
  let normalized = path.split('?')[0].split('#')[0]
  // Vercel renders the homepage under its internal alias '/index' during
  // background ISR revalidations (the alias is even reachable as a URL),
  // while the browser always hydrates with '/'. Treating the two differently
  // makes the server pick DEFAULT_CHIPS and the client the homepage chips —
  // a text mismatch that throws hydration error #418 on every homepage load
  // served from such a render.
  if (normalized === '/index') normalized = '/'
  const exact = PAGES.find(p => p.path === normalized)
  if (exact) return exact
  if (normalized === '/') return PAGES.find(p => p.path === '/')
  const prefixMatch = PAGES.filter(
    p => p.path !== '/' && normalized.startsWith(p.path)
  )
  if (prefixMatch.length === 0) return undefined
  return prefixMatch.sort((a, b) => b.path.length - a.path.length)[0]
}

export function chipsFor(path: string): string[] {
  const page = findPage(path)
  return page?.chips ?? DEFAULT_CHIPS
}

export function greetingFor(path: string): string {
  const page = findPage(path)
  return page?.greeting ?? DEFAULT_GREETING
}
