'use client'

import type { AnchorHTMLAttributes } from 'react'
import { isPlainClick, openFeedbackForm } from '@/lib/feedback-form'
import type { FeedbackKind } from '@/lib/site-feedback'

type FeedbackFormLinkProps = {
  /** Which of the site's forms it opens. */
  kind: FeedbackKind
  /** The Airtable form it stands for: where a Cmd-click or middle click
   *  goes, and what the site's form offers if sending fails. */
  href: string
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

/** A link in a page's text to the corrections or feedback form. A plain click
 *  opens the site's own form (FeedbackPopover) by the link. On its own:
 *  <FeedbackFormLink kind="correction" href={…} className="link">; as a
 *  button: <Button as={FeedbackFormLink} kind="feedback" href={…}>. */
export default function FeedbackFormLink({
  kind,
  href,
  onClick,
  ...rest
}: FeedbackFormLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-haspopup="dialog"
      {...rest}
      onClick={e => {
        onClick?.(e)
        if (e.defaultPrevented || !isPlainClick(e)) return
        e.preventDefault()
        openFeedbackForm({
          kind,
          entry: 'page',
          trigger: e.currentTarget,
          fallbackHref: href,
        })
      }}
    />
  )
}
