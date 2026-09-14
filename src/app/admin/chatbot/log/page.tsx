import { redirect } from 'next/navigation'
import { isConversationsTableConfigured } from '@/lib/admin/airtable'
import { canViewConversationLog } from '@/lib/admin/auth'
import ConversationList from '../ConversationList'
import styles from '../../admin.module.css'

export default async function ConversationsPage() {
  // The section layout let us in on either chatbot tab; this page needs its own.
  if (!(await canViewConversationLog())) redirect('/admin/chatbot/playground')
  const configured = isConversationsTableConfigured()
  return (
    <div className={styles.convPage}>
      <div className={styles.pageHeading}>
        <h1 className={styles.pageTitle}>Conversation Log</h1>
      </div>
      {configured ? (
        <ConversationList />
      ) : (
        <div className={styles.notice}>
          Set <code>ADMIN_CONVERSATIONS_TABLE_ID</code> in env to read the
          conversation log.
        </div>
      )}
    </div>
  )
}
