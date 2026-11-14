'use client'

/*
  The map strip on a /map addition: a small copy of the map editor under the
  listing, showing where the new pin would go.

  It opens on a suggested spot among the listings of the same category
  (src/lib/admin/map-spot.ts). The pin drags; a listing with no spot is
  placed with a click. Nothing here writes to Airtable: a suggested spot goes
  out with Publish, and a dragged one becomes two edits (x and y) on the
  card like any other, written when Publish is pressed.

  The canvas is the map editor's own (MapEditorCanvas), told to drag this
  one pin only. Nothing here touches the public /map.
*/

import { useEffect, useMemo, useRef, useState } from 'react'
import MapEditorCanvas, {
  type CanvasControls,
} from '@/app/admin/map/MapEditorCanvas'
import { MAP_AREA_BY_CATEGORY } from '@/lib/data/map-areas'
import type { EditorRecord } from '@/lib/admin/map-editor-core'
import {
  AREA_LABELS,
  BACKGROUND_IMAGE_URL,
  GRID_BOUNDS,
  MAP_HEIGHT,
  MAP_WIDTH,
} from '@/lib/admin/map-geometry'
import {
  suggestSpot,
  type Ground,
  type Spot,
  type SpotPin,
} from '@/lib/admin/map-spot'
import { tidySpot } from '@/lib/admin/queue-spot'
import styles from './queue.module.css'
import own from './MapSpot.module.css'

const API = '/api/admin/queue?map=1'

// ─── The map as it stands, read once and shared between items ──────────────

/** How long a read of the map is reused while stepping through items. */
const FRESH_MS = 2 * 60 * 1000

let mapRead: { at: number; records: Promise<EditorRecord[]> } | null = null
/** Listings published from this page a little while ago, by record: where
 *  they went. A read of the map may predate them, so they are laid over it,
 *  and the next suggestion keeps clear of them. Kept for a while after the
 *  write lands too, since a strip already open still holds the older read;
 *  then dropped, so a later move in the map editor is not overruled. */
const justPlaced = new Map<string, Spot & { at: number }>()
const PLACED_MS = 10 * 60 * 1000

/** One read of the map. A read that fails is tried twice more, a moment
 *  apart: Airtable drops the odd request, and a strip that needs a click to
 *  come back would hold up every /map addition behind it. */
async function fetchMap(): Promise<EditorRecord[]> {
  let failure = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt))
    try {
      const res = await fetch(API, { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as {
        records?: EditorRecord[]
        error?: string
      }
      if (res.ok && data.records) return data.records
      failure = data.error ?? `HTTP ${res.status}`
      // Not signed in, or no access: asking again changes nothing.
      if (res.status === 401 || res.status === 403) break
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(failure)
}

function readMap(): Promise<EditorRecord[]> {
  for (const [record, placed] of justPlaced) {
    if (Date.now() - placed.at > PLACED_MS) justPlaced.delete(record)
  }
  if (mapRead && Date.now() - mapRead.at < FRESH_MS) return mapRead.records
  const records = fetchMap()
  const read = { at: Date.now(), records }
  mapRead = read
  // A failed read is not kept: the next item tries again.
  records.catch(() => {
    if (mapRead === read) mapRead = null
  })
  return records
}

/** A /map addition is on its way out with this spot: later suggestions on
 *  this page count it as taken. */
export function notePlaced(record: string, spot: Spot) {
  justPlaced.set(record, { ...spot, at: Date.now() })
}

/** A decision on a /map item has landed: the map is read again when next
 *  needed. With `record`, that listing did not go out after all (the
 *  publish failed, or was undone), and its place is free again. */
export function forgetMap(record?: string | null) {
  mapRead = null
  if (record) justPlaced.delete(record)
}

// ─── What the picture shows under a spot ───────────────────────────────────

/** The background image, drawn small and read back, so a suggestion can
 *  stay on the kind of ground an area's pins sit on. Null when the browser
 *  will not let the page read it; suggestions then go by the pins alone. */
let groundRead: Promise<Ground | null> | null = null

function readGround(): Promise<Ground | null> {
  return (groundRead ??= new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      try {
        const w = 1240
        const h = Math.round((w * MAP_HEIGHT) / MAP_WIDTH)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('no 2d canvas')
        ctx.drawImage(img, 0, 0, w, h)
        const data = ctx.getImageData(0, 0, w, h).data
        const perUnit = w / GRID_BOUNDS.x[1]
        resolve((x, y) => {
          const px = Math.round(x * perUnit)
          const py = Math.round(y * perUnit)
          if (px < 0 || py < 0 || px >= w || py >= h) return null
          const i = (py * w + px) * 4
          // Open water is see-through; land is named by its colour, coarsely.
          if (data[i + 3] < 128) return 'sea'
          return `${data[i] >> 4}.${data[i + 1] >> 4}.${data[i + 2] >> 4}`
        })
      } catch (e) {
        console.warn(
          `[queue] The map picture could not be read (${e instanceof Error ? e.message : String(e)}); spots are suggested from the pins alone.`
        )
        resolve(null)
      }
    }
    img.onerror = () => {
      console.warn(
        '[queue] The map picture did not load; spots are suggested from the pins alone.'
      )
      resolve(null)
    }
    img.src = BACKGROUND_IMAGE_URL
  }))
}

