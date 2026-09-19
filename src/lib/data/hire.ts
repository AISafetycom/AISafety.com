// MOCK DATA — there is no "Candidates" Airtable table yet. This file stands
// in for one: `getCandidates()` has the same async signature every other
// `src/lib/data/*.ts` file exposes (see getJobs() in ./jobs.ts), so once a
// real table exists, only this file's body needs to change — every caller
// (the /hire page, the assistant catalog, the nav count) stays the same.
// When that table exists, follow the pattern in ./jobs.ts: a permanent
// FIELD map of Airtable field IDs, `returnFieldsByFieldId`, and
// `publishedFormula` (or a dedicated view) to select only live rows.

export type ProjectStatus = 'Current' | 'Active' | 'Debrief' | 'Completed'
export type ProjectRole = 'Project lead' | 'Project member' | 'Project advisor'

export interface CandidateProjectArtifact {
  /** Short label shown on the link, e.g. "Repo", "Report", "Write-up". */
  label: string
  url: string
}

export interface CandidateProject {
  id: string
  title: string
  status: ProjectStatus
  role: ProjectRole
  /** Categories of work this person is directly responsible for on the
   *  project, e.g. "Coding", "Research", "Writing". */
  categories: string[]
  /** YYYY-MM-DD the person joined the project. */
  joinedDate: string
  /** Set when the person left before the project wrapped, or the project
   *  itself was cancelled while they were on it. Absent for a normal
   *  current/completed run. */
  endedReason?: 'Left' | 'Cancelled'
  artifacts: CandidateProjectArtifact[]
}

export interface CandidateAvailability {
  /** Display label, e.g. "UTC+1 · Europe/London". */
  timezone: string
  maxConcurrentProjects: 1 | 2 | 3 | 4
  maxHoursPerWeek: number
  /** Whether they currently have open capacity (fewer active projects than
   *  maxConcurrentProjects). Drives the "Available now" filter. */
  hasCapacity: boolean
}

export interface CandidateLinks {
  linkedin?: string
  x?: string
  github?: string
  website?: string
}

/** Known focus areas, for the filter's option list. A candidate can carry
 *  any string here — this const only seeds the checkboxes with a sensible,
 *  ordered default set instead of whatever order Object.keys happens to
 *  return. */
export const KNOWN_FOCUS_AREAS = [
  'Interpretability',
  'Evals',
  'Agent safety',
  'Alignment theory',
  'Governance',
  'Security',
  'Biosecurity',
] as const

export interface Candidate {
  id: string
  name: string
  handle: string
  /** Initials shown in the avatar circle — there are no real photos in mock
   *  data (the real field is "photo from LinkedIn, or initials placeholder"). */
  avatarInitials: string
  /** Display label, e.g. "London, UK". */
  locationLabel: string
  /** Country only, for the Location filter. */
  country: string
  interests: string
  focusAreas: string[]
  /** Up to ~1000 characters, per the field spec. */
  wantToWorkOn: string
  links: CandidateLinks
  projects: CandidateProject[]
  openToFullTime: boolean
  availability: CandidateAvailability
  // Internal reliability signal ("flake tag") — captured for future
  // admin/internal use only. Deliberately NOT read by CandidateCard or the
  // assistant catalog: the site has no vetted taxonomy or public framing for
  // it yet, and showing an unreviewed reliability label on someone's public
  // profile would be a real harm if wrong. Flagged in the PR for Bryce/
  // Melissa rather than silently wired up.
  flakeTag?: string
}

