'use client'

/*
  Admin map editor controller: loads records live from /api/admin/map, keeps
  the optimistic local positions, runs a one-at-a-time save queue (later moves
  of the same record replace the queued one), holds the undo stack, and wires
  keyboard shortcuts. The canvas (d3) and side panel are dumb views.
*/

import dynamic from 'next/dynamic'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { EditorRecord, ScaleName } from '@/lib/admin/map-editor-core'
import { clampGrid, roundGrid } from '@/lib/admin/map-geometry'
import type { CanvasControls } from './MapEditorCanvas'
import SidePanel, { type PanelTab } from './SidePanel'
import adminStyles from '../admin.module.css'
import styles from './map-editor.module.css'

const MapEditorCanvas = dynamic(() => import('./MapEditorCanvas'), {
  ssr: false,
  loading: () => (
    <div className={`${styles.canvas} ${styles.canvasLoading}`}>
      <p className="paragraph-small color-teal-300">Loading map…</p>
    </div>
  ),
})

type Position = { x: number | null; y: number | null }

/** What one write changes on a record: where its pin is, or its Scale (logo
 *  size). Each is saved, retried, undone and redone the same way. */
type Change =
  | { field: 'position'; x: number; y: number }
  | { field: 'scale'; scale: ScaleName }

interface Status {
  kind: 'idle' | 'saving' | 'ok' | 'stale' | 'error'
  text: string
}

interface UndoEntry {
  id: string
  from: Change
  to: Change
  at: number
}

interface QueuedMove {
  id: string
  change: Change
  /** 'user' moves push an undo entry when confirmed (and clear redo);
   *  'undo' moves hand their entry to the redo stack; 'redo' moves hand it
   *  back to the undo stack. */
  kind: 'user' | 'undo' | 'redo'
  /** The history entry an undo/redo write is replaying. */
  entry?: UndoEntry
  /** When it was (last) queued — sends wait SETTLE_MS after this so a burst
   *  of nudges becomes one write. */
  at: number
  /** Rate-limit retries so far. */
  attempts: number
}

/** A pending write of the same record AND the same field supersedes an
 *  older one; a move and a Scale change of one record can both be queued. */
function sameSlot(a: { id: string; change: Change }, b: QueuedMove): boolean {
  return a.id === b.id && a.change.field === b.change.field
}

function describe(c: Change): string {
  return c.field === 'position' ? `(${fmt(c.x)}, ${fmt(c.y)})` : c.scale
}

/** Consecutive nudges/drops of the same pin within this window collapse into
 *  one undo step. */
const UNDO_MERGE_MS = 1500
/** Re-read Airtable when the tab regains focus after this long away. */
const REFRESH_ON_FOCUS_MS = 60_000
/** Wait this long after the last move of a pin before writing it. Airtable
 *  allows ~5 requests/s per base and each save is two; held arrow keys or
 *  quick successive drops must not turn into a burst. */
const SETTLE_MS = 400
/** After a 429 Airtable refuses everything for ~30 s. Retry then. */
const RATE_LIMIT_WAIT_MS = 31_000
const RATE_LIMIT_MAX_ATTEMPTS = 3
/** The map + panel never shrink below this, even on a short window (the
 *  page scrolls instead). Matches min-height in map-editor.module.css. */
const MIN_EDITOR_HEIGHT = 480

function fmt(n: number): string {
  return n.toFixed(1)
}

