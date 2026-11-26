'use client'

import Image from 'next/image'
import { useState } from 'react'
import Icon from '@/components/Icon'
import styles from './ListingLogo.module.css'

/* A listing's logo at the start of a list row: the site search's results
   and a text box's suggestions (<TextField suggestions>). 40px, the logo
   whole on its square; the name's initials in a circle when there's no
   logo or it fails to load; a page's icon in a white circle. */
export default function ListingLogo({
  title,
  logo,
  page = false,
}: {
  title: string
  logo: string | null | undefined
  /** One of the site's pages: its logo is an icon. */
  page?: boolean
}) {
  const [errored, setErrored] = useState(false)

  if (page && logo) {
    return (
      <div
        className={`${styles.logo} ${styles.page} drop-shadow-light flex items-center justify-center`}
      >
        <Icon src={logo} size={16} className="color-teal-800" />
      </div>
    )
  }

  if (logo && !errored) {
    return (
      <div
        className={`${styles.logo} ${styles.image} flex items-center justify-center`}
      >
        <Image
          src={logo}
          alt=""
          width={40}
          height={40}
          onError={() => setErrored(true)}
          unoptimized={!logo.startsWith('/')}
        />
      </div>
    )
  }

  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()

  return (
    <div
      className={`${styles.logo} ${styles.initials} bg-teal-750 paragraph-xs-bold color-teal-300 flex items-center justify-center`}
    >
      {initials}
    </div>
  )
}
