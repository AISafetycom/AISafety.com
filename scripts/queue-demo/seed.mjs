// Made-up Queue rows and listings for the local Queue demo (README.md in
// this folder). Nothing here is real: names, addresses and links are
// invented, and every address is on example.org.
//
// Queue rows are kept by field id, as the site reads them; the listings by
// field name, as the Queue reads a target record.

export const QUEUE = 'tblonlKwIFJ7Aa8QN'
export const EVENTS = 'tblXbN9swwldwq8f7'
export const COMMUNITIES = 'tbluI5Dll697WiSm8'
export const FUNDING = 'tblzMTLDZWZKqTxrq'

// The Queue's field ids (src/lib/admin/queue.ts, F).
export const F = {
  title: 'fldeRsOE3DM3R2vbX',
  type: 'fldBc9YIDhjmu58f3',
  source: 'flddKkVy62MAZ8M0J',
  status: 'fldTXGYOoXcUApaI2',
  page: 'fldAMyLjM8CnXSRPX',
  targetTable: 'fld45SUjstUZROuXl',
  targetRecord: 'fldszXtLdUijgFG4l',
  sourceLink: 'fld4jnmGibDfKUwNx',
  sourceExcerpt: 'fld9VtbNjLpodrtA7',
  sourceText: 'fldBnX1ohCmWuZFc0',
  proposal: 'fldgl9Ny2jnu8T0Da',
  verdict: 'fld835yJytaSRAuvB',
  reasons: 'fldvEp4bscGNzBcSJ',
  rejectChips: 'fldw42wRz08vO5Xzq',
  replyDraft: 'fld8lCAVyjDEVZ8VV',
  rejectDrafts: 'fldPusDzL9nnzibyt',
  decidedAt: 'fldtt7z4lYvAR5t94',
  appliedAt: 'fldML8YnyaDYaAmTb',
  history: 'fldjRsqYJAwR6CXpA',
  forBryce: 'fldWFnmC0u06GNC6B',
}

const text = (name, id) => ({ id, name, type: 'singleLineText' })
const long = (name, id) => ({ id, name, type: 'multilineText' })
const date = (name, id) => ({ id, name, type: 'date' })
const box = (name, id) => ({ id, name, type: 'checkbox' })
const link = (name, id) => ({ id, name, type: 'url' })

/** The base's tables as the meta API lists them: only the columns the
 *  demo's listings use, so these are the only fields the Queue asks for. */
export const SCHEMA = [
  {
    id: EVENTS,
    name: 'Events',
    primaryFieldId: 'fldDemoEvName0001',
    fields: [
      text('Name', 'fldDemoEvName0001'),
      link('URL', 'fldDemoEvUrl00001'),
      long('Description', 'fldDemoEvDesc0001'),
      text('Host name', 'fldDemoEvHost0001'),
      date('Start date', 'fldDemoEvStart001'),
      date('End date', 'fldDemoEvEnd00001'),
      box('Publish?', 'fldDemoEvPub00001'),
      box('Hide?', 'fldDemoEvHide0001'),
    ],
  },
  {
    id: COMMUNITIES,
    name: 'Communities',
    primaryFieldId: 'fldDemoCoName0001',
    fields: [
      text('Name', 'fldDemoCoName0001'),
      link('Link', 'fldDemoCoLink0001'),
      long('Description', 'fldDemoCoDesc0001'),
      box('Publish?', 'fldDemoCoPub00001'),
      box('Hide?', 'fldDemoCoHide0001'),
    ],
  },
  {
    id: FUNDING,
    name: 'Funding',
    primaryFieldId: 'fldDemoFuName0001',
    fields: [
      text('Name', 'fldDemoFuName0001'),
      date('Deadline', 'fldDemoFuDead0001'),
      box('Publish?', 'fldDemoFuPub00001'),
      box('Hide?', 'fldDemoFuHide0001'),
    ],
  },
]

const CHIPS = [
  'Not about AI safety',
  'Already listed',
  'Too small for the site',
]

