'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { describeChanges, type Change } from '@/lib/donation-guide/diff'
import type {
  Actor,
  DraftDoc,
  Guide,
  LiveDoc,
  RichText,
  VersionMeta,
} from '@/lib/donation-guide/types'
import { formatTimeAgo } from '@/lib/format-date'
import Icon from '@/components/Icon'
import RichEditor from './RichEditor'
import styles from '../donation-guide.module.css'
import adminStyles from '../../admin.module.css'

const API = '/api/admin/donation-guide'
const PREVIEW_PATH = '/admin/donation-guide/preview'
const AUTOSAVE_MS = 1500
const POLL_MS = 30_000
/** The preview iframe renders the page at this width and is scaled to fit. */
const PREVIEW_WIDTH = 1280
/** Typing into the same field within this long is one undo step. */
const COALESCE_MS = 1000
const MAX_UNDO = 200

interface LiveMeta {
  version: number
  guide: Guide
  publishedAt: string
  publishedBy: Actor | null
  note: string | null
}

interface Loaded {
  live: LiveMeta
  draft: DraftDoc | null
  versions: VersionMeta[]
  canEdit: boolean
  me: Actor
}

type Selection =
  | { kind: 'intro' }
  | { kind: 'tab'; id: string }
  | { kind: 'section'; id: string }

interface VersionDetail {
  version: LiveDoc
  changesIfRestored: Change[]
  liveVersion: number
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
}

function ago(iso: string, now: number): string {
  try {
    return formatTimeAgo(iso, new Date(now))
  } catch {
    return iso
  }
}

function moveInList<T>(list: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return list
  }
  const out = list.slice()
  const [item] = out.splice(from, 1)
  out.splice(to, 0, item)
  return out
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

