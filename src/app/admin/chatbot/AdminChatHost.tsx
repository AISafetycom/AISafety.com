'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import ChatBody, { type ChatBodyHandle } from '@/components/assistant/ChatBody'
import { chipsFor, greetingFor } from '@/lib/assistant/pages'
import { modelShortLabel } from '@/lib/assistant/models'
import { suggestFormUrl } from '@/lib/assistant/constants'
import styles from '../admin.module.css'
import type { ContextOverrides } from './EditorPanel'

interface Props {
  prompt: string
  model: string
  context: ContextOverrides
}

export default function AdminChatHost({ prompt, model, context }: Props) {
  const chatRef = useRef<ChatBodyHandle>(null)
  const [hasMessages, setHasMessages] = useState(false)

  const greeting = useMemo(
    () => greetingFor(context.currentPage),
    [context.currentPage]
  )
  const chips = useMemo(
    () => chipsFor(context.currentPage),
    [context.currentPage]
  )

  // Send the latest prompt + model + context with each turn (function form).
  const buildExtras = useCallback(() => {
    const geo: { city?: string; region?: string; country?: string } = {}
    if (context.geoCity) geo.city = context.geoCity
    if (context.geoRegion) geo.region = context.geoRegion
    if (context.geoCountry) geo.country = context.geoCountry
    let pageState: Record<string, unknown> | null = null
    if (context.pageState.trim()) {
      try {
        pageState = JSON.parse(context.pageState)
      } catch {
        pageState = null
      }
    }
    return {
      prompt,
      model,
      currentPage: context.currentPage,
      pageState,
      referrer: context.referrer || null,
      geo: Object.keys(geo).length > 0 ? geo : null,
    }
  }, [prompt, model, context])

  const handleClear = useCallback(() => {
    chatRef.current?.clear()
    setHasMessages(false)
  }, [])

  const handleSuggest = useCallback((_query: string, type?: string) => {
    window.open(suggestFormUrl(type), '_blank', 'noopener')
  }, [])

  return (
    <div className={styles.chatHost}>
      <div className={styles.chatHostHeader}>
        <div className={styles.chatHostBadge}>
          <span className={styles.chatHostBadgeDot} />
          <span>Sandbox · {modelShortLabel(model)}</span>
        </div>
        {hasMessages && (
          <button
            type="button"
            className={styles.chatHostClear}
            onClick={handleClear}
          >
            Clear
          </button>
        )}
      </div>
      <ChatBody
        ref={chatRef}
        endpoint="/api/admin/test-run"
        bodyExtras={buildExtras}
        chips={chips}
        greeting={greeting}
        privacyNote="Sandbox: test chats aren't saved to the Bot log."
        onHasMessagesChange={setHasMessages}
        onSuggest={handleSuggest}
      />
    </div>
  )
}
