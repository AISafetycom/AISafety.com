'use client'

import { useEffect, useRef, useState } from 'react'
import { PAGES } from '@/lib/assistant/pages'
import { DEFAULT_MODEL_ID, MODELS } from '@/lib/assistant/models'
import styles from '../admin.module.css'
import Icon from '@/components/Icon'

export interface ContextOverrides {
  currentPage: string
  geoCity: string
  geoRegion: string
  geoCountry: string
  referrer: string
  pageState: string
}

interface Version {
  id: string
  createdAt: string
  name: string
  prompt: string
  model: string
}

interface CurrentDraft {
  prompt: string
  model: string
  name: string
}

interface Props {
  productionPrompt: string
  prompt: string
  onPromptChange: (v: string) => void
  model: string
  onModelChange: (v: string) => void
  name: string
  onNameChange: (v: string) => void
  context: ContextOverrides
  onContextChange: (v: ContextOverrides) => void
}

const DRAFT_KEY = 'aisafety-admin-draft-v1'
const VERSIONS_KEY = 'aisafety-admin-versions-v1'
const AUTOSAVE_DEBOUNCE_MS = 600

function loadDraft(): CurrentDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as CurrentDraft
  } catch {
    return null
  }
}

function saveDraft(d: CurrentDraft): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
  } catch (err) {
    console.warn('[admin] draft persist failed', err)
  }
}

