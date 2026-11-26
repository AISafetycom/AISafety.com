import Button from '@/components/Button'
import Icon from '@/components/Icon'
import styles from './Assistant.module.css'

interface Props {
  /** The attached file's name. */
  name: string
  /** Adds an × that takes the document off the message being written. */
  onRemove?: () => void
}

/** A document attached to a chatbot message: a small pill with the file's
 *  name. Shown above the message box while the message is being written, and
 *  above the sent message afterwards. Renders an <li>, so its parent is a
 *  <ul role="list">. */
export default function AttachmentChip({ name, onRemove }: Props) {
  return (
    // data-rr-mask: hidden in session recordings, like the message itself. A
    // file's name is often the visitor's own.
    <li
      className={`${styles.attachment} border-plus-fill flex items-center gap-8px padding-left-12px${onRemove ? '' : ' padding-right-12px'}`}
      data-rr-mask=""
    >
      <Icon src="/images/icons/document.svg" className="color-teal-grey-300" />
      <span className={`${styles.attachmentName} paragraph-xs`}>{name}</span>
      {onRemove && (
        <Button
          variant="clear"
          size="xs"
          iconSize={12}
          icon="/images/icons/x-small.svg"
          iconPosition="only"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          tooltip="Remove"
          tooltipPosition="above"
        />
      )}
    </li>
  )
}
