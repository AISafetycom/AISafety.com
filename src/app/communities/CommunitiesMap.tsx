'use client'

import { useEffect, useRef, useState } from 'react'
import Script from 'next/script'
import Icon from '@/components/Icon'
import MapControls from '@/components/MapControls'
import styles from './page.module.css'
import { Community } from '@/lib/data/communities'
import { positionTooltip } from '@/lib/mapTooltip'
import {
  trackListingClick,
  trackListingHover,
  trackCardsButtonClick,
} from '@/lib/analytics'
import { withUtm } from '@/lib/utm'
import { MAPBOX_GL_CSS_URL, MAPBOX_GL_JS_URL } from '@/lib/communities-map'

interface CommunitiesMapProps {
  communities: Community[]
}

const INITIAL_CENTER: [number, number] = [0, 30]
const INITIAL_ZOOM = 1.5

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    mapboxgl: any
  }
}

export default function CommunitiesMap({ communities }: CommunitiesMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  // Keeps preloaded logo images alive after their bytes + decoded bitmaps are
  // ready. Without these refs the browser may garbage-collect the decoded
  // bitmap and the first tooltip hover still pays the decode cost.
  const preloadedLogosRef = useRef<HTMLImageElement[]>([])
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const [pinsLoaded, setPinsLoaded] = useState(false)

  function initMap() {
    if (!mapContainerRef.current || !tooltipRef.current || !window.mapboxgl)
      return
    if (mapRef.current) return

    const mapboxgl = window.mapboxgl
    const mapContainer = mapContainerRef.current
    const tooltip = tooltipRef.current

    const mapCommunities = communities
      .filter(
        c =>
          c.latitude !== null &&
          c.longitude !== null &&
          !c.type.every(t => t.toLowerCase() === 'online') &&
          // Inactive communities are left off the map on purpose; they stay
          // in the cards below, where the Activity level filter shows them.
          c.activityLevel !== 'Inactive'
      )
      .map(c => {
        const typeStr = c.type.join(' ').toLowerCase()
        let locationType = 'city'
        if (typeStr.includes('country')) locationType = 'country'
        else if (typeStr.includes('continent') || typeStr.includes('global'))
          locationType = 'continent'
        return {
          // Airtable record id — lets analytics join map interactions back
          // to the exact source record.
          id: c.id,
          name: c.name,
          description: c.description,
          type: locationType,
          coordinates: [c.longitude!, c.latitude!] as [number, number],
          location: c.location || '',
          link: c.joinLink,
          logo: c.logo || '',
        }
      })

    mapboxgl.accessToken =
      'pk.eyJ1IjoiYWxpZ25tZW50ZWNvc3lzdGVtZGV2ZWxvcG1lbnQiLCJhIjoiY201YnNnbnpzNTEyNTJtcHYzMWVhand6OSJ9._HknM4VVUlEU6mbv8NagGw'

    const map = new mapboxgl.Map({
      container: mapContainer,
      style:
        'mapbox://styles/alignmentecosystemdevelopment/cmh1t3h6u00e401st9gu75gvq',
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      logoPosition: 'bottom-right',
    })
    mapRef.current = map

    // Read live so behavior adapts when the viewport is resized (e.g.
    // dev tools mobile mode toggled after load).
    const isMobile = () => window.innerWidth < 768

    // Mapbox doesn't auto-resize when its container changes size (e.g. via
    // CSS media queries). Watch the container and tell Mapbox to recalculate.
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(mapContainer)

    // Start loading the pin image immediately, in parallel with the map
    // style. Wrapping it in a promise lets us await it alongside the map's
    // `style.load` event without nesting callbacks (the nested version
    // caused a race where the image resolved after the map event fired and
    // the listener attached too late — leaving the map pin-less on an
    // uncached first visit).
    const pinImagePromise = new Promise<HTMLImageElement | null>(resolve => {
      // No `crossOrigin` set — /images/pin.svg is same-origin, and
      // setting it would cause the browser to issue a second fetch that
      // doesn't match the `<link rel="preload">` hint.
      const customPin = new window.Image()
      customPin.onload = () => resolve(customPin)
      // null = fall back to a plain canvas-drawn pin in rasterizePin.
      customPin.onerror = () => resolve(null)
      customPin.src = '/images/pin.svg'
    })

    // Use `style.load` instead of `load`. Mapbox's `load` event waits for
    // the first complete tile render before firing, which introduces a
    // visible gap where the basemap is painted but the pins aren't added
    // yet. `style.load` fires as soon as the style JSON is parsed — well
    // before any tiles come back — so we can register the source and
    // layer early enough that pins render in the *same frame* as the
    // first tiles, not a second or two after.
    const styleLoadPromise = new Promise<void>(resolve => {
      if (map.isStyleLoaded()) {
        resolve()
      } else {
        map.once('style.load', () => resolve())
      }
    })

    Promise.all([pinImagePromise, styleLoadPromise]).then(([pinImage]) => {
      // Mapbox rasterizes an added image once and then scales that bitmap on
      // the GPU, which is what made the pins blurry — one 128px raster was
      // being resized for every pin size and screen density. Instead,
      // re-render the SVG at each displayed size × devicePixelRatio and
      // register the results as separate images, so pins map 1:1 onto
      // physical pixels.
      const dpr = window.devicePixelRatio || 1
      // 128×140 is pin.svg's intrinsic size; the widths reproduce the old
      // look (icon-size 0.25 / 0.35 / 0.45 of the 128px raster).
      const PIN_ASPECT = 140 / 128
      // The pin's tip sits at y=104 of the SVG's 128×140 canvas (the rest
      // is shadow padding). The raster is padded with extra transparent
      // space at the bottom so the tip lands exactly at the canvas's
      // vertical center — that lets the layer's `icon-anchor: center`
      // place the tip on the location for every pin size and hover
      // variant, with no per-size offset expressions.
      const PIN_TIP_Y = 104 / 128
      const CANVAS_ASPECT = 2 * PIN_TIP_Y
      const pinWidths: Record<string, number> = {
        city: 32,
        country: 44.8,
        continent: 57.6,
      }

      function rasterizePin(cssWidth: number) {
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(cssWidth * dpr)
        canvas.height = Math.round(cssWidth * CANVAS_ASPECT * dpr)
        const pinHeight = Math.round(cssWidth * PIN_ASPECT * dpr)
        const ctx = canvas.getContext('2d')!
        if (pinImage) {
          // Drawing an SVG <img> scaled makes the browser re-render the
          // vector at the destination resolution — not resize a bitmap.
          ctx.drawImage(pinImage, 0, 0, canvas.width, pinHeight)
        } else {
          // Fallback if pin.svg failed to load: a simple filled circle
          // resting its bottom edge on the tip point (the canvas center).
          const radius = canvas.width / 2 - 2 * dpr
          ctx.beginPath()
          ctx.arc(
            canvas.width / 2,
            canvas.height / 2 - radius,
            radius,
            0,
            Math.PI * 2
          )
          ctx.fillStyle = '#14b8a6'
          ctx.fill()
          ctx.lineWidth = dpr
          ctx.strokeStyle = '#ffffff'
          ctx.stroke()
        }
        return ctx.getImageData(0, 0, canvas.width, canvas.height)
      }

      for (const [type, width] of Object.entries(pinWidths)) {
        if (!map.hasImage(`pin-${type}`)) {
          map.addImage(`pin-${type}`, rasterizePin(width), { pixelRatio: dpr })
          // Hovered pins get their own full-resolution raster too, instead
          // of GPU-upscaling the base image by 1.2.
          map.addImage(`pin-${type}-hover`, rasterizePin(width * 1.2), {
            pixelRatio: dpr,
          })
        }
      }

      let hoveredPinId: number | null = null
      let tappedPinId: number | null = null

      // Pending hover-analytics dwell. A desktop hover only counts once the
      // cursor has rested on a pin for 500 ms — the timer restarts when the
      // cursor enters a new pin and is canceled whenever it leaves the pins
      // (mouseleave or the empty-features branch below), so drive-by mouse
      // passes across the map don't record.
      let hoverTimer: ReturnType<typeof setTimeout> | null = null

      function cancelHoverTimer() {
        if (hoverTimer !== null) {
          clearTimeout(hoverTimer)
          hoverTimer = null
        }
      }

      const geojsonData = {
        type: 'FeatureCollection' as const,
        features: mapCommunities.map((community, index) => ({
          type: 'Feature' as const,
          id: index,
          properties: {
            id: index,
            // Distinct name on purpose — `id` above is the feature index
            // that the hover/tap state machine keys on; `recordId` is the
            // Airtable record id that analytics reports.
            recordId: community.id,
            name: community.name,
            description: community.description,
            type: community.type,
            link: community.link,
            location: community.location,
            logo: community.logo,
            hover: false,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: community.coordinates,
          },
        })),
      }

      map.addSource('communities', { type: 'geojson', data: geojsonData })

      map.addLayer({
        id: 'community-pins',
        type: 'symbol',
        source: 'communities',
        layout: {
          'icon-image': [
            'concat',
            'pin-',
            ['get', 'type'],
            ['case', ['boolean', ['get', 'hover'], false], '-hover', ''],
          ],
          // The raster is bottom-padded so its center IS the pin's tip —
          // see rasterizePin. Anchoring at center pins the tip to the
          // location.
          'icon-anchor': 'center',
          'icon-allow-overlap': true,
        },
      })

      // `idle` fires after tiles + pins have actually painted — much more
      // accurate than hiding the loader when the layer is merely registered.
      map.once('idle', () => {
        setPinsLoaded(true)
        // Warm the browser cache for every tooltip logo so the first hover
        // doesn't show an empty image slot. Runs during idle time so it
        // doesn't compete with the initial page render. We also call
        // `.decode()` on each image and hold the reference — that forces
        // the browser to decode the bitmap during preload (instead of on
        // first hover) and prevents GC from evicting it.
        const preloadLogos = () => {
          mapCommunities.forEach(c => {
            if (!c.logo) return
            const img = new window.Image()
            img.decoding = 'async'
            img.src = c.logo
            img.decode().catch(() => {})
            preloadedLogosRef.current.push(img)
          })
        }
        if ('requestIdleCallback' in window) {
          ;(window as any).requestIdleCallback(preloadLogos, { timeout: 2000 })
        } else {
          setTimeout(preloadLogos, 200)
        }
      })

      // Escapes text for both attribute values and element content.
      function escapeAttr(value: string) {
        return value
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
      }

      function buildTooltipHTML(props: any) {
        const name = props?.name ?? ''
        const description = props?.description ?? ''
        const location = props?.location
        const logo = props?.logo
        const headerImage = logo
          ? `<div class="tooltip-img"><img src="${escapeAttr(logo)}" alt="${escapeAttr(name)} logo" class="tooltip-image" fetchpriority="high" decoding="sync" onerror="this.style.display='none'" /></div>`
          : ''
        const locationLine = location
          ? `<span class="location-text"><svg class="location-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 1C7 1 7.96 1.43 8.66 2.19C9.36 2.95 9.75 3.98 9.75 5.04C9.75 6.96 8.69 8.66 7.85 9.72C7.36 10.33 6.82 10.89 6.25 11.4C6.11 11.53 5.89 11.53 5.75 11.4C5.18 10.89 4.64 10.33 4.15 9.72C3.31 8.66 2.25 6.96 2.25 5.04C2.25 3.98 2.64 2.95 3.34 2.19C4.04 1.43 5 1 6 1Z" stroke="currentColor" stroke-linejoin="round"/><circle cx="6" cy="4.9" r="1.9" stroke="currentColor" stroke-linejoin="round"/></svg>${escapeAttr(location)}</span>`
          : ''
        return `<div class="tooltip-header">${headerImage}<div class="tooltip-title-block"><strong class="paragraph-small-bold">${escapeAttr(name)}</strong>${locationLine}</div></div>${escapeAttr(description)}`
      }

      function updateTooltipPosition(
        e: any,
        tt: HTMLDivElement,
        container: HTMLDivElement
      ) {
        positionTooltip(
          e.originalEvent.clientX,
          e.originalEvent.clientY,
          tt,
          container,
          isMobile() ? { minLeftMargin: 20 } : {}
        )
      }

      function setData(data: any) {
        map.getSource('communities').setData(data)
      }

      function resetHover() {
        geojsonData.features.forEach((f: any) => (f.properties.hover = false))
        setData(geojsonData)
      }

      // Desktop hover
      map.on('mousemove', 'community-pins', (e: any) => {
        if (isMobile() || !e.features || e.features.length === 0) {
          if (!isMobile() && hoveredPinId !== null) {
            map.getCanvas().style.cursor = ''
            resetHover()
            hoveredPinId = null
            tooltip.style.display = 'none'
            // Cursor slid off the pins — an unfinished dwell doesn't count.
            cancelHoverTimer()
          }
          return
        }
        map.getCanvas().style.cursor = 'pointer'
        const feature = e.features[0]
        const currentFeatureId = feature.id as number
        if (hoveredPinId !== currentFeatureId) {
          geojsonData.features.forEach((f: any) => {
            f.properties.hover = f.id === currentFeatureId
          })
          setData(geojsonData)
          hoveredPinId = currentFeatureId
          tooltip.innerHTML = buildTooltipHTML(feature.properties)
          tooltip.style.display = 'block'
          // Restart the hover dwell — entering a new pin (including moving
          // straight from one pin onto another) resets the 500 ms clock.
          cancelHoverTimer()
          const props = feature.properties
          hoverTimer = setTimeout(() => {
            hoverTimer = null
            trackListingHover(
              'Communities',
              props?.name ?? '',
              props?.link || undefined,
              props?.recordId || undefined
            )
          }, 500)
        }
        updateTooltipPosition(e, tooltip, mapContainer)
      })

      map.on('mouseleave', 'community-pins', () => {
        // Leaving before the dwell elapses means it wasn't a real hover.
        cancelHoverTimer()
        if (isMobile()) return
        if (hoveredPinId !== null) {
          map.getCanvas().style.cursor = ''
          resetHover()
          hoveredPinId = null
          tooltip.style.display = 'none'
        }
      })

      // Open the URL in a new tab via a synthetic anchor click. Some
      // browser/extension popup blockers stop `window.open(url, '_blank')`
      // from a Mapbox click handler because they treat it as a popup
      // rather than a link click. Programmatically clicking a real <a>
      // bypasses that — it's what `target="_blank"` links already do.
      function openInNewTab(url: string) {
        // Only web links: a listing's link comes from Airtable, and anything
        // else (javascript:, data:) must never run from a pin click.
        if (!/^https?:\/\//i.test(url)) return
        const a = document.createElement('a')
        a.href = url
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }

      // Click handler — desktop opens the listing directly. Mobile shows
      // the tooltip first so users can preview the info; tapping the
      // tooltip then opens the listing (handled below).
      map.on('click', 'community-pins', (e: any) => {
        if (!e.features || e.features.length === 0) return
        const feature = e.features[0]

        if (!isMobile()) {
          const link = feature.properties?.link
          if (link && link !== '#') {
            trackListingClick(
              'Communities',
              feature.properties?.name,
              link,
              feature.properties?.recordId || undefined,
              undefined,
              'map'
            )
            openInNewTab(withUtm(link, 'Communities'))
          }
          return
        }

        const currentFeatureId = feature.id as number
        if (tappedPinId !== currentFeatureId) {
          geojsonData.features.forEach((f: any) => {
            f.properties.hover = f.id === currentFeatureId
          })
          setData(geojsonData)
          tappedPinId = currentFeatureId

          tooltip.innerHTML = buildTooltipHTML(feature.properties)

          const link = feature.properties?.link
          tooltip.setAttribute('data-link-url', link || '')
          tooltip.setAttribute(
            'data-link-title',
            feature.properties?.name || ''
          )
          // Stash the record id too, so the tooltip-tap click below can
          // report it — that handler has no feature in scope.
          tooltip.setAttribute(
            'data-listing-id',
            feature.properties?.recordId || ''
          )
          tooltip.style.display = 'block'
          // A mobile "hover" is the first tap that opens the tooltip —
          // there's no cursor to dwell, so it counts immediately.
          trackListingHover(
            'Communities',
            feature.properties?.name ?? '',
            link || undefined,
            feature.properties?.recordId || undefined
          )
        }
        updateTooltipPosition(e, tooltip, mapContainer)
      })

      // Tooltip tap → open listing. Registered unconditionally so it
      // still works if the viewport is resized to mobile after load.
      const handleTooltipClick = function (e: MouseEvent) {
        if ((e.target as HTMLElement).closest('#mapbox-tooltip')) {
          const lnk = tooltip.getAttribute('data-link-url')
          if (lnk && lnk !== '#') {
            tooltip.style.display = 'none'
            if (tappedPinId !== null) {
              resetHover()
              tappedPinId = null
            }
            const title = tooltip.getAttribute('data-link-title')
            if (title)
              trackListingClick(
                'Communities',
                title,
                lnk,
                // Stashed on the tooltip by the first tap.
                tooltip.getAttribute('data-listing-id') || undefined,
                undefined,
                'map'
              )
            openInNewTab(withUtm(lnk, 'Communities'))
          }
          e.stopPropagation()
        }
      }

      // Tap outside any pin/tooltip → dismiss tooltip.
      const handleDocumentClick = function (e: MouseEvent) {
        const clickedOnMapCanvas = (e.target as HTMLElement).closest(
          '.mapboxgl-canvas'
        ) as HTMLCanvasElement | null
        const clickedOnTooltip = (e.target as HTMLElement).closest(
          '#mapbox-tooltip'
        )
        let clickedOnPin = false
        if (clickedOnMapCanvas && map.queryRenderedFeatures) {
          try {
            // queryRenderedFeatures expects canvas-relative coordinates,
            // not viewport coordinates. Without this offset the lookup
            // misses the pin when the map sits below any header.
            const canvasRect = clickedOnMapCanvas.getBoundingClientRect()
            const features = map.queryRenderedFeatures(
              [e.clientX - canvasRect.left, e.clientY - canvasRect.top],
              { layers: ['community-pins'] }
            )
            clickedOnPin = features.length > 0
          } catch {
            /* Ignore - map may be in invalid state */
          }
        }
        if (!clickedOnTooltip && !clickedOnPin) {
          if (tooltip.style.display !== 'none') {
            tooltip.style.display = 'none'
            if (tappedPinId !== null) {
              resetHover()
              tappedPinId = null
            }
          }
        }
      }

      // ESC resets the view, same as the reset button. Skip while typing in
      // a form field — ESC there shouldn't yank the map.
      const handleEscKey = function (e: KeyboardEvent) {
        if (e.key !== 'Escape') return
        const target = e.target as HTMLElement | null
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        )
          return
        handleResetView()
      }

      tooltip.addEventListener('click', handleTooltipClick)
      document.addEventListener('click', handleDocumentClick)
      document.addEventListener('keydown', handleEscKey)

      // Store cleanup function for useEffect teardown
      cleanupRef.current = () => {
        // A pending hover dwell must not fire after unmount.
        cancelHoverTimer()
        tooltip.removeEventListener('click', handleTooltipClick)
        document.removeEventListener('click', handleDocumentClick)
        document.removeEventListener('keydown', handleEscKey)
        resizeObserver.disconnect()
      }
    })
  }

  useEffect(() => {
    // If the script was already loaded (e.g. cached from a previous visit),
    // mark it as ready so the init effect below fires.
    if (window.mapboxgl) {
      setScriptLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!scriptLoaded) return
    initMap()
    return () => {
      // Clean up event listeners
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      // Clean up map instance
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptLoaded])

  function handleScriptLoad() {
    setScriptLoaded(true)
  }

  function handleZoomIn() {
    mapRef.current?.zoomIn()
  }

  function handleZoomOut() {
    mapRef.current?.zoomOut()
  }

  function handleResetView() {
    mapRef.current?.flyTo({
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      bearing: 0,
      pitch: 0,
      duration: 500,
      essential: true,
    })
  }

  function handleViewOnline() {
    trackCardsButtonClick('Communities', 'View online communities')
    if (mapContainerRef.current) {
      const mapRect = mapContainerRef.current.getBoundingClientRect()
      window.scrollTo({
        top: window.scrollY + mapRect.bottom,
        behavior: 'smooth',
      })
    }
  }

  return (
    <>
      {/*
       * Preconnect + preload hints so the browser starts fetching the Mapbox
       * script, stylesheet, and pin image as soon as the HTML arrives —
       * instead of waiting for React hydration + `Script strategy=afterInteractive`.
       * Together these shave ~500–1000ms off the time-to-pins on first load.
       */}
      <link rel="preconnect" href="https://api.mapbox.com" />
      <link rel="dns-prefetch" href="https://events.mapbox.com" />
      <link
        rel="preload"
        as="script"
        href={MAPBOX_GL_JS_URL}
        fetchPriority="high"
      />
      <link rel="preload" as="style" href={MAPBOX_GL_CSS_URL} />
      <link
        rel="preload"
        as="image"
        href="/images/pin.svg"
        type="image/svg+xml"
      />
      <link href={MAPBOX_GL_CSS_URL} rel="stylesheet" />
      <Script
        src={MAPBOX_GL_JS_URL}
        strategy="afterInteractive"
        onLoad={handleScriptLoad}
      />
      <div ref={mapContainerRef} className={styles.mapContainer}>
        {!pinsLoaded && (
          <div className={styles.mapLoading} aria-live="polite">
            <div className={styles.mapSpinner} aria-hidden="true" />
            <p className="paragraph-small">Loading map…</p>
          </div>
        )}
        <button
          onClick={handleViewOnline}
          className={`button-primary ${styles.mapButton}`}
        >
          <p>View online communities</p>
          <Icon
            src="/images/icons/arrow-down.svg"
            size={16}
            className="color-teal-bright-400"
          />
        </button>
        <MapControls
          className={styles.mapControls}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onReset={handleResetView}
        />
      </div>
      <div
        ref={tooltipRef}
        id="mapbox-tooltip"
        className="paragraph-xs"
        style={{ display: 'none', position: 'fixed' }}
      />
    </>
  )
}
