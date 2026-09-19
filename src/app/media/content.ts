// Copy for the press and media page (/media), kept apart from the layout so
// the words can be edited without touching JSX. Drafted by Rachel Novosad,
// September 2026. American English, like the rest of the site.

/** The press inbox. Shown as a real mailto: link so reporters can copy it. */
export const PRESS_EMAIL = 'media@aisafety.com'

/** Boilerplate, meant to be pasted without editing. The page works out each
 *  word count itself, so it can't go stale when the text changes. */
export const BOILERPLATE = [
  {
    id: 'one-line',
    label: 'One-line version',
    trackingName: 'one-line boilerplate',
    text: 'AISafety.com is a nonprofit-driven resource hub for AI existential safety that aggregates the events, training programs, jobs, funders, organizations, and communities that make up the field.',
  },
  {
    id: 'full',
    label: 'Full version',
    trackingName: 'full boilerplate',
    text: 'AISafety.com is the centralized resource hub for AI existential safety that aggregates the events, training programs, jobs, funders, organizations, and communities that make up the field. Free and continuously updated, it is run as a small, independent nonprofit project that is grant-funded and volunteer-supported. Its goal is to connect people who want to work on AI safety with the right resources, multiplying the field’s efforts by cutting the time it takes to discover them. All AISafety.com content is free to reuse under a Creative Commons license. Learn more at aisafety.com/media or contact media@aisafety.com.',
  },
] as const

/** The media contacts: a short bio that can be quoted as is, and what each
 *  can speak to. In the about page's order, with its photos. The rest of the
 *  team is on the about page, which the section links to. */
export const PEOPLE: {
  name: string
  role: string
  photo: string
  bio: string
  speaksTo?: string
}[] = [
  {
    name: 'Søren Elverlin',
    role: 'Founder, project lead, back-end development',
    photo: '/images/soeren.png',
    bio: 'Søren Elverlin founded AISafety.com. He bought the domain in 2017 and built the first version of the site. He also founded AI Safety Danmark in 2016, leads PauseAI Denmark, and has run the AISafety.com reading group for more than 340 sessions, making him one of the longer-running community organizers in the field.',
    speaksTo:
      'The arguments for and against AI existential risk, AI safety in Denmark and the Nordics, the case for pausing frontier AI development.',
  },
  {
    name: 'Bryce Robertson',
    role: 'Project manager',
    photo: '/images/bryce.png',
    bio: 'Bryce Robertson manages AISafety.com, maintaining the database of AI safety resources and running the corresponding newsletters. He moved into AI safety from video production after GPT-4’s release, and now spends his time on the question the site exists to answer: How does someone who wants to help actually get started?',
    speaksTo:
      'Typical paths people follow when entering the field, problems faced by newcomers.',
  },
]

/** Where to send object-level questions about AI risk. `url` is stored clean;
 *  the page adds the site's UTM tags when it renders the link. */
export const RECOMMENDED_ORGANIZATIONS = [
  {
    name: 'International AI Safety Report',
    url: 'https://internationalaisafetyreport.org',
    note: 'expert consensus overview of AI capabilities and risks.',
  },
  {
    name: 'Future of Life Institute',
    url: 'https://futureoflife.org',
    note: 'established nonprofit with wide coverage of AI risk and policy.',
  },
  {
    name: 'Center for AI Safety',
    url: 'https://safe.ai/about/media',
    note: 'research nonprofit with a dedicated media page. It organized the 2023 extinction risk statement.',
  },
  {
    name: 'ControlAI',
    url: 'https://controlai.com',
    note: 'focused on policymakers and legislation, especially in the UK and US.',
  },
  {
    name: 'PauseAI',
    url: 'https://pauseai.info',
    note: 'grassroots movement with national chapters and local spokespeople.',
  },
  {
    name: 'AISafety.info',
    url: 'https://aisafety.info',
    note: 'plain-language answers to several hundred common questions about AI risk.',
  },
  {
    name: 'UK AISI',
    before: 'National AI Safety / Security Institutes, for example the ',
    url: 'https://www.aisi.gov.uk',
    note: 'government evaluation bodies, best suited to journalists covering a national angle.',
  },
  {
    name: 'AISafety.com field map',
    url: '/map',
    note: 'for everything else.',
  },
] as const

/** Where the weekly Media Shots job uploads the screenshots, the zip and
 *  manifest.json (docs/architecture.md, "Press kit"). Public files at fixed
 *  addresses in the site's Vercel Blob store, so a refresh needs no deploy.
 *  The logos never change, so they live in public/press. */
export const PRESS_BLOB =
  'https://vfnmdozpctvdobh7.public.blob.vercel-storage.com/press'

/** `?download=1` makes Blob serve it as a download rather than in the tab. */
export const PRESS_KIT_ZIP = `${PRESS_BLOB}/aisafety-com-press-kit.zip?download=1`

export const LOGOS = [
  {
    id: 'teal',
    label: 'Teal wordmark',
    note: 'As used on the site',
    svg: '/press/aisafety-com-logo-teal.svg',
    png: '/press/aisafety-com-logo-teal.png',
    on: 'dark',
  },
  {
    id: 'white',
    label: 'White wordmark',
    note: 'For dark backgrounds',
    svg: '/press/aisafety-com-logo-white.svg',
    png: '/press/aisafety-com-logo-white.png',
    on: 'dark',
  },
  {
    id: 'black',
    label: 'Black wordmark',
    note: 'For light backgrounds',
    svg: '/press/aisafety-com-logo-black.svg',
    png: '/press/aisafety-com-logo-black.png',
    on: 'light',
  },
  {
    id: 'square',
    label: 'Square tile',
    note: 'Wordmark on our dark teal, 1522 × 1522',
    png: '/press/aisafety-com-logo-square-dark.png',
    on: 'tile',
  },
  {
    id: 'rectangle',
    label: 'Rectangle tile',
    note: 'Wordmark on our dark teal, 1790 × 880',
    png: '/press/aisafety-com-logo-rectangle-dark.png',
    on: 'tile',
  },
] as const

/** `file` is the full 2880 x 1800 PNG, `thumb` the 1440 x 900 JPEG shown on
 *  the page. Both are re-shot from the live site every week. */
export const SCREENSHOTS = [
  {
    id: 'field-map',
    label: 'Field map',
    file: `${PRESS_BLOB}/aisafety-com-screenshot-field-map.png`,
    thumb: `${PRESS_BLOB}/aisafety-com-screenshot-field-map-thumb.jpg`,
  },
  {
    id: 'home',
    label: 'Homepage',
    file: `${PRESS_BLOB}/aisafety-com-screenshot-home.png`,
    thumb: `${PRESS_BLOB}/aisafety-com-screenshot-home-thumb.jpg`,
  },
  {
    id: 'jobs',
    label: 'Jobs board',
    file: `${PRESS_BLOB}/aisafety-com-screenshot-jobs.png`,
    thumb: `${PRESS_BLOB}/aisafety-com-screenshot-jobs-thumb.jpg`,
  },
] as const
