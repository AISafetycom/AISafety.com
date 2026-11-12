'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Button from '@/components/Button'
import styles from './Assistant.module.css'

const MAX_TEXTAREA_HEIGHT_PX = 120

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  disabled?: boolean
  placeholder?: string
  isStreaming?: boolean
  onStop?: () => void
}

const Composer = forwardRef<HTMLTextAreaElement, Props>(function Composer(
  { value, onChange, onSubmit, disabled, placeholder, isStreaming, onStop },
  forwardedRef
) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(
    forwardedRef,
    () => ref.current as HTMLTextAreaElement,
    []
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`
  }, [value])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!disabled && !isStreaming && value.trim().length > 0) onSubmit()
    }
  }

  return (
    <div className={styles.composer}>
      <div className={styles.composerField}>
        <textarea
          ref={ref}
          className={styles.composerInput}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder ?? 'Ask in any language…'}
          rows={1}
          maxLength={4000}
          aria-label="Message"
        />
        {isStreaming ? (
          <Button
            variant="teal-alt"
            size="small"
            icon="/images/icons/stop-large.svg"
            iconPosition="only"
            className={styles.composerButton}
            onClick={onStop}
            aria-label="Stop"
            tooltipPosition="above"
          />
        ) : (
          <Button
            size="small"
            icon="/images/icons/arrow-up-large.svg"
            iconPosition="only"
            className={styles.composerButton}
            disabled={disabled || value.trim().length === 0}
            onClick={onSubmit}
            aria-label="Send"
            tooltipPosition="above"
          />
        )}
      </div>
    </div>
  )
})

export default Composer
