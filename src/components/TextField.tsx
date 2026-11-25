'use client'

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import ListingLogo from '@/components/ListingLogo'
import { matchSuggestions, type Suggestion } from '@/lib/suggestions'
import styles from './TextField.module.css'

/* A form field: its label, the box, and an error message under it. Built
   from the Figma text input set (file xQcFkuYX4dACj17xRVfDYD, "page-wide
   forms"): default, focus (the box's border lightens), error (a red border
   and message) and disabled. The box itself is the global .text-field.

     <TextField label="Email" type="email" required />
     <TextField as="textarea" label="What's wrong?" />
     <TextField as="select" label="Which page?" options={['Events', …]} />
     <TextField label="Which listing?" suggestions={[{ value: 'ARENA' }, …]}
       onSuggestion={pick} />

   A text area grows with what's typed instead of scrolling. A text box with
   suggestions lists the ones that match what's typed under it, as the
   /events "Find events near you" box does; the arrow keys and Enter or a
   click pick one. */

interface Common {
  /** Shown above the box, and read out for it. */
  label: ReactNode
  /** Adds "(optional)" after the label, or this text in its place. */
  optional?: boolean | string
  /** Shown under the box in red; the box is marked invalid. */
  error?: string
  /** Classes on the field's wrapper, e.g. its place in a grid. */
  className?: string
}

