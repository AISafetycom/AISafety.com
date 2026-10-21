'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import styles from './analytics.module.css'

/** The Org lookup tab's search box. Submitting swaps `q` in the url (and
 *  clears the left-out rows, which belonged to the old search); the date
 *  range and count mode carry over. The panels below fade while the new
 *  search loads, like a date change. */
export default function OrgSearch({ query }: { query: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(query)
  const [pending, startTransition] = useTransition()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'orgs')
    params.delete('x')
    params.delete('source')
    const q = value.trim()
    if (q) params.set('q', q)
    else params.delete('q')
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  return (
    <form className={styles.orgSearch} onSubmit={submit} role="search">
      <span hidden data-pending={pending || undefined} />
      <input
        type="search"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="An org's name, like Lens Academy"
        aria-label="Org name"
        className={styles.orgSearchInput}
        maxLength={100}
        autoFocus={!query}
      />
      <button
        type="submit"
        className={styles.applyBtn}
        disabled={!value.trim() || value.trim() === query}
      >
        Look up
      </button>
    </form>
  )
}
