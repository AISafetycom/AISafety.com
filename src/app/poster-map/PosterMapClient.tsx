'use client'

import dynamic from 'next/dynamic'
import Icon from '@/components/Icon'
import { useRef } from 'react'
import styles from './page.module.css'
import { MapOrg } from '@/lib/data/map'

const D3PosterMap = dynamic(() => import('./D3PosterMap'), {
  ssr: false,
  loading: () => (
    <div
      className={styles['map-container']}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <p className="paragraph-small color-teal-300">Loading map...</p>
    </div>
  ),
})

interface PosterMapClientProps {
  orgs: MapOrg[]
}

export default function PosterMapClient({ orgs }: PosterMapClientProps) {
  const mapWrapperRef = useRef<HTMLDivElement>(null)

  const scrollToWarning = () => {
    if (!mapWrapperRef.current) return
    const mapRect = mapWrapperRef.current.getBoundingClientRect()
    const scrollAmount = window.scrollY + mapRect.bottom
    window.scrollTo({ top: scrollAmount, behavior: 'smooth' })
  }

  return (
    <>
      <h1 className="visually-hidden">Field map poster</h1>
      <div ref={mapWrapperRef} className={styles['map-wrapper']}>
        <D3PosterMap orgs={orgs} />
        <button onClick={scrollToWarning} className={styles['scroll-button']}>
          View cards{' '}
          <span style={{ color: '#81878f' }}>
            <Icon
              src="/images/icons/arrow-down.svg"
              className="color-teal-bright-400"
            />
          </span>
        </button>
      </div>

      <div className="container-default">
        <h2
          className="width-7-col padding-bottom-56px"
          style={{ paddingTop: '40px' }}
        >
          <span style={{ color: '#FF8C00' }}>
            THIS IS NOT THE REAL MAP, IT&apos;S JUST USED FOR PRINTING POSTERS
          </span>
        </h2>
      </div>
    </>
  )
}
