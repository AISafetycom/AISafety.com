'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorRecord, ScaleName } from '@/lib/admin/map-editor-core'
import {
  isScaleName,
  MAP_TABLE_ID,
  SCALE_OPTIONS,
} from '@/lib/admin/map-editor-core'
import { DEFAULT_SCALE_NAME, GRID_BOUNDS } from '@/lib/admin/map-geometry'
import adminStyles from '../admin.module.css'
import styles from './map-editor.module.css'

const AIRTABLE_BASE_URL = 'https://airtable.com/appF8XfZUGXtfi40E'
/** Search results shown before asking for a narrower query. */
const MAX_RESULTS = 50

export type PanelTab = 'unplaced' | 'selected'

interface Props {
  records: EditorRecord[]
  selected: EditorRecord | null
  placeModeId: string | null
  tab: PanelTab
  onTabChange: (tab: PanelTab) => void
  onPlace: (id: string) => void
  /** A search result was chosen: select it and jump to it if it is placed. */
  onPick: (id: string) => void
  onSetPosition: (id: string, x: number, y: number) => void
  /** Change the record's Scale (logo size); saved like a move. */
  onSetScale: (id: string, scale: ScaleName) => void
  /** A view-only session: the same lists and details, nothing to place,
   *  move or resize. */
  readOnly: boolean
}

/** Case-insensitive match on any name the record goes by, or its category.
 *  Name-prefix matches sort first, then alphabetical. */
function searchRecords(records: EditorRecord[], query: string): EditorRecord[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const names = (r: EditorRecord) =>
    [r.title, r.labelName, r.shortName ?? '', r.tooltipTitle].map(s =>
      s.toLowerCase()
    )
  const rank = (r: EditorRecord): number => {
    const ns = names(r)
    if (ns.some(n => n.startsWith(q))) return 0
    if (ns.some(n => n.includes(q))) return 1
    if (r.category.toLowerCase().includes(q)) return 2
    return -1
  }
  return records
    .map(r => ({ r, rank: rank(r) }))
    .filter(x => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.r.title.localeCompare(b.r.title))
    .map(x => x.r)
}

function Badges({ r }: { r: EditorRecord }) {
  return (
    <span className={styles.badges}>
      <span className={r.published ? styles.badgeLive : styles.badgeDraft}>
        {r.published ? 'Published' : 'Incoming suggestion'}
      </span>
      {r.isMagic && <span className={styles.badgeWarn}>furniture</span>}
      {!r.mapLogo && <span className={styles.badgeWarn}>no map logo</span>}
      {!r.description && (
        <span className={styles.badgeWarn}>no description</span>
      )}
      {!r.scale && (
        <span className={styles.badgeWarn}>no Scale (drawn Medium)</span>
      )}
    </span>
  )
}

function airtableUrl(id: string): string {
  return `${AIRTABLE_BASE_URL}/${MAP_TABLE_ID}/${id}`
}

