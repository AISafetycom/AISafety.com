'use client'

import analytics from '../../admin/analytics/analytics.module.css'

/** A button that saves `csv` as a file, made in the browser: the text is
 *  already on the page, so there's no address to fetch it from (and none
 *  that could carry the link's token). */
export default function CsvDownload({
  csv,
  filename,
  label,
}: {
  csv: string
  filename: string
  label: string
}) {
  const save = () => {
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' })
    )
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    // After the click has started the download.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  return (
    <button type="button" className={analytics.copyBtn} onClick={save}>
      {label}
    </button>
  )
}
