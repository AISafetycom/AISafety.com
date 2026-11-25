// Recordings with their visitors' events, for /admin/analytics.

import { readEventsInRange, type DateRange } from '@/lib/analytics/events'
import { joinRecordings, type RecordingRow } from './join'
import { listRecordings, readRecording, type ChunkRecord } from './store'

/** Some slack either side, so events on a recording's edges are read. */
const EDGE_MS = 60_000

/** The range's recordings (newest first, at most `limit`) with their
 *  events. Throws when either store can't be read. */
export async function readRecordingRows(
  range: DateRange,
  limit = 1000
): Promise<RecordingRow[]> {
  const recs = await listRecordings(range, limit)
  if (recs.length === 0) return []
  const events = await readEventsInRange({
    startMs: Math.min(...recs.map(r => r.start)) - EDGE_MS,
    endMs: Math.max(...recs.map(r => r.end)) + EDGE_MS,
  })
  return joinRecordings(recs, events)
}

/** One recording with its events and chunks, or null when there's none by
 *  that id. Throws when a store can't be read. */
export async function readRecordingRow(
  id: string
): Promise<{ row: RecordingRow; chunks: ChunkRecord[] } | null> {
  const rec = await readRecording(id)
  if (!rec) return null
  const events = await readEventsInRange({
    startMs: rec.summary.start - EDGE_MS,
    endMs: rec.summary.end + EDGE_MS,
  })
  const [row] = joinRecordings([rec.summary], events)
  return { row, chunks: rec.chunks }
}
