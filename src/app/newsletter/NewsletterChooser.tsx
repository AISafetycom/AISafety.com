'use client'

import { useEffect, useId, useState } from 'react'
import {
  trackEvent,
  trackNewsletterSignup,
  trackNewsletterSignupError,
  trackNewsletterSignupSuccess,
} from '@/lib/analytics'
import { hashHasKeyParam, keyFromHash } from '@/lib/newsletter-manage-link'
import {
  SIGNUP_NEWSLETTERS,
  type SignupNewsletter,
} from '@/lib/newsletter-signup'
import styles from './NewsletterChooser.module.css'

/** The newsletters on /newsletter, for a visitor to tick and sign up to, or
 *  (from the "Manage subscriptions" link in an issue) for a reader to see
 *  and change. The reader's key arrives in the address's fragment and goes
 *  straight out of the address bar; it lives in this component's state
 *  only, never in browser storage. */

type Subscriptions = Record<SignupNewsletter, boolean>

interface Newsletter {
  key: SignupNewsletter
  /** "AI Safety Events" */
  name: string
  /** The sentence after the name: "is a weekly newsletter that lists …" */
  about: string
  /** Its own page, with past issues and its feed. */
  archive: string
}

interface Updates {
  name: string
  about: string
  url: string
}

/** Recorded under this page in analytics (its own row, apart from the
 *  boxes on /events, /training and /funding). */
const TRACKING_PAGE = '/newsletter'
const NONE: Subscriptions = { events: false, training: false, funding: false }

const SOMETHING_WRONG =
  'Something went wrong. Please try again in a few minutes.'
const OFFLINE =
  "Couldn't connect. Please check your internet connection and try again."
const BROKEN_LINK =
  "This link doesn't work anymore. To change your newsletters, use the Manage subscriptions link at the bottom of a recent email, or sign up below."

type View =
  | { kind: 'signup'; note?: string; retryKey?: string }
  | { kind: 'loading' }
  | { kind: 'manage'; key: string; email: string; saved: Subscriptions }

interface SettingsAnswer {
  ok: boolean
  email?: string
  subscribed?: Subscriptions
  dryRun?: boolean
  error?: string
  reason?: string
}

async function callSettings(body: {
  k: string
  set?: Subscriptions
}): Promise<SettingsAnswer> {
  try {
    const res = await fetch('/api/newsletter/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const answer = ((await res.json().catch(() => null)) ??
      {}) as SettingsAnswer
    if (res.ok && answer.ok === true) return answer
    return {
      ...answer,
      ok: false,
      error: typeof answer.error === 'string' ? answer.error : SOMETHING_WRONG,
      reason:
        typeof answer.reason === 'string'
          ? answer.reason
          : `http_${res.status}`,
    }
  } catch {
    return { ok: false, error: OFFLINE, reason: 'network' }
  }
}

/** "A", "A and B", "A, B, and C". */
function listOf(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

export default function NewsletterChooser({
  newsletters,
  updates,
}: {
  newsletters: Newsletter[]
  updates: Updates
}) {
  const [view, setView] = useState<View>({ kind: 'signup' })

  async function load(key: string) {
    setView({ kind: 'loading' })
    const answer = await callSettings({ k: key })
    trackEvent('newsletter_settings_open', {
      page: TRACKING_PAGE,
      label: 'Newsletter settings',
      source: answer.ok ? 'ok' : (answer.reason ?? 'error'),
    })
    if (answer.ok && answer.email && answer.subscribed) {
      setView({
        kind: 'manage',
        key,
        email: answer.email,
        saved: answer.subscribed,
      })
      return
    }
    // A link that will never work shows the signup with a note; anything
    // else (ActiveCampaign down, a lost connection) can be tried again.
    const final =
      answer.reason === 'link_invalid' || answer.reason === 'not_found'
    setView({
      kind: 'signup',
      note: answer.error ?? SOMETHING_WRONG,
      retryKey: final ? undefined : key,
    })
  }

  useEffect(() => {
    const hash = window.location.hash
    if (!hashHasKeyParam(hash)) return
    // Out of the address bar straight away, so an address copied from it
    // never carries the reader's key.
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search
    )
    const key = keyFromHash(hash)
    if (key) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: the fragment only exists in the browser, after the static page has hydrated
      void load(key)
      return
    }
    trackEvent('newsletter_settings_open', {
      page: TRACKING_PAGE,
      label: 'Newsletter settings',
      source: 'link_invalid',
    })
    setView({ kind: 'signup', note: BROKEN_LINK })
    // Runs once, on the address the page was opened with.
  }, [])

  return (
    <>
      {view.kind === 'loading' && (
        <p className="color-teal-300" role="status">
          Loading your newsletters
        </p>
      )}
      {view.kind === 'manage' && (
        <ManageForm
          key={view.key}
          newsletters={newsletters}
          settingsKey={view.key}
          email={view.email}
          initial={view.saved}
        />
      )}
      {view.kind === 'signup' && (
        <>
          {view.note && (
            <div className="padding-bottom-40px">
              <p className="color-orange" role="status">
                {view.note}
              </p>
              {view.retryKey && (
                <button
                  type="button"
                  className="button-secondary cursor-pointer margin-top-16px"
                  onClick={() => void load(view.retryKey as string)}
                >
                  Try again
                </button>
              )}
            </div>
          )}
          <SignupForm newsletters={newsletters} />
        </>
      )}
      {view.kind !== 'loading' && <UpdatesNote updates={updates} />}
    </>
  )
}