export default function MapEditor({
  canEdit,
}: {
  /** False for a view-only grant: the map as the editor draws it, with
   *  nothing to drag or change. The API refuses those writes regardless. */
  canEdit: boolean
}) {
  const [records, setRecords] = useState<EditorRecord[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [placeModeId, setPlaceModeId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' })
  const [errorBanner, setErrorBanner] = useState<{
    text: string
    retry: QueuedMove | null
  } | null>(null)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([])
  const [showDrafts, setShowDrafts] = useState(true)
  const [previewPublic, setPreviewPublic] = useState(false)
  const [dragging, setDragging] = useState(false)
  // True while any save is queued or in flight (Undo waits for it).
  const [saving, setSaving] = useState(false)
  const [panelTab, setPanelTab] = useState<PanelTab>('unplaced')

  const controlsRef = useRef<CanvasControls>({
    zoomIn: () => {},
    zoomOut: () => {},
    reset: () => {},
    focusOn: () => {},
  })
  // What Airtable last confirmed for each record — the `expected` value sent
  // with every write, and where a pin goes back to when a save fails.
  const lastConfirmed = useRef<Map<string, Position>>(new Map())
  const lastConfirmedScale = useRef<Map<string, string | null>>(new Map())
  const queue = useRef<QueuedMove[]>([])
  const inFlight = useRef<QueuedMove | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rateLimitedUntil = useRef(0)
  const recordsRef = useRef<EditorRecord[] | null>(null)
  recordsRef.current = records
  const draggingRef = useRef(false)
  draggingRef.current = dragging
  const placeModeRef = useRef<string | null>(null)
  placeModeRef.current = placeModeId
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selectedId
  const undoRef = useRef<UndoEntry[]>([])
  undoRef.current = undoStack
  const redoRef = useRef<UndoEntry[]>([])
  redoRef.current = redoStack
  /** Undo/redo pressed while a save was pending; runs when the queue drains. */
  const pendingHistory = useRef<'undo' | 'redo' | null>(null)
  const lastLoadAt = useRef(0)
  const splitRef = useRef<HTMLDivElement>(null)

  // ── Fit to the window ────────────────────────────────────────────────────
  // Size the map + panel to the space between the toolbar and the bottom of
  // the window (minus the page padding), so nothing is cut off.
  // Re-measured on resize and whenever anything above/below changes height
  // (e.g. the toolbar status wrapping onto a second line).
  useLayoutEffect(() => {
    const el = splitRef.current
    if (!el) return
    const main = el.closest('main')
    const apply = () => {
      const split = el.getBoundingClientRect()
      const mainBottom = main?.getBoundingClientRect().bottom ?? split.bottom
      const below = mainBottom - split.bottom
      const top = split.top + window.scrollY
      const h = Math.floor(window.innerHeight - top - below)
      el.style.setProperty(
        '--editor-height',
        `${Math.max(MIN_EDITOR_HEIGHT, h)}px`
      )
    }
    apply()
    window.addEventListener('resize', apply)
    const ro = new ResizeObserver(apply)
    if (main) ro.observe(main)
    return () => {
      window.removeEventListener('resize', apply)
      ro.disconnect()
    }
  }, [])

  // ── Loading ──────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoadError(null)
    let res: Response
    try {
      res = await fetch('/api/admin/map', { cache: 'no-store' })
    } catch (err) {
      setLoadError(`Could not reach the server: ${String(err)}`)
      return
    }
    if (!res.ok) {
      const text = await res.text()
      setLoadError(`Load failed (${res.status}): ${text}`)
      return
    }
    const data = (await res.json()) as {
      fetchedAt: string
      records: EditorRecord[]
    }
    // Records with a write still queued or in flight, per field.
    const pending = [...queue.current]
    if (inFlight.current) pending.push(inFlight.current)
    const busyPos = new Set(
      pending.filter(m => m.change.field === 'position').map(m => m.id)
    )
    const busyScale = new Set(
      pending.filter(m => m.change.field === 'scale').map(m => m.id)
    )
    setRecords(prev => {
      // Keep the local position / Scale of anything still being saved.
      if (!prev) return data.records
      const local = new Map(prev.map(r => [r.id, r]))
      return data.records.map(r => {
        const l = local.get(r.id)
        if (!l) return r
        return {
          ...r,
          ...(busyPos.has(r.id) ? { x: l.x, y: l.y } : {}),
          ...(busyScale.has(r.id) ? { scale: l.scale } : {}),
        }
      })
    })
    for (const r of data.records) {
      if (!busyPos.has(r.id))
        lastConfirmed.current.set(r.id, { x: r.x, y: r.y })
      if (!busyScale.has(r.id)) lastConfirmedScale.current.set(r.id, r.scale)
    }
    setFetchedAt(data.fetchedAt)
    lastLoadAt.current = Date.now()
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Refresh when coming back to the tab after a while — but never in the
  // middle of a drag, a save, or a placement.
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastLoadAt.current < REFRESH_ON_FOCUS_MS) return
      if (draggingRef.current || inFlight.current || queue.current.length)
        return
      if (placeModeRef.current) return
      void load()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  // ── Local mutation + save queue ──────────────────────────────────────────

  const setLocalPosition = useCallback((id: string, x: number, y: number) => {
    setRecords(prev =>
      prev ? prev.map(r => (r.id === id ? { ...r, x, y } : r)) : prev
    )
  }, [])

  const setLocalScale = useCallback((id: string, scale: string | null) => {
    setRecords(prev =>
      prev ? prev.map(r => (r.id === id ? { ...r, scale } : r)) : prev
    )
  }, [])

  const applyLocal = useCallback(
    (id: string, change: Change) => {
      if (change.field === 'position') setLocalPosition(id, change.x, change.y)
      else setLocalScale(id, change.scale)
    },
    [setLocalPosition, setLocalScale]
  )

  const pushUndo = useCallback((entry: UndoEntry) => {
    setUndoStack(prev => {
      const last = prev[prev.length - 1]
      if (
        last &&
        last.id === entry.id &&
        last.to.field === entry.to.field &&
        entry.at - last.at < UNDO_MERGE_MS
      ) {
        // Merge a burst of nudges into one step, keeping the original origin.
        return [...prev.slice(0, -1), { ...entry, from: last.from }]
      }
      return [...prev.slice(-49), entry]
    })
  }, [])

  const processQueue = useCallback(async () => {
    if (inFlight.current) return
    const next = queue.current.shift()
    if (!next) {
      setSaving(false)
      return
    }
    setSaving(true)
    // Let a burst of moves settle so we send one write, not one per keypress,
    // and hold everything while Airtable's rate-limit lockout is running.
    const wait = Math.max(
      SETTLE_MS - (Date.now() - next.at),
      rateLimitedUntil.current - Date.now()
    )
    if (wait > 0) {
      queue.current.unshift(next)
      if (!settleTimer.current) {
        settleTimer.current = setTimeout(() => {
          settleTimer.current = null
          void processQueue()
        }, wait)
      }
      return
    }
    inFlight.current = next
    const change = next.change
    // A newer write of the same field of the same record waiting behind this
    // one means the record is already how the user wants it — don't drag it
    // back to this result.
    const superseded = () => queue.current.some(m => sameSlot(next, m))
    const expected = lastConfirmed.current.get(next.id) ?? { x: null, y: null }
    const expectedScale = lastConfirmedScale.current.get(next.id) ?? null
    const name =
      recordsRef.current?.find(r => r.id === next.id)?.labelName ?? next.id
    setStatus({
      kind: 'saving',
      text: `Saving ${name} → ${describe(change)}…`,
    })
    try {
      const body =
        change.field === 'position'
          ? { id: next.id, x: change.x, y: change.y, expected }
          : { id: next.id, scale: change.scale, expected: expectedScale }
      const res = await fetch('/api/admin/map', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 409) {
        // Someone else changed it in Airtable: show what is really there and
        // drop any of our follow-up writes rather than silently overwriting.
        // A pending undo would now revert the wrong step, so drop it too.
        queue.current = queue.current.filter(m => !sameSlot(next, m))
        pendingHistory.current = null
        if (change.field === 'position') {
          const data = (await res.json()) as { current: Position }
          lastConfirmed.current.set(next.id, data.current)
          if (data.current.x !== null && data.current.y !== null) {
            setLocalPosition(next.id, data.current.x, data.current.y)
          }
          setStatus({
            kind: 'stale',
            text: `${name} was moved in Airtable since you loaded – shown at its current position (${
              data.current.x === null ? '–' : fmt(data.current.x)
            }, ${data.current.y === null ? '–' : fmt(data.current.y)}). Drag again if you still want to move it.`,
          })
        } else {
          const data = (await res.json()) as {
            current: { scale: string | null }
          }
          lastConfirmedScale.current.set(next.id, data.current.scale)
          setLocalScale(next.id, data.current.scale)
          setStatus({
            kind: 'stale',
            text: `${name}'s Scale was changed in Airtable since you loaded – now showing ${
              data.current.scale ?? 'not set'
            }. Pick a size again if you still want to change it.`,
          })
        }
      } else if (
        res.status === 429 &&
        next.attempts < RATE_LIMIT_MAX_ATTEMPTS
      ) {
        // Airtable rate limit: keep the move, wait out the lockout, retry.
        // Nothing else is sent until then either (see the gate above).
        if (!superseded()) {
          queue.current.unshift({
            ...next,
            at: Date.now(),
            attempts: next.attempts + 1,
          })
        }
        rateLimitedUntil.current = Date.now() + RATE_LIMIT_WAIT_MS
        setStatus({
          kind: 'saving',
          text: `Airtable is rate-limiting – ${name} will be saved automatically in about 30 seconds (attempt ${next.attempts + 1} of ${RATE_LIMIT_MAX_ATTEMPTS})…`,
        })
      } else if (!res.ok) {
        let message = `Save failed (${res.status})`
        try {
          const data = (await res.json()) as { error?: string }
          if (data.error) message = `Save failed (${res.status}): ${data.error}`
        } catch {
          // non-JSON error body; keep the status text
        }
        throw new Error(message)
      } else {
        // What Airtable actually stored, as a Change; and what it held before
        // (null when there was nothing to go back to – a first placement or an
        // unset Scale – in which case the step is not undoable, same as /map's
        // first placement today).
        let stored: Change
        let from: Change | null
        if (change.field === 'position') {
          const data = (await res.json()) as {
            record: { id: string; x: number; y: number }
          }
          stored = { field: 'position', x: data.record.x, y: data.record.y }
          from =
            expected.x !== null && expected.y !== null
              ? { field: 'position', x: expected.x, y: expected.y }
              : null
          lastConfirmed.current.set(next.id, { x: stored.x, y: stored.y })
        } else {
          const data = (await res.json()) as {
            record: { id: string; scale: ScaleName }
          }
          stored = { field: 'scale', scale: data.record.scale }
          from =
            expectedScale !== null
              ? { field: 'scale', scale: expectedScale as ScaleName }
              : null
          lastConfirmedScale.current.set(next.id, stored.scale)
        }
        if (next.kind === 'user') {
          if (from) {
            pushUndo({ id: next.id, from, to: stored, at: Date.now() })
          }
        } else if (next.kind === 'undo' && next.entry) {
          const entry = next.entry
          setRedoStack(prev => [...prev.slice(-49), entry])
        } else if (next.kind === 'redo' && next.entry) {
          const entry = next.entry
          setUndoStack(prev => [...prev.slice(-49), entry])
        }
        if (!superseded()) applyLocal(next.id, stored)
        setStatus({
          kind: 'ok',
          text: `Saved ${name} ${
            stored.field === 'position' ? 'at' : 'as'
          } ${describe(stored)} · ${new Date().toLocaleTimeString()}`,
        })
        setErrorBanner(null)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // The write didn't happen, so an undo pressed for it has nothing to
      // undo – it must not fall through to the previous step.
      pendingHistory.current = null
      // Put the record back to what Airtable last confirmed.
      if (!superseded()) {
        if (change.field === 'position') {
          const back = lastConfirmed.current.get(next.id)
          if (back && back.x !== null && back.y !== null) {
            setLocalPosition(next.id, back.x, back.y)
          }
        } else if (lastConfirmedScale.current.has(next.id)) {
          setLocalScale(next.id, lastConfirmedScale.current.get(next.id)!)
        }
      }
      // A failed undo/redo keeps its history entry where it came from.
      if (next.kind === 'undo' && next.entry) {
        const entry = next.entry
        setUndoStack(prev => [...prev, entry])
      } else if (next.kind === 'redo' && next.entry) {
        const entry = next.entry
        setRedoStack(prev => [...prev, entry])
      }
      setStatus({ kind: 'error', text: `Not saved: ${name}` })
      setErrorBanner({ text: message, retry: next })
    } finally {
      inFlight.current = null
      if (queue.current.length) void processQueue()
      else setSaving(false)
    }
  }, [pushUndo, setLocalPosition, setLocalScale, applyLocal])

  const enqueue = useCallback(
    (move: Omit<QueuedMove, 'at' | 'attempts'>) => {
      // A newer write of the same field of the same record replaces the one
      // still waiting.
      queue.current = queue.current.filter(m => !sameSlot(move, m))
      queue.current.push({ ...move, at: Date.now(), attempts: 0 })
      if (settleTimer.current) {
        clearTimeout(settleTimer.current)
        settleTimer.current = null
      }
      void processQueue()
    },
    [processQueue]
  )

  type History = { kind: QueuedMove['kind']; entry?: UndoEntry }

  /** Show a change immediately and queue its save. Every way of changing a
   *  record (drag, place, nudge, the x/y fields, Scale, undo, redo) comes
   *  through here, so a view-only session is stopped in one place. */
  const applyChange = useCallback(
    (id: string, change: Change, history: History = { kind: 'user' }) => {
      if (!canEdit) return
      applyLocal(id, change)
      // A fresh change forks history: nothing to redo any more.
      if (history.kind === 'user') setRedoStack([])
      enqueue({ id, change, ...history })
    },
    [enqueue, applyLocal, canEdit]
  )

  const moveRecord = useCallback(
    (id: string, x: number, y: number, history?: History) => {
      const c = clampGrid(roundGrid(x), roundGrid(y))
      applyChange(id, { field: 'position', x: c.x, y: c.y }, history)
    },
    [applyChange]
  )

  const setScale = useCallback(
    (id: string, scale: ScaleName) => {
      applyChange(id, { field: 'scale', scale })
    },
    [applyChange]
  )

  /** History entries only exist once Airtable confirms a write, so replaying
   *  one while a save is pending could revert the wrong thing. An undo/redo
   *  pressed during a save is remembered and runs the moment the queue is
   *  empty (see the effect below) – it is never just dropped. */
  const historyBusy = useCallback((what: 'undo' | 'redo') => {
    if (inFlight.current || queue.current.length) {
      pendingHistory.current = what
      setStatus({
        kind: 'saving',
        text: `Finishing the current save, then ${what}ing…`,
      })
      return true
    }
    return false
  }, [])

  const undo = useCallback(() => {
    if (historyBusy('undo')) return
    const last = undoRef.current[undoRef.current.length - 1]
    if (!last) {
      setStatus({ kind: 'idle', text: 'Nothing to undo.' })
      return
    }
    setUndoStack(prev => prev.slice(0, -1))
    applyChange(last.id, last.from, { kind: 'undo', entry: last })
  }, [historyBusy, applyChange])

  const redo = useCallback(() => {
    if (historyBusy('redo')) return
    const last = redoRef.current[redoRef.current.length - 1]
    if (!last) {
      setStatus({ kind: 'idle', text: 'Nothing to redo.' })
      return
    }
    setRedoStack(prev => prev.slice(0, -1))
    applyChange(last.id, last.to, { kind: 'redo', entry: last })
  }, [historyBusy, applyChange])

  // Run the undo/redo that was pressed mid-save once the queue has drained
  // and the history stacks have caught up (this runs after render, so the
  // stack refs are current).
  useEffect(() => {
    if (saving || !pendingHistory.current) return
    const what = pendingHistory.current
    pendingHistory.current = null
    if (what === 'undo') undo()
    else redo()
  }, [saving, undoStack, redoStack, undo, redo])

  // ── Canvas callbacks ─────────────────────────────────────────────────────

  const onDrop = useCallback(
    (id: string, x: number, y: number, clamped: boolean) => {
      moveRecord(id, x, y)
      if (clamped) {
        setStatus({
          kind: 'saving',
          text: 'Dropped past the edge – clamped to the map edge…',
        })
      }
      setSelectedId(id)
      setPanelTab('selected')
    },
    [moveRecord]
  )

  // Clicking a logo on the map opens its details in the side panel.
  const onSelect = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) setPanelTab('selected')
  }, [])

  // Picking a search result: select it and, if it is on the map, pan/zoom
  // to it (switching drafts back on if that is what was hiding it).
  const onPick = useCallback((id: string) => {
    const rec = recordsRef.current?.find(r => r.id === id)
    if (!rec) return
    setSelectedId(id)
    setPanelTab('selected')
    if (rec.x !== null && rec.y !== null) {
      if (!rec.published) setShowDrafts(true)
      controlsRef.current.focusOn(rec.x, rec.y)
    }
  }, [])

  const onPlaceClick = useCallback(
    (x: number, y: number) => {
      const id = placeModeRef.current
      if (!id) return
      moveRecord(id, x, y)
      setPlaceModeId(null)
      setSelectedId(id)
      setPanelTab('selected')
    },
    [moveRecord]
  )

  // ── Keyboard: Undo, Escape, arrow nudges ─────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      // Undo/redo always mean the map, even with the cursor in the search
      // box or an x/y field – there is no text history worth keeping there.
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase()
        if (k === 'z' && e.shiftKey) {
          e.preventDefault()
          redo()
          return
        }
        if (k === 'z') {
          e.preventDefault()
          undo()
          return
        }
        if (k === 'y') {
          e.preventDefault()
          redo()
          return
        }
      }
      if (e.key === 'Escape') {
        if (typing) return
        if (placeModeRef.current) {
          setPlaceModeId(null)
          return
        }
        if (selectedRef.current) {
          setSelectedId(null)
          return
        }
        controlsRef.current.reset()
        return
      }
      const selId = selectedRef.current
      if (typing || !selId) return
      const step = e.shiftKey ? 1 : 0.1
      const rec = recordsRef.current?.find(r => r.id === selId)
      if (!rec || rec.x === null || rec.y === null) return
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else return
      e.preventDefault()
      moveRecord(rec.id, rec.x + dx, rec.y + dy)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [moveRecord, undo, redo])

  // ── Derived ──────────────────────────────────────────────────────────────

  const visible = useMemo(() => {
    if (!records) return []
    return records.filter(r => {
      if (previewPublic) return r.published
      if (!showDrafts && !r.published) return false
      return true
    })
  }, [records, showDrafts, previewPublic])

  const counts = useMemo(() => {
    const all = records ?? []
    const placed = all.filter(r => r.x !== null && r.y !== null).length
    return {
      total: all.length,
      placed,
      unplaced: all.length - placed,
      drafts: all.filter(r => !r.published).length,
    }
  }, [records])

  const selected = records?.find(r => r.id === selectedId) ?? null
  const placing = records?.find(r => r.id === placeModeId) ?? null

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <div className={`${adminStyles.pageHeading} ${styles.heading}`}>
        <h1 className={adminStyles.pageTitle}>Map editor</h1>
        <span className={adminStyles.pageMeta}>
          {canEdit
            ? 'Drag a listing to move it · click to select · only x, y and Scale are written'
            : 'Click a listing to see its details'}
        </span>
      </div>

      {canEdit ? (
        <div className={`${adminStyles.notice} ${styles.liveWarning}`}>
          <strong>This edits the live site.</strong> Every move is saved to
          Airtable straight away and appears on the public /map within a few
          minutes. Use with caution.
        </div>
      ) : (
        <div className={adminStyles.notice}>
          View only: you can look at every listing, placed or not, but moving
          and resizing them stays with people who can edit the Map editor.
        </div>
      )}

      <div className={`${adminStyles.editorToolbar} ${styles.toolbar}`}>
        <span className={adminStyles.editorStatus}>
          {records
            ? `Live from Airtable · loaded ${
                fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : ''
              } · ${counts.total} records · ${counts.placed} placed · ${
                counts.unplaced
              } unplaced · ${counts.drafts} incoming suggestions`
            : 'Loading…'}
        </span>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={showDrafts}
            onChange={e => setShowDrafts(e.target.checked)}
            disabled={previewPublic}
          />
          Show incoming suggestions on map
        </label>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={previewPublic}
            onChange={e => setPreviewPublic(e.target.checked)}
          />
          Preview as public
        </label>
        <span
          className={`${adminStyles.editorStatus} ${
            status.kind === 'saving' ? adminStyles.editorStatusSaving : ''
          } ${status.kind === 'error' ? adminStyles.convError : ''} ${
            status.kind === 'stale' ? styles.statusStale : ''
          }`}
        >
          {status.text}
        </span>
        <span className={styles.toolbarActions}>
          <button
            type="button"
            className={adminStyles.editorButton}
            onClick={() => void load()}
            disabled={dragging || !!inFlight.current}
          >
            Refresh
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                className={adminStyles.editorButton}
                onClick={undo}
                disabled={undoStack.length === 0 || saving}
                title="Cmd/Ctrl+Z"
              >
                Undo{undoStack.length ? ` (${undoStack.length})` : ''}
              </button>
              <button
                type="button"
                className={adminStyles.editorButton}
                onClick={redo}
                disabled={redoStack.length === 0 || saving}
                title="Cmd/Ctrl+Shift+Z"
              >
                Redo{redoStack.length ? ` (${redoStack.length})` : ''}
              </button>
            </>
          )}
        </span>
      </div>

      <div className={styles.split} ref={splitRef}>
        <div className={styles.canvasWrap}>
          {/* Notices float over the map so they never push it around. */}
          <div className={styles.overlays}>
            {placing && (
              <div className={`${adminStyles.notice} ${styles.placeNotice}`}>
                Click on the map to place <strong>{placing.title}</strong>.
                Press Esc to cancel.
              </div>
            )}

            {errorBanner && (
              <div className={`${adminStyles.notice} ${styles.errorBanner}`}>
                <span>{errorBanner.text}</span>
                <span className={styles.errorActions}>
                  {errorBanner.retry && (
                    <button
                      type="button"
                      className={adminStyles.editorButtonPrimary}
                      onClick={() => {
                        const m = errorBanner.retry!
                        setErrorBanner(null)
                        applyChange(m.id, m.change, {
                          kind: m.kind,
                          entry: m.entry,
                        })
                      }}
                    >
                      Retry
                    </button>
                  )}
                  <button
                    type="button"
                    className={adminStyles.editorButton}
                    onClick={() => setErrorBanner(null)}
                  >
                    Dismiss
                  </button>
                </span>
              </div>
            )}

            {loadError && (
              <div className={`${adminStyles.notice} ${styles.errorBanner}`}>
                <span>{loadError}</span>
                <button
                  type="button"
                  className={adminStyles.editorButtonPrimary}
                  onClick={() => void load()}
                >
                  Retry
                </button>
              </div>
            )}
          </div>
          {records ? (
            <MapEditorCanvas
              records={visible}
              selectedId={selectedId}
              placeModeId={placeModeId}
              previewPublic={previewPublic}
              onDrop={onDrop}
              onSelect={onSelect}
              onPlaceClick={onPlaceClick}
              onDragStateChange={setDragging}
              controlsRef={controlsRef}
              readOnly={!canEdit}
            />
          ) : (
            <div className={`${styles.canvas} ${styles.canvasLoading}`}>
              <p className="paragraph-small color-teal-300">
                {loadError ? 'Could not load the map.' : 'Loading map…'}
              </p>
            </div>
          )}
        </div>
        {!previewPublic && (
          <SidePanel
            records={records ?? []}
            selected={selected}
            placeModeId={placeModeId}
            tab={panelTab}
            onTabChange={setPanelTab}
            onPlace={id => {
              setPlaceModeId(prev => (prev === id ? null : id))
              setSelectedId(id)
            }}
            onPick={onPick}
            onSetPosition={(id, x, y) => moveRecord(id, x, y)}
            onSetScale={setScale}
            readOnly={!canEdit}
          />
        )}
      </div>
    </div>
  )
}
