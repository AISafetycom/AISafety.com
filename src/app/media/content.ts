// Copy for the press and media page (/media), kept apart from the layout so
// the words can be edited without touching JSX. Drafted by Rachel Novosad,
// September 2026. American English, like the rest of the site.

/** The press inbox. Shown as a real mailto: link so reporters can copy it. */
export const PRESS_EMAIL = 'media@aisafety.com'

/** Boilerplate in three lengths, each meant to be pasted without editing. */
export const BOILERPLATE = [
  {
    id: 'one-line',
    label: 'One line',
    words: 25,
    text: 'AISafety.com is a nonprofit resource hub for AI existential safety, indexing the jobs, funding, training programs, communities and research that make up the field.',
  },
  {
    id: 'short',
    label: 'Short',
    words: 50,
    text: 'AISafety.com is a nonprofit resource hub for AI existential safety. It maintains free, continuously updated directories of jobs, funding sources, training programs, events, communities and organizations working to reduce risks from advanced AI, so that people who want to contribute can find where they fit.',
  },
  {
    id: 'long',
    label: 'Long',
    words: 100,
    text: 'AISafety.com is a nonprofit resource hub for AI existential safety, run by a small salaried team and a network of volunteer community-builders. It maintains free, continuously updated directories covering the field: open jobs, funding sources, training programs and fellowships, events, online and local communities, self-study materials, and a map of the organizations doing the work. The goal is to multiply global AI safety effort by removing the search cost: a researcher, engineer, policy specialist or funder should be able to find their next step in one place rather than across a hundred scattered forms, Slack channels and application deadlines.',
  },
] as const

/** Team members who take press questions, with what each can speak to.
 *  Photos are the ones on the about page. */
export const PEOPLE = [
  {
    name: 'Søren Elverlin',
    role: 'Founder, project lead, back-end development',
    photo: '/images/soeren.png',
    speaksTo:
      'The state of the AI safety field, how the ecosystem is organized, and community-building over the last decade. He founded AI Safety Danmark in 2016 and has run its reading group for more than 300 sessions.',
  },
  {
    name: 'Bryce Robertson',
    role: 'Project manager',
    photo: '/images/bryce.png',
    speaksTo:
      'How people actually enter the field, career-change paths, and what the jobs and training data shows. He moved into AI safety from video production after the release of GPT-4.',
  },
  {
    name: 'Melissa Samworth',
    role: 'Product design, front-end development',
    photo: '/images/melissa.png',
    speaksTo:
      'Making a technical field legible to newcomers, and what people search for and fail to find. She joined AISafety.com in 2023.',
  },
  {
    name: 'plex',
    role: 'Founder and advisor',
    photo: '/images/plex.png',
    speaksTo:
      'The site’s origins and the wider existential-risk landscape. He has worked on reducing existential risk from AI since 2015, building the original versions of the AISafety.com resources and AISafety.info.',
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

/** Files in public/press. The zip holds all of them. */
export const PRESS_KIT_ZIP = '/press/aisafety-com-press-kit.zip'

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

export const SCREENSHOTS = [
  {
    id: 'field-map',
    label: 'Field map',
    file: '/press/aisafety-com-screenshot-field-map.png',
  },
  {
    id: 'home',
    label: 'Homepage',
    file: '/press/aisafety-com-screenshot-home.png',
  },
  {
    id: 'jobs',
    label: 'Jobs board',
    file: '/press/aisafety-com-screenshot-jobs.png',
  },
] as const