/** One row per newsletter: its box, what it is, and a link to its page. */
function NewsletterRows({
  newsletters,
  ticks,
  onToggle,
  disabled,
}: {
  newsletters: Newsletter[]
  ticks: Subscriptions
  onToggle: (key: SignupNewsletter, on: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <ul className={styles.rows}>
      {newsletters.map(n => (
        <li
          key={n.key}
          className={`${styles.row} flex items-start gap-8px padding-top-24px padding-bottom-24px`}
        >
          <input
            id={`${id}-${n.key}`}
            type="checkbox"
            className="checkbox"
            checked={ticks[n.key]}
            disabled={disabled}
            onChange={e => onToggle(n.key, e.target.checked)}
          />
          <div>
            <label htmlFor={`${id}-${n.key}`} className="cursor-pointer">
              <span className="color-white">{n.name}</span>{' '}
              <span className="color-teal-300">{n.about}</span>
            </label>
            <p className="paragraph-small padding-top-8px">
              <a
                href={n.archive}
                className={`color-light-teal ${styles.link}`}
                onClick={() =>
                  trackEvent('newsletter_page_click', {
                    page: TRACKING_PAGE,
                    label: n.key,
                    source: 'issues',
                  })
                }
              >
                Past issues&nbsp;&rarr;
              </a>
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** A visitor's signup: tick the newsletters, give the address, confirm once
 *  from the inbox. */
function SignupForm({ newsletters }: { newsletters: Newsletter[] }) {
  const [ticks, setTicks] = useState<Subscriptions>(NONE)
  const [email, setEmail] = useState('')
  // The honeypot's value: stays empty for people.
  const [hp, setHp] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const statusId = useId()
  const sending = state === 'sending'
  const nameOf = (key: string) =>
    newsletters.find(n => n.key === key)?.name ?? key

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (sending) return
    const picks = SIGNUP_NEWSLETTERS.filter(n => ticks[n])
    if (picks.length === 0) {
      setError('Tick at least one newsletter.')
      return
    }
    trackNewsletterSignup(TRACKING_PAGE)
    setState('sending')
    setError('')
    let answer: {
      ok?: unknown
      already?: unknown
      confirm?: unknown
      error?: unknown
      reason?: unknown
    } = {}
    let failure: { message: string; reason: string } | null = null
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, newsletters: picks, hp }),
      })
      answer = ((await res.json().catch(() => null)) ?? {}) as typeof answer
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
      trackNewsletterSignupError(TRACKING_PAGE, failure.reason)
      return
    }
    setState('done')
    if (answer.already === true) {
      setDone(
        picks.length > 1
          ? "You're already subscribed to these."
          : "You're already subscribed."
      )
      trackNewsletterSignupError(TRACKING_PAGE, 'already_subscribed')
      return
    }
    // The newsletters the confirmation email names: the ones ticked that the
    // reader didn't get yet. One newsletter's email comes from it; a
    // combination's comes from AISafety.com.
    const confirm = Array.isArray(answer.confirm)
      ? SIGNUP_NEWSLETTERS.filter(n =>
          (answer.confirm as unknown[]).includes(n)
        )
      : []
    const sender =
      confirm.length === 1
        ? nameOf(confirm[0])
        : confirm.length > 1
          ? 'AISafety.com'
          : null
    setDone(
      `Check your inbox${sender ? ` for an email from ${sender}` : ''} and confirm your subscription.`
    )
    trackNewsletterSignupSuccess(
      TRACKING_PAGE,
      confirm.length ? confirm.join('+') : undefined
    )
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={sending}>
      <NewsletterRows
        newsletters={newsletters}
        ticks={ticks}
        disabled={state === 'done'}
        onToggle={(key, on) => {
          setTicks(t => ({ ...t, [key]: on }))
          setError('')
        }}
      />
      {state !== 'done' && (
        <div className="flex items-center gap-16px padding-top-32px">
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="text-field"
            placeholder="Your email"
            aria-label="Your email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? statusId : undefined}
          />
          <button type="submit" className="button-primary" disabled={sending}>
            {sending ? 'Subscribing' : 'Subscribe'}
          </button>
        </div>
      )}
      {/* Always rendered, so screen readers announce what lands in it. */}
      <div
        id={statusId}
        role="status"
        aria-live="polite"
        className={
          state === 'done'
            ? 'color-light-teal padding-top-32px'
            : error
              ? 'paragraph-xs color-orange padding-top-8px'
              : ''
        }
      >
        {state === 'done' ? done : error}
      </div>
      {/* Honeypot, as in the signup boxes: off-screen, hidden from screen
          readers, out of the tab order, with a name no browser fills in. */}
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
      <p className="paragraph-small color-teal-300 padding-top-40px">
        Already getting one? To change which newsletters you get, or to stop
        them all, use the Manage subscriptions link at the bottom of any of
        their emails.
      </p>
    </form>
  )
}

