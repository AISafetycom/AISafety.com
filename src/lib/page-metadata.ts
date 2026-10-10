import type { Metadata } from 'next'
import type { SitePage } from './site-pages'

/**
 * <head> metadata for a public page: <title>, description and canonical URL.
 *
 * Deliberately no `openGraph` or `twitter` block. Next fills og:/twitter:
 * title and description from the fields below, the root layout's site name,
 * card type and fallback image are inherited, and a route's
 * `opengraph-image.tsx` replaces that image with the page's own card.
 *
 * A page-level `openGraph` object would replace the root one wholesale, and
 * if it named `images` Next would also ignore the route's generated card
 * (file-based images only apply when the same segment's config leaves
 * `images` unset). Both happened on 2–3 September 2026.
 */
export function pageMetadata(
  { path, title, description }: SitePage,
  /** A feed to announce, so a feed reader given the page's address finds
   *  it (/events and /training: their newsletter's). */
  feed?: { url: string; title: string }
): Metadata {
  return {
    title: `${title} – AISafety.com`,
    description,
    alternates: {
      canonical: path,
      ...(feed ? { types: { 'application/rss+xml': [feed] } } : {}),
    },
  }
}
