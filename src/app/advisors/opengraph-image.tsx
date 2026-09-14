import { linkPreviewImage } from '@/lib/link-preview'
import { SITE_PAGES } from '@/lib/site-pages'

const page = SITE_PAGES.advisors

export const alt = `${page.title} – AISafety.com`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/jpeg'

export default function Image() {
  return linkPreviewImage(page)
}
