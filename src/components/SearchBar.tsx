'use client'

import type { ComponentPropsWithoutRef, KeyboardEvent, RefObject } from 'react'
import { useRef } from 'react'
import Icon from '@/components/Icon'
import styles from './SearchBar.module.css'

type NativeInputProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'value' | 'onChange'
>

// Touch devices show an on-screen keyboard; we use this to adjust focus
// behavior so we don't summon or trap that keyboard. Desktop is left as-is.
const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches

interface SearchBarProps extends NativeInputProps {
  value: string
  onChange: (value: string) => void
  inputRef?: RefObject<HTMLInputElement | null>
  wrapperClassName?: string
  className?: string
  clearButtonClassName?: string
  showClearButton?: boolean
}

export default function SearchBar({
  value,
  onChange,
  placeholder,
  maxLength = 256,
  inputRef,
  wrapperClassName,
  className,
  clearButtonClassName,
  showClearButton = true,
  ...inputProps
}: SearchBarProps) {
  const fallbackInputRef = useRef<HTMLInputElement>(null)
  const resolvedInputRef = inputRef ?? fallbackInputRef
  const showClear = showClearButton && value.length > 0

  const clearSearch = () => {
    onChange('')
    // On desktop, keep the cursor in the box so the user can keep typing. On
    // touch devices we skip refocusing: the clear button stays visible after
    // the field has blurred, so refocusing would pop the on-screen keyboard
    // back up when the user is just clearing to browse. (A field still focused
    // mid-typing stays focused either way, via the button's onMouseDown
    // preventDefault.)
    if (!isTouchDevice()) {
      resolvedInputRef.current?.focus()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // The search filters live, so there's nothing to submit. On touch devices,
    // pressing the keyboard's return/search key blurs the input to dismiss the
    // on-screen keyboard. Desktop keeps the cursor in place.
    if (event.key === 'Enter' && isTouchDevice()) {
      resolvedInputRef.current?.blur()
    } else if (event.key === 'Escape') {
      // Clear the search but keep the cursor in the box.
      event.preventDefault()
      onChange('')
    }
  }

  return (
    <div
      className={`${styles.wrapper}${wrapperClassName ? ` ${wrapperClassName}` : ''}`}
    >
      <input
        ref={resolvedInputRef}
        type="text"
        {...inputProps}
        className={`text-field ${styles.input}${className ? ` ${className}` : ''}`}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {showClear ? (
        <button
          type="button"
          className={`${styles.clearButton} flex items-center justify-center cursor-pointer color-teal-grey-400${clearButtonClassName ? ` ${clearButtonClassName}` : ''}`}
          aria-label="Clear search"
          onMouseDown={event => event.preventDefault()}
          onClick={clearSearch}
        >
          <Icon src="/images/icons/x.svg" size={16} />
        </button>
      ) : null}
    </div>
  )
}
