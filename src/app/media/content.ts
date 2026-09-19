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
    text: 'AISafety.com is the resource hub for AI existential safety, run by a small nonprofit that indexes the jobs, funding, training programs, communities, and organizations that make up the field.',
  },
  {
    id: 'full',
    label: 'Full version',
    trackingName: 'full boilerplate',
    text: 'AISafety.com is the resource hub for AI existential safety, indexing the jobs, funding, training programs, communities, and organizations that make up the field. Free and continuously updated, it is run by a small, independent nonprofit that is grant-funded, largely volunteer-driven, and takes no position on any lab or policy. Its goal is to connect people who want to work on AI safety with the right resources, multiplying the field’s efforts by cutting the time it takes to find them. All AISafety.com content is free to reuse under a Creative Commons license. Learn more at aisafety.com/media or contact media@aisafety.com.',
  },
] as const

/** Team members who take press questions: what each can speak to, and a short
 *  bio that can be quoted as is. Photos are the ones on the about page. */
export const PEOPLE = [
  {
    name: 'Bryce Robertson',
    role: 'Project manager',
    photo: '/images/bryce.png',
    speaksTo:
      'How people actually enter the field, career-change paths, and what the jobs and training data shows.',
    bio: 'Bryce Robertson manages AISafety.com. He moved into AI safety from video production after GPT-4’s release, and now spends his time on the question the site exists to answer: How does someone who wants to help actually get started?',
  },
  {
    name: 'Søren Elverlin',
    role: 'Founder, project lead, back-end development',
    photo: '/images/soeren.png',
    speaksTo:
      'The state of the AI safety field, how the ecosystem is organized, and community-building over the last decade.',
    bio: 'Søren Elverlin founded AISafety.com. He bought the domain in 2017 and built the first version of the site. He also founded AI Safety Danmark in 2016 and has run its reading group for more than 300 sessions, making him one of the longer-running community organizers in the field.',
  },
  {
    name: 'Melissa Samworth',
    role: 'Product design, front-end development',
    photo: '/images/melissa.png',
    speaksTo:
      'Making a technical field legible to newcomers, and what people search for and fail to find.',
    bio: 'Melissa Samworth leads product design and front-end development at AISafety.com, which she joined in 2023.',
  },
  {
    name: 'plex',
    role: 'Founder and advisor',
    photo: '/images/plex.png',
    speaksTo: 'The site’s origins and the wider existential-risk landscape.',
    bio: 'plex has worked toward reducing existential risk from AI since 2015, building infrastructure like the original versions of the AISafety.com resources and AISafety.info. He now advises the project while working on other existential-risk efforts.',
  },
] as const

/** The corrections we find ourselves making most often. */
export const COVERAGE_MISTAKES = [
  {
    claim: '“AI safety” is not a position.',
    text: 'It is a field containing people who disagree sharply about timelines, about how serious the risk is, and about what should be done. Quoting one researcher as representing “the AI safety view” is like quoting one economist as representing economics.',
  },
  {
    claim: 'Safety and ethics are not the same community, and not opposed.',
    text: 'Work on existential risk from advanced systems and work on present-day harms (bias, labor, surveillance, environmental cost) have different literatures, funders and conferences. Plenty of people work on both. Framing them as rivals makes a story tidier than the reality.',
  },
  {
    claim: 'A probability estimate is not a measurement.',
    text: 'When a researcher gives a number for the chance of catastrophe, that is a considered personal judgment, not an output of a model. It deserves the same treatment you would give any expert forecast: attribute it, date it, and say what it rests on.',
  },
  {
    claim: 'Being listed here is not an endorsement.',
    text: 'Our directories aim to be comprehensive. Organizations, funders and programs appear because they exist and are relevant, not because we vouch for them. We list groups whose approaches contradict each other.',
  },
  {
    claim: 'Almost nobody in this field wants to “stop AI.”',
    text: 'Positions range from targeted technical work, to specific regulatory asks, to slowing frontier development. “AI safety people want to ban AI” describes very few of the people we index. If you want an accurate spread of views, the field map is the fastest way to see it.',
  },
] as const

/** Where the weekly Press Shots job uploads the screenshots, the zip and
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
