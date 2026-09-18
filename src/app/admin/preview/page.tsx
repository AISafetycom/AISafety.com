import { previewPillsShown } from '@/lib/admin/auth'
import { isPreviewRequest } from '@/lib/preview'
import { formatTimeAgo } from '@/lib/format-date'
import adminStyles from '../admin.module.css'
import styles from './preview.module.css'
import PreviewToggle from './PreviewToggle'

// Never prerendered: the page shows this session's own switch-pill and
// preview state, which lives in cookies.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PreviewAdminPage() {
  const pillsShown = await previewPillsShown()
  const previewOn = await isPreviewRequest()
  const buildTime = process.env.BUILD_TIME
  const rebuilt = buildTime ? formatTimeAgo(buildTime, new Date()) : null

  return (
    <div className={adminStyles.editorColumn}>
      <div className={adminStyles.pageHeading}>
        <h1 className={adminStyles.pageTitle}>Site preview</h1>
        {rebuilt && (
          <p className={adminStyles.pageMeta}>
            Public version built{' '}
            <span className={adminStyles.pageMetaValue}>{rebuilt}</span>
          </p>
        )}
      </div>

      <div className={adminStyles.editorBlock}>
        <div className={adminStyles.editorBlockHeader}>
          <h2 className={adminStyles.editorBlockTitle}>
            Switch buttons are{' '}
            <span className={pillsShown ? styles.stateOn : styles.stateOff}>
              {pillsShown ? 'SHOWN' : 'HIDDEN'}
            </span>
            {previewOn && (
              <span className={styles.previewNote}> · preview mode is on</span>
            )}
          </h2>
          <PreviewToggle pillsShown={pillsShown} />
        </div>
        <p className={adminStyles.sectionHint}>
          The switch buttons sit at the bottom middle of every page, for your
          browser only. &ldquo;Switch to preview&rdquo; shows the real pages
          rendered from live Airtable data — open pages notice an edit within a
          few seconds and update themselves, no reload needed. The pink preview
          button switches you back, and always stays visible while preview mode
          is on, even with the switch buttons hidden here. Search keeps up too:
          it re-reads the listings you have just edited — the page you are on
          whenever it refreshes, and every other page each time you come back to
          this tab — so an edit shows in search within seconds. Visitors see
          none of this: they keep the fast prebuilt pages, which catch up on
          their own a couple of minutes after each edit.
        </p>
      </div>
    </div>
  )
}
