import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import { SITE_PAGES, type SitePage } from '@/lib/site-pages'

/**
 * Renders the 1200×630 link-preview card for a page: the homepage card
 * (public/images/link-preview.jpg) with the page's own pill second in the
 * list, filled and ringed like the active item in the global nav, plus a soft
 * teal glow. Wordmark and headline are the homepage card's, on every page.
 *
 * background.png is the homepage card with its pill column replaced by the
 * same teal gradient (a smooth surface fitted to the card's empty areas), so
 * the left half is Melissa's file pixel for pixel and only the pills are
 * redrawn. Pill geometry, type size and colors are measured from that file.
 *
 * Each route's `opengraph-image.tsx` calls this with its SITE_PAGES entry.
 * Next renders it at build time, so the font and images are read from the
 * repo rather than fetched. The PNG that next/og produces is re-encoded as
 * JPEG: the gradient makes the PNG ~440 KB, and WhatsApp drops preview images
 * over ~300 KB; the JPEG is under 100 KB with no visible change.
 */

export const size = { width: 1200, height: 630 }
export const contentType = 'image/jpeg'
const JPEG_QUALITY = 88

const ASSET_DIR = join(process.cwd(), 'src/lib/link-preview')
const ICON_DIR = join(process.cwd(), 'public/images/icons')

// The five pills on the homepage card, in its order. The current page takes
// the second slot (the first is clipped by the top edge) and the rest follow.
const PILL_ORDER = ['jobs', 'events', 'communities', 'map', 'advisors'] as const
const PILL = { left: 637, width: 486, height: 124, pitch: 144, firstTop: -40 }
const DISC = 104
const ICON = 40

// Nav icons are drawn in --teal-300; on the white discs they are --teal-bright-800.
const ICON_SOURCE_COLOR = /#AAB2B3/gi
const ICON_COLOR = '#094141'

// The current page's pill uses the global nav's active state:
// --bright-teal-300 ring on a --teal-850 fill (Navigation.module.css).
const RING = '#a6dad9'
const FILL = '#0e2628'

const svgDataUri = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

export async function linkPreviewImage(page: SitePage) {
  const others = PILL_ORDER.map(key => SITE_PAGES[key]).filter(
    p => p.path !== page.path
  )
  const pills: SitePage[] = [others[0], page, ...others.slice(1)].slice(0, 5)

  const [semibold, background, ...icons] = await Promise.all([
    readFile(join(ASSET_DIR, 'Inter-SemiBold.ttf')),
    readFile(join(ASSET_DIR, 'background.png')),
    ...pills.map(p => readFile(join(ICON_DIR, p.icon), 'utf8')),
  ])

  const png = new ImageResponse(
    <div
      style={{
        width: size.width,
        height: size.height,
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#00191b',
        fontFamily: 'Inter',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`data:image/png;base64,${background.toString('base64')}`}
        width={size.width}
        height={size.height}
        alt=""
        style={{ position: 'absolute', top: 0, left: 0 }}
      />

      {pills.map((pill, i) => {
        const current = pill.path === page.path
        return (
          <div
            key={pill.path}
            style={{
              position: 'absolute',
              left: PILL.left,
              top: PILL.firstTop + i * PILL.pitch,
              // Long names ("Volunteer projects") need more room than the homepage
              // pill gives them, so a pill may grow to fit its label; the others keep
              // the measured width.
              minWidth: PILL.width,
              paddingRight: 48,
              height: PILL.height,
              display: 'flex',
              alignItems: 'center',
              borderRadius: PILL.height / 2,
              border: `2px solid ${current ? RING : '#46797b'}`,
              backgroundColor: current ? FILL : 'transparent',
              // Satori rejects `boxShadow: undefined`, so only set it here.
              ...(current && {
                boxShadow: '0 0 44px rgba(108, 189, 187, 0.6)',
              }),
            }}
          >
            <div
              style={{
                width: DISC,
                height: DISC,
                marginLeft: 9,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: DISC / 2,
                backgroundColor: '#ffffff',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={svgDataUri(
                  icons[i].replace(ICON_SOURCE_COLOR, ICON_COLOR)
                )}
                width={ICON}
                height={ICON}
                alt=""
              />
            </div>
            <div
              style={{
                marginLeft: 27,
                fontSize: 36,
                fontWeight: 600,
                color: '#ffffff',
              }}
            >
              {pill.title}
            </div>
          </div>
        )
      })}
    </div>,
    {
      ...size,
      fonts: [{ name: 'Inter', data: semibold, weight: 600, style: 'normal' }],
    }
  )

  const jpeg = await sharp(Buffer.from(await png.arrayBuffer()))
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer()
  return new Response(new Uint8Array(jpeg), {
    headers: { 'Content-Type': contentType },
  })
}
