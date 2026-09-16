import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import { Suspense } from 'react'
import './globals.css'
import LayoutShell from '@/components/LayoutShell'
import MatomoRouteTracker from '@/components/MatomoRouteTracker'
import PreviewBanner from '@/components/PreviewBanner'
import ScrollToHash from '@/components/ScrollToHash'
import { fetchAllCounts } from '@/lib/data/counts'
import { isPreviewRequest } from '@/lib/preview'

const inter = Inter({
  subsets: ['latin'],
  weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-inter',
})

export const viewport: Viewport = {
  colorScheme: 'dark',
}

export const metadata: Metadata = {
  metadataBase: new URL('https://aisafety.com'),
  title: 'AISafety.com',
  description:
    'The hub for AI existential safety, providing resources to help you learn about and help mitigate the risks from advanced AI.',
  icons: {
    icon: '/images/favicon.png',
    apple: '/images/webclip.png',
  },
  openGraph: {
    siteName: 'AISafety.com',
    type: 'website',
    images: [{ url: '/images/link-preview.jpg' }],
  },
  // Card type only: title, description and image fall back to each page's
  // own (its metadata, or its opengraph-image.tsx), so X shows the page
  // rather than the homepage blurb.
  twitter: {
    card: 'summary_large_image',
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const counts = await fetchAllCounts()
  const preview = await isPreviewRequest()

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(performance.getEntriesByType('navigation')[0]?.type==='reload')document.documentElement.classList.add('is-reload')}catch(e){}`,
          }}
        />
        <Script id="matomo" strategy="afterInteractive">
          {`
            var _paq = window._paq = window._paq || [];
            _paq.push(["disableCookies"]);
            // 'aisafety_no_track' mirrors OPTOUT_KEY in src/lib/analytics.ts —
            // browsers opted out via the privacy page (or admin) send Matomo
            // nothing, matching the first-party analytics behavior.
            var noTrack = false;
            try { noTrack = !!localStorage.getItem('aisafety_no_track'); } catch (e) {}
            if (!noTrack) {
              _paq.push(['trackPageView']);
              _paq.push(['enableLinkTracking']);
            }
            (function() {
              var u="https://aisafety.matomo.cloud/";
              _paq.push(['setTrackerUrl', u+'matomo.php']);
              _paq.push(['setSiteId', '1']);
              var d=document, g=d.createElement('script'), s=d.getElementsByTagName('script')[0];
              g.async=true; g.src='https://cdn.matomo.cloud/aisafety.matomo.cloud/matomo.js'; s.parentNode.insertBefore(g,s);
            })();
          `}
        </Script>
        <Suspense fallback={null}>
          <MatomoRouteTracker />
        </Suspense>
        <LayoutShell counts={counts} preview={preview}>
          <ScrollToHash />
          {children}
        </LayoutShell>
        <PreviewBanner />
      </body>
    </html>
  )
}
