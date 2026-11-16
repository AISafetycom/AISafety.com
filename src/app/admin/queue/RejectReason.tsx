'use client'

import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import type { AgentInfo } from '@/lib/admin/queue'
import { insertDictated, isDictationKey } from '@/lib/admin/queue-dictation'
import { base64Of } from './Chat'
import styles from './queue.module.css'
import { useDictation } from './useDictation'

// The reject panel's "Other reason…" box, with dictation (Bryce, 16 Nov
// 2026: "Let's add dictation to this"). It works as the Fable chat's does:
// the mic in the box, or Cmd+D while the panel is open, starts it; Cmd+D
// again puts the words in the box, Enter puts them in and rejects, Esc
// throws the recording away. The Mac turns the recording into words
// (~/Queue/dictate.py), so nothing goes to another service.

export interface RejectReasonControl {
  /** Confirm reject: with the words first when it is listening. */
  reject: () => void
}

/** Where the cursor is: Cmd+D in another text box (the Fable chat's) stays
 *  that box's. */
function inOtherField(el: Element | null, own: Element | null): boolean {
  if (!el || el === own) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement)
    return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(el.type)
  return el instanceof HTMLElement && el.isContentEditable
}

export default function RejectReason({
  value,
  onChange,
  chips,
  busy,
  agent,
  itemId,
  onPick,
  onReject,
  onCancel,
  control,
}: {
  value: string
  onChange: (text: string) => void
  /** The reasons on offer: 1–9 picks one while the box is empty. */
  chips: string[]
  busy: boolean
  /** The Mac agent when it can turn speech into text; null: no mic. */
  agent: AgentInfo | null
  itemId: string
  onPick: (chip: string) => void
  /** Reject; `typed` is the box's text when the words just went in, before
   *  the page has them. */
  onReject: (typed?: string) => void
  onCancel: () => void
  control?: React.Ref<RejectReasonControl>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const micRef = useRef<HTMLButtonElement>(null)
  const valueRef = useRef(value)
  const agentRef = useRef(agent)
  const cb = useRef({ onChange, onReject })
  useEffect(() => {
    valueRef.current = value
    agentRef.current = agent
    cb.current = { onChange, onReject }
  })
  // Closed while the Mac was still writing the words: they go nowhere.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [heard, setHeard] = useState<{
    text: string
    retry?: () => void
  } | null>(null)

  const dictation = useDictation({
    meterRef: micRef,
    leave: 'cancel',
    transcribe: async audio => {
      const a = agentRef.current
      if (!a) throw new Error('the Mac agent is not connected.')
      const res = await fetch(`http://127.0.0.1:${a.port}/chat/dictate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: await base64Of(audio),
          type: audio.type,
          id: itemId,
          token: a.token,
        }),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => ({}))) as {
        text?: string
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      return data.text ?? ''
    },
    onWords: (words, reject) => {
      if (!mounted.current) return
      setHeard(null)
      const el = inputRef.current
      const now = valueRef.current
      const [from, to] =
        el && document.activeElement === el
          ? [el.selectionStart ?? now.length, el.selectionEnd ?? now.length]
          : [now.length, now.length]
      const next = insertDictated(now, from, to, words)
      if (reject) {
        cb.current.onReject(next.text)
        return
      }
      cb.current.onChange(next.text)
      requestAnimationFrame(() => {
        const box = inputRef.current
        if (!box) return
        box.focus()
        box.setSelectionRange(next.caret, next.caret)
      })
    },
    onProblem: (message, retry) => {
      if (mounted.current) setHeard({ text: message, retry })
    },
  })
  const listening =
    dictation.state === 'listening' || dictation.state === 'starting'

  /** Enter or Confirm reject: while it listens, the words go in first. */
  const reject = () => {
    if (busy) return
    if (dictation.state === 'starting') {
      // Still asking for the microphone: reject with what is typed.
      dictation.finish('cancel')
      onReject()
    } else if (dictation.state === 'off' || !dictation.finish('send')) {
      onReject()
    }
  }
  useImperativeHandle(control, () => ({ reject }))

  const toggle = () => {
    setHeard(null)
    if (dictation.state === 'off') inputRef.current?.focus()
    dictation.toggle()
  }
  const keyRef = useRef({ toggle, state: dictation.state })
  useEffect(() => {
    keyRef.current = { toggle, state: dictation.state }
  })
  // Cmd+D while the panel is open is this box's, ahead of the chat's (this
  // listens first, on the way down), unless the cursor is in another text
  // box. Once it listens, Cmd+D stops it wherever the cursor is.
  const canDictate = agent !== null
  useEffect(() => {
    if (!canDictate) return
    const mac = /Mac|iPhone|iPad/.test(navigator.platform)
    const onKey = (e: KeyboardEvent) => {
      if (!isDictationKey(e, mac)) return
      const { toggle, state } = keyRef.current
      if (
        state === 'off' &&
        inOtherField(document.activeElement, inputRef.current)
      )
        return
      // Not the browser's bookmark, and not the chat's dictation.
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) toggle()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [canDictate])

  return (
    <>
      <span
        className={`${styles.otherBox}${canDictate ? ` ${styles.otherBoxMic}` : ''}`}
      >
        {/* Focused as the panel opens, so a reason can be typed straight
            away (Bryce, 24 Sept 2026). While it is still empty the number
            keys keep picking a chip, and Esc cancels the reject as it does
            outside the box. */}
        <input
          ref={inputRef}
          autoFocus
          className={`${styles.input} ${styles.other}`}
          placeholder={
            dictation.state === 'transcribing'
              ? 'Turning your words into text…'
              : listening
                ? 'Listening…'
                : 'Other reason…'
          }
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && dictation.state !== 'off') {
              e.preventDefault()
              reject()
              return
            }
            if (e.key === 'Escape' && listening) {
              // Esc while it listens throws the recording away; the panel
              // stays open.
              e.preventDefault()
              e.stopPropagation()
              dictation.finish('cancel')
              return
            }
            if (e.metaKey || e.ctrlKey || e.altKey) return
            const chip = value ? undefined : chips[Number(e.key) - 1]
            if (/^[1-9]$/.test(e.key) && chip && !busy) {
              e.preventDefault()
              onPick(chip)
            } else if (e.key === 'Enter' && !busy) {
              e.preventDefault()
              reject()
            } else if (e.key === 'Escape' && !busy) {
              e.stopPropagation()
              onCancel()
            }
          }}
        />
        {canDictate && (
          <button
            ref={micRef}
            type="button"
            className={`${styles.chatMic}${listening ? ` ${styles.chatMicOn}` : ''}`}
            aria-label={listening ? 'Stop dictating' : 'Dictate a reason'}
            aria-pressed={listening}
            title={
              dictation.state === 'transcribing'
                ? 'Turning your words into text…'
                : listening
                  ? 'Stop dictating (⌘D)'
                  : 'Dictate a reason (⌘D)'
            }
            disabled={busy || dictation.state === 'transcribing'}
            // The box keeps the cursor, so the words go where it is.
            onMouseDown={e => e.preventDefault()}
            onClick={toggle}
          >
            {dictation.state === 'transcribing' ? (
              <span className={styles.chatMicBusy} />
            ) : listening ? (
              <span className={styles.chatMicDot} />
            ) : (
              <Icon src="/images/icons/microphone.svg" size={16} />
            )}
          </button>
        )}
      </span>
      {dictation.state === 'listening' && (
        <p className={`${styles.chatDictating} ${styles.otherNote}`}>
          <kbd>⌘D</kbd> puts the words in · <kbd>Enter</kbd> rejects ·{' '}
          <kbd>Esc</kbd> cancels
        </p>
      )}
      {heard && (
        <p className={`${styles.chatError} ${styles.otherNote}`}>
          {heard.text}
          {heard.retry && (
            <>
              {' '}
              <button
                type="button"
                className={styles.chatLink}
                onClick={() => {
                  const again = heard.retry
                  setHeard(null)
                  again?.()
                }}
              >
                Try again
              </button>
            </>
          )}
        </p>
      )}
    </>
  )
}
