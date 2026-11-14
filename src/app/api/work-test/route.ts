/*
  The work test's only endpoint (src/lib/work-test/flow.ts says what the
  work test is). Not an admin route: the caller is a candidate, known only
  by the private link in the request body. An unknown link is a 404.

  POST /api/work-test
    { token, action: 'save', key, answer, text }  → { ok: true }
        keeps one answer; refused for an item that is not open at the
        candidate's stage, so a submitted round cannot be changed
    { token, action: 'start' | 'submit' | 'next' } → { state }
        moves the candidate on a stage. 'submit' is refused while any open
        item is incomplete: { error, missing: [keys] } with 409.

  Writes go to the work test's own answers and candidates tables and
  nowhere else (store.ts).
*/

import { NextRequest } from 'next/server'
import {
  checkSave,
  missingKeys,
  stageOf,
  stampFor,
  stateFor,
  type Move,
} from '@/lib/work-test/flow'
import {
  findCandidate,
  listAnswers,
  listItems,
  saveAnswer,
  stampCandidate,
} from '@/lib/work-test/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

const MOVES: Move[] = ['start', 'submit', 'next']

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json({ error: 'Bad request.' }, 400)
    }
    body = parsed as Record<string, unknown>
  } catch {
    return json({ error: 'Bad request.' }, 400)
  }

  const token = typeof body.token === 'string' ? body.token : ''
  const found = await findCandidate(token)
  if (!found) return json({ error: 'Not found.' }, 404)

  const action = typeof body.action === 'string' ? body.action : ''
  const stage = stageOf(found.candidate)
  const items = await listItems()

  if (action === 'save') {
    const key = typeof body.key === 'string' ? body.key : ''
    const item = items.find(i => i.key === key)
    const checked = checkSave(stage, item, body.answer, body.text)
    if (!checked.ok) return json({ error: checked.error }, 409)
    await saveAnswer(found.candidate.code, key, {
      answer: checked.answer,
      text: checked.text,
    })
    return json({ ok: true })
  }

  if (MOVES.includes(action as Move)) {
    const stamp = stampFor(stage, action as Move)
    if (!stamp) {
      return json({ error: 'That step is not open right now.' }, 409)
    }
    if (action === 'submit') {
      const answers = await listAnswers(found.candidate.code)
      const missing = missingKeys(stage, items, answers)
      if (missing.length > 0) {
        return json(
          { error: 'Some items still need a decision or a reason.', missing },
          409
        )
      }
    }
    await stampCandidate(found.recordId, stamp)
    const after = await findCandidate(token)
    if (!after) return json({ error: 'Not found.' }, 404)
    const answers = await listAnswers(after.candidate.code)
    return json({ state: stateFor(after.candidate, items, answers) })
  }

  return json({ error: 'Bad request.' }, 400)
}
