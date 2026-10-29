'use client'

import { Fragment, useEffect, useState } from 'react'
import base from '../page.module.css'
import { FIELDS, OTHER_MAX, SECTIONS, maxLen, type Field } from './questions'

/** Answers by field key. Checkbox groups hold the ticked options; their
 *  free-text "Other" box is stored under `${key}Other`. */
type Values = {
  text: Record<string, string>
  multi: Record<string, string[]>
  agree: Record<string, boolean>
}

const EMPTY: Values = { text: { website: '' }, multi: {}, agree: {} }

/** Render a label/hint string, turning [text](url) into links. */
function Text({ children }: { children: string }) {
  const parts = children.split(/(\[[^\]]+\]\([^)]+\))/g)
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        return m ? (
          <a
            key={i}
            href={m[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="color-light-teal"
          >
            {m[1]}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      })}
    </>
  )
}

/** Textareas grow with their content instead of scrolling internally. */
function grow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + 2}px`
}

export default function DetailsForm() {
  const [values, setValues] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  // false = not sent yet; 'emailed' / 'stored' = sent, with / without an
  // email address to confirm to.
  const [done, setDone] = useState<false | 'emailed' | 'stored'>(false)
  const [error, setError] = useState('')

  const setText = (key: string, value: string) =>
    setValues(v => ({ ...v, text: { ...v.text, [key]: value } }))
  const toggle = (key: string, option: string) =>
    setValues(v => {
      const current = v.multi[key] ?? []
      const next = current.includes(option)
        ? current.filter(o => o !== option)
        : [...current, option]
      return { ...v, multi: { ...v.multi, [key]: next } }
    })
  const setAgree = (key: string, checked: boolean) =>
    setValues(v => ({ ...v, agree: { ...v.agree, [key]: checked } }))

  // A required checkbox group is a rule the browser can't express with
  // `required` alone, so it's fed in as custom validity and a failed submit
  // scrolls to and flags the group like any other field. No group is required
  // at the moment.
  useEffect(() => {
    for (const f of FIELDS) {
      if (f.type !== 'checkboxes' || !f.required) continue
      const first = document.querySelector<HTMLInputElement>(
        `#${f.key} input[type="checkbox"]`
      )
      // An open-but-empty "Other" box counts here; its own `required` then
      // flags the box itself instead of the first checkbox.
      const ok =
        (values.multi[f.key]?.length ?? 0) > 0 ||
        !!values.agree[`${f.key}OtherOpen`]
      first?.setCustomValidity(ok ? '' : 'Please choose at least one option.')
    }
  }, [values])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/hackathon-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values.text,
          ...values.multi,
          ...values.agree,
        }),
      })
      if (res.ok) {
        setDone(values.text.email?.trim() ? 'emailed' : 'stored')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else if (res.status === 429) {
        setError(
          'Too many submissions from your connection – please try again in an hour.'
        )
      } else {
        setError(
          'Something went wrong sending your details. Please try again, or email bryceerobertson@gmail.com.'
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
      <div
        className={`${base.thanks} border-plus-fill margin-bottom-56px padding-top-32px padding-bottom-32px padding-left-32px padding-right-32px`}
      >
        <h3 className="padding-bottom-16px">Thanks!</h3>
        <p className="color-teal-grey-300">
          {done === 'emailed'
            ? 'We’ve emailed you a copy of your answers. If anything changes, just reply to that email.'
            : 'If anything changes, just let Bryce know.'}
        </p>
      </div>
    )
  }

  function renderField(f: Field) {
    const width = 'half' in f && f.half ? '' : base.full
    const label = (
      <>
        <Text>{f.label}</Text>
        {f.hint && (
          <>
            <br />
            <span className="paragraph-xs color-teal-grey-400">
              <Text>{f.hint}</Text>
            </span>
          </>
        )}
      </>
    )

    switch (f.type) {
      case 'text':
      case 'email':
      case 'tel':
        return (
          <div key={f.key} className={`${base.field} ${width}`}>
            <label
              className="paragraph-small color-teal-grey-300"
              htmlFor={f.key}
            >
              {label}
            </label>
            <input
              id={f.key}
              type={f.type}
              className="text-field"
              value={values.text[f.key] ?? ''}
              onChange={e => setText(f.key, e.target.value)}
              required={f.required}
              maxLength={maxLen(f)}
            />
          </div>
        )

      case 'textarea':
        return (
          <div key={f.key} className={`${base.field} ${width}`}>
            <label
              className="paragraph-small color-teal-grey-300"
              htmlFor={f.key}
            >
              {label}
            </label>
            <textarea
              id={f.key}
              className={`text-field ${base.textarea}`}
              value={values.text[f.key] ?? ''}
              onChange={e => {
                grow(e.target)
                setText(f.key, e.target.value)
              }}
              required={f.required}
              maxLength={maxLen(f)}
            />
          </div>
        )

      case 'select':
        return (
          <div key={f.key} className={`${base.field} ${width}`}>
            <label
              className="paragraph-small color-teal-grey-300"
              htmlFor={f.key}
            >
              {label}
            </label>
            <select
              id={f.key}
              className="text-field cursor-pointer"
              value={values.text[f.key] ?? ''}
              onChange={e => setText(f.key, e.target.value)}
              required={f.required}
            >
              <option value="">Select…</option>
              {f.options.map(o => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        )

      case 'checkboxes': {
        const ticked = values.multi[f.key] ?? []
        // The free-text box is sent as `${key}Other`; whether it's open is
        // UI-only state kept under a separate key.
        const otherKey = `${f.key}Other`
        const openKey = `${f.key}OtherOpen`
        const otherOpen = values.agree[openKey] ?? false
        return (
          <div
            key={f.key}
            id={f.key}
            role="group"
            aria-labelledby={`${f.key}-label`}
            className={`${base.field} ${base.full}`}
          >
            <p
              id={`${f.key}-label`}
              className="paragraph-small color-teal-grey-300"
            >
              {label}
            </p>
            <div className="flex flex-col gap-8px">
              {f.options.map(o => (
                <label key={o} className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={ticked.includes(o)}
                    onChange={() => toggle(f.key, o)}
                  />
                  <span className="paragraph-small color-white">{o}</span>
                </label>
              ))}
              {f.other && (
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={otherOpen}
                    onChange={e => {
                      setAgree(openKey, e.target.checked)
                      if (!e.target.checked) setText(otherKey, '')
                    }}
                  />
                  <span className="paragraph-small color-white">{f.other}</span>
                </label>
              )}
              {f.other && otherOpen && (
                <input
                  type="text"
                  className="text-field"
                  aria-label={f.other}
                  value={values.text[otherKey] ?? ''}
                  onChange={e => setText(otherKey, e.target.value)}
                  maxLength={OTHER_MAX}
                  required={f.required && ticked.length === 0}
                  autoFocus
                />
              )}
            </div>
          </div>
        )
      }

      case 'agree':
        return (
          <label
            key={f.key}
            className={`flex items-center cursor-pointer ${base.full}`}
          >
            <input
              type="checkbox"
              className="checkbox"
              checked={values.agree[f.key] ?? false}
              onChange={e => setAgree(f.key, e.target.checked)}
              required={f.required}
            />
            <span className="paragraph-small color-white">{label}</span>
          </label>
        )
    }
  }

  return (
    <form
      className={`${base.fields} padding-bottom-56px`}
      onSubmit={handleSubmit}
    >
      {SECTIONS.map((s, i) => (
        <Fragment key={s.title ?? i}>
          {(s.title || s.intro) && (
            <div className={`${base.full} ${i > 0 ? 'padding-top-24px' : ''}`}>
              {s.title && (
                <h3 className={s.intro ? 'padding-bottom-8px' : ''}>
                  {s.title}
                </h3>
              )}
              {s.intro && (
                <p className="paragraph-small color-teal-grey-300">{s.intro}</p>
              )}
            </div>
          )}
          {s.fields.map(renderField)}
        </Fragment>
      ))}

      <div className={base.hp} aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.text.website}
          onChange={e => setText('website', e.target.value)}
        />
      </div>

      <div className={`${base.full} margin-top-16px`}>
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit'}
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
