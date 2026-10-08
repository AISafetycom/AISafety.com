'use client'

import { useId, useState } from 'react'
import Icon from '@/components/Icon'
import {
  trackNewsletterSignup,
  trackNewsletterSignupError,
  trackNewsletterSignupSuccess,
  trackNewsletterView,
} from '@/lib/analytics'
import type { SignupNewsletter } from '@/lib/newsletter-signup'
import { withUtm } from '@/lib/utm'
import styles from './NewsletterSignup.module.css'

/** The newsletter signup box beside a resource page's header, in one of two
 *  modes:
 *  - `newsletter` set (/events, /training): signs the reader up on the site,
 *    through /api/subscribe and the newsletter's ActiveCampaign form, and
 *    asks them to confirm from their inbox.
 *  - `subscribeUrl` set (/funding, while the Funding newsletter is still on
 *    Substack): opens Substack's subscribe page with the email filled in,
 *    and the heading links to the publication itself. */
export default function NewsletterSignup({
  heading,
  newsletter,
  subscribeUrl,
  trackingPage,
}: {
  heading?: string
  /** Sign up through ActiveCampaign for this newsletter. */
  newsletter?: SignupNewsletter
  /** Or: the Substack subscribe page the box opens. */
  subscribeUrl?: string
  /** Analytics page name (e.g. 'Events'). When set, a submit records a
   *  newsletter_signup event under this page, plus how it ended
   *  (newsletter_signup_success / _error) in ActiveCampaign mode, or a
   *  newsletter_view for a click on the card's link in Substack mode. */
  trackingPage?: string
}) {
  if (!heading) throw new Error('NewsletterSignup needs a heading')
  if (newsletter) {
    return (
      <ActiveCampaignSignup
        heading={heading}
        newsletter={newsletter}
        trackingPage={trackingPage}
      />
    )
  }
  if (subscribeUrl) {
    return (
      <SubstackSignup
        heading={heading}
        subscribeUrl={subscribeUrl}
        trackingPage={trackingPage}
      />
    )
  }
  throw new Error('NewsletterSignup needs a newsletter or a subscribeUrl')
}

const SUCCESS = 'Check your inbox to confirm your subscription.'
const SOMETHING_WRONG =
  'Something went wrong. Please try again in a few minutes.'
const OFFLINE =
  "Couldn't connect. Please check your internet connection and try again."

/** Signs the reader up on the site. The heading is plain text: there's no
 *  public archive to link to. */
function ActiveCampaignSignup({
  heading,
  newsletter,
  trackingPage,
}: {
  heading: string
  newsletter: SignupNewsletter
  trackingPage?: string
}) {
  const [email, setEmail] = useState('')
  // The honeypot's value: stays empty for people.
  const [hp, setHp] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState('')
  const statusId = useId()
  const sending = state === 'sending'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (sending) return
    // On the form, not the button, so Enter submits count the same as clicks.
    if (trackingPage) trackNewsletterSignup(trackingPage)
    setState('sending')
    setError('')
    let failure: { message: string; reason: string } | null = null
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, newsletter, hp }),
      })
      const body: unknown = await res.json().catch(() => null)
      const answer = (body ?? {}) as {
        ok?: unknown
        error?: unknown
        reason?: unknown
      }
      if (!res.ok || answer.ok !== true) {
        failure = {
          message:
            typeof answer.error === 'string' ? answer.error : SOMETHING_WRONG,
          reason:
            typeof answer.reason === 'string'
              ? answer.reason
              : `http_${res.status}`,
        }
      }
    } catch {
      failure = { message: OFFLINE, reason: 'network' }
    }
    if (failure) {
      // Keep the typed address so a fix is one edit away.
      setState('idle')
      setError(failure.message)
      if (trackingPage) trackNewsletterSignupError(trackingPage, failure.reason)
    } else {
      setState('done')
      if (trackingPage) trackNewsletterSignupSuccess(trackingPage)
    }
  }

  const status = state === 'done' ? SUCCESS : error
  const statusStyle =
    state === 'done'
      ? 'paragraph-small color-light-teal'
      : error
        ? 'paragraph-xs color-orange padding-top-8px'
        : ''
  return (
    <form
      className={`width-4-col ${styles.card}`}
      onSubmit={handleSubmit}
      aria-busy={sending}
    >
      <p className={`paragraph-small ${styles.heading}`}>{heading}</p>
      <div>
        {state !== 'done' && (
          // A label so clicks anywhere on the pill focus the input.
          <label className={styles.field}>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className={`paragraph-small ${styles.input}`}
              placeholder="Your email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? statusId : undefined}
            />
            <button
              type="submit"
              className={`${styles.submit}${sending ? ' opacity-50' : ''}`}
              aria-label="Subscribe"
              disabled={sending}
            >
              <Icon
                src="/images/icons/arrow-right.svg"
                size={16}
                className="color-white"
              />
            </button>
          </label>
        )}
        {/* Always rendered, so screen readers announce what lands in it:
            the error under the pill, or the success line in its place. */}
        <div
          id={statusId}
          role="status"
          aria-live="polite"
          className={`${styles.status} ${statusStyle}`.trim()}
        >
          {status}
        </div>
      </div>
      {/* Honeypot: off-screen, hidden from screen readers, and out of the
          tab order, with a name no browser or password manager fills in.
          People never see it; naive bots fill every field. */}
      <div className={styles.trap} aria-hidden="true">
        <input
          type="text"
          name="hp"
          tabIndex={-1}
          autoComplete="off"
          value={hp}
          onChange={e => setHp(e.target.value)}
        />
      </div>
    </form>
  )
}

/** Hands off to Substack's own subscribe page with the email filled in. */
function SubstackSignup({
  heading,
  subscribeUrl,
  trackingPage,
}: {
  heading: string
  subscribeUrl: string
  trackingPage?: string
}) {
  const [email, setEmail] = useState('')
  // The publication's homepage — where the card link goes, so visitors can
  // read the newsletter before handing over an email.
  const homepageUrl = subscribeUrl.replace(/\/subscribe\/?$/, '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // On the form, not the button, so Enter submits count the same as clicks.
    if (trackingPage) trackNewsletterSignup(trackingPage)
    const trimmed = email.trim()
    const url = trimmed
      ? `${subscribeUrl}?email=${encodeURIComponent(trimmed)}`
      : subscribeUrl
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <form className={`width-4-col ${styles.card}`} onSubmit={handleSubmit}>
      {/* The heading is a link stretched over the whole card, so clicking
          anywhere outside the email pill opens the newsletter itself —
          letting visitors read it without entering an email. */}
      <a
        href={trackingPage ? withUtm(homepageUrl, trackingPage) : homepageUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`paragraph-small ${styles.heading} ${styles.headingLink}`}
        onClick={() => {
          if (trackingPage) trackNewsletterView(trackingPage)
        }}
      >
        {heading}
      </a>
      {/* A label so clicks anywhere on the pill focus the input. */}
      <label className={styles.field}>
        <input
          type="email"
          className={`paragraph-small ${styles.input}`}
          placeholder="Your email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <button type="submit" className={styles.submit} aria-label="Subscribe">
          <Icon
            src="/images/icons/arrow-right.svg"
            size={16}
            className="color-white"
          />
        </button>
      </label>
    </form>
  )
}
