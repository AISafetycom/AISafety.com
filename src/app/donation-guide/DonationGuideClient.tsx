'use client'

import { useRef, useState } from 'react'
import RelativeDate from '@/components/RelativeDate'
import { IntroHeading, TabContent } from '@/lib/donation-guide/render'
import type { Guide } from '@/lib/donation-guide/types'
import styles from './page.module.css'

interface Props {
  guide: Guide
  /** ISO time the guide was last published. */
  lastUpdated: string
  /** Tab id to open first; the first tab when absent or unknown. */
  initialTab?: string
}

/** The page as the visitor sees it: the tab switching and its fade live
 *  here, the content comes in as JSON (live from the store, or a draft on
 *  the admin's preview). */
export default function DonationGuideClient({
  guide,
  lastUpdated,
  initialTab,
}: Props) {
  const firstTab = guide.tabs.some(t => t.id === initialTab)
    ? initialTab!
    : guide.tabs[0]?.id
  const [activeTab, setActiveTab] = useState(firstTab)
  const [fading, setFading] = useState(false)
  const pendingTab = useRef<string | null>(null)

  function handleTabClick(id: string) {
    if (id === activeTab) return
    pendingTab.current = id
    setFading(true)
    setTimeout(() => {
      setActiveTab(pendingTab.current!)
      pendingTab.current = null
      setFading(false)
    }, 100)
  }

  return (
    <div>
      <div className="container-default">
        <h1 className="padding-top-56px padding-bottom-8px">Donation guide</h1>
        <RelativeDate
          iso={lastUpdated}
          className="padding-bottom-40px paragraph-small color-teal-300"
        />
        <IntroHeading intro={guide.intro} />
        <p className="padding-bottom-32px">Choose a donation amount:</p>

        <div className={styles.tabsContainer}>
          <div className={`${styles.tabsMenu} width-3-col`}>
            {guide.tabs.map(tab => (
              <button
                key={tab.id}
                className={`${styles.tabLink} ${activeTab === tab.id ? styles.tabLinkActive : ''}`}
                onClick={() => handleTabClick(tab.id)}
              >
                <p>{tab.amount}</p>
              </button>
            ))}
          </div>

          <div
            className={`width-9-col ${styles.tabContent} ${fading ? styles.tabContentFading : ''}`}
          >
            {guide.tabs.map(tab =>
              activeTab === tab.id ? (
                <TabContent key={tab.id} tab={tab} />
              ) : null
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
