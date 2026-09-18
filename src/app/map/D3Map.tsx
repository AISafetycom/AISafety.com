'use client'

// @refresh reset — d3 pipeline is inside useEffect; force remount on edit.

import { useEffect, useMemo, useRef } from 'react'
import * as d3 from 'd3'
import MapControls from '@/components/MapControls'
import MapSearch, { NO_MAP_SEARCH_CONTROL } from './MapSearch'
import type { MapSearchControl } from './MapSearch'
import { trackListingClick, trackListingHover } from '@/lib/analytics'
import { withUtm } from '@/lib/utm'
import { positionTooltip } from '@/lib/mapTooltip'
import { MAP_BACKGROUND_URL } from '@/lib/map-images'
import styles from './page.module.css'

interface MapOrg {
  id: string
  title: string
  tooltipTitle: string
  shortName: string | null
  description: string
  category: string
  link: string
  mapLogo: string | null
  x: number | null
  y: number | null
  scale: string | null
  isMagic?: boolean
}

interface D3MapProps {
  orgs: MapOrg[]
  suggestEntryUrl: string
}

// Map constants from WebFlow
const MAP_WIDTH = 2485
const MAP_HEIGHT = 1355
const PADDING_FACTOR = 1.1
const PADDED_WIDTH = MAP_WIDTH * PADDING_FACTOR
const PADDED_HEIGHT = MAP_HEIGHT * PADDING_FACTOR
const GRID_SIZE = MAP_WIDTH / 60

// Logo size scales (handle both cases)
const SIZE_TO_SCALE: Record<string, number> = {
  small: 0.4,
  Small: 0.4,
  medium: 0.6,
  Medium: 0.6,
  large: 0.8,
  Large: 0.8,
}
const BASE_LOGO_SIZE = 64
const LOGO_GLOBAL_SCALE = 1.0

// Area labels from WebFlow
const AREA_LABELS = [
  { label: 'Conceptual Cliffs', x: 46, y: 5.5 },
  { label: 'Resource Rock', x: 3.5, y: 8 },
  { label: 'Support Shoreline', x: 13, y: 6.7 },
  { label: 'Newsletter Nook', x: 15.8, y: 14.5 },
  { label: 'Video Vista', x: 23, y: 5.6 },
  { label: 'Funding Forest', x: 29.2, y: 7 },
  { label: 'Governance Grove', x: 37.7, y: 5.5 },
  { label: 'Strategy Summit', x: 34.8, y: 19 },
  { label: 'Research Range', x: 45.3, y: 15.9 },
  { label: 'Training Town', x: 22.2, y: 17.2 },
  { label: 'Empirical Escarpment', x: 53.5, y: 16 },
  { label: 'Podcast Port', x: 9.5, y: 20.5 },
  { label: 'Blog Beach', x: 15, y: 25.8 },
  { label: 'Forecasting Falls', x: 39.2, y: 23.8 },
  { label: 'Career Castle', x: 30.5, y: 29.4 },
  { label: 'Advocacy Anchorage', x: 8, y: 31 },
  { label: 'Capabilities Cove', x: 45, y: 27.1 },
  { label: 'Gone Graveyard', x: 56, y: 30 },
]

