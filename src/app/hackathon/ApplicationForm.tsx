'use client'

import { useState } from 'react'
import styles from './page.module.css'

const EMPTY = {
  name: '',
  email: '',
  skills: '',
  links: '',
  anythingElse: '',
  // Honeypot – hidden from people, filled in by naive bots.
  website: '',
}

function Optional() {
  return <em className="color-teal-grey-400">(optional)</em>
}

export default function ApplicationForm() {
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  function set(field: keyof typeof EMPTY) {
    return (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) => {
      const el = e.target
      // Textareas grow with their content instead of scrolling internally.
      if (el instanceof HTMLTextAreaElement) {
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight + 2}px`
      }
      setForm({ ...form, [field]: el.value })
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/hackathon-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setDone(true)
      } else if (res.status === 429) {
        setError(
          'Too many applications from your connection – please try again in an hour.'
        )
      } else {
        setError(
          'Something went wrong sending your application. Please try again, or email bryceerobertson@gmail.com.'
        )
      }
    } catch {
      setError('Network error – please check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="padding-bottom-56px">
        <h3 className="padding-bottom-16px">Thanks!</h3>
        <p className="color-teal-grey-300">
          We&apos;ve emailed you a confirmation. Since applications have
          officially closed, we can&apos;t promise a decision, but we&apos;ll be
          in touch if we&apos;re able to offer you a place.
        </p>
      </div>
    )
  }

  return (
    <form
      className={`${styles.fields} padding-bottom-56px`}
      onSubmit={handleSubmit}
    >
      {/* Applications closed 14 August 2026; the form stays up for late
          applications from very strong candidates. */}
      <h3 className={`${styles.full} padding-bottom-8px`}>
        Applications have closed
      </h3>

      <div className={`${styles.field} ${styles.full}`}>
        <label className="paragraph-small color-teal-grey-300" htmlFor="name">
          Name
        </label>
        <input
          id="name"
          type="text"
          className="text-field"
          value={form.name}
          onChange={set('name')}
          required
        />
      </div>

      <div className={`${styles.field} ${styles.full}`}>
        <label className="paragraph-small color-teal-grey-300" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          className="text-field"
          value={form.email}
          onChange={set('email')}
          required
        />
      </div>

      <div className={`${styles.field} ${styles.full}`}>
        <label className="paragraph-small color-teal-grey-300" htmlFor="skills">
          What skills or experience could you bring to this hackathon?
        </label>
        <textarea
          id="skills"
          className={`text-field ${styles.textarea}`}
          value={form.skills}
          onChange={set('skills')}
          required
        />
      </div>

      <div className={`${styles.field} ${styles.full}`}>
        <label className="paragraph-small color-teal-grey-300" htmlFor="links">
          Please share any personal links e.g. LinkedIn, LessWrong, CV, etc.{' '}
          <Optional />
        </label>
        <textarea
          id="links"
          className={`text-field ${styles.textarea}`}
          value={form.links}
          onChange={set('links')}
        />
      </div>

      <div className={`${styles.field} ${styles.full}`}>
        <label
          className="paragraph-small color-teal-grey-300"
          htmlFor="anythingElse"
        >
          Anything else you&apos;d like us to know? <Optional />
        </label>
        <textarea
          id="anythingElse"
          className={`text-field ${styles.textarea}`}
          value={form.anythingElse}
          onChange={set('anythingElse')}
        />
      </div>

      <div className={styles.hp} aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={form.website}
          onChange={set('website')}
        />
      </div>

      <div className={styles.full}>
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? 'Applying…' : 'Apply'}
        </button>
        {error && (
          <p className="paragraph-small color-orange margin-top-16px">
            {error}
          </p>
        )}
      </div>
    </form>
  )
}
