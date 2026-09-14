'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import adminStyles from '../admin.module.css'
import styles from './newsletter.module.css'

interface CardInfo {
  key: string
  title: string
  logo: string | null
}

interface CardGroup {
  id: string
  label: string
  cards: CardInfo[]
}

interface Draft {
  id: string
  name: string
  subject: string
  fromEmail: string
  fromName: string
  createdAt: string | null
  listId: string | null
  listName: string | null
  activeContacts: number | null
  problems: string[]
  /** The inbox preview line (hidden preheader), as Gmail shows it. */
  preview: string | null
  /** Cards by section, current order; null for drafts built before the
   *  renderer stamped card markers (no Reorder button then). */
  cards: CardGroup[] | null
}

interface Recent {
  id: string
  name: string
  status: 'scheduled' | 'sending' | 'sent' | 'stopped' | 'paused'
  scheduledFor: string | null
  sentAt: string | null
  sentTo: number
  uniqueOpens: number | null
  unsubscribes: number | null
  listNames: string[]
}

interface Payload {
  fetchedAt: string
  /** This session may approve. Preview-only reviewers get false and no
   *  button; the API refuses them anyway. */
  canSend: boolean
  drafts: Draft[]
  recent: Recent[]
}

function when(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function NewsletterAdmin({
  canSend,
}: {
  /** This session may approve (from the server, so it is known before the
   *  ActiveCampaign read finishes). Picks which notice shows at the top; the
   *  Approve button itself follows the API's answer in `data.canSend`. */
  canSend: boolean
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [previewId, setPreviewId] = useState<string | null>(null)
  /** Bumped after a reorder so the preview frame reloads the new order. */
  const [previewNonce, setPreviewNonce] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Draft | null>(null)
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error'
    text: string
  } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/admin/newsletter', { cache: 'no-store' })
      const body = (await res.json()) as Payload & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setData(body)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function send(draft: Draft) {
    if (!draft.listId) return
    setConfirming(null)
    setBusyId(draft.id)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign: draft.id, list: draft.listId }),
      })
      const body = (await res.json()) as {
        error?: string
        problems?: string[]
        campaignId?: string
        sdate?: string
      }
      if (res.status === 401 && body.error === 'reauth') {
        // The session is older than the approval step allows: confirm with
        // Google (one click) and come back to this page.
        window.location.assign('/api/admin/auth/google?next=/admin/newsletter')
        return
      }
      if (!res.ok) {
        const detail = body.problems?.length
          ? body.problems.join('; ')
          : (body.error ?? `HTTP ${res.status}`)
        throw new Error(detail)
      }
      setNotice({
        kind: 'ok',
        text: `Approved. “${draft.name}” is scheduled to send at ${when(body.sdate ?? null)} (campaign ${body.campaignId}). Nothing more to do.`,
      })
      if (previewId === draft.id) setPreviewId(null)
      await load()
    } catch (err) {
      setNotice({
        kind: 'error',
        text: `Not sent: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setBusyId(null)
    }
  }

  function reordered(draftId: string, cards: CardGroup[]) {
    setData(d =>
      d
        ? {
            ...d,
            drafts: d.drafts.map(x => (x.id === draftId ? { ...x, cards } : x)),
          }
        : d
    )
    setPreviewNonce(n => n + 1)
    setNotice({ kind: 'ok', text: 'Order saved to the draft.' })
  }

  return (
    <div className={adminStyles.editorColumn}>
      <div className={adminStyles.pageHeading}>
        <h1 className={adminStyles.pageTitle}>Newsletters</h1>
        <p className={adminStyles.pageMeta}>
          {data ? (
            <>
              ActiveCampaign read{' '}
              <span className={adminStyles.pageMetaValue}>
                {when(data.fetchedAt)}
              </span>
            </>
          ) : (
            'Reading ActiveCampaign…'
          )}{' '}
          <button
            type="button"
            className={styles.button}
            onClick={() => void load()}
            disabled={loading}
            style={{ marginLeft: 12, padding: '4px 10px', fontSize: 12 }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </p>
      </div>

      {canSend && (
        <div className={`${adminStyles.notice} ${styles.liveWarning}`}>
          <strong>This sends real emails.</strong> Approving an issue schedules
          it to go to every subscriber on its list about two minutes later.
          There’s no recall once it’s out. Use with caution.
        </div>
      )}
      {!canSend && (
        <p className={styles.notice}>
          View only: you can open every drafted issue below, but approving and
          sending stays with people who can edit Newsletters.
        </p>
      )}

      {notice && (
        <p
          className={
            notice.kind === 'ok' ? styles.noticeOk : styles.noticeError
          }
        >
          {notice.text}
        </p>
      )}
      {loadError && (
        <p className={styles.noticeError}>
          Could not read ActiveCampaign: {loadError}
        </p>
      )}

      <div className={adminStyles.editorBlock}>
        <div className={adminStyles.editorBlockHeader}>
          <h2 className={adminStyles.editorBlockTitle}>
            Waiting for approval{data ? ` · ${data.drafts.length}` : ''}
          </h2>
        </div>
        <p className={adminStyles.sectionHint}>
          Issues the pipeline has drafted from Pen. Each one is re-checked here
          before sending: still a draft, wired to exactly one list, content
          untouched since the pipeline wrote it. Approving schedules the send
          for about two minutes later.
        </p>
        {data && data.drafts.length === 0 && !loading && (
          <p className={styles.notice}>
            Nothing waiting. A draft appears here when the pipeline finishes an
            issue.
          </p>
        )}
        {data?.drafts.map(draft => {
          const ok = draft.problems.length === 0 && draft.listId != null
          return (
            <div key={draft.id} className={adminStyles.editorBlock}>
              <div className={adminStyles.editorBlockHeader}>
                <h3 className={adminStyles.editorBlockTitle}>{draft.name}</h3>
                <span className={ok ? styles.statusOk : styles.statusBad}>
                  {ok ? 'Verified' : 'Cannot send'}
                </span>
              </div>
              <p className={styles.draftMeta}>
                <span>
                  Subject{' '}
                  <span className={styles.draftMetaValue}>{draft.subject}</span>
                </span>
                {draft.preview && (
                  <span>
                    Preview{' '}
                    <span className={styles.draftMetaValue}>
                      {draft.preview}
                    </span>
                  </span>
                )}
                <span>
                  To{' '}
                  <span className={styles.draftMetaValue}>
                    {draft.listName ??
                      (draft.listId ? `list ${draft.listId}` : 'no list')}
                  </span>
                  {draft.activeContacts != null && (
                    <>
                      {' '}
                      ·{' '}
                      <span className={styles.draftMetaValue}>
                        {draft.activeContacts}
                      </span>{' '}
                      active contact{draft.activeContacts === 1 ? '' : 's'}
                    </>
                  )}
                </span>
                <span>
                  From{' '}
                  <span className={styles.draftMetaValue}>
                    {draft.fromName} &lt;{draft.fromEmail}&gt;
                  </span>
                </span>
                <span>
                  Drafted{' '}
                  <span className={styles.draftMetaValue}>
                    {when(draft.createdAt)}
                  </span>
                </span>
                <span className={styles.muted}>campaign {draft.id}</span>
              </p>
              {draft.problems.length > 0 && (
                <ul className={styles.problems}>
                  {draft.problems.map(p => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() =>
                    setPreviewId(previewId === draft.id ? null : draft.id)
                  }
                >
                  {previewId === draft.id ? 'Hide preview' : 'Preview'}
                </button>
                {data.canSend && (
                  <button
                    type="button"
                    className={styles.buttonPrimary}
                    onClick={() => setConfirming(draft)}
                    disabled={!ok || busyId != null}
                  >
                    {busyId === draft.id ? 'Scheduling…' : 'Approve & send'}
                  </button>
                )}
              </div>
              {/* The preview brings the reorder panel with it (approvers only;
                  no separate button — Bryce, 11 Sept 2026). */}
              {previewId === draft.id && (
                <div className={styles.previewRow}>
                  {data.canSend && draft.cards && ok && (
                    <div className={styles.reorderSide}>
                      <ReorderPanel
                        key={draft.id}
                        draft={draft}
                        onSaved={cards => reordered(draft.id, cards)}
                      />
                    </div>
                  )}
                  <iframe
                    title={`Preview of ${draft.subject}`}
                    className={styles.previewFrame}
                    sandbox=""
                    src={`/api/admin/newsletter/preview?draft=${draft.id}&v=${previewNonce}`}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className={adminStyles.editorBlock}>
        <div className={adminStyles.editorBlockHeader}>
          <h2 className={adminStyles.editorBlockTitle}>Recent sends</h2>
        </div>
        {data && data.recent.length === 0 && (
          <p className={styles.notice}>No sends yet.</p>
        )}
        {data && data.recent.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>List</th>
                <th>Status</th>
                <th>Sent</th>
                <th>To</th>
                <th>Opens</th>
                <th>Unsubs</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className={styles.muted}>
                    {r.listNames.join(', ') || '—'}
                  </td>
                  <td>
                    {r.status === 'sent' ? (
                      <span className={styles.statusOk}>sent</span>
                    ) : r.status === 'stopped' ? (
                      <span className={styles.statusBad}>stopped</span>
                    ) : (
                      r.status
                    )}
                  </td>
                  <td className={styles.muted}>
                    {r.status === 'scheduled'
                      ? `due ${when(r.scheduledFor)}`
                      : when(r.sentAt)}
                  </td>
                  <td>{r.sentTo}</td>
                  <td className={styles.muted}>{r.uniqueOpens ?? '—'}</td>
                  <td className={styles.muted}>{r.unsubscribes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirming && (
        <ConfirmSend
          draft={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void send(confirming)}
        />
      )}
    </div>
  )
}

const keysOf = (groups: CardGroup[]) => groups.map(g => g.cards.map(c => c.key))

/** Drag-and-drop ordering of a draft's cards, one list per section (a card
 *  never leaves its section). Saving rewrites the draft inside
 *  ActiveCampaign; nothing is sent. Arrow keys on a focused row are the
 *  keyboard route (Bryce, 11 Sept 2026: no visible arrow buttons). */
function ReorderPanel({
  draft,
  onSaved,
}: {
  draft: Draft
  onSaved: (cards: CardGroup[]) => void
}) {
  const original = draft.cards ?? []
  const [groups, setGroups] = useState<CardGroup[]>(() =>
    original.map(g => ({ ...g, cards: [...g.cards] }))
  )
  const [drag, setDrag] = useState<{ gid: string; key: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty =
    JSON.stringify(keysOf(groups)) !== JSON.stringify(keysOf(original))

  function move(gid: string, from: number, to: number) {
    if (from === to) return
    setGroups(gs =>
      gs.map(g => {
        if (g.id !== gid) return g
        const cards = [...g.cards]
        const [card] = cards.splice(from, 1)
        cards.splice(to, 0, card)
        return { ...g, cards }
      })
    )
  }

  /** Live reorder while dragging: the dragged card takes the slot of the
   *  card under the pointer (same section only). */
  function enter(gid: string, key: string) {
    if (!drag || drag.gid !== gid || drag.key === key) return
    const g = groups.find(x => x.id === gid)
    if (!g) return
    const from = g.cards.findIndex(c => c.key === drag.key)
    const to = g.cards.findIndex(c => c.key === key)
    if (from >= 0 && to >= 0) move(gid, from, to)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const order = Object.fromEntries(
        groups.map(g => [g.id, g.cards.map(c => c.key)])
      )
      const res = await fetch('/api/admin/newsletter/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign: draft.id, order }),
      })
      const body = (await res.json()) as {
        error?: string
        problems?: string[]
        cards?: CardGroup[]
      }
      if (!res.ok || !body.cards) {
        throw new Error(
          body.problems?.length
            ? body.problems.join('; ')
            : (body.error ?? `HTTP ${res.status}`)
        )
      }
      setGroups(body.cards.map(g => ({ ...g, cards: [...g.cards] })))
      onSaved(body.cards)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.reorder}>
      <p className={adminStyles.sectionHint}>
        Drag a listing to move it. Cards stay within their section. Save writes
        the new order into the draft (the preview updates); it sends nothing.
      </p>
      {groups.map(g => (
        <div key={g.id} className={styles.reorderGroup}>
          {groups.length > 1 && (
            <div className={styles.reorderGroupLabel}>{g.label}</div>
          )}
          <ol className={styles.reorderList}>
            {g.cards.map((c, i) => (
              <li
                key={c.key}
                className={`${styles.reorderRow}${
                  drag?.gid === g.id && drag.key === c.key
                    ? ` ${styles.reorderRowDragging}`
                    : ''
                }`}
                draggable={!saving}
                tabIndex={0}
                aria-label={`${c.title}, position ${i + 1} of ${g.cards.length}. Arrow keys move it.`}
                onKeyDown={e => {
                  if (saving) return
                  if (e.key === 'ArrowUp' && i > 0) {
                    e.preventDefault()
                    move(g.id, i, i - 1)
                  } else if (e.key === 'ArrowDown' && i < g.cards.length - 1) {
                    e.preventDefault()
                    move(g.id, i, i + 1)
                  }
                }}
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', c.key)
                  setDrag({ gid: g.id, key: c.key })
                }}
                onDragEnter={() => enter(g.id, c.key)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => e.preventDefault()}
                onDragEnd={() => setDrag(null)}
              >
                <span className={styles.reorderHandle} aria-hidden="true">
                  ⋮⋮
                </span>
                <span className={styles.reorderIndex}>{i + 1}</span>
                {c.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.logo}
                    alt=""
                    width={28}
                    height={28}
                    className={styles.reorderLogo}
                    draggable={false}
                  />
                ) : (
                  <span className={styles.reorderLogo} aria-hidden="true" />
                )}
                <span className={styles.reorderTitle}>{c.title}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {error && <p className={styles.noticeError}>Not saved: {error}</p>}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save order'}
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={!dirty || saving}
          onClick={() =>
            setGroups(original.map(g => ({ ...g, cards: [...g.cards] })))
          }
        >
          Reset
        </button>
        {!dirty && !saving && (
          <span className={styles.notice}>Order matches the draft.</span>
        )}
      </div>
    </div>
  )
}

/** In-page confirmation for the one irreversible action on this page. */
function ConfirmSend({
  draft,
  onCancel,
  onConfirm,
}: {
  draft: Draft
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const count = draft.activeContacts
  const listLabel =
    draft.listName ?? (draft.listId ? `list ${draft.listId}` : '')
  const who =
    count == null
      ? `everyone on ${listLabel}`
      : `${count} contact${count === 1 ? '' : 's'}`

  useEffect(() => {
    // Focus lands on Cancel, so a stray Enter never sends.
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-send-title"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="confirm-send-title" className={styles.dialogTitle}>
          Send “{draft.name}”?
        </h2>
        {/* In the order the inbox shows them: sender, subject, preview line. */}
        <dl className={styles.dialogFacts}>
          <dt>From</dt>
          <dd>
            {draft.fromName} &lt;{draft.fromEmail}&gt;
          </dd>
          <dt>Subject</dt>
          <dd>{draft.subject}</dd>
          {draft.preview && (
            <>
              <dt>Preview</dt>
              <dd className={styles.muted}>{draft.preview}</dd>
            </>
          )}
          <dt>To</dt>
          <dd>
            {listLabel}
            {count != null && (
              <span className={styles.muted}>
                {' '}
                · {count} active contact{count === 1 ? '' : 's'}
              </span>
            )}
          </dd>
        </dl>
        <p className={styles.dialogNote}>
          It goes out about two minutes after you confirm and can&rsquo;t be
          recalled.
        </p>
        <div className={styles.dialogActions}>
          <button
            ref={cancelRef}
            type="button"
            className={styles.button}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.buttonPrimary}
            onClick={onConfirm}
          >
            Send to {who}
          </button>
        </div>
      </div>
    </div>
  )
}
