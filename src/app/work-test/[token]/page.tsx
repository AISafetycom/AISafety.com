// The work test: a sandboxed copy of the admin Queue for someone applying
// to work on listings, at the private link they were sent
// (src/lib/work-test/flow.ts). An unknown link is a plain 404, and nothing
// here is indexed or passed on in a Referer.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { stateFor } from '@/lib/work-test/flow'
import {
  findCandidate,
  isToken,
  listAnswers,
  listItems,
} from '@/lib/work-test/store'
import WorkTest from './WorkTest'

// Each load reads the candidate's own stage and answers.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Work test – AISafety.com',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function WorkTestPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  // A malformed link never reaches the store.
  if (!isToken(token)) notFound()
  const found = await findCandidate(token)
  if (!found) notFound()

  const [items, answers] = await Promise.all([
    listItems(),
    listAnswers(found.candidate.code),
  ])

  return (
    <WorkTest
      token={token}
      initial={stateFor(found.candidate, items, answers)}
    />
  )
}