/** A fresh demo: six items waiting (one of them a change a teammate
 *  proposed in the Fable chat, one a rule from that chat) and one
 *  published earlier today. */
export function seed(now = Date.now()) {
  const iso = ms => new Date(ms).toISOString()
  const day = ms => iso(ms).slice(0, 10)
  const inDays = n => day(now + n * 86_400_000)
  const row = (id, hoursAgo, fields) => [
    id,
    { createdTime: iso(now - hoursAgo * 3_600_000), fields },
  ]
  const unconference = {
    Name: 'Demo: Harbor City AI Safety Unconference',
    URL: 'https://example.org/unconference',
    Description:
      'A one-day unconference for people working on AI safety, with open sessions chosen on the day.',
    'Host name': 'Harbor City AI Safety (demo)',
    'Start date': inDays(20),
    'End date': inDays(20),
  }
  const readingGroup = {
    Name: 'Demo: Evals Reading Group',
    URL: 'https://example.org/evals-reading',
    Description: 'A weekly reading group on model evaluations.',
    'Host name': 'Evals Circle (demo)',
    'Start date': inDays(9),
    'End date': inDays(9),
  }
  const queue = Object.fromEntries([
    row('recDEMOQUEUE00001', 30, {
      [F.title]: unconference.Name,
      [F.type]: 'Add',
      [F.source]: 'Form',
      [F.status]: 'Pending',
      [F.page]: '/events',
      [F.targetTable]: EVENTS,
      [F.targetRecord]: 'recDEMOEVENT00001',
      [F.verdict]: 'Publish',
      [F.reasons]:
        '- Run by a local AI safety group\n- Dates, link and host check out',
      [F.rejectChips]: CHIPS.join('\n'),
      [F.replyDraft]:
        'Hi Sam,\n\nThanks for sending this in. It is now listed at aisafety.com/events.\n\nBest,\nBryce',
      [F.rejectDrafts]: JSON.stringify(
        Object.fromEntries(
          CHIPS.map(c => [
            c,
            `Hi Sam,\n\nThanks for sending this in. It is not one for the site this time (${c.toLowerCase()}).\n\nBest,\nBryce`,
          ])
        )
      ),
      [F.proposal]: JSON.stringify({
        kind: 'add',
        name: unconference.Name,
        url: unconference.URL,
        fields: unconference,
        reply: { to: 'sam.demo@example.org', name: 'Sam Demo' },
      }),
    }),
    row('recDEMOQUEUE00002', 20, {
      [F.title]: 'Demo: Crypto and AI Builders',
      [F.type]: 'Add',
      [F.source]: 'Comb',
      [F.status]: 'Pending',
      [F.page]: '/communities',
      [F.targetTable]: COMMUNITIES,
      [F.targetRecord]: 'recDEMOCOMMUNITY1',
      [F.verdict]: "Don't publish",
      [F.reasons]: '- Mostly about crypto trading, not AI safety',
      [F.rejectChips]: ['Not about AI safety', 'Inactive'].join('\n'),
      [F.sourceExcerpt]: 'Source: a made-up community directory',
      [F.proposal]: JSON.stringify({
        kind: 'add',
        name: 'Demo: Crypto and AI Builders',
        fields: { Name: 'Demo: Crypto and AI Builders' },
      }),
    }),
    row('recDEMOQUEUE00003', 10, {
      [F.title]: 'Demo: Open Alignment Fund: deadline moved',
      [F.type]: 'Change',
      [F.source]: 'Broom',
      [F.status]: 'Pending',
      [F.page]: '/funding',
      [F.targetTable]: FUNDING,
      [F.targetRecord]: 'recDEMOFUNDING001',
      [F.verdict]: 'Fix',
      [F.reasons]: `- The fund's page now gives ${inDays(30)} as the deadline`,
      [F.rejectChips]: ['The old date is right', 'Not the same round'].join(
        '\n'
      ),
      [F.proposal]: JSON.stringify({
        name: 'Demo: Open Alignment Fund',
        changes: [{ field: 'Deadline', from: inDays(14), to: inDays(30) }],
      }),
    }),
    row('recDEMOQUEUE00004', 5, {
      [F.title]: readingGroup.Name,
      [F.type]: 'Add',
      [F.source]: 'Comb',
      [F.status]: 'Pending',
      [F.page]: '/events',
      [F.targetTable]: EVENTS,
      [F.targetRecord]: 'recDEMOEVENT00002',
      [F.verdict]: 'Unsure',
      [F.reasons]: '- Could be a private group; the page does not say',
      [F.rejectChips]: CHIPS.join('\n'),
      // Found in a Slack a teammate may not be in: the post is saved on the
      // row, and Q shows it to anyone but the owner (queue-source.ts).
      [F.sourceExcerpt]:
        'Demo Safety Community (Slack) #events\nhttps://demo-safety.slack.com/archives/C0DEMO0001/p1795550026714199',
      [F.sourceText]:
        "the post · #events\nHi all! We're starting a weekly reading group on model evaluations, open to anyone who has done an intro course. First session in nine days, details and sign-up at https://example.org/evals-reading",
      [F.proposal]: JSON.stringify({
        kind: 'add',
        name: readingGroup.Name,
        fields: readingGroup,
      }),
    }),
    row('recDEMOQUEUE00005', 8, {
      [F.title]: 'Demo: Safety Careers Evening',
      [F.type]: 'Add',
      [F.source]: 'Comb',
      [F.status]: 'Applied',
      [F.page]: '/events',
      [F.targetTable]: EVENTS,
      [F.targetRecord]: 'recDEMOEVENT00003',
      [F.verdict]: 'Publish',
      [F.decidedAt]: iso(now - 2 * 3_600_000),
      [F.appliedAt]: iso(now - 2 * 3_600_000),
      [F.history]: JSON.stringify([
        { at: iso(now - 2 * 3_600_000), by: 'Bryce Demo', did: 'accept' },
      ]),
      [F.proposal]: JSON.stringify({
        kind: 'add',
        name: 'Demo: Safety Careers Evening',
        fields: { Name: 'Demo: Safety Careers Evening' },
      }),
    }),
    // A change to a published listing, proposed in the team's Fable chat
    // (~/Queue/propose_change.py writes this shape: Source "Queue chat",
    // the proposal's `chat` naming who asked and from which item, and the
    // excerpt the reasons alone, with no name or address in it).
    row('recDEMOQUEUE00006', 1, {
      [F.title]: 'Demo: Safety Careers Evening: description',
      [F.type]: 'Change',
      [F.source]: 'Queue chat',
      [F.status]: 'Pending',
      [F.page]: '/events',
      [F.targetTable]: EVENTS,
      [F.targetRecord]: 'recDEMOEVENT00003',
      [F.verdict]: 'Fix',
      [F.reasons]: "- The host's page now says the talks start at 6 pm",
      [F.rejectChips]: ['The description is right', 'Not the same event'].join(
        '\n'
      ),
      [F.sourceExcerpt]: "The host's page now says the talks start at 6 pm.",
      [F.proposal]: JSON.stringify({
        kind: 'change',
        table: EVENTS,
        record: 'recDEMOEVENT00003',
        page: '/events',
        name: 'Demo: Safety Careers Evening',
        changes: [
          {
            field: 'Description',
            from: 'Short talks on AI safety careers, then questions.',
            to: 'Short talks on AI safety careers from 6 pm, then questions.',
          },
        ],
        chat: {
          by: 'Rob Demo',
          email: 'rob.demo@example.org',
          row: 'recDEMOQUEUE00001',
          at: iso(now - 3_600_000),
        },
      }),
    }),
    // A rule proposed in a teammate's Fable chat. It carries the mark that
    // only the owner's own Apply puts it in (`bryce_applies`), so its card
    // is drawn from `edits`, what Apply writes, and the words about them
    // (`summary`, `wording`) are shown only as the chat's own description.
    // Here the two do not quite agree, on purpose: the description speaks
    // of dates, and the edits also add a line about times.
    row('recDEMOQUEUE00007', 2, {
      [F.title]: 'Queue chat lessons: how to write dates',
      [F.type]: 'Rule',
      [F.source]: 'Teach',
      [F.status]: 'Pending',
      [F.rejectChips]: [
        'Not a lesson worth keeping',
        'Say it another way',
      ].join('\n'),
      [F.proposal]: JSON.stringify({
        kind: 'rule',
        file: '~/Queue/chat-lessons.md',
        title: 'How to write dates',
        summary:
          'Write dates in replies as 4 February 2026, never as Feb 4 or 2/4.',
        wording: '- Write dates as 4 February 2026.',
        edits: [
          {
            file: '~/Queue/chat-lessons.md',
            find: '## Replies\n- One line, no greeting.\n',
            replace:
              '## Replies\n- One line, no greeting.\n- Write dates as 4 February 2026, never "Feb 4".\n- Give times with their time zone.\n',
          },
        ],
        bryce_applies: {
          why: 'Proposed in the Queue chat',
          rows: [],
          chat: 'rob.demo@example.org',
          name: 'Rob Demo',
          at: iso(now - 2 * 3_600_000),
        },
      }),
    }),
    row('recDEMOQUEUE00008', 3, {
      [F.title]: 'Demo: Open Alignment Fund: deadline',
      [F.type]: 'Change',
      [F.source]: 'Email',
      [F.status]: 'Pending',
      [F.page]: '/funding',
      [F.targetTable]: FUNDING,
      [F.targetRecord]: 'recDEMOFUNDING001',
      [F.verdict]: 'Fix',
      [F.reasons]: "- The fund's page gives the new deadline",
      [F.rejectChips]: ['The old date is right', 'Not the same round'].join(
        '\n'
      ),
      [F.sourceLink]:
        'https://mail.google.com/mail/?authuser=bryce.demo@example.org#all/1a2b3c4d5e6f7a8b',
      [F.sourceExcerpt]: `Alex Demo, ${inDays(-1)}:\nCould you move our deadline back two weeks? Thanks!`,
      [F.sourceText]: `From: Alex Demo <alex.demo@example.org>\nDate: ${inDays(-1)}\nSubject: Open Alignment Fund deadline\n\nHi Bryce,\n\nCould you move our deadline back two weeks? The new date is on our page.\n\nThanks!\nAlex`,
      [F.proposal]: JSON.stringify({
        kind: 'change',
        table: FUNDING,
        record: 'recDEMOFUNDING001',
        page: '/funding',
        name: 'Demo: Open Alignment Fund',
        changes: [{ field: 'Deadline', from: inDays(14), to: inDays(28) }],
        reply: { to: 'alex.demo@example.org', name: 'Alex Demo' },
      }),
    }),
  ])
  const records = {
    [EVENTS]: {
      recDEMOEVENT00001: unconference,
      recDEMOEVENT00002: readingGroup,
      recDEMOEVENT00003: {
        Name: 'Demo: Safety Careers Evening',
        URL: 'https://example.org/careers-evening',
        Description: 'Short talks on AI safety careers, then questions.',
        'Host name': 'Careers Club (demo)',
        'Start date': inDays(5),
        'End date': inDays(5),
        'Publish?': true,
      },
    },
    [COMMUNITIES]: {
      recDEMOCOMMUNITY1: {
        Name: 'Demo: Crypto and AI Builders',
        Link: 'https://example.org/crypto-ai',
        Description: 'A chat for people building trading bots.',
      },
    },
    [FUNDING]: {
      recDEMOFUNDING001: {
        Name: 'Demo: Open Alignment Fund',
        Deadline: inDays(14),
        'Publish?': true,
      },
    },
  }
  return { queue, records }
}

/** The two people the demo signs in as: one who decides, and one whose
 *  decisions are checked first. Neither is a real account. */
export const DEMO_USERS = [
  {
    email: 'bryce.demo@example.org',
    name: 'Bryce Demo',
    access: { queue: 'edit', manageUsers: 'edit' },
  },
  {
    email: 'rob.demo@example.org',
    name: 'Rob Demo',
    access: { queue: 'suggest' },
  },
]
