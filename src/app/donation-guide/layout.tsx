import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

export const metadata = pageMetadata(SITE_PAGES.donationGuide)

export default function DonationGuideLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
