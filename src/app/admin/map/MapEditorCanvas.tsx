'use client'

/*
  The editor's map canvas. Draws the same scene as the public /map (same
  background, title, area labels, logo sizes and label pills — see
  src/lib/admin/map-geometry.ts, a guarded copy of D3Map's numbers) and adds
  what the public map must never have: draggable pins, a place-mode click,
  selection/draft rings, and a live x/y readout.

  Kept deliberately separate from src/app/map/D3Map.tsx: nothing in here is
  imported by the public map, and nothing here imports it. No analytics.
*/

import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import MapControls from '@/components/MapControls'
import { positionTooltip } from '@/lib/mapTooltip'
import {
  AREA_LABELS,
  AREA_LABEL_STYLE,
  BACKGROUND_IMAGE_URL,
  MAP_HEIGHT,
  MAP_OFFSET_X,
  MAP_OFFSET_Y,
  MAP_WIDTH,
  PADDED_HEIGHT,
  PADDED_WIDTH,
  PRESERVE_ASPECT_RATIO,
  TITLE,
  VIEWBOX,
  ZOOM_EXTENT,
  clampGrid,
  gridToPx,
  logoMetrics,
  pxToGrid,
  roundGrid,
} from '@/lib/admin/map-geometry'
import type { EditorRecord } from '@/lib/admin/map-editor-core'
import styles from './map-editor.module.css'

export interface CanvasControls {
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
  /** Pan (and zoom in to at least FOCUS_ZOOM) so this grid position is
   *  centred in the visible canvas. */
  focusOn: (x: number, y: number) => void
}

/** Zoom level a "Show on map" jump lands at (kept if already closer). */
const FOCUS_ZOOM = 2

interface Props {
  /** Records to draw (already filtered by the toolbar toggles). Records with
   *  no x/y are skipped — they live in the side tray. */
  records: EditorRecord[]
  selectedId: string | null
  /** Record currently being placed from the tray (click on the map drops it). */
  placeModeId: string | null
  /** Hide every editor-only decoration so the canvas matches /map. */
  previewPublic: boolean
  onDrop: (id: string, x: number, y: number, clamped: boolean) => void
  onSelect: (id: string | null) => void
  onPlaceClick: (x: number, y: number) => void
  onDragStateChange: (dragging: boolean) => void
  /** Filled in by the canvas so the parent (keyboard shortcuts) can zoom. */
  controlsRef: React.MutableRefObject<CanvasControls>
  /** A view-only session: pins select on click but never drag or place. */
  readOnly: boolean
}

const LOGO_CLIP_ID = 'editor-logo-circle-clip'
const RING_GAP = 3
/** Selection ring: a vivid magenta that reads on the teal land, the orange
 *  hills and dark water. No white halo – it looked like a second logo
 *  circle. */
const SELECTED_COLOR = '#ff2d95'

type PinSel = d3.Selection<SVGGElement, EditorRecord, SVGGElement, unknown>

function glyphSignature(r: EditorRecord): string {
  return `${r.scale ?? ''}|${r.labelName}|${r.mapLogo ?? ''}`
}

