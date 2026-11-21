/**
 * Hostnames of the live site. Only pages served on these report to Matomo,
 * both the browser snippet in src/app/layout.tsx and the AI-assistant hits in
 * src/proxy.ts. Everything else (dev servers on localhost, Vercel preview
 * deploys, the project's own *.vercel.app addresses, other people's forks
 * deployed to their own Vercel) would otherwise fill Matomo with test visits,
 * several hundred a month by November 2026, mostly from Claude Code
 * sessions' dev servers and previews.
 *
 * Google Translate's proxy serves a real reader the page in their language,
 * so it counts.
 */
export const LIVE_SITE_HOSTS: readonly string[] = [
  'aisafety.com',
  'www.aisafety.com',
  'aisafety-com.translate.goog',
]

export function isLiveSiteHost(hostname: string): boolean {
  return LIVE_SITE_HOSTS.includes(hostname.toLowerCase())
}
