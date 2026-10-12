'use client'

import { useId, useState } from 'react'
import Icon from '@/components/Icon'
import {
  trackNewsletterSignup,
  trackNewsletterSignupError,
  trackNewsletterSignupSuccess,
} from '@/lib/analytics'
import type { SignupNewsletter } from '@/lib/newsletter-signup'
import styles from './NewsletterSignup.module.css'

/** The newsletter signup box beside a resource page's header (/events,
 *  /training, /funding): signs the reader up on the site, through
 *  /api/subscribe and the newsletter's ActiveCampaign form, and asks them to
 *  confirm from their inbox. (Until the Funding move, /funding's box opened
 *  Substack's subscribe page instead.) */
export default function NewsletterSignup({
  heading,
  newsletter,
  trackingPage,
}: {
  heading?: string
  /** Sign up through ActiveCampaign for this newsletter. */
  newsletter?: SignupNewsletter
  /** Analytics page name (e.g. 'Events'). When set, a submit records a
   *  newsletter_signup event under this page, plus how it ended
   *  (newsletter_signup_success / _error). */
  trackingPage?: string
}) {
  if (!heading) throw new Error('NewsletterSignup needs a heading')
  if (!newsletter) throw new Error('NewsletterSignup needs a newsletter')
  return (
    <ActiveCampaignSignup
      heading={heading}
      newsletter={newsletter}
      trackingPage={trackingPage}
    />
  )
}

const SUCCESS = 'Check your inbox to confirm your subscription.'
const ALREADY = "You're already subscribed."
const SOMETHING_WRONG =
  'Something went wrong. Please try again in a few minutes.'
const OFFLINE =
  "Couldn't connect. Please check your internet connection and try again."

/** Signs the reader up on the site. The heading is plain text: no link to
 *  the newsletter's past issues page (/newsletter/<key>) for now (Bryce,
 *  10 Oct 2026). */
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
  // Set when the address was already confirmed on the list: no email comes.
  const [already, setAlready] = useState(false)
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
    let wasAlready = false
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, newsletter, hp }),
      })
      const body: unknown = await res.json().catch(() => null)
      const answer = (body ?? {}) as {
        ok?: unknown
        already?: unknown
        error?: unknown
        reason?: unknown
      }
      wasAlready = answer.already === true
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
      setAlready(wasAlready)
      setState('done')
      // An address already on the list isn't a new signup: it's counted
      // under its own reason on the dashboard, not as a success.
      if (trackingPage) {
        if (wasAlready) {
          trackNewsletterSignupError(trackingPage, 'already_subscribed')
        } else trackNewsletterSignupSuccess(trackingPage)
      }
    }
  }

  const status = state === 'done' ? (already ? ALREADY : SUCCESS) : error
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
              className={styles.submit}
              aria-label={sending ? 'Subscribing' : 'Subscribe'}
              disabled={sending}
            >
              {/* A loading circle while the signup is on its way, so a
                  press of Enter visibly did something (Bryce, 8 Oct 2026). */}
              {sending ? (
                <span className={styles.spinner} aria-hidden="true" />
              ) : (
                <Icon
                  src="/images/icons/arrow-right.svg"
                  size={16}
                  className="color-white"
                />
              )}
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
