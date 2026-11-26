'use client'

import { useState } from 'react'
import styles from './page.module.css'
import Button from '@/components/Button'
import TextField from '@/components/TextField'

const EMPTY = {
  name: '',
  email: '',
  skills: '',
  links: '',
  anythingElse: '',
  // Honeypot – hidden from people, filled in by naive bots.
  website: '',
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
      setForm({ ...form, [field]: e.target.value })
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

      <TextField
        className={styles.full}
        label="Name"
        id="name"
        value={form.name}
        onChange={set('name')}
        required
      />

      <TextField
        className={styles.full}
        label="Email"
        id="email"
        type="email"
        value={form.email}
        onChange={set('email')}
        required
      />

      <TextField
        as="textarea"
        className={styles.full}
        label="What skills or experience could you bring to this hackathon?"
        id="skills"
        value={form.skills}
        onChange={set('skills')}
        required
      />

      <TextField
        as="textarea"
        className={styles.full}
        label="Please share any personal links e.g. LinkedIn, LessWrong, CV, etc."
        optional
        id="links"
        value={form.links}
        onChange={set('links')}
      />

      <TextField
        as="textarea"
        className={styles.full}
        label="Anything else you'd like us to know?"
        optional
        id="anythingElse"
        value={form.anythingElse}
        onChange={set('anythingElse')}
      />

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
        <Button type="submit" disabled={busy}>
          {busy ? 'Applying…' : 'Apply'}
        </Button>
        {error && (
          <p className="paragraph-small color-red-300 margin-top-16px">
            {error}
          </p>
        )}
      </div>
    </form>
  )
}