export default function D3Map({ orgs, suggestEntryUrl }: D3MapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  // Zoom actions live in the d3 pipeline inside useEffect; the buttons reach
  // them through this ref.
  const controlsRef = useRef({
    zoomIn: () => {},
    zoomOut: () => {},
    reset: () => {},
  })
  // Search fly-to lives in the d3 pipeline for the same reason the zoom
  // buttons do — the zoom behavior only exists inside the effect below.
  // Filled in by MapSearch: lets the map shut the search on a bare-map tap,
  // and lets ESC reach the search before it reaches the view reset.
  const searchControlRef = useRef<MapSearchControl>(NO_MAP_SEARCH_CONTROL)
  const searchRef = useRef<{
    flyTo: (org: {
      x: number | null
      y: number | null
      scale: string | null
    }) => void
    clearHighlight: () => void
  }>({
    flyTo: () => {},
    clearHighlight: () => {},
  })
  // Magic-map decorations and unlinked furniture rows (e.g. "Last updated")
  // render as pins but shouldn't be findable.
  const searchOrgs = useMemo(
    () =>
      orgs.filter(
        org =>
          !org.isMagic &&
          org.link &&
          org.link !== '#' &&
          org.x !== null &&
          org.y !== null
      ),
    [orgs]
  )
  // The d3 pipeline below tears down and rebuilds whenever `orgs` changes
  // identity — which preview mode's auto-refresh does on every data change
  // and tab focus. Keeping the last zoom transform here lets the rebuild
  // restore the viewport instead of jumping back to the zoomed-out default.
  const savedTransformRef = useRef<d3.ZoomTransform | null>(null)

  useEffect(() => {
    if (!containerRef.current || orgs.length === 0) return

    // Clear any existing SVG
    d3.select(containerRef.current).select('svg').remove()

    // translateZ + backface-visibility promote the SVG to its own
    // compositor layer in WebKit, avoiding tile re-rasterization flicker
    // during pinch/wheel zoom on macOS.
    const svg = d3
      .select(containerRef.current)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${PADDED_WIDTH} ${PADDED_HEIGHT}`)
      .attr('preserveAspectRatio', 'xMidYMin meet')
      .style('transform', 'translateZ(0)')
      .style('backface-visibility', 'hidden')

    // Create main group with offset
    const offsetX = (PADDED_WIDTH - MAP_WIDTH) / 2
    const offsetY = (PADDED_HEIGHT - MAP_HEIGHT) / 20
    const svgGroup = svg
      .append('g')
      .attr('transform', `translate(${offsetX}, ${offsetY})`)

    // Read live so behavior adapts when the viewport is resized (e.g.
    // dev tools mobile mode toggled after load).
    const isMobile = () => window.innerWidth < 768
    const maxZoom = isMobile() ? 25 : 8

    // Tracks which org's tooltip is currently shown from a mobile tap, so
    // the next tap can switch to a different pin or dismiss on outside tap.
    let tappedOrgId: string | null = null

    // Pending hover-analytics dwell. A desktop hover only counts once the
    // cursor has rested on a listing for 500 ms — the timer is canceled on
    // early leave (and on zoom start, via hideTooltip) so drive-by mouse
    // passes across the map don't record.
    let hoverTimer: ReturnType<typeof setTimeout> | null = null

    function cancelHoverTimer() {
      if (hoverTimer !== null) {
        clearTimeout(hoverTimer)
        hoverTimer = null
      }
    }

    function hideTooltip() {
      cancelHoverTimer()
      if (tooltipRef.current) {
        tooltipRef.current.style.visibility = 'hidden'
        tooltipRef.current.style.opacity = '0'
        tooltipRef.current.removeAttribute('data-link-url')
        tooltipRef.current.removeAttribute('data-link-title')
        tooltipRef.current.removeAttribute('data-listing-id')
        tooltipRef.current.removeAttribute('data-area')
      }
      tappedOrgId = null
    }

    // Gates the hover handlers below. Mutating `pointer-events` on
    // svgGroup (the previous approach) invalidates its compositor layer
    // in Mac WebKit and causes visible flicker mid-zoom.
    let isZooming = false
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, maxZoom])
      .on('zoom', event => {
        if (!isZooming) {
          // First real movement — set in `zoom`, not `start`, because
          // `start` fires on mousedown and would suppress link clicks.
          isZooming = true
          hideTooltip()
        }
        const newX = event.transform.x + offsetX
        const newY = event.transform.y + offsetY
        svgGroup.attr(
          'transform',
          `translate(${newX}, ${newY}) scale(${event.transform.k})`
        )
        savedTransformRef.current = event.transform
      })
      .on('end', () => {
        isZooming = false
      })

    svg.call(zoom)

    // Mobile: a tap on bare map closes the search. On desktop the field
    // already collapses when it loses focus, but a touch tap never blurs it
    // — the d3 gesture handlers swallow that. Pins and their labels live
    // inside <a>, so taps on a listing are left to their own handler, and a
    // pan does not reach here because the drag cancels the synthetic click.
    svg.on('click.mapsearch', event => {
      if (!isMobile()) return
      if ((event.target as Element | null)?.closest('a')) return
      searchControlRef.current.close()
    })

    if (savedTransformRef.current) {
      svg.call(zoom.transform, savedTransformRef.current)
    }

    // Prevent wheel events over the map from zooming the whole page
    // (once D3's zoom hits its scaleExtent limit, the browser would
    // otherwise handle the event as a page zoom or scroll).
    const svgNode = svg.node()!
    const preventPageZoom = (e: WheelEvent) => e.preventDefault()
    svgNode.addEventListener('wheel', preventPageZoom, { passive: false })

    // Shared clip-path for all logo circles. Using objectBoundingBox units so
    // a single definition works for every logo regardless of its size.
    const LOGO_CLIP_ID = 'logo-circle-clip'
    svg
      .append('defs')
      .append('clipPath')
      .attr('id', LOGO_CLIP_ID)
      .attr('clipPathUnits', 'objectBoundingBox')
      .append('circle')
      .attr('cx', 0.5)
      .attr('cy', 0.5)
      .attr('r', 0.5)

    // Add background image
    svgGroup
      .append('image')
      .attr('xlink:href', MAP_BACKGROUND_URL)
      .attr('width', MAP_WIDTH)
      .attr('height', MAP_HEIGHT)
      .attr('x', 0)
      .attr('y', 0)

    // Add main title
    const titleX = 30 * GRID_SIZE
    const titleY = 2.5 * GRID_SIZE
    svgGroup
      .append('text')
      .attr('x', titleX)
      .attr('y', titleY)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'Inter, sans-serif')
      .attr('font-weight', 400)
      .attr('font-size', 72)
      .style('letter-spacing', '-2.16px')
      .attr('fill', '#fff')
      .text('Map of AI Existential Safety')

    // Add area labels
    const labelScale = 1.75
    const baseFontSize = 14
    const basePadX = 14
    const basePadY = 7
    const finalFontSize = baseFontSize * labelScale
    const finalPadX = basePadX * labelScale
    const finalPadY = basePadY * labelScale

    AREA_LABELS.forEach(({ label, x, y }) => {
      const xPos = x * GRID_SIZE
      const yPos = y * GRID_SIZE

      const labelGroup = svgGroup
        .append('g')
        .attr('transform', `translate(${xPos}, ${yPos})`)
        .style('user-select', 'none')
        .style('pointer-events', 'none')

      const textEl = labelGroup
        .append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('text-anchor', 'middle')
        .attr('font-family', 'Inter, sans-serif')
        .attr('font-weight', 600)
        .attr('font-size', finalFontSize)
        .style('letter-spacing', '-0.01em')
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
          .attr('fill', 'rgba(27, 43, 62, 0.6)')
      }
    })

    // Render organization logos
    orgs.forEach(org => {
      if (org.x === null || org.y === null) return

      const xPos = org.x * GRID_SIZE
      const yPos = org.y * GRID_SIZE

      // Calculate logo size based on scale (matching WebFlow)
      const rawScale = SIZE_TO_SCALE[org.scale || 'Medium'] || 0.6
      const iconSize = BASE_LOGO_SIZE * rawScale * LOGO_GLOBAL_SCALE
      const padding = 2
      const contentSize = iconSize - 2 * padding

      // Create item group with translate, then link inside (matching Webflow structure)
      const itemGroup = svgGroup
        .append('g')
        .attr('transform', `translate(${xPos}, ${yPos})`)
      // QA: Items with no real link (e.g. "Last updated") should render
      // on the map but not be clickable
      const hasLink = org.link && org.link !== '#'
      // First category only — orgs can carry several ("Funding, Resource"),
      // but the dashboard groups map hovers/clicks by a single area. May be
      // '' for uncategorized items, which analytics receives as undefined.
      const firstCategory = org.category.split(',')[0].trim()
      const linkEl = itemGroup
        .append(hasLink ? 'a' : 'g')
        .attr('class', 'mapItem')
      if (hasLink) {
        linkEl
          .attr('xlink:href', withUtm(org.link, 'Map'))
          .attr('target', '_blank')
          .attr('rel', 'noopener noreferrer')
          .style('cursor', 'pointer')
          .on('click', event => {
            // Mobile: first tap shows the tooltip instead of opening the
            // link. Second tap of the tooltip itself opens it. Matches the
            // pattern used on the /communities map.
            if (isMobile()) {
              event.preventDefault()
              const tt = tooltipRef.current
              const container = containerRef.current
              if (!tt || !container) return
              // Only a tap on a DIFFERENT pin (re)opens the tooltip — a
              // repeat tap on the already-open pin just repositions it below.
              // Same guard as the /communities map, and it's what keeps the
              // hover count honest: one open gesture, one recorded hover.
              if (tappedOrgId !== org.id) {
                tt.querySelector('strong')!.textContent = org.tooltipTitle
                tt.querySelector('span')!.textContent = org.description
                tt.setAttribute('data-link-url', org.link)
                tt.setAttribute('data-link-title', org.title)
                // Stash id + area too, so the tooltip's second-tap click can
                // report them — the tooltip click handler has no org in scope.
                tt.setAttribute('data-listing-id', org.id)
                tt.setAttribute('data-area', firstCategory)
                tt.style.visibility = 'visible'
                tt.style.opacity = '1'
                tappedOrgId = org.id
                // A mobile "hover" is the first tap that opens the tooltip —
                // there's no cursor to dwell, so it counts immediately.
                // (hasLink is guaranteed: this handler only exists on links.)
                trackListingHover(
                  'Map',
                  org.title,
                  org.link,
                  org.id,
                  firstCategory || undefined
                )
              }
              positionTooltip(event.clientX, event.clientY, tt, container, {
                minLeftMargin: 20,
              })
              return
            }
            trackListingClick(
              'Map',
              org.title,
              org.link,
              org.id,
              undefined,
              'map',
              firstCategory || undefined
            )
            // Clicking a pin leaves the browser's focus ring on the link, and
            // it is still sitting there when you come back from the tab that
            // opened. A mouse click does not need a focus ring. detail > 0
            // means a real pointer click, so a keyboard Enter on a focused
            // pin keeps its ring and the user keeps their place.
            if (event.detail > 0) {
              ;(event.currentTarget as SVGElement | null)?.blur?.()
            }
          })
      }

      // White circle background
      linkEl
        .append('circle')
        .attr('r', iconSize / 2)
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('fill', '#fff')

      // Logo image — single SVG <image> clipped to a circle. The browser
      // fetches/decodes the logo exactly once; preserveAspectRatio handles
      // the aspect-fit math that used to require a separate `new Image()`.
      if (org.mapLogo) {
        const logoImg = linkEl
          .append('image')
          .attr('href', org.mapLogo)
          .attr('width', contentSize)
          .attr('height', contentSize)
          .attr('x', -contentSize / 2)
          .attr('y', -contentSize / 2)
          .attr('preserveAspectRatio', 'xMidYMid meet')
          .attr('clip-path', `url(#${LOGO_CLIP_ID})`)

        // On load failure, swap in the orange fallback circle.
        logoImg.on('error', () => {
          logoImg.remove()
          linkEl
            .append('circle')
            .attr('r', contentSize / 2)
            .attr('cx', 0)
            .attr('cy', 0)
            .attr('fill', '#f70')
        })
      } else {
        linkEl
          .append('circle')
          .attr('r', contentSize / 2)
          .attr('cx', 0)
          .attr('cy', 0)
          .attr('fill', 'red')
      }

      // Add label below logo
      const labelName = org.shortName || org.title
      const labelOffset = 11 * rawScale * 1.5
      const labelY = iconSize / 2 + labelOffset
      const fontSize = 6 * rawScale * 1.5

      const labelG = linkEl
        .append('g')
        .attr('transform', `translate(0, ${labelY})`)

      const textEl = labelG
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('font-family', 'Inter, sans-serif')
        .attr('font-weight', 600)
        .attr('font-size', fontSize)
        .style('letter-spacing', '-0.02em')
        .attr('fill', '#000')
        .text(labelName)

      // Get text bounding box and add background pill
      const bbox = textEl.node()?.getBBox()
      if (bbox) {
        const padX = 6 * rawScale * 1.5
        const padY = 3 * rawScale * 1.5
        const rectW = bbox.width + padX * 2
        const rectH = bbox.height + padY * 2

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

        // QA: Add an invisible bridge rect for a more forgiving hover zone so the
        // tooltip doesn't disappear when the cursor is between logo and label.
        const bridgeW = Math.max(iconSize, rectW)
        const bridgeH = (iconSize + rectH) / 2 + labelOffset
        linkEl
          .append('rect')
          .attr('x', -bridgeW / 2)
          .attr('y', 0)
          .attr('width', bridgeW)
          .attr('height', bridgeH)
          .attr('fill', 'transparent')
          .lower()
      }

      // Tooltip events with smart edge-detection positioning
      linkEl
        .on('mouseenter', event => {
          if (isMobile()) return
          if (isZooming) return
          // Arm the hover dwell — only for real listings (furniture rows
          // like "Last updated" show a tooltip but never record a hover).
          if (hasLink) {
            cancelHoverTimer()
            hoverTimer = setTimeout(() => {
              hoverTimer = null
              trackListingHover(
                'Map',
                org.title,
                org.link,
                org.id,
                firstCategory || undefined
              )
            }, 500)
          }
          const tt = tooltipRef.current
          const container = containerRef.current
          if (!tt || !container) return
          // QA: Use tooltipTitle ('Long name') not title ('Long name for cards')
          // so bracketed acronyms like "(CARMA)" don't appear in the tooltip
          tt.querySelector('strong')!.textContent = org.tooltipTitle
          tt.querySelector('span')!.textContent = org.description
          tt.style.visibility = 'visible'
          tt.style.opacity = '1'
          positionTooltip(event.clientX, event.clientY, tt, container)
        })
        .on('mousemove', event => {
          if (isMobile()) return
          if (isZooming) return
          const tt = tooltipRef.current
          const container = containerRef.current
          if (!tt || !container) return
          positionTooltip(event.clientX, event.clientY, tt, container)
        })
        .on('mouseleave', () => {
          // Leaving before the dwell elapses means it wasn't a real hover.
          cancelHoverTimer()
          if (isMobile()) return
          if (tooltipRef.current) {
            tooltipRef.current.style.visibility = 'hidden'
            tooltipRef.current.style.opacity = '0'
          }
        })
    })

    // Setup zoom controls
    const resetView = () => {
      svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity)
    }
    controlsRef.current = {
      zoomIn: () => {
        svg.transition().duration(300).call(zoom.scaleBy, 1.5)
      },
      zoomOut: () => {
        svg.transition().duration(300).call(zoom.scaleBy, 0.75)
      },
      reset: resetView,
    }

    // Search: fly the viewport to a pin and pulse a ring around it. The ring
    // sits inside svgGroup so it pans/zooms with the map; non-scaling-stroke
    // keeps its line width constant at any zoom.
    let highlightRing: d3.Selection<
      SVGCircleElement,
      unknown,
      null,
      undefined
    > | null = null
    const clearHighlight = () => {
      if (highlightRing) {
        highlightRing.interrupt()
        highlightRing.remove()
        highlightRing = null
      }
    }
    searchRef.current = {
      clearHighlight,
      flyTo: org => {
        if (org.x === null || org.y === null) return
        clearHighlight()
        const px = org.x * GRID_SIZE
        const py = org.y * GRID_SIZE
        // Mobile pins are tiny at rest, so land closer in.
        const k = isMobile() ? 8 : 3.5
        // Centers the pin in the rendered viewBox area: the group transform
        // places map point p at viewBox coordinate t + offset + k*p.
        svg
          .transition()
          .duration(800)
          .call(
            zoom.transform,
            d3.zoomIdentity
              .translate(
                PADDED_WIDTH / 2 - offsetX - k * px,
                PADDED_HEIGHT / 2 - offsetY - k * py
              )
              .scale(k)
          )
        const rawScale = SIZE_TO_SCALE[org.scale || 'Medium'] || 0.6
        const r = (BASE_LOGO_SIZE * rawScale) / 2 + 10
        const ring = svgGroup
          .append('circle')
          .attr('cx', px)
          .attr('cy', py)
          .attr('r', r)
          .attr('fill', 'none')
          .attr('stroke', 'var(--white)')
          .attr('stroke-width', 3.5)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('pointer-events', 'none')
        highlightRing = ring
        let growing = true
        const pulse = () => {
          ring
            .transition()
            .duration(600)
            .ease(d3.easeSinInOut)
            .attr('r', growing ? r * 1.7 : r)
            .attr('stroke-opacity', growing ? 0.3 : 0.9)
            .on('end', () => {
              growing = !growing
              pulse()
            })
        }
        pulse()
      },
    }

    // ESC resets the view, same as the recenter button. Skip while typing in
    // a form field — ESC there shouldn't yank the map.
    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      )
        return
      // An open search gets ESC first. Clicking a listing on the map takes
      // focus out of the field but leaves the box open, and ESC then has to
      // still mean "close the search", not "reset the view".
      if (searchControlRef.current.isOpen()) {
        searchControlRef.current.escape()
        return
      }
      resetView()
    }
    document.addEventListener('keydown', handleEscKey)

    // Mobile: tapping the tooltip opens the stashed link in a new tab.
    const handleTooltipClick = (e: MouseEvent) => {
      const tt = tooltipRef.current
      if (!tt) return
      const link = tt.getAttribute('data-link-url')
      const title = tt.getAttribute('data-link-title')
      if (link && link !== '#') {
        if (title)
          trackListingClick(
            'Map',
            title,
            link,
            // Stashed by the first tap — this handler has no org in scope.
            tt.getAttribute('data-listing-id') || undefined,
            undefined,
            'map',
            tt.getAttribute('data-area') || undefined
          )
        hideTooltip()
        window.open(withUtm(link, 'Map'), '_blank')
      }
      e.stopPropagation()
    }

    // Mobile: tapping outside any pin or the tooltip dismisses the tooltip.
    const handleDocumentClick = (e: MouseEvent) => {
      if (tappedOrgId === null) return
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('.mapItem')) return
      if (tooltipRef.current && tooltipRef.current.contains(target)) return
      hideTooltip()
    }

    const tooltipEl = tooltipRef.current
    if (tooltipEl) tooltipEl.addEventListener('click', handleTooltipClick)
    document.addEventListener('click', handleDocumentClick)

    const container = containerRef.current
    return () => {
      // A pending hover dwell must not fire after unmount.
      cancelHoverTimer()
      // The ring is removed with the SVG; the fns must not outlive the zoom
      // behavior they close over.
      searchRef.current = { flyTo: () => {}, clearHighlight: () => {} }
      svgNode.removeEventListener('wheel', preventPageZoom)
      if (tooltipEl) tooltipEl.removeEventListener('click', handleTooltipClick)
      document.removeEventListener('click', handleDocumentClick)
      document.removeEventListener('keydown', handleEscKey)
      if (container) {
        d3.select(container).select('svg').remove()
      }
    }
  }, [orgs])

  return (
    <>
      <div ref={containerRef} className={styles['map-container']} />

      <MapControls
        className={styles['map-controls']}
        onZoomIn={() => controlsRef.current.zoomIn()}
        onZoomOut={() => controlsRef.current.zoomOut()}
        onReset={() => controlsRef.current.reset()}
      />

      <MapSearch
        className={styles['map-search']}
        orgs={searchOrgs}
        suggestEntryUrl={suggestEntryUrl}
        controlRef={searchControlRef}
        onPick={org => searchRef.current.flyTo(org)}
        onClear={() => searchRef.current.clearHighlight()}
      />

      {/* Tooltip — always in DOM for measuring, visibility toggled via ref */}
      <div
        ref={tooltipRef}
        className={styles['map-tooltip']}
        style={{ visibility: 'hidden', opacity: 0 }}
      >
        <strong></strong>
        <span></span>
      </div>
    </>
  )
}
