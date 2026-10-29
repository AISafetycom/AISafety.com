'use client'

import { useTrackingOptOut, formatExcludedSince } from '@/lib/useTrackingOptOut'
import { trackEvent } from '@/lib/analytics'

/** Visitor-facing analytics switch on the privacy page. Shares the one
 *  "exclude this browser" localStorage flag with the admin controls, so a
 *  browser switched off here drops out of first-party analytics, Matomo, and
 *  the chatbot conversation log alike. Forward-only: anything already
 *  recorded stays. */
export default function AnalyticsOptOut() {
  const { marker, optedOut, setOptOut } = useTrackingOptOut()
  const since = optedOut ? formatExcludedSince(marker) : undefined

  const handleToggle = () => {
    if (!optedOut) {
      // Count the opt-out itself (dashboard's "Analytics opt-outs" stat) —
      // fired before the flag flips, as the browser's last analytics event.
      // Only this public switch counts; the admin exclude-browser controls
      // are the team's own testing and don't fire it.
      trackEvent('analytics_optout', { page: 'Privacy' })
      setOptOut(true)
    } else {
      setOptOut(false)
      trackEvent('analytics_optin', { page: 'Privacy' })
    }
  }

  return (
    <div className="padding-bottom-40px">
      {optedOut && (
        <p className="paragraph-small color-teal-300 padding-bottom-16px">
          ✓ Analytics is off in this browser{since ? ` (since ${since})` : ''}.
        </p>
      )}
      <button
        type="button"
        className="button-secondary cursor-pointer"
        onClick={handleToggle}
      >
        {optedOut
          ? 'Turn analytics back on'
          : 'Turn off analytics in this browser'}
      </button>
    </div>
  )
}