export default function SidePanel({
  records,
  selected,
  placeModeId,
  tab,
  onTabChange,
  onPlace,
  onPick,
  onSetPosition,
  onSetScale,
  readOnly,
}: Props) {
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // Typed-but-not-yet-applied x/y for the selected record.
  const [draft, setDraft] = useState<{
    id: string
    x: string
    y: string
  } | null>(null)

  const unplaced = useMemo(
    () =>
      records
        .filter(r => r.x === null || r.y === null)
        // Published-but-unplaced first (they are missing from the live map),
        // then newest additions to Airtable (same order as the Incoming
        // suggestions view), then by name.
        .sort((a, b) => {
          if (a.published !== b.published) return a.published ? -1 : 1
          const t = (b.createdTime ?? '').localeCompare(a.createdTime ?? '')
          return t !== 0 ? t : a.title.localeCompare(b.title)
        }),
    [records]
  )

  const results = useMemo(
    () => searchRecords(records, search),
    [records, search]
  )
  const searching = search.trim() !== ''
  const shown = results.slice(0, MAX_RESULTS)
  // Keyboard cursor in the results (↑/↓ move it, Enter opens it). Reset to
  // the first row whenever the query changes.
  const [cursor, setCursor] = useState(0)
  const active = Math.min(cursor, Math.max(0, shown.length - 1))
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, search])

  // "/" anywhere on the page (except while typing in a field) jumps into the
  // search box, like GitHub. The editor's own shortcuts ignore "/", so the
  // two never fight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const setQuery = (q: string) => {
    setSearch(q)
    setCursor(0)
  }
  // After a pick the search box lets go of focus so the editor's shortcuts
  // (arrows, Escape, Cmd+Z) act on the map straight away.
  const pick = (id: string) => {
    onPick(id)
    setQuery('')
    searchRef.current?.blur()
  }
  const placeFromSearch = (id: string) => {
    onPlace(id)
    setQuery('')
    searchRef.current?.blur()
  }

  const shownTab = tab
  const xValue =
    draft && selected && draft.id === selected.id
      ? draft.x
      : selected?.x === null || selected?.x === undefined
        ? ''
        : selected.x.toFixed(1)
  const yValue =
    draft && selected && draft.id === selected.id
      ? draft.y
      : selected?.y === null || selected?.y === undefined
        ? ''
        : selected.y.toFixed(1)

  const submitPosition = () => {
    if (!selected) return
    const x = Number(xValue)
    const y = Number(yValue)
    if (
      xValue === '' ||
      yValue === '' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    )
      return
    setDraft(null)
    onSetPosition(selected.id, x, y)
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.searchBar}>
        <input
          ref={searchRef}
          className={`${adminStyles.editorInput} ${styles.search}`}
          type="search"
          placeholder="Find a listing (placed or unplaced)…"
          aria-label="Find a listing"
          value={search}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor(Math.min(active + 1, shown.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor(Math.max(active - 1, 0))
            } else if (e.key === 'Enter' && shown[active]) {
              e.preventDefault()
              pick(shown[active].id)
            } else if (e.key === 'Escape') {
              // First Escape clears; a second one leaves the box so the
              // editor's own Escape (deselect / reset view) takes over.
              if (searching) setQuery('')
              else searchRef.current?.blur()
            }
          }}
        />
        <kbd className={styles.searchKey} aria-hidden="true">
          /
        </kbd>
      </div>

      {searching && (
        <div className={styles.panelBody}>
          {results.length === 0 ? (
            <p className={adminStyles.sectionHint}>No matches.</p>
          ) : (
            <>
              <p className={adminStyles.sectionHint}>
                {results.length === 1 ? '1 match' : `${results.length} matches`}{' '}
                · ↑↓ to move · Enter to open · Esc to clear
              </p>
              <ul className={styles.list} ref={listRef}>
                {shown.map((r, i) => {
                  const placed = r.x !== null && r.y !== null
                  return (
                    <li
                      key={r.id}
                      data-active={i === active}
                      className={`${styles.row} ${styles.rowResult} ${
                        i === active ? styles.rowActive : ''
                      } ${selected?.id === r.id ? styles.rowSelected : ''}`}
                    >
                      <button
                        type="button"
                        className={styles.resultPick}
                        title={
                          placed
                            ? 'Show on the map'
                            : 'Select (not on the map yet)'
                        }
                        onClick={() => pick(r.id)}
                      >
                        <span className={styles.rowLogo}>
                          {r.mapLogo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.mapLogo} alt="" />
                          ) : (
                            <span className={styles.rowLogoMissing} />
                          )}
                        </span>
                        <span className={styles.rowMain}>
                          <span className={styles.rowTitle}>{r.title}</span>
                          <span className={styles.rowMeta}>
                            {r.category || '—'}
                          </span>
                          <span className={styles.badges}>
                            <span
                              className={
                                r.published
                                  ? styles.badgeLive
                                  : styles.badgeDraft
                              }
                            >
                              {r.published
                                ? 'Published'
                                : 'Incoming suggestion'}
                            </span>
                          </span>
                        </span>
                      </button>
                      {placed ? (
                        <span className={styles.rowCoords}>
                          {r.x!.toFixed(1)}, {r.y!.toFixed(1)}
                        </span>
                      ) : readOnly ? null : (
                        <button
                          type="button"
                          className={
                            placeModeId === r.id
                              ? adminStyles.editorButtonPrimary
                              : adminStyles.editorButton
                          }
                          onClick={() => placeFromSearch(r.id)}
                        >
                          {placeModeId === r.id ? 'Placing…' : 'Place'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
              {results.length > MAX_RESULTS && (
                <p className={adminStyles.sectionHint}>
                  Showing the first {MAX_RESULTS} – keep typing to narrow it
                  down.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {!searching && (
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${shownTab === 'unplaced' ? styles.tabActive : ''}`}
            onClick={() => onTabChange('unplaced')}
          >
            Unplaced ({unplaced.length})
          </button>
          <button
            type="button"
            className={`${styles.tab} ${shownTab === 'selected' ? styles.tabActive : ''}`}
            onClick={() => onTabChange('selected')}
          >
            Selected
          </button>
        </div>
      )}

      {!searching && shownTab === 'unplaced' && (
        <div className={styles.panelBody}>
          {unplaced.length === 0 ? (
            <p className={adminStyles.sectionHint}>
              Everything has coordinates.
            </p>
          ) : (
            <ul className={styles.list}>
              {unplaced.map(r => (
                <li
                  key={r.id}
                  className={`${styles.row} ${
                    r.published ? styles.rowLiveUnplaced : ''
                  } ${placeModeId === r.id ? styles.rowPlacing : ''}`}
                >
                  <span className={styles.rowLogo}>
                    {r.mapLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.mapLogo} alt="" />
                    ) : (
                      <span className={styles.rowLogoMissing} />
                    )}
                  </span>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{r.title}</span>
                    <span className={styles.rowMeta}>
                      {r.category || '—'}
                      {r.scale ? ` · ${r.scale}` : ''}
                    </span>
                    {r.published && (
                      <span className={styles.missingNote}>
                        Published but not on the map yet
                      </span>
                    )}
                    <Badges r={r} />
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      className={
                        placeModeId === r.id
                          ? adminStyles.editorButtonPrimary
                          : adminStyles.editorButton
                      }
                      onClick={() => onPlace(r.id)}
                    >
                      {placeModeId === r.id ? 'Placing…' : 'Place'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!searching && shownTab === 'selected' && (
        <div className={styles.panelBody}>
          {!selected ? (
            <p className={adminStyles.sectionHint}>
              Click a listing on the map to select it.
            </p>
          ) : (
            <div className={styles.detail}>
              <div className={styles.detailHead}>
                <span className={styles.rowLogo}>
                  {selected.mapLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selected.mapLogo} alt="" />
                  ) : (
                    <span className={styles.rowLogoMissing} />
                  )}
                </span>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{selected.title}</span>
                  <span className={styles.rowMeta}>
                    {selected.category || '—'}
                  </span>
                  <Badges r={selected} />
                </span>
              </div>
              <dl className={styles.dl}>
                <dt>Status</dt>
                <dd>{selected.status}</dd>
                <dt>Scale</dt>
                <dd>
                  {readOnly ? (
                    isScaleName(selected.scale) ? (
                      selected.scale
                    ) : (
                      `Not set – drawn as ${DEFAULT_SCALE_NAME}`
                    )
                  ) : (
                    <select
                      className={`${adminStyles.editorSelect} ${styles.scaleSelect}`}
                      aria-label="Scale (logo size)"
                      // An unset Scale shows as a disabled placeholder so the
                      // first real choice is a deliberate one.
                      value={isScaleName(selected.scale) ? selected.scale : ''}
                      onChange={e => {
                        const v = e.target.value
                        if (isScaleName(v)) onSetScale(selected.id, v)
                      }}
                    >
                      {!isScaleName(selected.scale) && (
                        <option value="" disabled>
                          {selected.scale
                            ? `${selected.scale} (unknown)`
                            : `Not set – drawn as ${DEFAULT_SCALE_NAME}`}
                        </option>
                      )}
                      {SCALE_OPTIONS.map(s => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  )}
                </dd>
                <dt>Label</dt>
                <dd>{selected.labelName}</dd>
              </dl>
              {readOnly ? (
                <p className={adminStyles.sectionHint}>
                  {selected.x === null || selected.y === null
                    ? 'Not on the map yet.'
                    : `At ${selected.x.toFixed(1)}, ${selected.y.toFixed(1)}.`}
                </p>
              ) : (
                <>
                  <div className={styles.coords}>
                    <label>
                      x
                      <input
                        className={adminStyles.editorInput}
                        type="number"
                        step="0.1"
                        min={GRID_BOUNDS.x[0]}
                        max={GRID_BOUNDS.x[1]}
                        value={xValue}
                        onChange={e =>
                          setDraft({
                            id: selected.id,
                            x: e.target.value,
                            y: yValue,
                          })
                        }
                        onKeyDown={e => e.key === 'Enter' && submitPosition()}
                      />
                    </label>
                    <label>
                      y
                      <input
                        className={adminStyles.editorInput}
                        type="number"
                        step="0.1"
                        min={GRID_BOUNDS.y[0]}
                        max={GRID_BOUNDS.y[1]}
                        value={yValue}
                        onChange={e =>
                          setDraft({
                            id: selected.id,
                            x: xValue,
                            y: e.target.value,
                          })
                        }
                        onKeyDown={e => e.key === 'Enter' && submitPosition()}
                      />
                    </label>
                    <button
                      type="button"
                      className={adminStyles.editorButton}
                      onClick={submitPosition}
                    >
                      Set
                    </button>
                  </div>
                  <p className={adminStyles.sectionHint}>
                    Arrow keys nudge the selected listing by 0.1 (Shift: 1.0).
                    Map is 0–{GRID_BOUNDS.x[1]} wide, 0–{GRID_BOUNDS.y[1]} tall.
                  </p>
                  {(selected.x === null || selected.y === null) && (
                    <button
                      type="button"
                      className={adminStyles.editorButtonPrimary}
                      onClick={() => onPlace(selected.id)}
                    >
                      {placeModeId === selected.id
                        ? 'Placing…'
                        : 'Place on map'}
                    </button>
                  )}
                </>
              )}
              <a
                className={styles.airtableLink}
                href={airtableUrl(selected.id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Airtable ↗
              </a>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