const CANDIDATES: Candidate[] = [
  {
    id: 'priya-natarajan',
    name: 'Priya Natarajan',
    handle: '@priyanat',
    avatarInitials: 'PN',
    locationLabel: 'London, UK',
    country: 'UK',
    interests:
      'Evaluating deceptive behaviour in frontier models, and interpretability tooling that non-experts can actually use.',
    focusAreas: ['Evals', 'Interpretability'],
    wantToWorkOn:
      'Evaluations that actually change deployment decisions: sandbagging, situational awareness and agentic misuse. Ideally with a team that ships open-source tooling and publishes negative results. I would also join a small control or monitoring project as an engineer if it has a clear path to a write-up, and I am happy to pair with people newer to the field.',
    links: {
      linkedin: 'https://www.linkedin.com/in/priyanatarajan',
      x: 'https://x.com/priyanat',
      github: 'https://github.com/priyanat',
      website: 'https://priya.dev',
    },
    projects: [
      {
        id: 'monitor-in-the-loop',
        title: 'Monitor-in-the-loop demo',
        status: 'Current',
        role: 'Project member',
        categories: ['Research', 'Coding'],
        joinedDate: '2026-07-01',
        artifacts: [
          {
            label: 'Repo',
            url: 'https://github.com/example/monitor-in-the-loop',
          },
        ],
      },
      {
        id: 'agentic-eval-taxonomy',
        title: 'Agentic eval taxonomy',
        status: 'Completed',
        role: 'Project advisor',
        categories: ['Research', 'Writing'],
        joinedDate: '2026-05-01',
        artifacts: [
          {
            label: 'Report',
            url: 'https://example.com/reports/agentic-eval-taxonomy',
          },
          {
            label: 'Write-up',
            url: 'https://example.com/writeups/agentic-eval-taxonomy',
          },
        ],
      },
    ],
    openToFullTime: true,
    availability: {
      timezone: 'UTC+1 · Europe/London',
      maxConcurrentProjects: 2,
      maxHoursPerWeek: 15,
      hasCapacity: true,
    },
  },
  {
    id: 'daniel-osei',
    name: 'Daniel Osei',
    handle: '@daniel_osei',
    avatarInitials: 'DO',
    locationLabel: 'Accra, Ghana',
    country: 'Ghana',
    interests:
      'AI governance and compute-governance policy, with a focus on how emerging-market regulators can engage with frontier labs.',
    focusAreas: ['Governance'],
    wantToWorkOn:
      'A full-time policy role at an org that talks directly to regulators, or a research project mapping compute-governance options for governments outside the US/EU/China. Open to remote work with an existing team.',
    links: {
      linkedin: 'https://www.linkedin.com/in/danielosei',
      website: 'https://danielosei.org',
    },
    projects: [
      {
        id: 'compute-governance-map',
        title: 'Compute governance options for emerging regulators',
        status: 'Active',
        role: 'Project lead',
        categories: ['Research', 'Policy'],
        joinedDate: '2026-03-15',
        artifacts: [
          {
            label: 'Report',
            url: 'https://example.com/reports/compute-governance-map',
          },
        ],
      },
    ],
    openToFullTime: true,
    availability: {
      timezone: 'UTC+0 · Africa/Accra',
      maxConcurrentProjects: 1,
      maxHoursPerWeek: 40,
      hasCapacity: true,
    },
  },
  {
    id: 'mei-lin-chen',
    name: 'Mei-Lin Chen',
    handle: '@meilinchen',
    avatarInitials: 'MC',
    locationLabel: 'Toronto, Canada',
    country: 'Canada',
    interests:
      'Mechanistic interpretability of vision-language models, and building shared tooling for the interpretability community.',
    focusAreas: ['Interpretability', 'Alignment theory'],
    wantToWorkOn:
      'Open problems in circuit-level interpretability of multimodal models. Keen to keep contributing to open-source interpretability tooling part-time alongside a PhD.',
    links: {
      github: 'https://github.com/meilinchen',
      x: 'https://x.com/meilinchen',
    },
    projects: [
      {
        id: 'sae-feature-browser',
        title: 'SAE feature browser',
        status: 'Current',
        role: 'Project lead',
        categories: ['Coding', 'Research'],
        joinedDate: '2026-04-10',
        artifacts: [
          {
            label: 'Repo',
            url: 'https://github.com/example/sae-feature-browser',
          },
        ],
      },
      {
        id: 'circuit-tracing-workshop',
        title: 'Circuit tracing workshop materials',
        status: 'Completed',
        role: 'Project member',
        categories: ['Writing'],
        joinedDate: '2026-01-20',
        artifacts: [
          {
            label: 'Write-up',
            url: 'https://example.com/writeups/circuit-tracing-workshop',
          },
        ],
      },
    ],
    openToFullTime: false,
    availability: {
      timezone: 'UTC-5 · America/Toronto',
      maxConcurrentProjects: 1,
      maxHoursPerWeek: 10,
      hasCapacity: false,
    },
  },
  {
    id: 'oskar-lindqvist',
    name: 'Oskar Lindqvist',
    handle: '@oskarlind',
    avatarInitials: 'OL',
    locationLabel: 'Stockholm, Sweden',
    country: 'Sweden',
    interests:
      'Red-teaming agentic systems and building infrastructure-security tooling for AI labs.',
    focusAreas: ['Security', 'Agent safety'],
    wantToWorkOn:
      'Security engineering for a lab or third-party evaluator: sandboxing, exfiltration testing, and hardening agent scaffolds against prompt injection. Full-time, in-person preferred but open to remote.',
    links: {
      linkedin: 'https://www.linkedin.com/in/oskarlindqvist',
      github: 'https://github.com/oskarlind',
    },
    projects: [
      {
        id: 'agent-sandbox-hardening',
        title: 'Agent sandbox hardening',
        status: 'Current',
        role: 'Project lead',
        categories: ['Coding', 'Security'],
        joinedDate: '2026-06-01',
        artifacts: [
          {
            label: 'Repo',
            url: 'https://github.com/example/agent-sandbox-hardening',
          },
        ],
      },
    ],
    openToFullTime: true,
    availability: {
      timezone: 'UTC+1 · Europe/Stockholm',
      maxConcurrentProjects: 2,
      maxHoursPerWeek: 40,
      hasCapacity: true,
    },
  },
  {
    id: 'ananya-rao',
    name: 'Ananya Rao',
    handle: '@ananya_r',
    avatarInitials: 'AR',
    locationLabel: 'Bengaluru, India',
    country: 'India',
    interests:
      'Biosecurity risk assessment for AI-assisted biological design tools, and dual-use research review processes.',
    focusAreas: ['Biosecurity', 'Governance'],
    wantToWorkOn:
      'Research or policy work on screening AI-assisted bio-design tools for misuse potential. Comfortable leading a small research project or joining a larger one as a subject-matter contributor.',
    links: {
      linkedin: 'https://www.linkedin.com/in/ananyarao',
      website: 'https://ananyarao.com',
    },
    projects: [
      {
        id: 'bio-design-screening-review',
        title: 'Screening review for AI-assisted bio-design tools',
        status: 'Debrief',
        role: 'Project lead',
        categories: ['Research', 'Writing'],
        joinedDate: '2026-02-01',
        artifacts: [
          {
            label: 'Report',
            url: 'https://example.com/reports/bio-design-screening-review',
          },
        ],
      },
    ],
    openToFullTime: false,
    availability: {
      timezone: 'UTC+5:30 · Asia/Kolkata',
      maxConcurrentProjects: 1,
      maxHoursPerWeek: 12,
      hasCapacity: true,
    },
  },
  {
    id: 'lucas-ferreira',
    name: 'Lucas Ferreira',
    handle: '@lucasf',
    avatarInitials: 'LF',
    locationLabel: 'São Paulo, Brazil',
    country: 'Brazil',
    interests:
      'Formal verification approaches to alignment theory, and translating theoretical results into empirically testable claims.',
    focusAreas: ['Alignment theory'],
    wantToWorkOn:
      'Theoretical research connecting formal verification to alignment guarantees for learned systems. Open to a research assistant or collaborator role, part-time alongside independent study.',
    links: {
      github: 'https://github.com/lucasferreira',
      x: 'https://x.com/lucasf',
    },
    projects: [
      {
        id: 'verification-alignment-survey',
        title: 'Formal verification for alignment: a survey',
        status: 'Completed',
        role: 'Project member',
        categories: ['Research', 'Writing'],
        joinedDate: '2025-11-01',
        endedReason: 'Left',
        artifacts: [
          {
            label: 'Write-up',
            url: 'https://example.com/writeups/verification-alignment-survey',
          },
        ],
      },
    ],
    openToFullTime: false,
    availability: {
      timezone: 'UTC-3 · America/Sao_Paulo',
      maxConcurrentProjects: 1,
      maxHoursPerWeek: 8,
      hasCapacity: true,
    },
  },
  {
    id: 'hannah-becker',
    name: 'Hannah Becker',
    handle: '@hbecker',
    avatarInitials: 'HB',
    locationLabel: 'Berlin, Germany',
    country: 'Germany',
    interests:
      'Evals engineering for agentic coding assistants, and building shared benchmark infrastructure.',
    focusAreas: ['Evals', 'Agent safety'],
    wantToWorkOn:
      'Engineering-heavy eval work: building and maintaining benchmark harnesses, especially for agentic and tool-use settings. Full-time, remote or Berlin-based.',
    links: {
      linkedin: 'https://www.linkedin.com/in/hannahbecker',
      github: 'https://github.com/hbecker',
      website: 'https://hannahbecker.dev',
    },
    projects: [
      {
        id: 'agentic-coding-benchmark',
        title: 'Agentic coding benchmark harness',
        status: 'Current',
        role: 'Project lead',
        categories: ['Coding', 'Research'],
        joinedDate: '2026-05-20',
        artifacts: [
          {
            label: 'Repo',
            url: 'https://github.com/example/agentic-coding-benchmark',
          },
        ],
      },
      {
        id: 'tool-use-eval-suite',
        title: 'Tool-use eval suite',
        status: 'Completed',
        role: 'Project member',
        categories: ['Coding'],
        joinedDate: '2026-01-05',
        artifacts: [
          {
            label: 'Repo',
            url: 'https://github.com/example/tool-use-eval-suite',
          },
        ],
      },
    ],
    openToFullTime: true,
    availability: {
      timezone: 'UTC+1 · Europe/Berlin',
      maxConcurrentProjects: 2,
      maxHoursPerWeek: 40,
      hasCapacity: false,
    },
  },
  {
    id: 'james-whitfield',
    name: 'James Whitfield',
    handle: '@jwhitfield',
    avatarInitials: 'JW',
    locationLabel: 'Sydney, Australia',
    country: 'Australia',
    interests:
      'Advocacy and public communication on frontier AI risk, translating technical findings for policymakers and journalists.',
    focusAreas: ['Governance'],
    wantToWorkOn:
      'A communications or policy-adjacent role helping an org explain its research to non-technical audiences. Open to full-time or a substantial part-time commitment.',
    links: {
      linkedin: 'https://www.linkedin.com/in/jameswhitfield',
      x: 'https://x.com/jwhitfield',
    },
    projects: [
      {
        id: 'policy-explainer-series',
        title: 'Policy explainer series',
        status: 'Active',
        role: 'Project advisor',
        categories: ['Writing'],
        joinedDate: '2026-04-01',
        artifacts: [
          {
            label: 'Write-up',
            url: 'https://example.com/writeups/policy-explainer-series',
          },
        ],
      },
    ],
    openToFullTime: true,
    availability: {
      timezone: 'UTC+10 · Australia/Sydney',
      maxConcurrentProjects: 2,
      maxHoursPerWeek: 25,
      hasCapacity: true,
    },
  },
  {
    id: 'fatima-al-sayed',
    name: 'Fatima Al-Sayed',
    handle: '@fatimaalsayed',
    avatarInitials: 'FA',
    locationLabel: 'Dubai, UAE',
    country: 'UAE',
    interests:
      'Applied interpretability for language model safety classifiers, and reducing false positives in deployed content-safety systems.',
    focusAreas: ['Interpretability', 'Evals'],
    wantToWorkOn:
      'Hands-on engineering work improving the reliability of safety classifiers used in production. Interested in a research-engineer role, full-time.',
    links: {
      linkedin: 'https://www.linkedin.com/in/fatimaalsayed',
      github: 'https://github.com/fatimaalsayed',
    },
    projects: [
      {
        id: 'classifier-reliability-audit',
        title: 'Safety classifier reliability audit',
        status: 'Current',
        role: 'Project member',
        categories: ['Research', 'Coding'],
        joinedDate: '2026-06-15',
        artifacts: [
          {
            label: 'Report',
            url: 'https://example.com/reports/classifier-reliability-audit',
          },
        ],
      },
    ],
    openToFullTime: true,
    availability: {
      timezone: 'UTC+4 · Asia/Dubai',
      maxConcurrentProjects: 1,
      maxHoursPerWeek: 40,
      hasCapacity: true,
    },
  },
  {
    id: 'noah-kim',
    name: 'Noah Kim',
    handle: '@noahkim',
    avatarInitials: 'NK',
    locationLabel: 'Seoul, South Korea',
    country: 'South Korea',
    interests:
      'Agent safety evaluations for multi-agent systems, and open-source scaffolding for reproducible agent benchmarks.',
    focusAreas: ['Agent safety', 'Evals'],
    wantToWorkOn:
      'Building reproducible multi-agent eval environments. Would join an existing project as an engineer or lead a small one with a clear scope.',
    links: {
      github: 'https://github.com/noahkim',
      website: 'https://noahkim.dev',
    },
    projects: [
      {
        id: 'multi-agent-eval-env',
        title: 'Multi-agent eval environment',
        status: 'Active',
        role: 'Project lead',
        categories: ['Coding', 'Research'],
        joinedDate: '2026-03-01',
        artifacts: [
          {
            label: 'Repo',
            url: 'https://github.com/example/multi-agent-eval-env',
          },
        ],
      },
      {
        id: 'scaffold-cancelled',
        title: 'Shared agent scaffold library',
        status: 'Completed',
        role: 'Project member',
        categories: ['Coding'],
        joinedDate: '2025-10-01',
        endedReason: 'Cancelled',
        artifacts: [],
      },
    ],
    openToFullTime: false,
    availability: {
      timezone: 'UTC+9 · Asia/Seoul',
      maxConcurrentProjects: 2,
      maxHoursPerWeek: 20,
      hasCapacity: true,
    },
  },
]

export async function getCandidates(): Promise<Candidate[]> {
  return CANDIDATES
}
