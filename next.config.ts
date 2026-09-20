import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  env: {
    // Timestamp when this build started. Used by /api/check-rebuild to decide
    // whether Airtable has been edited since the last deploy.
    BUILD_TIME: new Date().toISOString(),
  },
  async redirects() {
    return [
      // Vercel's edge routing serves the homepage under its internal alias
      // /index (Next itself 404s it — try `next start`). Left reachable it's
      // a duplicate page for search engines and lets a public request
      // repopulate the homepage ISR cache under the alias. Internal
      // revalidations invoke the function directly and never pass through
      // redirects, so this only affects public requests.
      { source: '/index', destination: '/', permanent: true },
      {
        source: '/founder-toolkit',
        destination: '/founders',
        permanent: true,
      },
      // Admin routes renamed: /admin/assistant -> /admin/chatbot.
      {
        source: '/admin/assistant',
        destination: '/admin/chatbot/playground',
        permanent: false,
      },
      {
        source: '/admin/assistant/conversations',
        destination: '/admin/chatbot/log',
        permanent: false,
      },
      // Migrated from Webflow redirects (exported 6 April 2026).
      // Redirects whose destination doesn't exist on the new site
      // were skipped: /ai-safety-reading-guide, /landscape-map/suggest,
      // /jobs-old, /reading-guide.
      // Chains through /stay-informed were collapsed to /media-channels.
      { source: '/donating', destination: '/donation-guide', permanent: true },
      { source: '/database', destination: '/communities', permanent: true },
      // The split page: /events-and-training's traffic goes to /training
      // (Bryce's call, 27 Jul 2026).
      {
        source: '/events-and-training',
        destination: '/training',
        permanent: true,
      },
      { source: '/talk-to-a-human', destination: '/advisors', permanent: true },
      { source: '/landscape-map', destination: '/map', permanent: true },
      { source: '/landscape-map-2025', destination: '/map', permanent: true },
      { source: '/reading-group', destination: '/', permanent: true },
      { source: '/courses', destination: '/self-study', permanent: true },
      { source: '/funders', destination: '/funding', permanent: true },
      {
        source: '/volunteer-projects',
        destination: '/projects',
        permanent: true,
      },
      {
        source: '/stay-informed',
        destination: '/media-channels',
        permanent: true,
      },
      {
        source: '/learn-and-stay-informed',
        destination: '/media-channels',
        permanent: true,
      },
      // /media used to redirect to /media-channels (a Webflow-era alias). It
      // is the press and media page since September 2026; /press is its
      // alias. Browsers that cached the old permanent redirect keep following
      // it until that cache expires.
      { source: '/press', destination: '/media', permanent: true },
      // /donate is the short address for giving to AISafety.com itself (the
      // footer's Donate link goes to the same Every.org page). Temporary on
      // purpose: if the site ever gets its own support page, the address can
      // move there without browsers remembering the old target. Not to be
      // confused with /donating, which is the guide to funding AI safety
      // organizations.
      {
        source: '/donate',
        destination:
          'https://www.every.org/aisafetycom?donateTo=aisafetycom#/donate/card',
        permanent: false,
      },
    ]
  },
}

export default nextConfig
