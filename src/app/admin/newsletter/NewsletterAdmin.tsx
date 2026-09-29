'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import adminStyles from '../admin.module.css'
import styles from './newsletter.module.css'

interface CardInfo {
  key: string
  title: string
  logo: string | null
  /** "Consider applying if" as plain text ('' = none yet); null when the
   *  card can't carry one (events/training, or an older funding draft). */
  fit: string | null
  /** Pen's original line, to show what changed and offer it back. */
  pipelineFit: string | null
  /** Every piece of text on the card (title, lines under it, description,
   *  rows at the bottom); empty for drafts built before 25 Sept 2026. */
  fields: CardField[]
}

interface CardField {
  name: string
  label: string
  value: string
  /** The text as built, when it has been edited since; null otherwise. */
  original: string | null
  hasLink: boolean
}

/** Pen stamps each item with its Airtable record id; only those cards can
 *  pass a description on to the site's listing. */
const RECORD_KEY_RE = /^rec[A-Za-z0-9]{14}$/

/** How long after the last keystroke the editor saves by itself. */
const AUTOSAVE_DELAY_MS = 900
/** How long after a card is dropped (or moved with the arrow keys) the new
 *  order saves itself. */
const ORDER_SAVE_DELAY_MS = 500

interface CardGroup {
  id: string
  label: string
  cards: CardInfo[]
}

interface Draft {
  id: string
  /** The draft's message: sent with every save and the preview so the server
   *  can read it alongside its checks (ActiveCampaign is slow per request). */
  messageId: string | null
  name: string
  subject: string
  fromEmail: string
  fromName: string
  createdAt: string | null
  listId: string | null
  listName: string | null
  activeContacts: number | null
  /** The pipeline's checks (still a draft, one list, content untouched);
   *  empty = it can be previewed, tested and edited. */
  problems: string[]
  /** Why it may not be sent even so; empty = Approve may be pressed. */
  blocks: string[]
  /** What the approver ticks in the confirm dialog before it sends. */
  warnings: SendWarning[]
  /** The issue already went (or is going) to this list as that campaign. */
  alreadySent: { campaignId: string; status: string } | null
  /** Card edits can be saved into it from this copy of the site (real
   *  lists only from aisafety.com itself). */
  editable: boolean
  /** The inbox preview line (hidden preheader), as Gmail shows it. */
  preview: string | null
  /** Cards by section, current order; null for drafts built before the
   *  renderer stamped card markers (no Reorder button then). */
  cards: CardGroup[] | null
}

/** Something to look at before sending: card text edited since Pen wrote
 *  it, leftover words (TEST, TODO…), or a date already past. */
interface SendWarning {
  /** Sent back when ticked; the server checks every current one was. */
  id: string
  kind: 'edited' | 'words' | 'date'
  text: string
  from?: string
  to?: string
}

const WARNING_GROUPS: Array<{ kind: SendWarning['kind']; title: string }> = [
  { kind: 'edited', title: 'Card text changed since Pen wrote it' },
  { kind: 'words', title: 'Words that look left over' },
  { kind: 'date', title: 'Dates or deadlines already past' },
]

interface Recent {
  id: string
  name: string
  status:
    | 'scheduled'
    | 'sending'
    | 'sent'
    | 'stopped'
    | 'paused'
    | 'held'
    | 'disabled'
  scheduledFor: string | null
  sentAt: string | null
  sentTo: number
  uniqueOpens: number | null
  unsubscribes: number | null
  listNames: string[]
  /** Counted on aisafety.com (the links go through /api/nl since 28 Sept
   *  2026); zero for older sends. */
  clicks: {
    total: number
    links: Array<{ label: string; url: string; clicks: number }>
  }
}

interface Payload {
  fetchedAt: string
  /** This session may approve. Preview-only reviewers get false and no
   *  button; the API refuses them anyway. */
  canSend: boolean
  drafts: Draft[]
  recent: Recent[]
}

/** How often the page rereads ActiveCampaign on its own, so an approved
 *  issue turns from "scheduled" into "sent" (and the opens move) without a
 *  click (Bryce, 16 Sept 2026: "this should automatically update without me
 *  needing to refresh"). A read is several AC calls and takes a few seconds,
 *  so no faster than this; the Refresh button is still there for right now. */
const POLL_MS = 30_000

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

