'use client'

import { useEffect, useState } from 'react'
import EditorPanel, { type ContextOverrides } from './EditorPanel'
import AdminChatHost from './AdminChatHost'
import { DEFAULT_MODEL_ID } from '@/lib/assistant/models'
import styles from '../admin.module.css'

interface Props {
  productionPrompt: string
  promptVersion: string
}

const EMPTY_CONTEXT: ContextOverrides = {
  currentPage: '/',
  geoCity: '',
  geoRegion: '',
  geoCountry: '',
  referrer: '',
  pageState: '',
}

export default function AssistantAdmin({
  productionPrompt,
  promptVersion,
}: Props) {
  const [draftPrompt, setDraftPrompt] = useState(productionPrompt)
  const [draftModel, setDraftModel] = useState(DEFAULT_MODEL_ID)
  const [draftName, setDraftName] = useState('Draft')
  const [context, setContext] = useState<ContextOverrides>(EMPTY_CONTEXT)
  const [contextHydrated, setContextHydrated] = useState(false)

  useEffect(() => {
    if (contextHydrated) return
    let cancelled = false
    void fetch('https://ipapi.co/json/', {
      cache: 'force-cache',
      signal: AbortSignal.timeout(5000),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (cancelled) return
        const g = (data ?? {}) as Record<string, string>
        setContext(prev => ({
          ...prev,
          geoCity: prev.geoCity || (g.city ?? ''),
          geoRegion: prev.geoRegion || (g.region ?? ''),
          geoCountry: prev.geoCountry || (g.country_code ?? ''),
        }))
      })
      .catch(err => {
        console.warn('[admin] geo hydrate failed', err)
      })
      .finally(() => setContextHydrated(true))
    return () => {
      cancelled = true
    }
  }, [contextHydrated])

  return (
    <>
      <div className={styles.pageHeading}>
        <h1 className={styles.pageTitle}>Bot playground</h1>
        <div className={styles.pageMeta}>
          Production prompt:{' '}
          <span className={styles.pageMetaValue}>{promptVersion}</span>
        </div>
      </div>

      <div className={styles.consoleSplit}>
        <AdminChatHost
          prompt={draftPrompt}
          model={draftModel}
          context={context}
        />

        <div className={styles.editorColumn}>
          <EditorPanel
            productionPrompt={productionPrompt}
            prompt={draftPrompt}
            onPromptChange={setDraftPrompt}
            model={draftModel}
            onModelChange={setDraftModel}
            name={draftName}
            onNameChange={setDraftName}
            context={context}
            onContextChange={setContext}
          />
        </div>
      </div>
    </>
  )
}
