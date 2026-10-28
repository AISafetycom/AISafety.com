'use client'

import { CopyLinkButton } from '../../admin/analytics/ShareOrgLink'
import analytics from '../../admin/analytics/analytics.module.css'

/** The data file: a download, and its address to hand an AI assistant. */
export default function DataLink({
  url,
  filename,
}: {
  url: string
  filename: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-8px margin-top-12px">
      <a href={url} download={filename} className={analytics.copyBtn}>
        Download all the data
      </a>
      <input
        type="text"
        readOnly
        value={url}
        className={analytics.shareLink}
        aria-label="Address of the data file"
        onFocus={e => e.currentTarget.select()}
      />
      <CopyLinkButton url={url} />
    </div>
  )
}