/** "lensacademy.org" for a link's destination (no www, no path). */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default function NewsletterAdmin({
  canSend,
  testTo,
}: {
  /** This session may approve (from the server, so it is known before the
   *  ActiveCampaign read finishes). Picks which notice shows at the top; the
   *  Approve button itself follows the API's answer in `data.canSend`. */
  canSend: boolean
  /** Where "Send test" delivers: the approver's own sign-in address. Null
   *  for view-only sessions, which get no test button. */
  testTo: string | null
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [previewId, setPreviewId] = useState<string | null>(null)
  /** The send whose per-link clicks are open under its row. */
  const [openClicks, setOpenClicks] = useState<string | null>(null)
  /** Bumped after a reorder or a text edit so the preview frame reloads. */
  const [previewNonce, setPreviewNonce] = useState(0)
  /** Where the reader is in the preview (the frame posts it as it scrolls),
   *  and the position the frame was last loaded with. Only the second one
   *  goes into the frame's URL, and only changes together with the nonce, so
   *  scrolling never reloads the frame. */
  const previewScroll = useRef(0)
  const previewFrame = useRef<HTMLIFrameElement | null>(null)
  const [previewY, setPreviewY] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** The draft a test copy is on its way for, and how the last one went.
   *  `edited` = the draft has changed since that copy went out. */
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{
    draftId: string
    kind: 'ok' | 'error'
    text: string
    edited?: boolean
  } | null>(null)
  /** The draft with edits not yet written into it (typed text, a moved card,
   *  a save in flight): a test or an approval now would go without them. */
  const [unsavedId, setUnsavedId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Draft | null>(null)
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error'
    text: string
  } | null>(null)

  /** A read in progress, and when the last one started: the timer skips a
   *  tick rather than stacking reads, and a tab coming back into view only
   *  rereads when its data is older than a tick. */
  const inFlight = useRef(false)
  const lastStarted = useRef(0)

  /** `quiet` = the timer's own reread: no "Refreshing…" on the button and
   *  skipped while a read is already running. A click or an approval reads
   *  the ordinary way. */
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (quiet && inFlight.current) return
    inFlight.current = true
    lastStarted.current = Date.now()
    if (!quiet) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const res = await fetch('/api/admin/newsletter', { cache: 'no-store' })
      const body = (await res.json()) as Payload & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setData(body)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      inFlight.current = false
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Reread every POLL_MS while the tab is visible, and as soon as it becomes
  // visible again if the data has gone stale meanwhile. A hidden tab reads
  // nothing.
  useEffect(() => {
    let timer = 0
    const tick = () => {
      if (document.visibilityState === 'visible') void load({ quiet: true })
      timer = window.setTimeout(tick, POLL_MS)
    }
    timer = window.setTimeout(tick, POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastStarted.current < POLL_MS) return
      void load({ quiet: true })
      window.clearTimeout(timer)
      timer = window.setTimeout(tick, POLL_MS)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  /** Approve: `confirmed` = the ids of the warnings ticked in the dialog.
   *  Only an answer that says so counts as "not sent"; anything unclear
   *  (no answer, a gateway error, a 202) may mean the send is scheduled, so
   *  the page says not to press again and rereads the lists either way. */
  async function send(draft: Draft, confirmed: string[]) {
    if (!draft.listId) return
    setConfirming(null)
    setBusyId(draft.id)
    setNotice(null)
    let res: Response | null = null
    let body: {
      error?: string
      problems?: string[]
      campaignId?: string
      sdate?: string
      held?: boolean
      approver?: string
      notes?: string[]
      needsConfirmation?: boolean
      warnings?: SendWarning[]
      locked?: boolean
      maybeScheduled?: boolean
      notSent?: boolean
    } = {}
    try {
      res = await fetch('/api/admin/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign: draft.id,
          list: draft.listId,
          confirmed,
        }),
      })
      body = await res.json().catch(() => ({}))
    } catch {
      // No answer: the request may still have reached the server.
      res = null
    }
    if (res?.status === 401 && body.error === 'reauth') {
      // The session is older than the approval step allows: confirm with
      // Google (one click) and come back to this page.
      window.location.assign('/api/admin/auth/google?next=/admin/newsletter')
      return
    }
    if (res?.status === 200 && body.campaignId) {
      const by = body.approver ? ` by ${body.approver}` : ''
      setNotice({
        kind: 'ok',
        text:
          (body.held
            ? `Approved${by}. ActiveCampaign is holding “${draft.name}” for its own review first (campaign ${body.campaignId}) – it goes out once they approve it. Nothing more to do; don’t approve it again.`
            : `Approved${by}. “${draft.name}” is scheduled to send at ${when(body.sdate ?? null)} (campaign ${body.campaignId}). Nothing more to do.`) +
          (body.notes?.length ? ` ${body.notes.join(' ')}` : ''),
      })
      if (previewId === draft.id) setPreviewId(null)
    } else if (res?.status === 409 && body.needsConfirmation && body.warnings) {
      // The checks changed since the dialog opened (an edit landed, a date
      // passed): show the current ones and ask again.
      const next = { ...draft, warnings: body.warnings }
      setData(d =>
        d
          ? {
              ...d,
              drafts: d.drafts.map(x => (x.id === draft.id ? next : x)),
            }
          : d
      )
      setNotice({
        kind: 'error',
        text: 'Not sent: the checks changed since you opened the dialog. Look at them again and tick them.',
      })
      setBusyId(null)
      setConfirming(next)
      return
    } else if (res?.status === 409 && body.locked) {
      setNotice({
        kind: 'error',
        text: body.error ?? 'Another approval is running.',
      })
    } else if (
      res != null &&
      ([400, 401, 403, 409, 503].includes(res.status) || body.notSent)
    ) {
      const detail = body.problems?.length
        ? body.problems.join('; ')
        : (body.error ?? `HTTP ${res.status}`)
      setNotice({ kind: 'error', text: `Not sent: ${detail}` })
    } else {
      setNotice({
        kind: 'error',
        text:
          body.maybeScheduled && body.error
            ? body.error
            : `It may have been scheduled anyway: the answer didn’t come back cleanly (${res ? `HTTP ${res.status}` : 'no answer'}). Don’t press Approve again – check Recent sends below, which updates by itself.`,
      })
    }
    setBusyId(null)
    await load()
  }

  /** Mail the draft to the signed-in approver alone (ActiveCampaign's test
   *  send), so it can be read and clicked through in a real inbox first. */
  async function sendTest(draft: Draft) {
    setTestingId(draft.id)
    setTestResult(null)
    try {
      const res = await fetch('/api/admin/newsletter/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign: draft.id,
          message: draft.messageId ?? undefined,
        }),
      })
      const body = (await res.json()) as {
        error?: string
        problems?: string[]
        to?: string
      }
      if (!res.ok || !body.to) {
        throw new Error(
          body.problems?.length
            ? body.problems.join('; ')
            : (body.error ?? `HTTP ${res.status}`)
        )
      }
      setTestResult({
        draftId: draft.id,
        kind: 'ok',
        text: `Test sent to ${body.to} only. It arrives in a minute or two as “TEST: ${draft.subject}”.`,
      })
    } catch (err) {
      setTestResult({
        draftId: draft.id,
        kind: 'error',
        text: `Test not sent: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setTestingId(null)
    }
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== previewFrame.current?.contentWindow) return
      const y = (e.data as { aisafetyPreviewScroll?: unknown } | null)
        ?.aisafetyPreviewScroll
      if (typeof y === 'number' && Number.isFinite(y) && y >= 0)
        previewScroll.current = y
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  function togglePreview(id: string) {
    previewScroll.current = 0
    setPreviewY(0)
    setPreviewId(previewId === id ? null : id)
  }

  /** A reorder or a text edit was written into the draft: keep the cards,
   *  reload the preview where the reader was, say so (an empty `text` = an
   *  autosave, which reports inside the editor instead). */
  function draftChanged(draftId: string, cards: CardGroup[], text: string) {
    setData(d =>
      d
        ? {
            ...d,
            drafts: d.drafts.map(x => (x.id === draftId ? { ...x, cards } : x)),
          }
        : d
    )
    setPreviewY(previewScroll.current)
    setPreviewNonce(n => n + 1)
    setTestResult(t =>
      t && t.draftId === draftId && t.kind === 'ok' ? { ...t, edited: true } : t
    )
    if (text) setNotice({ kind: 'ok', text })
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
              {' · '}updates every {Math.round(POLL_MS / 1000)} seconds
            </>
          ) : (
            <>
              <span
                className={`${styles.spinner} ${styles.spinnerSmall}`}
                aria-hidden="true"
              />
              Reading ActiveCampaign…
            </>
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
          untouched since the pipeline wrote it, the right sender for its list,
          a working footer and links, and not already sent. Approving schedules
          the send for about two minutes later.
        </p>
        {testTo && (
          <p className={adminStyles.sectionHint}>
            Send test emails an issue to you alone ({testTo}), exactly as
            subscribers will get it but with “TEST:” in front of the subject, so
            you can read it and try the links first. Clicks from this browser
            aren’t counted while you’re signed in. Don’t use the unsubscribe
            links in a test copy.
          </p>
        )}
        {/* The first read takes several seconds; say so where the drafts
            will appear, not only in the small line at the top (Bryce, 16
            Sept 2026: "make this more obvious"). */}
        {!data && loading && !loadError && (
          <div className={styles.loading} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            <div>
              <strong>Reading ActiveCampaign…</strong>
              <span className={styles.loadingNote}>
                Drafts waiting for approval and recent sends appear here in a
                few seconds.
              </span>
            </div>
          </div>
        )}
        {data && data.drafts.length === 0 && !loading && (
          <p className={styles.notice}>
            Nothing waiting. A draft appears here when the pipeline finishes an
            issue.
          </p>
        )}
        {data?.drafts.map(draft => {
          const ok = draft.problems.length === 0 && draft.listId != null
          const approvable =
            ok && draft.blocks.length === 0 && !draft.alreadySent
          const unsaved = unsavedId === draft.id
          const result = testResult?.draftId === draft.id ? testResult : null
          return (
            <div key={draft.id} className={adminStyles.editorBlock}>
              <div className={adminStyles.editorBlockHeader}>
                <h3 className={adminStyles.editorBlockTitle}>{draft.name}</h3>
                <span
                  className={approvable ? styles.statusOk : styles.statusBad}
                >
                  {draft.alreadySent
                    ? 'Already sent'
                    : approvable
                      ? 'Verified'
                      : 'Cannot send'}
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
              {draft.alreadySent && (
                <p className={`${styles.noticeError} ${styles.testResult}`}>
                  Already sent as campaign {draft.alreadySent.campaignId} (
                  {draft.alreadySent.status}). Approving it again would send it
                  twice, so Approve stays off.
                </p>
              )}
              {(draft.problems.length > 0 || draft.blocks.length > 0) && (
                <ul className={styles.problems}>
                  {[...draft.problems, ...draft.blocks].map(p => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              {draft.warnings.length > 0 && (
                <div className={styles.warnings}>
                  <p className={styles.warningsTitle}>
                    To check before sending (you’ll tick these when you
                    approve):
                  </p>
                  <WarningItems items={draft.warnings} />
                </div>
              )}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => togglePreview(draft.id)}
                >
                  {previewId === draft.id ? 'Hide preview' : 'Preview'}
                </button>
                {data.canSend && testTo && (
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => void sendTest(draft)}
                    disabled={
                      !ok || testingId != null || busyId != null || unsaved
                    }
                    title={
                      unsaved
                        ? 'Waits for your edits to save'
                        : `Sends this issue to ${testTo} only`
                    }
                  >
                    {testingId === draft.id ? 'Sending test…' : 'Send test'}
                  </button>
                )}
                {data.canSend && (
                  <button
                    type="button"
                    className={styles.buttonPrimary}
                    onClick={() => setConfirming(draft)}
                    disabled={
                      !approvable ||
                      busyId != null ||
                      unsaved ||
                      testingId === draft.id
                    }
                    title={unsaved ? 'Waits for your edits to save' : undefined}
                  >
                    {busyId === draft.id ? 'Scheduling…' : 'Approve & send'}
                  </button>
                )}
              </div>
              {result && (
                <p
                  className={`${
                    result.kind === 'ok' ? styles.noticeOk : styles.noticeError
                  } ${styles.testResult}`}
                  role="status"
                  aria-live="polite"
                >
                  {result.text}
                  {result.edited &&
                    ' You’ve edited the issue since, so send another test to see the changes.'}
                </p>
              )}
              {/* The preview brings the reorder panel with it (approvers only;
                  no separate button — Bryce, 11 Sept 2026). */}
              {previewId === draft.id && (
                <div className={styles.previewRow}>
                  {data.canSend && draft.cards && draft.editable && (
                    <div className={styles.reorderSide}>
                      <ReorderPanel
                        key={draft.id}
                        draft={draft}
                        onSaved={(cards, text) =>
                          draftChanged(draft.id, cards, text)
                        }
                        onUnsavedChange={pending =>
                          setUnsavedId(id =>
                            pending ? draft.id : id === draft.id ? null : id
                          )
                        }
                      />
                    </div>
                  )}
                  <iframe
                    ref={previewFrame}
                    title={`Preview of ${draft.subject}`}
                    className={styles.previewFrame}
                    // Links in the email open in a new, ordinary tab (the
                    // preview sets <base target="_blank">). The only script
                    // is the preview's own scroll keeper (the route's CSP
                    // allows nothing else); no allow-same-origin, so it
                    // can't reach this page.
                    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                    src={`/api/admin/newsletter/preview?draft=${draft.id}${
                      draft.messageId ? `&m=${draft.messageId}` : ''
                    }&v=${previewNonce}#y=${previewY}`}
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
        {!data && loading && !loadError && (
          <p className={styles.notice}>
            <span
              className={`${styles.spinner} ${styles.spinnerSmall}`}
              aria-hidden="true"
            />
            Reading ActiveCampaign…
          </p>
        )}
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
                <th>Clicks</th>
                <th>Unsubs</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map(r => [
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className={styles.muted}>
                    {r.listNames.join(', ') || '—'}
                  </td>
                  <td>
                    {r.status === 'sent' ? (
                      <span className={styles.statusOk}>sent</span>
                    ) : r.status === 'stopped' || r.status === 'disabled' ? (
                      <span className={styles.statusBad}>{r.status}</span>
                    ) : r.status === 'held' ? (
                      <span title="ActiveCampaign is reviewing this send; it goes out once they approve it">
                        held for review
                      </span>
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
                  <td>
                    {r.clicks.total > 0 ? (
                      <button
                        type="button"
                        className={styles.rowButton}
                        aria-expanded={openClicks === r.id}
                        title="Which links were clicked"
                        onClick={() =>
                          setOpenClicks(openClicks === r.id ? null : r.id)
                        }
                      >
                        {r.clicks.total}
                      </button>
                    ) : (
                      <span className={styles.muted}>0</span>
                    )}
                  </td>
                  <td className={styles.muted}>{r.unsubscribes ?? '—'}</td>
                </tr>,
                openClicks === r.id && (
                  <tr key={`${r.id}-clicks`}>
                    <td colSpan={8} className={styles.clicksCell}>
                      <ol className={styles.clicksList}>
                        {r.clicks.links.map(l => (
                          <li key={l.url} className={styles.clicksRow}>
                            <span className={styles.clicksCount}>
                              {l.clicks}
                            </span>
                            <span>{l.label}</span>
                            <a
                              href={l.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.muted}
                            >
                              {hostOf(l.url)}
                            </a>
                          </li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                ),
              ])}
            </tbody>
          </table>
        )}
      </div>

      {confirming && (
        <ConfirmSend
          // New warnings (after a refused approval) start with no ticks.
          key={confirming.warnings.map(w => w.id).join(' ')}
          draft={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={confirmed => void send(confirming, confirmed)}
        />
      )}
    </div>
  )
}

const keysOf = (groups: CardGroup[]) => groups.map(g => g.cards.map(c => c.key))

/** Drag-and-drop ordering of a draft's cards, one list per section (a card
 *  never leaves its section). Saving rewrites the draft inside
 *  ActiveCampaign; nothing is sent. Arrow keys on a focused row are the
 *  keyboard route (Bryce, 11 Sept 2026: no visible arrow buttons). Funding
 *  rows also open an editor for the card's "Consider applying if" line
 *  (Bryce, 16 Sept 2026); that saves on its own, straight into the draft. */
function ReorderPanel({
  draft,
  onSaved,
  onUnsavedChange,
}: {
  draft: Draft
  onSaved: (cards: CardGroup[], notice: string) => void
  /** True while something here isn't in the draft yet; the page holds Send
   *  test and Approve & send back until it is. */
  onUnsavedChange: (unsaved: boolean) => void
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
  /** The card open in the editor, and the text in its boxes. */
  const [editing, setEditing] = useState<{ gid: string; key: string } | null>(
    null
  )
  const [values, setValues] = useState<Record<string, string>>({})
  const [fitText, setFitText] = useState('')
  const [savingCard, setSavingCard] = useState(false)
  const [cardError, setCardError] = useState<string | null>(null)
  /** At least one save went through since the editor opened. */
  const [savedOnce, setSavedOnce] = useState(false)
  /** The last "put this description on the site" for the open card. */
  const [listing, setListing] = useState<{
    key: string
    text: string
    status: 'saving' | 'done' | { error: string }
  } | null>(null)
  /** The save in flight (text saves itself — Bryce, 25 Sept 2026 — so a
   *  second one waits for it rather than racing it). */
  const inFlight = useRef<Promise<boolean> | null>(null)
  const editable = groups.some(g =>
    g.cards.some(c => c.fields.length > 0 || c.fit !== null)
  )

  // Chrome doesn't always fire dragend on a row React moved in the DOM while
  // it was being dragged, which left that row dimmed after the drop (Bryce,
  // 16 Sept 2026). So any end of a drag clears the state: dragend or a drop
  // anywhere in the window, the first mouse movement afterwards (no mouse
  // events arrive during a drag), or a second without a dragover (the
  // browser fires one every ~350 ms for as long as a drag is in progress).
  useEffect(() => {
    if (!drag) return
    const clear = () => setDrag(null)
    let timer = window.setTimeout(clear, 1000)
    const tick = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(clear, 1000)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    window.addEventListener('mousemove', clear)
    window.addEventListener('dragover', tick)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
      window.removeEventListener('mousemove', clear)
      window.removeEventListener('dragover', tick)
    }
  }, [drag])

  const editingCard =
    (editing &&
      groups
        .find(g => g.id === editing.gid)
        ?.cards.find(c => c.key === editing.key)) ||
    null

  /** The boxes that differ from the card as saved. */
  function changesFor(card: CardInfo) {
    const fields: Record<string, string> = {}
    for (const f of card.fields) {
      const v = (values[f.name] ?? f.value).replace(/\s+/g, ' ').trim()
      if (v !== f.value) fields[f.name] = v
    }
    const fit =
      card.fit !== null && fitText.trim() !== card.fit.trim()
        ? fitText.trim()
        : undefined
    return { fields, fit }
  }

  const pending = editingCard ? changesFor(editingCard) : null
  const pendingKey =
    pending &&
    (Object.keys(pending.fields).length > 0 || pending.fit !== undefined)
      ? JSON.stringify(pending)
      : ''
  const emptyField =
    (editingCard &&
      pending &&
      editingCard.fields.find(
        f => f.name in pending.fields && !pending.fields[f.name]
      )) ||
    null

  /** Write the open card's changed text into the draft. Resolves true when
   *  there was nothing to save or the save went through. */
  async function saveCard(): Promise<boolean> {
    if (inFlight.current) await inFlight.current
    if (!editing || !editingCard) return true
    const { fields, fit } = changesFor(editingCard)
    if (Object.keys(fields).length === 0 && fit === undefined) return true
    if (emptyField) return false
    const gid = editing.gid
    const key = editing.key
    const run = (async () => {
      setSavingCard(true)
      setCardError(null)
      try {
        const res = await fetch('/api/admin/newsletter/card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign: draft.id,
            message: draft.messageId ?? undefined,
            group: gid,
            key,
            fields,
            ...(fit !== undefined ? { fit } : {}),
          }),
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
        // The saved text becomes the card's baseline; what's in the boxes
        // stays (it may already be ahead of this save), and any unsaved drag
        // order stays too.
        const saved = new Map(
          body.cards.flatMap(g => g.cards.map(c => [`${g.id}:${c.key}`, c]))
        )
        setGroups(gs =>
          gs.map(g => ({
            ...g,
            cards: g.cards.map(c => {
              const s = saved.get(`${g.id}:${c.key}`)
              return s
                ? {
                    ...c,
                    title: s.title,
                    fit: s.fit,
                    pipelineFit: s.pipelineFit,
                    fields: s.fields,
                  }
                : c
            }),
          }))
        )
        setSavedOnce(true)
        onSaved(body.cards, '')
        return true
      } catch (err) {
        setCardError(err instanceof Error ? err.message : String(err))
        return false
      } finally {
        setSavingCard(false)
      }
    })()
    inFlight.current = run
    const ok = await run
    inFlight.current = null
    return ok
  }

  // Saves itself a moment after the typing stops (and at once when a box
  // loses focus, below). The ref holds this render's saveCard, so the timer
  // always saves what's in the boxes now.
  const saveRef = useRef(saveCard)
  useEffect(() => {
    saveRef.current = saveCard
  })
  useEffect(() => {
    if (!pendingKey || savingCard || emptyField) return
    const timer = window.setTimeout(
      () => void saveRef.current(),
      AUTOSAVE_DELAY_MS
    )
    return () => window.clearTimeout(timer)
  }, [pendingKey, savingCard, emptyField])

  async function openEditor(gid: string, card: CardInfo) {
    if (!(await saveCard())) return
    setEditing({ gid, key: card.key })
    setValues(Object.fromEntries(card.fields.map(f => [f.name, f.value])))
    setFitText(card.fit ?? '')
    setCardError(null)
    setSavedOnce(false)
    setListing(null)
  }

  async function closeEditor() {
    if (await saveCard()) setEditing(null)
  }

  /** "Put this description on the site too": the listing's Description in
   *  Airtable gets the text in the box (Bryce decides each time). */
  async function pushListing(gid: string, card: CardInfo) {
    const text = (values.desc ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return
    setListing({ key: card.key, text, status: 'saving' })
    try {
      const res = await fetch('/api/admin/newsletter/card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign: draft.id,
          group: gid,
          key: card.key,
          listing: text,
        }),
      })
      const body = (await res.json()) as {
        error?: string
        listing?: { ok: true } | { ok: false; reason: string }
      }
      if (!res.ok || !body.listing)
        throw new Error(body.error ?? `HTTP ${res.status}`)
      setListing({
        key: card.key,
        text,
        status: body.listing.ok ? 'done' : { error: body.listing.reason },
      })
    } catch (err) {
      setListing({
        key: card.key,
        text,
        status: { error: err instanceof Error ? err.message : String(err) },
      })
    }
  }

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

  /** Write the current card order into the draft (moves save themselves —
   *  Bryce, 25 Sept 2026 — so there is no Save order button). Waits for a
   *  text save in flight; keeps the order on screen as it is, so a card
   *  moved while this was saving is saved next. */
  async function saveOrder(): Promise<boolean> {
    if (inFlight.current) await inFlight.current
    const order = Object.fromEntries(
      groups.map(g => [g.id, g.cards.map(c => c.key)])
    )
    const run = (async () => {
      setSaving(true)
      setError(null)
      try {
        const res = await fetch('/api/admin/newsletter/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign: draft.id,
            message: draft.messageId ?? undefined,
            order,
          }),
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
        onSaved(body.cards, '')
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return false
      } finally {
        setSaving(false)
      }
    })()
    inFlight.current = run
    const ok = await run
    inFlight.current = null
    return ok
  }

  // ActiveCampaign sometimes takes 10+ seconds a request; say so rather than
  // leave "Saving…" looking stuck.
  const busy = saving || savingCard
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!busy) {
      setSlow(false)
      return
    }
    const timer = window.setTimeout(() => setSlow(true), 6000)
    return () => window.clearTimeout(timer)
  }, [busy])
  const slowNote = slow ? ' ActiveCampaign is answering slowly right now.' : ''

  // Typed text waiting for its autosave, a moved card, or a save in flight:
  // a test copy or an approval sent now would go out without it, so the page
  // waits. Cleared when the panel closes.
  const unsaved = Boolean(pendingKey) || dirty || saving || savingCard
  const unsavedRef = useRef(onUnsavedChange)
  useEffect(() => {
    unsavedRef.current = onUnsavedChange
  })
  useEffect(() => {
    unsavedRef.current(unsaved)
  }, [unsaved])
  useEffect(() => () => unsavedRef.current(false), [])

  const saveOrderRef = useRef(saveOrder)
  useEffect(() => {
    saveOrderRef.current = saveOrder
  })
  const orderKey = JSON.stringify(keysOf(groups))
  useEffect(() => {
    // Not mid-drag, not while a save runs, and only when the order on screen
    // differs from the draft's.
    if (!dirty || drag || saving || savingCard || error) return
    const timer = window.setTimeout(
      () => void saveOrderRef.current(),
      ORDER_SAVE_DELAY_MS
    )
    return () => window.clearTimeout(timer)
  }, [orderKey, dirty, drag, saving, savingCard, error])

  return (
    <div className={styles.reorder}>
      <p className={adminStyles.sectionHint}>
        Drag a listing to move it. Cards stay within their section.
        {editable && ' Edit changes any text on a card.'} Everything saves into
        the draft by itself and the preview updates; nothing is sent.
      </p>
      {groups.map(g => (
        <div key={g.id} className={styles.reorderGroup}>
          {groups.length > 1 && (
            <div className={styles.reorderGroupLabel}>{g.label}</div>
          )}
          <ol className={styles.reorderList}>
            {g.cards.map((c, i) => {
              const open = editing?.gid === g.id && editing.key === c.key
              const edited =
                (c.pipelineFit != null && c.fit !== c.pipelineFit) ||
                c.fields.some(f => f.original !== null)
              return [
                <li
                  key={c.key}
                  className={`${styles.reorderRow}${
                    drag?.gid === g.id && drag.key === c.key
                      ? ` ${styles.reorderRowDragging}`
                      : ''
                  }`}
                  draggable={!open}
                  tabIndex={0}
                  aria-label={`${c.title}, position ${i + 1} of ${g.cards.length}. Arrow keys move it.`}
                  onKeyDown={e => {
                    if (e.key === 'ArrowUp' && i > 0) {
                      e.preventDefault()
                      move(g.id, i, i - 1)
                    } else if (
                      e.key === 'ArrowDown' &&
                      i < g.cards.length - 1
                    ) {
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
                  <span className={styles.reorderTitle}>
                    {c.title}
                    {edited && !open && (
                      <span className={styles.rowEdited}> · edited</span>
                    )}
                  </span>
                  {(c.fields.length > 0 || c.fit !== null) && (
                    <button
                      type="button"
                      className={styles.rowButton}
                      disabled={saving}
                      aria-expanded={open}
                      onClick={() =>
                        void (open ? closeEditor() : openEditor(g.id, c))
                      }
                    >
                      {open ? 'Close' : 'Edit'}
                    </button>
                  )}
                </li>,
                open && (
                  <li key={`${c.key}-edit`} className={styles.fitEditor}>
                    {c.fields.map((f, n) => {
                      const v = values[f.name] ?? f.value
                      const vPlain = v.replace(/\s+/g, ' ').trim()
                      const onSite =
                        listing?.key === c.key && listing.text === vPlain
                          ? listing.status
                          : null
                      return (
                        <div key={f.name} className={styles.fieldBlock}>
                          <label className={styles.fitLabel}>
                            {f.label}
                            <textarea
                              className={`${styles.fitTextarea} ${
                                f.name === 'desc' ? '' : styles.fieldShort
                              }`}
                              value={v}
                              rows={
                                f.name === 'desc'
                                  ? 6
                                  : f.name === 'title'
                                    ? 2
                                    : 1
                              }
                              autoFocus={n === 0}
                              onChange={e =>
                                setValues(vs => ({
                                  ...vs,
                                  [f.name]: e.target.value,
                                }))
                              }
                              onBlur={() => void saveCard()}
                            />
                          </label>
                          {f.hasLink && (
                            <p className={styles.notice}>
                              This text has a link in it; editing it here drops
                              the link.
                            </p>
                          )}
                          {f.original !== null &&
                            vPlain !== f.original.trim() && (
                              <div className={styles.fieldActions}>
                                <button
                                  type="button"
                                  className={styles.rowButton}
                                  title={f.original}
                                  onClick={() =>
                                    setValues(vs => ({
                                      ...vs,
                                      [f.name]: f.original ?? '',
                                    }))
                                  }
                                >
                                  Pen’s text
                                </button>
                              </div>
                            )}
                          {f.name === 'desc' &&
                            RECORD_KEY_RE.test(c.key) &&
                            (f.original !== null || vPlain !== f.value) &&
                            (onSite === 'done' ? (
                              <p className={styles.noticeOk}>
                                ✓ The site’s listing has this description now
                                (it shows there in two or three minutes).
                              </p>
                            ) : (
                              <div className={styles.fieldActions}>
                                <button
                                  type="button"
                                  className={styles.rowButton}
                                  disabled={!vPlain || onSite === 'saving'}
                                  onClick={() => void pushListing(g.id, c)}
                                >
                                  {onSite === 'saving'
                                    ? 'Updating the site…'
                                    : 'Use this description on the site too'}
                                </button>
                                {onSite && typeof onSite === 'object' && (
                                  <span className={styles.noticeError}>
                                    Site not updated: {onSite.error}
                                  </span>
                                )}
                              </div>
                            ))}
                        </div>
                      )
                    })}
                    {c.fit !== null && (
                      <div className={styles.fieldBlock}>
                        <label className={styles.fitLabel}>
                          Consider applying if
                          <textarea
                            className={styles.fitTextarea}
                            value={fitText}
                            rows={4}
                            autoFocus={c.fields.length === 0}
                            onChange={e => setFitText(e.target.value)}
                            onBlur={() => void saveCard()}
                          />
                        </label>
                        {c.pipelineFit != null &&
                          fitText.trim() !== c.pipelineFit.trim() && (
                            <div className={styles.fieldActions}>
                              <button
                                type="button"
                                className={styles.rowButton}
                                title={
                                  c.pipelineFit ||
                                  'Pen wrote no line for this card'
                                }
                                onClick={() => setFitText(c.pipelineFit ?? '')}
                              >
                                Pen’s text
                              </button>
                            </div>
                          )}
                      </div>
                    )}
                    <p
                      className={
                        cardError || emptyField
                          ? styles.noticeError
                          : styles.notice
                      }
                      role="status"
                      aria-live="polite"
                    >
                      {cardError
                        ? `Not saved: ${cardError}`
                        : emptyField
                          ? `Not saved yet: the ${emptyField.label.toLowerCase()} can’t be empty.`
                          : savingCard
                            ? `Saving…${slowNote}`
                            : pendingKey
                              ? 'Saves when you pause typing.'
                              : savedOnce
                                ? 'All changes saved to the draft.'
                                : 'Changes save by themselves as you type.'}
                    </p>
                  </li>
                ),
              ]
            })}
          </ol>
        </div>
      ))}
      {(error || saving || dirty) && (
        <p
          className={error ? styles.noticeError : styles.notice}
          role="status"
          aria-live="polite"
        >
          {error ? (
            <>
              Order not saved: {error}{' '}
              <button
                type="button"
                className={styles.rowButton}
                onClick={() => {
                  setError(null)
                  void saveOrder()
                }}
              >
                Try again
              </button>
            </>
          ) : saving ? (
            `Saving the new order…${slowNote}`
          ) : (
            'The new order saves in a moment.'
          )}
        </p>
      )}
    </div>
  )
}

/** The warnings as a list; an edit shows the text as Pen wrote it → now. */
function WarningItems({ items }: { items: SendWarning[] }) {
  return (
    <ul className={styles.warningList}>
      {items.map(w => (
        <li key={w.id}>
          {w.text}
          {w.from != null && w.to != null && (
            <span className={styles.warningChange}>
              “{w.from}” → “{w.to}”
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** In-page confirmation for the one irreversible action on this page. Any
 *  warnings are grouped by kind, and each group needs its own tick before
 *  the send button works. */
function ConfirmSend({
  draft,
  onCancel,
  onConfirm,
}: {
  draft: Draft
  onCancel: () => void
  /** With the ids of every warning, once each group has been ticked. */
  onConfirm: (confirmed: string[]) => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  /** One tick per kind of warning (the server checks every id came back). */
  const groups = WARNING_GROUPS.map(g => ({
    ...g,
    items: draft.warnings.filter(w => w.kind === g.kind),
  })).filter(g => g.items.length > 0)
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())
  const allTicked = groups.every(g => ticked.has(g.kind))
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
        {groups.length > 0 && (
          <div className={styles.dialogChecks}>
            {groups.map(g => (
              <fieldset key={g.kind} className={styles.dialogCheck}>
                <legend>{g.title}</legend>
                <WarningItems items={g.items} />
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={ticked.has(g.kind)}
                    onChange={e =>
                      setTicked(t => {
                        const next = new Set(t)
                        if (e.target.checked) next.add(g.kind)
                        else next.delete(g.kind)
                        return next
                      })
                    }
                  />
                  I’ve checked {g.items.length === 1 ? 'this' : 'these'}
                </label>
              </fieldset>
            ))}
          </div>
        )}
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
            onClick={() => onConfirm(draft.warnings.map(w => w.id))}
            disabled={!allTicked}
            title={allTicked ? undefined : 'Tick the checks above first'}
          >
            Send to {who}
          </button>
        </div>
      </div>
    </div>
  )
}