/** Draws one pin's children (same element order and metrics as D3Map). */
function drawGlyph(
  g: d3.Selection<SVGGElement, EditorRecord, null, undefined>
) {
  g.selectAll('*').remove()
  const r = g.datum()
  const m = logoMetrics(r.scale)

  // Editor-only rings sit underneath the glyph so they never cover it.
  g.append('circle')
    .attr('class', 'ring-draft')
    .attr('r', m.iconSize / 2 + RING_GAP)
    .attr('fill', 'none')
    .attr('stroke', '#f5b942')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '6 4')
    .style('pointer-events', 'none')
  g.append('circle')
    .attr('class', 'ring-selected')
    .attr('r', m.iconSize / 2 + RING_GAP)
    .attr('fill', 'none')
    .attr('stroke', SELECTED_COLOR)
    .attr('stroke-width', 3.5)
    .style('pointer-events', 'none')

  const glyph = g.append('g').attr('class', 'glyph')

  // White circle background
  glyph
    .append('circle')
    .attr('r', m.iconSize / 2)
    .attr('cx', 0)
    .attr('cy', 0)
    .attr('fill', '#fff')

  if (r.mapLogo) {
    const logoImg = glyph
      .append('image')
      .attr('href', r.mapLogo)
      .attr('width', m.contentSize)
      .attr('height', m.contentSize)
      .attr('x', -m.contentSize / 2)
      .attr('y', -m.contentSize / 2)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('clip-path', `url(#${LOGO_CLIP_ID})`)
    logoImg.on('error', () => {
      logoImg.remove()
      glyph
        .append('circle')
        .attr('r', m.contentSize / 2)
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('fill', '#f70')
    })
  } else {
    glyph
      .append('circle')
      .attr('r', m.contentSize / 2)
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('fill', 'red')
  }

  // Label below logo
  const labelG = glyph
    .append('g')
    .attr('transform', `translate(0, ${m.labelY})`)
  const textEl = labelG
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('font-family', 'Inter, sans-serif')
    .attr('font-weight', 600)
    .attr('font-size', m.fontSize)
    .style('letter-spacing', '-0.02em')
    .attr('fill', '#000')
    .text(r.labelName)
  const bbox = textEl.node()?.getBBox()
  if (bbox) {
    const rectW = bbox.width + m.padX * 2
    const rectH = bbox.height + m.padY * 2
    labelG
      .insert('rect', 'text')
      .attr('x', -rectW / 2)
      .attr('y', -rectH / 2)
      .attr('width', rectW)
      .attr('height', rectH)
      .attr('rx', rectH / 2)
      .attr('ry', rectH / 2)
      .attr('fill', '#fff')
    textEl.attr('y', bbox.height * 0.35)

    // Bridge rect between logo and label (a forgiving grab zone).
    const bridgeW = Math.max(m.iconSize, rectW)
    const bridgeH = (m.iconSize + rectH) / 2 + m.labelOffset
    glyph
      .append('rect')
      .attr('x', -bridgeW / 2)
      .attr('y', 0)
      .attr('width', bridgeW)
      .attr('height', bridgeH)
      .attr('fill', 'transparent')
      .lower()
  }
  g.attr('data-sig', glyphSignature(r))
}

