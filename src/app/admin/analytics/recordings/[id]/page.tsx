// One recorded visit: the replay, with what the visitor did beside it (from
// the rest of the analytics). ?t=<epoch ms> starts the replay at that moment
// (the Replay links in Recent activity).

import Link from 'next/link'
import { requireAccess } from '@/lib/admin/auth'
import { readRecordingRow } from '@/lib/recordings/read'
import { isRecordingId } from '@/lib/recordings/shared'
import {
  formatLength,
  formatStart,
  pageLabel,
  screenOf,
} from '../../RecordingsTab'
import { labelFor, pillFor } from '../../event-labels'
import admin from '../../../admin.module.css'
import styles from '../../analytics.module.css'
import ReplayPlayer, { type Moment } from './ReplayPlayer'

export const dynamic = 'force-dynamic'

export default async function RecordingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ t?: string | string[] }>
}) {
  await requireAccess('analytics')
  const { id } = await params
  const t = Number((await searchParams).t)

  const back = (
    <Link
      href="/admin/analytics?tab=recordings"
      className={styles.recordingLink}
    >
      ← All recordings
    </Link>
  )
  if (!isRecordingId(id)) return <Missing back={back} />
  let found: Awaited<ReturnType<typeof readRecordingRow>>
  try {
    found = await readRecordingRow(id)
  } catch (err) {
    console.error('[recordings] replay page read failed:', err)
    return (
      <div className={styles.dashboard}>
        {back}
        <div className={`${styles.empty} ${styles.replayGap}`}>
          Couldn&apos;t read this recording just now – try refreshing in a
          moment.
        </div>
      </div>
    )
  }
  if (!found) return <Missing back={back} />
  const { row, chunks } = found

  const moments: Moment[] = row.moments.map(e => ({
    at: Date.parse(e.ts),
    pill: pillFor(e) ?? undefined,
    label: labelFor(e),
  }))

  return (
    <div className={styles.dashboard}>
      {back}
      <div className={`${styles.headerRow} ${styles.replayGap}`}>
        <h1 className={admin.pageTitle}>
          Visit on {formatStart(row.start)} (UTC)
        </h1>
        <div className={styles.meta}>
          <span className={styles.total}>
            {formatLength(row.end - row.start)}
          </span>
          <span className={styles.coverage}>{screenOf(row.width)}</span>
        </div>
      </div>
      <p className={styles.replayPages}>
        {row.pages.map(pageLabel).join(' → ')}
      </p>
      <ReplayPlayer
        id={id}
        chunkCount={chunks.length}
        offset={row.off}
        startAt={Number.isFinite(t) ? t : undefined}
        moments={moments}
      />
    </div>
  )
}

function Missing({ back }: { back: React.ReactNode }) {
  return (
    <div className={styles.dashboard}>
      {back}
      <div className={`${styles.empty} ${styles.replayGap}`}>
        There&apos;s no recording at this address.
      </div>
    </div>
  )
}