type InputField = Common & {
  as?: 'input'
  /** Shown under the box as it's typed in, the ones that match. */
  suggestions?: readonly Suggestion[]
  /** Called with a suggestion's value when one is picked. */
  onSuggestion?: (value: string) => void
  /** Shown in the list when something is typed and nothing matches. */
  noSuggestions?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>

type TextAreaField = Common & {
  as: 'textarea'
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>

type SelectField = Common & {
  as: 'select'
  options: readonly string[]
  /** The first, empty choice. Default "Select…". */
  placeholder?: string
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>

export type TextFieldProps = InputField | TextAreaField | SelectField

/** Grow a text area to fit its text (the +2 is its top and bottom border). */
function grow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + 2}px`
}

// The field's own props; everything else goes on the box. A dropdown's
// placeholder is its first, empty choice; a text box's is the box's own.
const OWN_PROPS = [
  'as',
  'label',
  'optional',
  'error',
  'className',
  'options',
  'suggestions',
  'onSuggestion',
  'noSuggestions',
] as const

function boxAttributes(props: TextFieldProps): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...props }
  for (const key of OWN_PROPS) delete rest[key]
  if (props.as === 'select') delete rest.placeholder
  return rest
}

export default function TextField(props: TextFieldProps) {
  const ownId = useId()
  const areaRef = useRef<HTMLTextAreaElement>(null)
  // A text area fits its text as it first shows and whenever its value
  // changes from outside (a saved draft coming back), not only as it's typed.
  useLayoutEffect(() => {
    if (areaRef.current) grow(areaRef.current)
  }, [props.value])
  const { label, optional, error, className } = props
  const id = props.id ?? ownId
  const errorId = `${id}-error`
  const attributes = {
    ...boxAttributes(props),
    id,
    ...(error && { 'aria-invalid': true, 'aria-describedby': errorId }),
  }

  let box: ReactNode
  if (props.as === 'textarea') {
    const { onInput } = props
    box = (
      <textarea
        {...(attributes as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        ref={areaRef}
        className={`text-field ${styles.textarea}`}
        onInput={e => {
          grow(e.currentTarget)
          onInput?.(e)
        }}
      />
    )
  } else if (props.as === 'select') {
    const { options, placeholder = 'Select…' } = props
    box = (
      <select
        {...(attributes as SelectHTMLAttributes<HTMLSelectElement>)}
        className="text-field cursor-pointer"
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  } else if (props.suggestions) {
    box = (
      <SuggestingInput
        attributes={attributes as InputHTMLAttributes<HTMLInputElement>}
        suggestions={props.suggestions}
        onSuggestion={props.onSuggestion}
        noSuggestions={props.noSuggestions}
      />
    )
  } else {
    box = (
      <input
        type="text"
        {...(attributes as InputHTMLAttributes<HTMLInputElement>)}
        className="text-field"
      />
    )
  }

  return (
    <div className={`flex flex-col gap-8px${className ? ` ${className}` : ''}`}>
      <label className="paragraph-small color-teal-grey-300" htmlFor={id}>
        {label}
        {optional && (
          <>
            {' '}
            <em>{typeof optional === 'string' ? optional : '(optional)'}</em>
          </>
        )}
      </label>
      {box}
      {error && (
        <p id={errorId} className="paragraph-xs color-red-300">
          {error}
        </p>
      )}
    </div>
  )
}

/** A text box with its suggestions in a list under it (a combobox). The
 *  list shows while the box has focus and some suggestions match; the arrow
 *  keys move through it, and Enter or a click picks one. */
function SuggestingInput({
  attributes,
  suggestions,
  onSuggestion,
  noSuggestions,
}: {
  attributes: InputHTMLAttributes<HTMLInputElement>
  suggestions: readonly Suggestion[]
  onSuggestion?: (value: string) => void
  noSuggestions?: string
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const typed = String(attributes.value ?? '')
  const matches = open ? matchSuggestions(suggestions, typed) : []
  // Once the box holds exactly the one suggestion left, the list has
  // nothing more to offer.
  const shown =
    matches.length === 1 &&
    matches[0].value.toLowerCase() === typed.trim().toLowerCase()
      ? []
      : matches
  const none = open && !!noSuggestions && !!typed.trim() && matches.length === 0

  function pick(s: Suggestion) {
    onSuggestion?.(s.value)
    setOpen(false)
    setActive(-1)
  }

  return (
    <div className={styles.combo}>
      <input
        type="text"
        {...attributes}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-activedescendant={
          shown[active] ? `${listId}-${active}` : undefined
        }
        autoComplete="off"
        className="text-field"
        onChange={e => {
          attributes.onChange?.(e)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={e => {
          attributes.onFocus?.(e)
          setOpen(true)
        }}
        onBlur={e => {
          attributes.onBlur?.(e)
          setOpen(false)
        }}
        onKeyDown={e => {
          attributes.onKeyDown?.(e)
          if (shown.length === 0) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const step = e.key === 'ArrowDown' ? 1 : -1
            setActive(a => (a + step + shown.length) % shown.length)
          } else if (e.key === 'Enter' && shown[active]) {
            // Picks the suggestion instead of sending the form.
            e.preventDefault()
            pick(shown[active])
          }
        }}
      />
      {shown.length > 0 && (
        <div
          id={listId}
          role="listbox"
          className={`border-plus-fill drop-shadow-dark ${styles.suggestions}`}
        >
          {shown.map((s, i) => (
            <div
              key={`${s.value}\n${s.detail ?? ''}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`flex items-center gap-12px cursor-pointer ${styles.suggestion}${
                i === active ? ` ${styles.suggestionActive}` : ''
              }`}
              // Keeps the focus in the box, so it doesn't close the list
              // before the click lands.
              onPointerDown={e => e.preventDefault()}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
            >
              {s.logo !== undefined && (
                <ListingLogo title={s.value} logo={s.logo} />
              )}
              <span className="flex flex-col">
                <span className="paragraph-small">{s.value}</span>
                {s.detail && (
                  <span className="paragraph-xs color-teal-grey-300">
                    {s.detail}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {none && (
        <div
          className={`border-plus-fill drop-shadow-dark ${styles.suggestions}`}
        >
          <p
            className={`paragraph-small color-teal-grey-300 ${styles.noSuggestions}`}
          >
            {noSuggestions}
          </p>
        </div>
      )}
    </div>
  )
}
