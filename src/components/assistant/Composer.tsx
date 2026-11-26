'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Button from '@/components/Button'
import {
  ACCEPTED_FILE_TYPES,
  type Attachment,
} from '@/lib/assistant/attachments'
import AttachmentChip from './AttachmentChip'
import { useDictation } from './useDictation'
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
  /** Documents that will go with the next message. */
  attachments?: Attachment[]
  /** The name of a file being read right now, if one is. */
  readingFile?: string | null
  /** Why the last file couldn't be attached; shown under the message box. */
  attachError?: string | null
  /** The visitor picked files to attach. */
  onAttachFiles?: (files: File[]) => void
  onRemoveAttachment?: (index: number) => void
  /** False while the chat is out of sight (its panel is closed), which stops
   *  any dictation: the microphone is never left on behind a closed panel. */
  visible?: boolean
  /** Dictation started, or stopped with an error. For analytics. */
  onDictationEvent?: (outcome: 'start' | 'error', reason?: string) => void
}

const Composer = forwardRef<HTMLTextAreaElement, Props>(function Composer(
  {
    value,
    onChange,
    onSubmit,
    disabled,
    placeholder,
    isStreaming,
    onStop,
    attachments = [],
    readingFile = null,
    attachError = null,
    onAttachFiles,
    onRemoveAttachment,
    visible = true,
    onDictationEvent,
  },
  forwardedRef
) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dictation = useDictation({
    onText: onChange,
    onEvent: onDictationEvent,
  })
  const { cancel: cancelDictation } = dictation

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

  useEffect(() => {
    if (!visible) cancelDictation()
  }, [visible, cancelDictation])

  // A message can be words, documents, or both, but not while a file is
  // still being read.
  const canSend =
    !disabled &&
    !readingFile &&
    (value.trim().length > 0 || attachments.length > 0)

  // Sending ends dictation at once, so words still on their way from the
  // speech service can't land in the box after it has been emptied.
  const submit = () => {
    cancelDictation()
    onSubmit()
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend && !isStreaming) submit()
    }
  }

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    // Emptied so picking the same file again (after removing it) still
    // counts as a change.
    e.target.value = ''
    if (files.length > 0) onAttachFiles?.(files)
  }

  const notice = attachError ?? dictation.error
  const truncated = attachments.some(a => a.truncated)

  return (
    <div className={styles.composer}>
      {(attachments.length > 0 || readingFile || truncated) && (
        <div className="flex flex-col gap-4px padding-bottom-8px">
          {attachments.length > 0 && (
            <ul role="list" className="flex flex-wrap gap-4px">
              {attachments.map((a, i) => (
                <AttachmentChip
                  key={`${a.name}-${i}`}
                  name={a.name}
                  onRemove={() => onRemoveAttachment?.(i)}
                />
              ))}
            </ul>
          )}
          {truncated && (
            <p className="paragraph-xs color-teal-grey-300">
              That document is long, so only its first part will be read.
            </p>
          )}
          {readingFile && (
            <p className="paragraph-xs color-teal-grey-300" role="status">
              Reading {readingFile}
            </p>
          )}
        </div>
      )}
      <div className={styles.composerField}>
        <textarea
          ref={ref}
          className={styles.composerInput}
          value={value}
          onChange={e => {
            // Typing takes over from dictation: what is typed stays as typed.
            cancelDictation()
            onChange(e.target.value)
          }}
          onKeyDown={handleKey}
          placeholder={
            dictation.listening
              ? 'Listening'
              : (placeholder ?? 'Ask in any language…')
          }
          rows={1}
          maxLength={4000}
          aria-label="Message"
        />
        {(onAttachFiles || dictation.supported) && (
          // The two small buttons, lifted 4px so they share a center line
          // with the taller Send button while the box is one line high.
          <div className="flex gap-4px margin-bottom-4px margin-right-4px">
            {onAttachFiles && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_FILE_TYPES}
                  multiple
                  hidden
                  onChange={handleFiles}
                />
                <Button
                  variant="clear"
                  size="xs"
                  icon="/images/icons/paperclip.svg"
                  iconPosition="only"
                  disabled={Boolean(readingFile)}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach a document"
                  tooltip="Attach a PDF, Word, or text file"
                  tooltipPosition="above"
                />
              </>
            )}
            {dictation.supported && (
              <Button
                variant={dictation.listening ? 'teal-alt' : 'clear'}
                size="xs"
                icon="/images/icons/microphone.svg"
                iconPosition="only"
                onClick={() =>
                  dictation.listening
                    ? dictation.stop()
                    : dictation.start(value)
                }
                aria-label={dictation.listening ? 'Stop dictating' : 'Dictate'}
                aria-pressed={dictation.listening}
                tooltipPosition="above"
              />
            )}
          </div>
        )}
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
            disabled={!canSend}
            onClick={submit}
            aria-label="Send"
            tooltipPosition="above"
          />
        )}
      </div>
      {notice && (
        <p className="paragraph-xs color-red-300 padding-top-8px" role="alert">
          {notice}
        </p>
      )}
    </div>
  )
})

export default Composer