// ─── The strip ─────────────────────────────────────────────────────────────

/** How close the strip opens on the spot. */
const OPEN_ZOOM = 3

function areaOf(category: string): string | null {
  const first = category.split(',')[0]?.trim() ?? ''
  return (first && MAP_AREA_BY_CATEGORY[first]) || null
}

export default function MapSpot({
  record,
  title,
  label,
  description,
  category,
  scale,
  logo,
  spot,
  edited,
  claimed,
  canEdit,
  focusTick,
  onSuggest,
  onMove,
  onReset,
}: {
  /** The Map record being added. */
  record: string
  /** Its Long name, and what /map prints under the logo (Short name). */
  title: string
  label: string
  description: string | null
  /** Its categories, comma-joined: the first decides the area. */
  category: string
  scale: string | null
  /** Its "Logo (for map)", when the page holds a link to it. */
  logo: string | null
  /** The place the record or the edits hold; null = none yet. */
  spot: Spot | null
  /** That place is an edit made on this page. */
  edited: boolean
  /** Places other open additions hold in their own edits, by record. */
  claimed: Record<string, Spot>
  canEdit: boolean
  /** Bumped when Publish is pressed with no place: the strip shows itself. */
  focusTick: number
  /** The suggested spot, whenever it changes (null = none). */
  onSuggest: (spot: Spot | null) => void
  onMove: (spot: Spot) => void
  /** Drop the edited place, back to the suggested one. */
  onReset: () => void
}) {
  const [map, setMap] = useState<EditorRecord[] | null>(null)
  const [ground, setGround] = useState<Ground | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const controlsRef = useRef<CanvasControls>({
    zoomIn: () => {},
    zoomOut: () => {},
    reset: () => {},
    focusOn: () => {},
  })
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let alive = true
    readMap().then(
      records => {
        if (alive) setMap(records)
      },
      e => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    )
    void readGround().then(g => {
      // Wrapped: handed a function, setState would call it.
      if (alive) setGround(() => g)
    })
    return () => {
      alive = false
    }
  }, [attempt])

  const area = areaOf(category)

  // Every other listing, each where it is: on the record, published from
  // this page a moment ago, or held in another open addition's edits.
  const others = useMemo(() => {
    if (!map) return null
    return map
      .filter(r => r.id !== record)
      .map(r => {
        const at = justPlaced.get(r.id) ?? claimed[r.id]
        return at ? { ...r, x: at.x, y: at.y } : r
      })
      .filter(r => r.x !== null && r.y !== null)
  }, [map, record, claimed])

  // The suggestion, worked out only while the listing has no place of its
  // own, and only once the picture has been read (or has failed to), so
  // the pin does not jump when it arrives.
  const suggested = useMemo(() => {
    if (spot || !others || ground === undefined) return null
    const pins: SpotPin[] = others.map(r => ({
      id: r.id,
      x: r.x as number,
      y: r.y as number,
      scale: r.scale,
      label: r.labelName,
      area: r.area,
    }))
    return suggestSpot(pins, { scale, label, area }, ground ?? undefined)
  }, [spot, others, ground, scale, label, area])

  const onSuggestRef = useRef(onSuggest)
  useEffect(() => {
    onSuggestRef.current = onSuggest
  })
  useEffect(() => {
    onSuggestRef.current(suggested)
  }, [suggested])
  // Leaving the item takes its suggestion with it.
  useEffect(() => () => onSuggestRef.current(null), [])

  const ready = Boolean(others) && ground !== undefined
  const at = spot ?? suggested

  // The new listing as a pin, drawn from the card as it reads now, so an
  // edit to its Short name, Scale or Category shows here too.
  const records = useMemo(() => {
    if (!others) return []
    const base = map?.find(r => r.id === record)
    const pin: EditorRecord = {
      id: record,
      title,
      tooltipTitle: title,
      shortName: label,
      labelName: label,
      description,
      category,
      area,
      status: base?.status ?? 'Active',
      scale,
      mapLogo: base?.mapLogo ?? logo,
      x: at?.x ?? null,
      y: at?.y ?? null,
      published: false,
      isMagic: false,
      createdTime: base?.createdTime ?? null,
      // On top of everything, wherever /map would stack it.
      order: Number.MAX_SAFE_INTEGER,
    }
    return [...others, pin]
  }, [
    others,
    map,
    record,
    title,
    label,
    description,
    category,
    area,
    scale,
    logo,
    at?.x,
    at?.y,
  ])

  // Open on the spot (or on its area, when it has none yet), once.
  const opened = useRef(false)
  useEffect(() => {
    if (!ready || opened.current) return
    opened.current = true
    const areaLabel = AREA_LABELS.find(l => l.label === area)
    const centre = at ?? (areaLabel ? { x: areaLabel.x, y: areaLabel.y } : null)
    if (centre) controlsRef.current.focusOn(centre.x, centre.y, OPEN_ZOOM, true)
  }, [ready, at, area])

  // Publish pressed with no place: bring the strip into view.
  useEffect(() => {
    if (focusTick > 0) {
      sectionRef.current?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      })
    }
  }, [focusTick])

  const move = (x: number, y: number) => onMove(tidySpot(x, y))

  const state: React.ReactNode = error ? (
    <span className={own.error}>
      The map could not be read ({error}).{' '}
      <button
        type="button"
        className={own.link}
        onClick={() => {
          setError(null)
          setAttempt(n => n + 1)
        }}
      >
        Try again
      </button>
    </span>
  ) : !ready ? (
    <span className={own.muted}>Reading the map…</span>
  ) : spot ? (
    <span className={own.muted}>
      {edited ? 'Your spot' : 'The spot on the record'}
      {canEdit && ' · drag the pin to move it'}
    </span>
  ) : suggested ? (
    <span className={own.muted}>
      Suggested spot{area ? ` in ${area}` : ''}
      {canEdit && ' · drag the pin to move it'}
    </span>
  ) : (
    <span className={own.unplaced}>
      {area
        ? `No free spot found in ${area}`
        : 'No category yet, so no area to suggest a spot in'}
      {canEdit && ' · click the map to place it'}
    </span>
  )

  return (
    <section className={own.spot} ref={sectionRef}>
      <div className={own.line}>
        <span className={styles.label}>Spot on the map</span>
        {state}
        {at && (
          <span className={own.numbers}>
            <Coordinate
              name="x"
              value={at.x}
              max={GRID_BOUNDS.x[1]}
              disabled={!canEdit}
              onChange={x => move(x, at.y)}
            />
            <Coordinate
              name="y"
              value={at.y}
              max={GRID_BOUNDS.y[1]}
              disabled={!canEdit}
              onChange={y => move(at.x, y)}
            />
            {edited && <em className={styles.edited}>edited</em>}
          </span>
        )}
        {canEdit && edited && (
          <button type="button" className={own.link} onClick={onReset}>
            Back to the suggested spot
          </button>
        )}
      </div>
      {!error && (
        <div className={own.frame}>
          <MapEditorCanvas
            records={records}
            selectedId={record}
            placeModeId={canEdit && ready && !at ? record : null}
            previewPublic={false}
            onDrop={(_id, x, y) => move(x, y)}
            onSelect={() => {}}
            onPlaceClick={move}
            onDragStateChange={() => {}}
            controlsRef={controlsRef}
            readOnly={!canEdit}
            onlyId={record}
            quietWheel
          />
        </div>
      )}
    </section>
  )
}

/** One of the two numbers, typed: kept when the box is left or Enter is
 *  pressed. */
function Coordinate({
  name,
  value,
  max,
  disabled,
  onChange,
}: {
  name: string
  value: number
  max: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const keep = () => {
    if (text === null) return
    const n = Number(text)
    setText(null)
    if (text.trim() !== '' && Number.isFinite(n) && n !== value) onChange(n)
  }
  return (
    <label className={own.number}>
      {name}
      <input
        type="number"
        inputMode="decimal"
        step={0.1}
        min={0}
        max={max}
        value={text ?? value.toFixed(1)}
        disabled={disabled}
        aria-label={`${name} on the map`}
        onChange={e => setText(e.target.value)}
        onBlur={keep}
        onKeyDown={e => {
          // The Queue's own keys (A, R, the arrows) stay out of the box.
          e.stopPropagation()
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setText(null)
            e.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}