export default function GuideEditor({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [guide, setGuide] = useState<Guide | null>(null)
  /** What the server holds for this person: the draft, or live. */
  const [savedGuide, setSavedGuide] = useState<Guide | null>(null)
  const [draftMeta, setDraftMeta] = useState<Omit<DraftDoc, 'guide'> | null>(
    null
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<DraftDoc | null>(null)
  const [selected, setSelected] = useState<Selection>({ kind: 'intro' })
  const [discardOpen, setDiscardOpen] = useState(false)
  const [previewScale, setPreviewScale] = useState(1)
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_WIDTH)
  const [editorKey, setEditorKey] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyDetail, setHistoryDetail] = useState<VersionDetail | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [restoreArmed, setRestoreArmed] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishChanges, setPublishChanges] = useState<Change[]>([])
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<Selection | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  const seenSavedAt = useRef<string | null>(null)
  const latestGuide = useRef<Guide | null>(null)
  const savingRef = useRef(false)
  const queuedRef = useRef(false)
  const previewBox = useRef<HTMLDivElement | null>(null)
  // One undo history for everything: typing, renames, adds, removes and
  // reorders all go through update(), which keeps the guide as it was.
  const past = useRef<Guide[]>([])
  const future = useRef<Guide[]>([])
  const lastEdit = useRef<{ key: string; at: number } | null>(null)
  const [historyLen, setHistoryLen] = useState({ past: 0, future: 0 })
  latestGuide.current = guide

  const dirty = useMemo(
    () =>
      guide !== null &&
      savedGuide !== null &&
      JSON.stringify(guide) !== JSON.stringify(savedGuide),
    [guide, savedGuide]
  )

  // ─── Loading ──────────────────────────────────────────────────────────

  const adopt = useCallback((loaded: Loaded) => {
    setData(loaded)
    const g = loaded.draft?.guide ?? loaded.live.guide
    setGuide(g)
    setSavedGuide(g)
    setDraftMeta(
      loaded.draft
        ? {
            savedAt: loaded.draft.savedAt,
            savedBy: loaded.draft.savedBy,
            basedOn: loaded.draft.basedOn,
          }
        : null
    )
    seenSavedAt.current = loaded.draft?.savedAt ?? null
    setConflict(null)
    setSaveError(null)
    setEditorKey(k => k + 1)
    past.current = []
    future.current = []
    lastEdit.current = null
    setHistoryLen({ past: 0, future: 0 })
  }, [])

  const load = useCallback(async (): Promise<Loaded | null> => {
    try {
      const res = await fetch(API, { cache: 'no-store' })
      const body = await readJson(res)
      if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`))
      return body as unknown as Loaded
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
      return null
    }
  }, [])

  useEffect(() => {
    void load().then(l => l && adopt(l))
  }, [load, adopt])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // ─── Saving ───────────────────────────────────────────────────────────

  const saveDraft = useCallback(async (g: Guide): Promise<boolean> => {
    if (savingRef.current) {
      queuedRef.current = true
      return false
    }
    savingRef.current = true
    setSaving(true)
    let ok = false
    try {
      const res = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guide: g, seenSavedAt: seenSavedAt.current }),
      })
      const body = await readJson(res)
      if (res.status === 409 && body.draft) {
        setConflict(body.draft as DraftDoc)
      } else if (!res.ok) {
        setSaveError(String(body.error ?? `HTTP ${res.status}`))
      } else {
        const draft = body.draft as DraftDoc
        seenSavedAt.current = draft.savedAt
        setDraftMeta({
          savedAt: draft.savedAt,
          savedBy: draft.savedBy,
          basedOn: draft.basedOn,
        })
        setSavedGuide(g)
        setSaveError(null)
        ok = true
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
    if (queuedRef.current) {
      queuedRef.current = false
      const latest = latestGuide.current
      if (latest && latest !== g) return saveDraft(latest)
    }
    return ok
  }, [])

  useEffect(() => {
    if (!canEdit || !guide || !dirty || conflict) return
    const t = setTimeout(() => void saveDraft(guide), AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [guide, dirty, canEdit, conflict, saveDraft])

  /** Save now, before publishing. True when nothing is left unsaved. */
  async function flushSave(): Promise<boolean> {
    if (!dirty || !guide) return !conflict
    if (conflict) return false
    return saveDraft(guide)
  }

  // Someone else's draft or publish shows up within half a minute even
  // when this person isn't typing.
  useEffect(() => {
    if (!data) return
    const t = setInterval(async () => {
      if (document.hidden || savingRef.current) return
      const l = await load()
      if (!l) return
      const theirs = l.draft
      const draftMoved = (theirs?.savedAt ?? null) !== seenSavedAt.current
      const liveMoved = l.live.version !== data.live.version
      if (!draftMoved && !liveMoved) return
      if (dirty && draftMoved && theirs) {
        setConflict(theirs)
        return
      }
      if (liveMoved) {
        setNotice(
          `Version ${l.live.version} was published by ${l.live.publishedBy?.name ?? 'someone'}; showing it now.`
        )
      } else if (theirs) {
        setNotice(
          `Loaded the draft ${theirs.savedBy.name} saved ${when(theirs.savedAt)}.`
        )
      } else {
        setNotice('The draft was discarded elsewhere; showing what is live.')
      }
      adopt(l)
    }, POLL_MS)
    return () => clearInterval(t)
  }, [data, dirty, load, adopt])

  useEffect(() => {
    if (selected.kind !== 'section') return
    document
      .getElementById(`section-${selected.id}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [selected])

  // ─── Preview scale ────────────────────────────────────────────────────

  useEffect(() => {
    const box = previewBox.current
    if (!box) return
    // Wider than the page's own width: shown 1:1 and filling the panel;
    // narrower: the page at its real width, scaled down to fit.
    const measure = () => {
      const w = box.clientWidth
      setPreviewScale(Math.min(1, w / PREVIEW_WIDTH))
      setPreviewWidth(Math.max(PREVIEW_WIDTH, w))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [data])

  // ─── Edits ────────────────────────────────────────────────────────────

  /** Change the guide, remembering what it was. `coalesce` names a field
   *  so a burst of typing into it is one undo step rather than one per key. */
  function update(fn: (g: Guide) => Guide, coalesce?: string) {
    const g = latestGuide.current
    if (!g) return
    const next = fn(g)
    if (next === g || JSON.stringify(next) === JSON.stringify(g)) return
    const at = Date.now()
    const merge =
      coalesce !== undefined &&
      lastEdit.current?.key === coalesce &&
      at - lastEdit.current.at < COALESCE_MS
    if (!merge) {
      past.current = [...past.current.slice(-(MAX_UNDO - 1)), g]
      future.current = []
    }
    lastEdit.current = coalesce !== undefined ? { key: coalesce, at } : null
    latestGuide.current = next
    setGuide(next)
    setHistoryLen({ past: past.current.length, future: future.current.length })
  }

  /** After an undo or redo the selected tab or section may be gone. */
  const keepSelectionValid = useCallback((g: Guide) => {
    setSelected(sel => {
      if (sel.kind === 'tab' && !g.tabs.some(t => t.id === sel.id)) {
        return { kind: 'intro' }
      }
      if (
        sel.kind === 'section' &&
        !g.tabs.some(t => t.sections.some(x => x.id === sel.id))
      ) {
        return { kind: 'intro' }
      }
      return sel
    })
  }, [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    const cur = latestGuide.current
    if (!prev || !cur) return
    future.current.push(cur)
    lastEdit.current = null
    latestGuide.current = prev
    setGuide(prev)
    setEditorKey(k => k + 1)
    keepSelectionValid(prev)
    setHistoryLen({ past: past.current.length, future: future.current.length })
  }, [keepSelectionValid])

  const redo = useCallback(() => {
    const next = future.current.pop()
    const cur = latestGuide.current
    if (!next || !cur) return
    past.current.push(cur)
    lastEdit.current = null
    latestGuide.current = next
    setGuide(next)
    setEditorKey(k => k + 1)
    keepSelectionValid(next)
    setHistoryLen({ past: past.current.length, future: future.current.length })
  }, [keepSelectionValid])

  // Cmd+Z / Shift+Cmd+Z (or Cmd+Y) anywhere on the page, the text boxes
  // included: their own undo is switched off so there is one history.
  useEffect(() => {
    if (!canEdit) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (k === 'y') {
        e.preventDefault()
        redo()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [canEdit, undo, redo])

  const selectedTabId =
    selected.kind === 'tab'
      ? selected.id
      : selected.kind === 'section'
        ? guide?.tabs.find(t => t.sections.some(s => s.id === selected.id))?.id
        : undefined

  function addTab() {
    const id = newId('tab')
    update(g => ({
      ...g,
      tabs: [...g.tabs, { id, amount: 'New amount', lead: '', sections: [] }],
    }))
    setSelected({ kind: 'tab', id })
  }

  function addSection(tabId: string) {
    const id = newId(tabId)
    update(g => ({
      ...g,
      tabs: g.tabs.map(t =>
        t.id === tabId
          ? {
              ...t,
              sections: [
                ...t.sections,
                { id, time: 'New section', body: { blocks: [] } },
              ],
            }
          : t
      ),
    }))
    setSelected({ kind: 'section', id })
  }

  function removeTab(id: string) {
    if (!guide?.tabs.some(t => t.id === id)) return
    update(g => ({ ...g, tabs: g.tabs.filter(t => t.id !== id) }))
    setSelected({ kind: 'intro' })
  }

  function removeSection(id: string) {
    const tab = guide?.tabs.find(t => t.sections.some(s => s.id === id))
    if (!tab) return
    update(g => ({
      ...g,
      tabs: g.tabs.map(t => ({
        ...t,
        sections: t.sections.filter(s => s.id !== id),
      })),
    }))
    setSelected({ kind: 'tab', id: tab.id })
  }

  function moveTab(id: string, to: number) {
    update(g => ({
      ...g,
      tabs: moveInList(
        g.tabs,
        g.tabs.findIndex(t => t.id === id),
        to
      ),
    }))
  }

  function moveSection(id: string, to: number) {
    update(g => ({
      ...g,
      tabs: g.tabs.map(t => {
        const from = t.sections.findIndex(s => s.id === id)
        return from < 0
          ? t
          : { ...t, sections: moveInList(t.sections, from, to) }
      }),
    }))
  }

  function setTabField(id: string, patch: { amount?: string; lead?: string }) {
    update(
      g => ({
        ...g,
        tabs: g.tabs.map(t => (t.id === id ? { ...t, ...patch } : t)),
      }),
      `tab:${id}:${patch.amount !== undefined ? 'amount' : 'lead'}`
    )
  }

  function setSectionField(
    id: string,
    patch: { time?: string; body?: RichText }
  ) {
    update(
      g => ({
        ...g,
        tabs: g.tabs.map(t => ({
          ...t,
          sections: t.sections.map(s => (s.id === id ? { ...s, ...patch } : s)),
        })),
      }),
      `${patch.body !== undefined ? 'body' : 'time'}:${id}`
    )
  }

  function onDrop(target: Selection) {
    const from = dragging
    setDragging(null)
    setDragOver(null)
    if (
      !from ||
      !guide ||
      from.kind !== target.kind ||
      from.kind === 'intro' ||
      target.kind === 'intro'
    )
      return
    if (from.id === target.id) return
    if (from.kind === 'tab' && target.kind === 'tab') {
      moveTab(
        from.id,
        guide.tabs.findIndex(t => t.id === target.id)
      )
    } else if (from.kind === 'section' && target.kind === 'section') {
      const tab = guide.tabs.find(t => t.sections.some(s => s.id === from.id))
      if (!tab || !tab.sections.some(s => s.id === target.id)) return
      moveSection(
        from.id,
        tab.sections.findIndex(s => s.id === target.id)
      )
    }
  }

  // ─── Draft, publish, history ──────────────────────────────────────────

  async function discardDraft() {
    setDiscardOpen(false)
    if (!data) return
    const res = await fetch(API, { method: 'DELETE' })
    if (!res.ok) {
      setSaveError(String((await readJson(res)).error ?? `HTTP ${res.status}`))
      return
    }
    const l = await load()
    if (l) adopt(l)
    setSelected({ kind: 'intro' })
  }

  async function openPublish() {
    if (!data || !guide) return
    const saved = await flushSave()
    if (!saved) return
    setPublishChanges(describeChanges(data.live.guide, guide))
    setPublishError(null)
    setPublishOpen(true)
  }

  async function confirmPublish() {
    if (!data) return
    setPublishBusy(true)
    setPublishError(null)
    try {
      const res = await fetch(`${API}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: data.live.version }),
      })
      const body = await readJson(res)
      if (res.status === 409) {
        const cur = body.current as {
          version: number
          publishedBy?: Actor
        } | null
        setPublishError(
          cur
            ? `Version ${cur.version} was published by ${cur.publishedBy?.name ?? 'someone'} since you loaded. Close this and reload to see it before publishing again.`
            : 'The live version changed since you loaded. Reload and try again.'
        )
        return
      }
      if (!res.ok) {
        setPublishError(String(body.error ?? `HTTP ${res.status}`))
        return
      }
      const live = body.live as { version: number }
      setPublishOpen(false)
      const l = await load()
      if (l) adopt(l)
      setNotice(
        `Published version ${live.version}. The live page updates within seconds.`
      )
    } finally {
      setPublishBusy(false)
    }
  }

  async function openVersion(n: number) {
    setHistoryBusy(true)
    setHistoryError(null)
    setRestoreArmed(false)
    try {
      const res = await fetch(`${API}/versions/${n}`, { cache: 'no-store' })
      const body = await readJson(res)
      if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`))
      setHistoryDetail(body as unknown as VersionDetail)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err))
    } finally {
      setHistoryBusy(false)
    }
  }

  async function restore(n: number) {
    if (!data) return
    setHistoryBusy(true)
    setHistoryError(null)
    try {
      const res = await fetch(`${API}/versions/${n}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: data.live.version }),
      })
      const body = await readJson(res)
      if (res.status === 409) {
        throw new Error(
          `Version ${String(body.current)} went live since you loaded. Close and reload first.`
        )
      }
      if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`))
      const live = body.live as { version: number }
      setHistoryOpen(false)
      setHistoryDetail(null)
      const l = await load()
      if (l) adopt(l)
      setSelected({ kind: 'intro' })
      setNotice(`Version ${n} is live again, as version ${live.version}.`)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err))
    } finally {
      setHistoryBusy(false)
      setRestoreArmed(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────

  if (loadError && !data) {
    return (
      <div className={adminStyles.notice}>
        Could not load the guide: {loadError}
      </div>
    )
  }
  if (!data || !guide) {
    return <div className={styles.empty}>Loading the guide…</div>
  }

  const status = (() => {
    if (saveError)
      return { text: `Not saved: ${saveError}`, cls: styles.statusError }
    if (saving) return { text: 'Saving…', cls: '' }
    if (dirty) return { text: 'Unsaved changes', cls: '' }
    if (draftMeta) {
      return {
        text: `Draft saved ${ago(draftMeta.savedAt, now)} by ${draftMeta.savedBy.name}`,
        cls: '',
      }
    }
    return { text: 'No draft, matches live', cls: styles.statusLive }
  })()

  const liveLine =
    data.live.version === 0
      ? 'Live: the built-in copy (nothing published yet)'
      : `Live: version ${data.live.version}, published ${when(data.live.publishedAt)} by ${data.live.publishedBy?.name ?? 'unknown'}`

  // The pane shows a whole amount tab, every section stacked like the live
  // page; picking a section in the outline scrolls to its block.
  const paneTab = selectedTabId
    ? guide.tabs.find(t => t.id === selectedTabId)
    : undefined
  const focusSectionId = selected.kind === 'section' ? selected.id : null

  const previewSrc = `${PREVIEW_PATH}${selectedTabId ? `?tab=${encodeURIComponent(selectedTabId)}` : ''}`

  return (
    <div>
      <div className={styles.top}>
        <div className={styles.topLeft}>
          <h1 className={adminStyles.pageTitle}>Donation guide</h1>
          <span className={`${styles.status} ${status.cls}`}>
            {status.text}
          </span>
          <span className={styles.status}>{liveLine}</span>
        </div>
        <div className={styles.actions}>
          {!canEdit && <span className={styles.status}>View only</span>}
          {canEdit && (
            <>
              <button
                type="button"
                className={`${adminStyles.editorButton} ${styles.iconButton}`}
                onClick={undo}
                disabled={historyLen.past === 0}
                title="Undo (Cmd+Z)"
              >
                <Icon src="/images/icons/undo.svg" />
                Undo
              </button>
              <button
                type="button"
                className={`${adminStyles.editorButton} ${styles.iconButton}`}
                onClick={redo}
                disabled={historyLen.future === 0}
                title="Redo (Shift+Cmd+Z)"
              >
                <Icon src="/images/icons/redo.svg" />
                Redo
              </button>
            </>
          )}
          <button
            type="button"
            className={adminStyles.editorButton}
            onClick={() => {
              setHistoryOpen(true)
              setHistoryDetail(null)
              setHistoryError(null)
            }}
          >
            History
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                className={adminStyles.editorButton}
                onClick={() => setDiscardOpen(true)}
                disabled={!draftMeta && !dirty}
              >
                Discard draft
              </button>
              <button
                type="button"
                className={adminStyles.editorButtonPrimary}
                onClick={openPublish}
                disabled={Boolean(conflict) || (!draftMeta && !dirty)}
              >
                Publish…
              </button>
            </>
          )}
        </div>
      </div>

      {conflict && (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          <span>
            <strong>{conflict.savedBy.name}</strong> saved a draft{' '}
            {ago(conflict.savedAt, now)} while you were editing. Your changes
            have not been saved.
          </span>
          <span className={styles.actions}>
            <button
              type="button"
              className={adminStyles.editorButton}
              onClick={() => {
                const theirs = conflict
                setGuide(theirs.guide)
                setSavedGuide(theirs.guide)
                setDraftMeta({
                  savedAt: theirs.savedAt,
                  savedBy: theirs.savedBy,
                  basedOn: theirs.basedOn,
                })
                seenSavedAt.current = theirs.savedAt
                setConflict(null)
                setEditorKey(k => k + 1)
                past.current = []
                future.current = []
                lastEdit.current = null
                setHistoryLen({ past: 0, future: 0 })
              }}
            >
              Load their draft
            </button>
            <button
              type="button"
              className={adminStyles.editorButtonPrimary}
              onClick={() => {
                seenSavedAt.current = conflict.savedAt
                setConflict(null)
              }}
            >
              Keep mine
            </button>
          </span>
        </div>
      )}
      {notice && (
        <div className={`${styles.banner} ${styles.bannerOk}`}>
          <span>{notice}</span>
          <button
            type="button"
            className={adminStyles.editorButton}
            onClick={() => setNotice(null)}
          >
            OK
          </button>
        </div>
      )}
      {!canEdit && (
        <div className={styles.banner}>
          <span>
            View only: you can read the draft, open the preview and browse the
            history, but not change anything.
          </span>
        </div>
      )}

      <div className={styles.split}>
        <nav className={styles.outline} aria-label="Guide outline">
          <div className={styles.outlineHint}>
            {canEdit ? 'Click to edit · drag to reorder tabs' : 'Click to view'}
          </div>
          <button
            type="button"
            className={`${styles.node} ${selected.kind === 'intro' ? styles.nodeActive : ''}`}
            onClick={() => setSelected({ kind: 'intro' })}
          >
            <span className={styles.nodeLabel}>Intro</span>
          </button>
          {guide.tabs.map(tab => (
            <div key={tab.id}>
              <button
                type="button"
                className={`${styles.node} ${styles.nodeTab} ${selected.kind === 'tab' && selected.id === tab.id ? styles.nodeActive : ''} ${dragOver === tab.id ? styles.nodeDragOver : ''}`}
                onClick={() => setSelected({ kind: 'tab', id: tab.id })}
                draggable={canEdit}
                onDragStart={() => setDragging({ kind: 'tab', id: tab.id })}
                onDragOver={e => {
                  if (dragging?.kind === 'tab') {
                    e.preventDefault()
                    setDragOver(tab.id)
                  }
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => onDrop({ kind: 'tab', id: tab.id })}
                onDragEnd={() => {
                  setDragging(null)
                  setDragOver(null)
                }}
              >
                {canEdit && (
                  <span className={styles.nodeHandle} aria-hidden="true">
                    ⋮⋮
                  </span>
                )}
                <span className={styles.nodeLabel}>{tab.amount}</span>
              </button>
            </div>
          ))}
          {canEdit && (
            <button
              type="button"
              className={`${styles.node} ${styles.nodeAdd}`}
              onClick={addTab}
            >
              + Add amount tab
            </button>
          )}
        </nav>

        <section className={styles.pane}>
          {selected.kind === 'intro' && (
            <>
              <div>
                <div className={styles.paneCrumb}>Under the page title</div>
                <div className={styles.paneTitle}>Intro sentence</div>
              </div>
              <div className={styles.fieldHint}>
                One sentence. Bold shows as the light-teal highlight on the
                page.
              </div>
              <RichEditor
                key={`intro-${editorKey}`}
                mode="intro"
                value={guide.intro}
                editable={canEdit}
                onChange={rt => update(g => ({ ...g, intro: rt }), 'intro')}
              />
            </>
          )}

          {paneTab && (
            <>
              <div className={styles.paneHead}>
                <div>
                  <div className={styles.paneCrumb}>Amount tab</div>
                  <div className={styles.paneTitle}>
                    {paneTab.amount} donation
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    className={`${adminStyles.editorButton} ${styles.danger}`}
                    disabled={guide.tabs.length === 1}
                    title={
                      guide.tabs.length === 1
                        ? 'The guide needs at least one tab'
                        : 'Delete this tab and its sections (Undo brings it back)'
                    }
                    onClick={() => removeTab(paneTab.id)}
                  >
                    Delete tab
                  </button>
                )}
              </div>
              <div className={styles.tabFields}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Tab name</span>
                  <input
                    className={styles.input}
                    value={paneTab.amount}
                    maxLength={40}
                    disabled={!canEdit}
                    onChange={e =>
                      setTabField(paneTab.id, { amount: e.target.value })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    Lead sentence under the heading
                  </span>
                  <input
                    className={styles.input}
                    value={paneTab.lead}
                    maxLength={400}
                    disabled={!canEdit}
                    onChange={e =>
                      setTabField(paneTab.id, { lead: e.target.value })
                    }
                  />
                </label>
              </div>

              {paneTab.sections.map(s => (
                <div
                  key={s.id}
                  id={`section-${s.id}`}
                  className={`${styles.sectionBlock} ${canEdit ? styles.sectionBlockEditable : ''} ${focusSectionId === s.id ? styles.sectionBlockActive : ''} ${dragOver === s.id ? styles.sectionBlockDragOver : ''}`}
                  onDragOver={e => {
                    if (dragging?.kind === 'section') {
                      e.preventDefault()
                      setDragOver(s.id)
                    }
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={() => onDrop({ kind: 'section', id: s.id })}
                >
                  <div className={styles.sectionSide}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>If you have</span>
                      <input
                        className={styles.input}
                        value={s.time}
                        maxLength={60}
                        disabled={!canEdit}
                        onChange={e =>
                          setSectionField(s.id, { time: e.target.value })
                        }
                      />
                    </label>
                    {canEdit && (
                      <button
                        type="button"
                        className={`${adminStyles.editorButton} ${styles.danger}`}
                        onClick={() => removeSection(s.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <RichEditor
                    key={`${s.id}-${editorKey}`}
                    mode="section"
                    value={s.body}
                    editable={canEdit}
                    onChange={rt => setSectionField(s.id, { body: rt })}
                  />
                  {canEdit && (
                    <span
                      className={styles.sectionGrip}
                      draggable
                      title="Drag to reorder"
                      onDragStart={() =>
                        setDragging({ kind: 'section', id: s.id })
                      }
                      onDragEnd={() => {
                        setDragging(null)
                        setDragOver(null)
                      }}
                    >
                      <Icon src="/images/icons/grip.svg" />
                    </span>
                  )}
                </div>
              ))}
              {paneTab.sections.length === 0 && (
                <div className={styles.empty}>No sections yet.</div>
              )}

              {canEdit && (
                <div className={styles.paneActions}>
                  <button
                    type="button"
                    className={adminStyles.editorButton}
                    onClick={() => addSection(paneTab.id)}
                  >
                    + Add section
                  </button>
                </div>
              )}
            </>
          )}

          {selected.kind !== 'intro' && !paneTab && (
            <div className={styles.empty}>Pick something in the outline.</div>
          )}
        </section>
      </div>

      <div className={styles.preview}>
        <div className={styles.previewHead}>
          <span>Preview</span>
          <a
            href={previewSrc}
            target="_blank"
            rel="noreferrer"
            className={adminStyles.editorButton}
          >
            Open in new tab
          </a>
        </div>
        <div className={styles.previewFrame} ref={previewBox}>
          <iframe
            key={previewSrc}
            src={previewSrc}
            title="Donation guide preview"
            style={{
              width: `${previewWidth}px`,
              transform: `scale(${previewScale})`,
              height: `${760 / previewScale}px`,
            }}
          />
        </div>
      </div>

      {historyOpen && (
        <>
          <div className={styles.scrim} onClick={() => setHistoryOpen(false)} />
          <aside className={styles.drawer} aria-label="History">
            <div className={styles.drawerHead}>
              <span>History</span>
              <button
                type="button"
                className={adminStyles.editorButton}
                onClick={() => setHistoryOpen(false)}
              >
                Close
              </button>
            </div>
            <div className={styles.drawerBody}>
              {data.versions.length === 0 && (
                <div className={styles.empty}>
                  Nothing published yet. The page shows the copy built into the
                  code.
                </div>
              )}
              {data.versions.map(v => (
                <button
                  key={v.version}
                  type="button"
                  className={`${styles.versionRow} ${historyDetail?.version.version === v.version ? styles.versionRowActive : ''}`}
                  onClick={() => openVersion(v.version)}
                >
                  <span className={styles.versionNum}>v{v.version}</span>
                  <span>
                    {v.publishedBy.name}
                    <div className={styles.versionMeta}>
                      {when(v.publishedAt)}
                      {v.note ? ` · ${v.note}` : ''}
                    </div>
                  </span>
                  {v.version === data.live.version && (
                    <span className={styles.versionLive}>live now</span>
                  )}
                </button>
              ))}
              {historyBusy && <div className={styles.muted}>Loading…</div>}
              {historyError && (
                <div className={`${styles.banner} ${styles.bannerWarn}`}>
                  {historyError}
                </div>
              )}
              {historyDetail && (
                <div>
                  <div className={styles.diffWhere} style={{ marginTop: 16 }}>
                    Version {historyDetail.version.version}
                    {historyDetail.version.version === data.live.version
                      ? ' is what is live'
                      : ' compared with what is live'}
                  </div>
                  {historyDetail.version.version !== data.live.version && (
                    <>
                      {historyDetail.changesIfRestored.length === 0 ? (
                        <div className={styles.muted}>
                          Same text as the live version.
                        </div>
                      ) : (
                        <ChangeList changes={historyDetail.changesIfRestored} />
                      )}
                      {canEdit && (
                        <div
                          className={styles.paneActions}
                          style={{ marginTop: 16 }}
                        >
                          {!restoreArmed ? (
                            <button
                              type="button"
                              className={adminStyles.editorButtonPrimary}
                              onClick={() => setRestoreArmed(true)}
                            >
                              Restore this version…
                            </button>
                          ) : (
                            <>
                              <span className={styles.muted}>
                                This publishes version{' '}
                                {historyDetail.version.version} again as version{' '}
                                {data.live.version + 1}, and the live page
                                changes at once.
                              </span>
                              <button
                                type="button"
                                className={adminStyles.editorButtonPrimary}
                                disabled={historyBusy}
                                onClick={() =>
                                  restore(historyDetail.version.version)
                                }
                              >
                                Yes, put it live
                              </button>
                              <button
                                type="button"
                                className={adminStyles.editorButton}
                                onClick={() => setRestoreArmed(false)}
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </aside>
        </>
      )}

      {discardOpen && (
        <>
          <div className={styles.scrim} onClick={() => setDiscardOpen(false)} />
          <div
            className={styles.dialog}
            role="dialog"
            aria-label="Discard draft"
          >
            <div className={styles.drawerHead}>
              <span>Discard the draft?</span>
            </div>
            <div className={styles.dialogBody}>
              <p className={styles.muted}>
                Everything in the draft goes and the editor shows what is live
                again. Undo cannot bring it back.
              </p>
            </div>
            <div className={styles.dialogFoot}>
              <button
                type="button"
                className={adminStyles.editorButton}
                onClick={() => setDiscardOpen(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className={adminStyles.editorButtonPrimary}
                onClick={discardDraft}
              >
                Discard draft
              </button>
            </div>
          </div>
        </>
      )}

      {publishOpen && (
        <>
          <div
            className={styles.scrim}
            onClick={() => !publishBusy && setPublishOpen(false)}
          />
          <div className={styles.dialog} role="dialog" aria-label="Publish">
            <div className={styles.drawerHead}>
              <span>Publish version {data.live.version + 1}</span>
            </div>
            <div className={styles.dialogBody}>
              {publishChanges.length === 0 ? (
                <p className={styles.muted}>
                  The draft reads the same as what is live. Publishing only sets
                  the “Updated” date.
                </p>
              ) : (
                <>
                  <p className={styles.muted}>
                    {publishChanges.length} change
                    {publishChanges.length === 1 ? '' : 's'} go live on the page
                    within seconds, and the chatbot reads the new text from its
                    next conversation.
                  </p>
                  <ChangeList changes={publishChanges} />
                </>
              )}
              {publishError && (
                <div
                  className={`${styles.banner} ${styles.bannerWarn}`}
                  style={{ marginTop: 12 }}
                >
                  {publishError}
                </div>
              )}
            </div>
            <div className={styles.dialogFoot}>
              <button
                type="button"
                className={adminStyles.editorButton}
                disabled={publishBusy}
                onClick={() => setPublishOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={adminStyles.editorButtonPrimary}
                disabled={publishBusy || Boolean(publishError)}
                onClick={confirmPublish}
              >
                {publishBusy ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ChangeList({ changes }: { changes: Change[] }) {
  return (
    <div className={styles.diffList}>
      {changes.map((c, i) => (
        <div key={i} className={styles.diffItem}>
          <div className={styles.diffWhere}>
            {c.where}
            <span className={styles.diffKind}>
              {c.kind === 'moved' ? 'reordered' : c.kind}
            </span>
          </div>
          {c.before !== undefined && (
            <div className={`${styles.diffText} ${styles.diffBefore}`}>
              {c.before}
            </div>
          )}
          {c.after !== undefined && (
            <div className={`${styles.diffText} ${styles.diffAfter}`}>
              {c.after}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
