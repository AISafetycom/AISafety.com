// Past news for the press and media page (/media): our own announcements and
// third-party coverage. Newest first on the page (sorted here by date, so the
// order below doesn't matter). Add a line when something new goes out.

export type NewsItem = {
  /** ISO date, e.g. '2026-07-30'. */
  date: string
  /** Where it appeared, e.g. 'EA Forum'. */
  outlet: string
  title: string
  url: string
  /** 'announcement' = written by us; 'coverage' = written about us. */
  kind: 'announcement' | 'coverage'
}

export const NEWS: NewsItem[] = [
  {
    date: '2024-05-17',
    outlet: 'EA Forum',
    title: 'AISafety.com – Resources for AI Safety',
    url: 'https://forum.effectivealtruism.org/posts/LHgk3ptnrCvLegYZ3/aisafety-com-resources-for-ai-safety',
    kind: 'announcement',
  },
  {
    date: '2025-03-04',
    outlet: 'EA Forum',
    title:
      'Top AI safety newsletters, books, podcasts, etc – new AISafety.com resource',
    url: 'https://forum.effectivealtruism.org/posts/wupfzGioFDDLz49aq/top-ai-safety-newsletters-books-podcasts-etc-new-aisafety',
    kind: 'announcement',
  },
  {
    date: '2025-11-05',
    outlet: 'LessWrong',
    title: 'New homepage for AI safety resources – AISafety.com redesign',
    url: 'https://www.lesswrong.com/posts/ciw6DCdywoXk7yrdw/new-homepage-for-ai-safety-resources-aisafety-com-redesign',
    kind: 'announcement',
  },
  {
    date: '2026-01-13',
    outlet: 'AISafety.com Updates',
    title: 'New funding newsletter',
    url: 'https://aisafetycom.substack.com/p/aisafetycom-update-new-funding-newsletter',
    kind: 'announcement',
  },
  {
    date: '2026-04-13',
    outlet: 'AISafety.com Updates',
    title: 'New resource page',
    url: 'https://aisafetycom.substack.com/p/aisafetycom-update-new-resource-page',
    kind: 'announcement',
  },
  {
    date: '2026-06-14',
    outlet: 'AISafety.com Updates',
    title: 'New chatbot',
    url: 'https://aisafetycom.substack.com/p/aisafetycom-update-new-chatbot',
    kind: 'announcement',
  },
  {
    date: '2026-07-30',
    outlet: 'AISafety.com Updates',
    title: 'New Events and Training programs pages',
    url: 'https://aisafetycom.substack.com/p/aisafetycom-update-new-events-and',
    kind: 'announcement',
  },
  {
    date: '2026-08-05',
    outlet: 'EA Forum',
    title: 'See all upcoming AI safety events and training programs',
    url: 'https://forum.effectivealtruism.org/posts/vXZoodvdEgHp8mh96/see-all-upcoming-ai-safety-events-and-training-programs',
    kind: 'announcement',
  },
  // Third-party coverage goes here with kind: 'coverage'. The "Coverage"
  // list only appears on the page once it has entries.
]