function loadVersions(): Version[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(VERSIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Version[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persistVersions(v: Version[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(VERSIONS_KEY, JSON.stringify(v))
  } catch (err) {
    console.warn('[admin] versions persist failed', err)
  }
}

export default function EditorPanel({
  productionPrompt,
  prompt,
  onPromptChange,
  model,
  onModelChange,
  name,
  onNameChange,
  context,
  onContextChange,
}: Props) {
  const [versions, setVersions] = useState<Version[]>([])
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [statusText, setStatusText] = useState('')
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [loadedVersionId, setLoadedVersionId] = useState<string | null>(null)
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null)
  const armedTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedRef = useRef('')
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hydratedRef = useRef(false)

  // Hydrate current draft + versions from localStorage on mount
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    const draft = loadDraft()
    if (draft) {
      onPromptChange(draft.prompt)
      onModelChange(draft.model || DEFAULT_MODEL_ID)
      onNameChange(draft.name || 'Draft')
      lastSavedRef.current = serialize(draft.prompt, draft.model, draft.name)
    } else {
      lastSavedRef.current = serialize(prompt, model, name)
    }
    setVersions(loadVersions())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-save the WORKING DRAFT (not a version) on edits
  useEffect(() => {
    const current = serialize(prompt, model, name)
    if (current === lastSavedRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setStatus('saving')
    setStatusText('saving…')
    saveTimerRef.current = setTimeout(() => {
      saveDraft({ prompt, model, name })
      lastSavedRef.current = current
      setStatus('saved')
      setStatusText('draft saved')
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [prompt, model, name])

  // Clear the "loaded version" highlight whenever the working draft diverges
  // from the loaded snapshot.
  useEffect(() => {
    if (!loadedVersionId) return
    const v = versions.find(x => x.id === loadedVersionId)
    if (!v) {
      setLoadedVersionId(null)
      return
    }
    if (v.prompt !== prompt || v.model !== model || v.name !== name) {
      setLoadedVersionId(null)
    }
  }, [prompt, model, name, loadedVersionId, versions])

  const handleSaveVersion = () => {
    const versionName = (name || 'Untitled').trim()
    const version: Version = {
      id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      name: versionName,
      prompt,
      model,
    }
    const next = [version, ...versions].slice(0, 100)
    setVersions(next)
    persistVersions(next)
    setLoadedVersionId(version.id)
    setVersionsOpen(true)
    setStatus('saved')
    setStatusText(`saved "${versionName}"`)
  }

  const handlePickVersion = (id: string) => {
    if (!id) return
    const v = versions.find(x => x.id === id)
    if (!v) return
    onPromptChange(v.prompt)
    onModelChange(v.model || DEFAULT_MODEL_ID)
    onNameChange(v.name)
    lastSavedRef.current = serialize(v.prompt, v.model, v.name)
    setLoadedVersionId(id)
    setStatusText(`loaded "${v.name}"`)
  }

  // Two-click delete: first click arms (turns red); second within 3s deletes;
  // any other click or 3s timeout cancels.
  const handleDeleteVersion = (id: string) => {
    if (armedDeleteId === id) {
      if (armedTimerRef.current) clearTimeout(armedTimerRef.current)
      setArmedDeleteId(null)
      const next = versions.filter(v => v.id !== id)
      setVersions(next)
      persistVersions(next)
      if (loadedVersionId === id) setLoadedVersionId(null)
      return
    }
    if (armedTimerRef.current) clearTimeout(armedTimerRef.current)
    setArmedDeleteId(id)
    armedTimerRef.current = setTimeout(() => setArmedDeleteId(null), 3000)
  }

  // Cleanup the armed timer on unmount
  useEffect(() => {
    return () => {
      if (armedTimerRef.current) clearTimeout(armedTimerRef.current)
    }
  }, [])

  const handleResetProduction = () => {
    onPromptChange(productionPrompt)
  }

  const setCtx = (patch: Partial<ContextOverrides>) =>
    onContextChange({ ...context, ...patch })

  const statusClass = status === 'saving' ? styles.editorStatusSaving : ''

  return (
    <>
      <div className={styles.editorBlock}>
        <div className={styles.editorBlockHeader}>
          <h2 className={styles.editorBlockTitle}>Prompt</h2>
          <span className={`${styles.editorStatus} ${statusClass}`}>
            {statusText || (lastSavedRef.current ? 'draft saved' : '')}
          </span>
        </div>
        <p className={styles.sectionHint}>
          The prompt is the bot&apos;s instructions: what it is for, what it may
          recommend, how it should answer. The live site runs the production
          prompt shown at the top right, which is changed in code, so edits here
          only affect this sandbox. Your draft saves itself in this browser as
          you type. &ldquo;Save version&rdquo; keeps a snapshot under the name
          below so you can reload it later; &ldquo;Reset to production&rdquo;
          puts the live prompt back. Model picks which Claude answers, and
          &ldquo;(production)&rdquo; marks the one visitors get. Once a version
          works well, send it to Bryce to go live.
        </p>

        <div className={styles.editorRow}>
          <label className={styles.editorRowLabel}>Name</label>
          <input
            className={styles.editorInput}
            value={name}
            onChange={e => onNameChange(e.target.value)}
            placeholder="Draft name"
          />
        </div>
        <div className={styles.editorRow}>
          <label className={styles.editorRowLabel}>Model</label>
          <select
            className={styles.editorSelect}
            value={model}
            onChange={e => onModelChange(e.target.value)}
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>
                {m.longLabel}
                {m.id === DEFAULT_MODEL_ID ? ' (production)' : ''}
              </option>
            ))}
          </select>
        </div>

        <textarea
          className={styles.editorTextarea}
          value={prompt}
          onChange={e => onPromptChange(e.target.value)}
          spellCheck={false}
        />

        <div className={styles.editorToolbar}>
          <button
            type="button"
            className={styles.editorButtonPrimary}
            onClick={handleSaveVersion}
          >
            Save version
          </button>
          <button
            type="button"
            className={styles.editorButton}
            onClick={handleResetProduction}
          >
            Reset to production
          </button>
        </div>

        {versions.length > 0 && (
          <div className={styles.editorVersionList}>
            <button
              type="button"
              className={styles.editorVersionListToggle}
              onClick={() => setVersionsOpen(o => !o)}
              aria-expanded={versionsOpen}
            >
              <span>Saved versions ({versions.length})</span>
              <Icon
                src="/images/icons/chevron-down.svg"
                size={16}
                className={styles.editorVersionListChevron}
              />
            </button>
            {versionsOpen && (
              <div className={styles.editorVersionListBody}>
                {versions.map(v => {
                  const isActive = v.id === loadedVersionId
                  const isArmed = v.id === armedDeleteId
                  return (
                    <div
                      key={v.id}
                      className={`${styles.editorVersionRow} ${isActive ? styles.editorVersionRowActive : ''}`}
                    >
                      <button
                        type="button"
                        className={styles.editorVersionPick}
                        onClick={() => handlePickVersion(v.id)}
                        title={`Load "${v.name}"`}
                      >
                        <span className={styles.editorVersionName}>
                          {v.name}
                          {isActive && (
                            <span
                              className={styles.editorVersionActiveDot}
                              aria-label="Loaded"
                            >
                              ●
                            </span>
                          )}
                        </span>
                        <span className={styles.editorVersionMeta}>
                          {new Date(v.createdAt).toLocaleString()}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`${styles.editorVersionDelete} ${isArmed ? styles.editorVersionDeleteArmed : ''}`}
                        onClick={() => handleDeleteVersion(v.id)}
                        aria-label={
                          isArmed
                            ? `Confirm delete ${v.name}`
                            : `Delete ${v.name}`
                        }
                        title={isArmed ? 'Click again to confirm' : 'Delete'}
                      >
                        {isArmed ? 'Delete?' : '×'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.editorBlock}>
        <div className={styles.editorBlockHeader}>
          <h2 className={styles.editorBlockTitle}>Context</h2>
        </div>
        <p className={styles.sectionHint}>
          Sent with each test message, in the same shape the live site sends.
          Page is where the visitor is, which sets the greeting and the
          suggestion chips. Page state is any filters they have set on that
          page, as JSON. Referrer is the link they arrived from. Location is
          pre-filled from your own IP. Edit anything to act as a different
          visitor.
        </p>

        <div className={styles.editorRow}>
          <label className={styles.editorRowLabel}>Page</label>
          <select
            className={styles.editorSelect}
            value={context.currentPage}
            onChange={e => setCtx({ currentPage: e.target.value })}
          >
            {PAGES.map(p => (
              <option key={p.path} value={p.path}>
                {p.path} · {p.title}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.editorRow}>
          <label className={styles.editorRowLabel}>City</label>
          <input
            className={styles.editorInput}
            value={context.geoCity}
            onChange={e => setCtx({ geoCity: e.target.value })}
            placeholder="London"
          />
        </div>
        <div className={styles.editorRow}>
          <label className={styles.editorRowLabel}>Region</label>
          <input
            className={styles.editorInput}
            value={context.geoRegion}
            onChange={e => setCtx({ geoRegion: e.target.value })}
            placeholder="England"
          />
        </div>
        <div className={styles.editorRow}>
          <label className={styles.editorRowLabel}>Country</label>
          <input
            className={styles.editorInput}
            value={context.geoCountry}
            onChange={e => setCtx({ geoCountry: e.target.value })}
            placeholder="GB"
          />
        </div>
        <div className={styles.editorRow}>
          <label className={styles.editorRowLabel}>Referrer</label>
          <input
            className={styles.editorInput}
            value={context.referrer}
            onChange={e => setCtx({ referrer: e.target.value })}
            placeholder="https://google.com/?q=..."
          />
        </div>
        <div className={styles.editorRow}>
          <label className={styles.editorRowLabel}>Page state</label>
          <input
            className={styles.editorInput}
            value={context.pageState}
            onChange={e => setCtx({ pageState: e.target.value })}
            placeholder='{"filters":{"workLocation":"Remote"}}'
          />
        </div>
      </div>
    </>
  )
}

function serialize(prompt: string, model: string, name: string): string {
  return `${name}::${model}::${prompt}`
}