/** A reader's own newsletters, from the link in an issue. */
function ManageForm({
  newsletters,
  settingsKey,
  email,
  initial,
}: {
  newsletters: Newsletter[]
  settingsKey: string
  email: string
  initial: Subscriptions
}) {
  const [saved, setSaved] = useState(initial)
  const [ticks, setTicks] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null
  )
  const getsAny = SIGNUP_NEWSLETTERS.some(n => saved[n])

  async function save(next: Subscriptions) {
    if (busy) return
    const changes = SIGNUP_NEWSLETTERS.filter(n => next[n] !== saved[n])
    if (changes.length === 0) {
      setStatus({ ok: true, text: 'Nothing to change.' })
      return
    }
    setBusy(true)
    setStatus(null)
    const answer = await callSettings({ k: settingsKey, set: next })
    setBusy(false)
    // Whatever happened, show what is true now.
    if (answer.subscribed) {
      setSaved(answer.subscribed)
      setTicks(answer.subscribed)
    }
    const label = changes.map(n => `${next[n] ? '+' : '-'}${n}`).join(' ')
    trackEvent('newsletter_settings_save', {
      page: TRACKING_PAGE,
      label,
      source: answer.ok ? 'saved' : (answer.reason ?? 'error'),
    })
    if (!answer.ok) {
      setStatus({ ok: false, text: answer.error ?? SOMETHING_WRONG })
      return
    }
    const now = answer.subscribed ?? next
    const names = newsletters.filter(n => now[n.key]).map(n => n.name)
    setStatus({
      ok: true,
      text:
        (names.length
          ? `Saved. You'll get ${listOf(names)}.`
          : "Saved. You won't get any of these newsletters anymore.") +
        (answer.dryRun
          ? ' (This copy of the site only pretends, so nothing was changed.)'
          : ''),
    })
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        void save(ticks)
      }}
      aria-busy={busy}
    >
      <h3 className="padding-bottom-8px">Your newsletters</h3>
      <p className="color-teal-300 padding-bottom-16px">
        For {email}. Tick the ones you want to get, then save.
      </p>
      <NewsletterRows
        newsletters={newsletters}
        ticks={ticks}
        disabled={busy}
        onToggle={(key, on) => {
          setTicks(t => ({ ...t, [key]: on }))
          setStatus(null)
        }}
      />
      <div className="flex flex-wrap items-center gap-16px padding-top-32px">
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? 'Saving' : 'Save changes'}
        </button>
        {getsAny && (
          <button
            type="button"
            className="button-secondary cursor-pointer"
            disabled={busy}
            onClick={() => void save(NONE)}
          >
            Unsubscribe from all
          </button>
        )}
      </div>
      <div
        role="status"
        aria-live="polite"
        className={
          status
            ? status.ok
              ? 'color-light-teal padding-top-24px'
              : 'paragraph-small color-orange padding-top-24px'
            : ''
        }
      >
        {status?.text}
      </div>
    </form>
  )
}

/** The Updates newsletter, still on Substack: a link, not a box to tick. */
function UpdatesNote({ updates }: { updates: Updates }) {
  return (
    <p className="paragraph-small color-teal-300 padding-top-24px">
      <span className="color-white">{updates.name}</span> {updates.about}{' '}
      <a
        href={updates.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`color-light-teal ${styles.link}`}
        onClick={() =>
          trackEvent('newsletter_page_click', {
            page: TRACKING_PAGE,
            label: 'updates',
            source: 'substack',
          })
        }
      >
        Subscribe on Substack&nbsp;&rarr;
      </a>
    </p>
  )
}
