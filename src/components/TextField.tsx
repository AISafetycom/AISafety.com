'use client'

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useId, useLayoutEffect, useRef } from 'react'
import styles from './TextField.module.css'

/* A form field: its label, the box, and an error message under it. Built
   from the Figma text input set (file xQcFkuYX4dACj17xRVfDYD, "page-wide
   forms"): default, focus (the box's border lightens), error (a red border
   and message) and disabled. The box itself is the global .text-field.

     <TextField label="Email" type="email" required />
     <TextField as="textarea" label="What's wrong?" />
     <TextField as="select" label="Which page?" options={['Events', …]} />

   A text area grows with what's typed instead of scrolling. */

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
  } else {
    box = (
      <input
        type="text"
        {...(attributes as InputHTMLAttributes<HTMLInputElement>)}
        className={`text-field ${styles.input}`}
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