export default function MapEditorCanvas({
  records,
  selectedId,
  placeModeId,
  previewPublic,
  onDrop,
  onSelect,
  onPlaceClick,
  onDragStateChange,
  controlsRef,
  readOnly,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const pinsLayerRef = useRef<SVGGElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  // Latest callbacks/state, read from inside d3 handlers without rebinding.
  const cbRef = useRef({ onDrop, onSelect, onPlaceClick, onDragStateChange })
  cbRef.current = { onDrop, onSelect, onPlaceClick, onDragStateChange }
  const placeModeRef = useRef(placeModeId)
  placeModeRef.current = placeModeId
  const draggingRef = useRef(false)
  const movedRef = useRef(false)

  const hideTooltip = () => {
    const tt = tooltipRef.current
    if (!tt) return
    tt.style.visibility = 'hidden'
    tt.style.opacity = '0'
  }

  // ── Static scene: built once ─────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    d3.select(container).select('svg').remove()

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', VIEWBOX)
      .attr('preserveAspectRatio', PRESERVE_ASPECT_RATIO)
      .style('transform', 'translateZ(0)')
      .style('backface-visibility', 'hidden')
    svgRef.current = svg.node()

    const svgGroup = svg
      .append('g')
      .attr('transform', `translate(${MAP_OFFSET_X}, ${MAP_OFFSET_Y})`)

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent(ZOOM_EXTENT)
      .on('zoom', event => {
        hideTooltip()
        svgGroup.attr(
          'transform',
          `translate(${event.transform.x + MAP_OFFSET_X}, ${
            event.transform.y + MAP_OFFSET_Y
          }) scale(${event.transform.k})`
        )
      })
    svg.call(zoom)

    const svgNode = svg.node()!
    const preventPageZoom = (e: WheelEvent) => e.preventDefault()
    svgNode.addEventListener('wheel', preventPageZoom, { passive: false })

    svg
      .append('defs')
      .append('clipPath')
      .attr('id', LOGO_CLIP_ID)
      .attr('clipPathUnits', 'objectBoundingBox')
      .append('circle')
      .attr('cx', 0.5)
      .attr('cy', 0.5)
      .attr('r', 0.5)

    svgGroup
      .append('image')
      .attr('xlink:href', BACKGROUND_IMAGE_URL)
      .attr('width', MAP_WIDTH)
      .attr('height', MAP_HEIGHT)
      .attr('x', 0)
      .attr('y', 0)

    svgGroup
      .append('text')
      .attr('x', gridToPx(TITLE.gridX))
      .attr('y', gridToPx(TITLE.gridY))
      .attr('text-anchor', 'middle')
      .attr('font-family', 'Inter, sans-serif')
      .attr('font-weight', TITLE.fontWeight)
      .attr('font-size', TITLE.fontSize)
      .style('letter-spacing', TITLE.letterSpacing)
      .attr('fill', '#fff')
      .text(TITLE.text)

    const s = AREA_LABEL_STYLE
    const finalFontSize = s.baseFontSize * s.labelScale
    const finalPadX = s.basePadX * s.labelScale
    const finalPadY = s.basePadY * s.labelScale
    AREA_LABELS.forEach(({ label, x, y }) => {
      const labelGroup = svgGroup
        .append('g')
        .attr('class', 'area-label')
        .attr('data-area', label)
        .attr('transform', `translate(${gridToPx(x)}, ${gridToPx(y)})`)
        .style('user-select', 'none')
        .style('pointer-events', 'none')
      const textEl = labelGroup
        .append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('text-anchor', 'middle')
        .attr('font-family', 'Inter, sans-serif')
        .attr('font-weight', s.fontWeight)
        .attr('font-size', finalFontSize)
        .style('letter-spacing', s.letterSpacing)
        .attr('fill', '#fff')
        .text(label)
      const bbox = textEl.node()?.getBBox()
      if (bbox) {
        labelGroup
          .insert('rect', 'text')
          .attr('x', bbox.x - finalPadX)
          .attr('y', bbox.y - finalPadY)
          .attr('width', bbox.width + finalPadX * 2)
          .attr('height', bbox.height + finalPadY * 2)
          .attr('rx', (bbox.height + finalPadY * 2) / 2)
          .attr('ry', (bbox.height + finalPadY * 2) / 2)
          .attr('fill', s.pillFill)
      }
    })

    const pinsLayer = svgGroup.append('g').attr('class', 'pins')
    pinsLayerRef.current = pinsLayer.node()

    // A plain click on empty map (a pan suppresses the click): in place mode
    // it drops the tray record, otherwise it deselects. Pins stop propagation.
    svg.on('click', event => {
      if (placeModeRef.current) {
        const [px, py] = d3.pointer(event, pinsLayer.node())
        const { x, y } = clampGrid(
          roundGrid(pxToGrid(px)),
          roundGrid(pxToGrid(py))
        )
        cbRef.current.onPlaceClick(x, y)
        return
      }
      cbRef.current.onSelect(null)
    })

    controlsRef.current = {
      zoomIn: () => {
        svg.transition().duration(300).call(zoom.scaleBy, 1.5)
      },
      zoomOut: () => {
        svg.transition().duration(300).call(zoom.scaleBy, 0.75)
      },
      reset: () => {
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity)
      },
      focusOn: (gx, gy) => {
        const k = Math.max(d3.zoomTransform(svgNode).k, FOCUS_ZOOM)
        // Centre of what is actually visible: the viewBox is fitted with
        // xMidYMin meet, so it is horizontally centred but top-aligned – a
        // canvas taller than the viewBox's aspect ratio shows extra map
        // below it.
        const rect = svgNode.getBoundingClientRect()
        const fit = Math.min(
          rect.width / PADDED_WIDTH,
          rect.height / PADDED_HEIGHT
        )
        const cx = PADDED_WIDTH / 2
        const cy = fit > 0 ? rect.height / fit / 2 : PADDED_HEIGHT / 2
        // The zoom handler draws the scene at translate(t + MAP_OFFSET)
        // scale(k), so a scene point p lands at t + MAP_OFFSET + k·p.
        const t = d3.zoomIdentity
          .translate(
            cx - MAP_OFFSET_X - k * gridToPx(gx),
            cy - MAP_OFFSET_Y - k * gridToPx(gy)
          )
          .scale(k)
        svg.transition().duration(500).call(zoom.transform, t)
      },
    }

    return () => {
      svgNode.removeEventListener('wheel', preventPageZoom)
      d3.select(container).select('svg').remove()
      pinsLayerRef.current = null
      svgRef.current = null
    }
    // The scene is static; records are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Pins: keyed data join, never rebuilds the scene or resets zoom ───────
  useEffect(() => {
    const layerNode = pinsLayerRef.current
    if (!layerNode) return
    const layer = d3.select(layerNode)
    const placed = records.filter(r => r.x !== null && r.y !== null)

    const drag = d3
      .drag<SVGGElement, EditorRecord>()
      .container(layerNode)
      .clickDistance(3)
      .subject((_event, d) => ({ x: gridToPx(d.x!), y: gridToPx(d.y!) }))
      .on('start', function () {
        movedRef.current = false
        draggingRef.current = true
        d3.select(this).classed('dragging', true)
        cbRef.current.onDragStateChange(true)
      })
      .on('drag', function (event) {
        if (!movedRef.current) {
          movedRef.current = true
          // Lift the pin above its neighbours only once it actually moves.
          // Moving the node in the DOM on mousedown would swallow the click
          // that selects a pin.
          d3.select(this).raise()
          if (hudRef.current) hudRef.current.style.display = 'block'
          hideTooltip()
          containerRef.current?.classList.add('is-dragging')
        }
        d3.select(this).attr('transform', `translate(${event.x}, ${event.y})`)
        if (hudRef.current) {
          const gx = roundGrid(pxToGrid(event.x))
          const gy = roundGrid(pxToGrid(event.y))
          hudRef.current.textContent = `x ${gx.toFixed(1)} · y ${gy.toFixed(1)}`
          hudRef.current.style.left = `${event.sourceEvent.clientX + 14}px`
          hudRef.current.style.top = `${event.sourceEvent.clientY + 14}px`
        }
      })
      .on('end', function (event, d) {
        draggingRef.current = false
        d3.select(this).classed('dragging', false)
        containerRef.current?.classList.remove('is-dragging')
        if (hudRef.current) hudRef.current.style.display = 'none'
        cbRef.current.onDragStateChange(false)
        const rawX = roundGrid(pxToGrid(event.x))
        const rawY = roundGrid(pxToGrid(event.y))
        const { x, y } = clampGrid(rawX, rawY)
        // A plain click (no movement) never writes, even if the stored value
        // would round or clamp differently.
        if (movedRef.current && (x !== d.x || y !== d.y)) {
          // Show it at the snapped/clamped spot straight away; the parent
          // will confirm or revert once Airtable answers.
          d3.select(this).attr(
            'transform',
            `translate(${gridToPx(x)}, ${gridToPx(y)})`
          )
          cbRef.current.onDrop(d.id, x, y, x !== rawX || y !== rawY)
        } else {
          d3.select(this).attr(
            'transform',
            `translate(${gridToPx(d.x!)}, ${gridToPx(d.y!)})`
          )
        }
      })

    const pins = layer
      .selectAll<SVGGElement, EditorRecord>('g.pin')
      .data(placed, d => d.id)

    pins.exit().remove()

    const entered = pins
      .enter()
      .append('g')
      .attr('class', 'pin')
      .attr('data-id', d => d.id)
      .style('cursor', 'grab')
      .on('click', function (event, d) {
        event.stopPropagation()
        cbRef.current.onSelect(d.id)
      })
      // Same hover as /map: the tooltip shows Long name + description.
      .on('mouseenter', function (event, d) {
        if (draggingRef.current) return
        const tt = tooltipRef.current
        const container = containerRef.current
        if (!tt || !container) return
        tt.querySelector('strong')!.textContent = d.tooltipTitle
        tt.querySelector('span')!.textContent =
          d.description ?? '(no description yet)'
        tt.style.visibility = 'visible'
        tt.style.opacity = '1'
        positionTooltip(event.clientX, event.clientY, tt, container)
      })
      .on('mousemove', function (event) {
        if (draggingRef.current) return
        const tt = tooltipRef.current
        const container = containerRef.current
        if (!tt || !container) return
        positionTooltip(event.clientX, event.clientY, tt, container)
      })
      .on('mouseleave', hideTooltip)
    entered.each(function () {
      drawGlyph(d3.select<SVGGElement, EditorRecord>(this))
    })
    if (!readOnly) entered.call(drag)

    const all: PinSel = entered.merge(pins)
    all.each(function (d) {
      const g = d3.select<SVGGElement, EditorRecord>(this)
      if (g.attr('data-sig') !== glyphSignature(d)) drawGlyph(g)
    })
    // Don't yank a pin out from under the cursor mid-drag.
    all
      .filter(function () {
        return !d3.select(this).classed('dragging')
      })
      .attr('transform', d => `translate(${gridToPx(d.x!)}, ${gridToPx(d.y!)})`)

    all
      .select('.ring-draft')
      .style('display', d => (!previewPublic && !d.published ? null : 'none'))
    all
      .select('.ring-selected')
      .style('display', d =>
        !previewPublic && d.id === selectedId ? null : 'none'
      )

    // Same stacking as /map: later records draw on top.
    all.sort((a, b) => a.order - b.order)

    // Highlight the selected/placing record's region label.
    const focus =
      records.find(r => r.id === (placeModeId ?? selectedId))?.area ?? null
    d3.select(svgRef.current)
      .selectAll<SVGGElement, unknown>('g.area-label')
      .each(function () {
        const area = this.getAttribute('data-area')
        d3.select(this)
          .select('rect')
          .attr(
            'stroke',
            !previewPublic && area === focus ? SELECTED_COLOR : null
          )
          .attr('stroke-width', 3)
      })
  }, [records, selectedId, placeModeId, previewPublic, readOnly])

  // Crosshair while placing.
  useEffect(() => {
    if (svgRef.current) {
      svgRef.current.style.cursor = placeModeId ? 'crosshair' : ''
    }
  }, [placeModeId])

  return (
    <>
      <div ref={containerRef} className={styles.canvas} />
      <MapControls
        className={styles.controls}
        onZoomIn={() => controlsRef.current.zoomIn()}
        onZoomOut={() => controlsRef.current.zoomOut()}
        onReset={() => controlsRef.current.reset()}
      />
      <div ref={hudRef} className={styles.hud} style={{ display: 'none' }} />
      {/* Tooltip — always in the DOM for measuring, toggled via ref */}
      <div
        ref={tooltipRef}
        className={styles.tooltip}
        style={{ visibility: 'hidden', opacity: 0 }}
      >
        <strong></strong>
        <span></span>
      </div>
    </>
  )
}
