// Question-theme summaries for the admin analytics dashboard.
//
// Exact-text grouping works for suggested chips (many people click the same
// chip) but typed questions almost never repeat word-for-word, so "what do
// people usually ask?" needs semantic grouping. refreshQuestionThemes() sends
// every typed first question to Claude, which sorts them into a handful of
// themes; the result is stored (Redis in prod, a dev file locally) and the
// dashboard just reads the latest stored summary. Refresh runs weekly via a
// Vercel cron and on demand from the dashboard's owner-only Refresh button —
// never on page load, so viewing the dashboard costs no API tokens.

import Anthropic from '@anthropic-ai/sdk'
import { Redis } from '@upstash/redis'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_MODEL_ID, outputConfig } from '@/lib/assistant/models'
import { listTypedQuestions } from './conversations'

export interface QuestionTheme {
  name: string
  count: number
  /** Up to three verbatim questions, so each theme is concrete. */
  examples: string[]
}

export interface ThemeSummary {
  generatedAt: string
  /** How many typed questions the themes cover. */
  totalQuestions: number
  themes: QuestionTheme[]
}

const KEY = 'aisafety:analytics:question-themes'

// Same env fallback chain as the event store, so both live in one database.
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

const DEV_FILE = path.join(process.cwd(), '.analytics-dev', 'themes.json')

/** The latest stored summary, or null when none has been generated yet (or
 *  the store can't be read — the dashboard treats both as "not yet"). */
export async function readQuestionThemes(): Promise<ThemeSummary | null> {
  try {
    if (store) return await store.get<ThemeSummary>(KEY)
    return JSON.parse(await fs.readFile(DEV_FILE, 'utf8')) as ThemeSummary
  } catch (err) {
    // Missing dev file just means nothing generated yet; only real read
    // failures are worth a warning.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        `[analytics] theme read failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    return null
  }
}

async function storeSummary(summary: ThemeSummary): Promise<void> {
  if (store) {
    await store.set(KEY, summary)
    return
  }
  await fs.mkdir(path.dirname(DEV_FILE), { recursive: true })
  await fs.writeFile(DEV_FILE, JSON.stringify(summary, null, 2), 'utf8')
}

// The latest Opus — Bryce wants the best grouping quality, and a weekly call
// over a few hundred short questions costs cents even on the top model.
// Anthropic offers no auto-updating "latest Opus" alias, so this tracks the
// chatbot's default model (kept on the newest Opus): one bump upgrades both.
const MODEL = DEFAULT_MODEL_ID
// Far above organic volume (~130 conversations in month one). If the log ever
// outgrows it, the newest questions win and the truncation is logged.
const MAX_QUESTIONS = 800

/** What Claude must return: every question index in exactly one theme. */
interface ClaudeThemes {
  themes: { name: string; questions: number[] }[]
}

function parseClaudeJson(text: string): ClaudeThemes {
  // Tolerate a fenced reply; anything else unparseable should fail loudly.
  const bare = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const parsed = JSON.parse(bare) as ClaudeThemes
  if (!Array.isArray(parsed.themes)) {
    throw new Error('Claude reply has no themes array')
  }
  return parsed
}

async function themeWithClaude(questions: string[]): Promise<QuestionTheme[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const list = questions
    .map((q, i) => `${i}. ${q.replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n')
  const prompt = `Here are ${questions.length} first messages that visitors typed to the chatbot on AISafety.com, a resource hub for the AI safety field (numbered, one per line):

${list}

Group every message into 4 to 10 themes by what the visitor is trying to do (for example: finding a job, getting started in the field, finding funding, testing the bot). Rules:
- Every message number must appear in exactly one theme.
- Theme names: at most 4 words, plain American English.
- Use a final "Other" theme only for messages that genuinely fit nowhere.

Reply with ONLY this JSON, no other text:
{"themes":[{"name":"Theme name","questions":[0,4,17]}]}`

  const response = await client.messages.create({
    model: MODEL,
    // Opus 5.5 thinks before answering out of this same budget, and the JSON
    // for 800 questions is a few thousand tokens on its own — 4000 risked a
    // truncated reply that would fail the JSON parse.
    max_tokens: 16000,
    // Nobody is waiting on this weekly call, so it gets high effort for the
    // best grouping (Opus 5.5 would otherwise default to medium).
    output_config: outputConfig(MODEL, 'high'),
    messages: [{ role: 'user', content: prompt }],
  })
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
  const parsed = parseClaudeJson(text)

  // Trust the grouping, not the bookkeeping: indexes are validated here, each
  // question counts once (first claim wins), and anything Claude missed lands
  // in Other — so the theme counts always sum to the question count.
  const assigned = new Set<number>()
  const themes: QuestionTheme[] = []
  for (const t of parsed.themes) {
    if (typeof t.name !== 'string' || !Array.isArray(t.questions)) continue
    const members: string[] = []
    for (const idx of t.questions) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= questions.length) continue
      if (assigned.has(idx)) continue
      assigned.add(idx)
      members.push(questions[idx])
    }
    if (members.length === 0) continue
    themes.push({
      name: t.name.trim().slice(0, 60),
      count: members.length,
      examples: members.slice(0, 3).map(q => q.slice(0, 160)),
    })
  }
  const missed = questions.filter((_, i) => !assigned.has(i))
  if (missed.length > 0) {
    const other = themes.find(t => t.name.toLowerCase() === 'other')
    if (other) {
      other.count += missed.length
      if (other.examples.length < 3)
        other.examples.push(
          ...missed
            .slice(0, 3 - other.examples.length)
            .map(q => q.slice(0, 160))
        )
    } else {
      themes.push({
        name: 'Other',
        count: missed.length,
        examples: missed.slice(0, 3).map(q => q.slice(0, 160)),
      })
    }
  }
  // Busiest first, Other always last.
  return themes.sort((a, b) => {
    const aOther = a.name.toLowerCase() === 'other'
    const bOther = b.name.toLowerCase() === 'other'
    if (aOther !== bOther) return aOther ? 1 : -1
    return b.count - a.count
  })
}

/** Regenerate the theme summary from every typed question in the log and
 *  store it. Throws on failure — the caller decides how to report it, and the
 *  previously stored summary stays in place. */
export async function refreshQuestionThemes(): Promise<ThemeSummary> {
  const all = await listTypedQuestions({ startMs: null, endMs: null })
  if (all.length > MAX_QUESTIONS) {
    console.warn(
      `[analytics] theming the ${MAX_QUESTIONS} most recent of ${all.length} questions`
    )
  }
  const questions = all.slice(0, MAX_QUESTIONS)
  const summary: ThemeSummary = {
    generatedAt: new Date().toISOString(),
    totalQuestions: questions.length,
    themes: questions.length === 0 ? [] : await themeWithClaude(questions),
  }
  await storeSummary(summary)
  return summary
}
