'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import adminStyles from '../admin.module.css'
import styles from './newsletter.module.css'
import NewsletterAlerts from './NewsletterAlerts'

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
  /** The issue already went (or is going) to this list as that campaign:
   *  to the whole list, or every one of its waves. */
  alreadySent: { campaignId: string; status: string } | null
  /** The list's warm-up waves and how far this issue has got; null when
   *  the list has none (it can only go out whole). */
  waves: WavePlan | null
  /** Minutes between approval and the send on this list. */
  sendDelayMinutes: number
  /** Card edits can be saved into it from this copy of the site (real
   *  lists only from aisafety.com itself). */
  editable: boolean
  /** It can be deleted from this copy of the site (the same rule). */
  deletable: boolean
  /** Why card edits are off just now (a wave sharing its email is going
   *  out). */
  editLock: string | null
  /** The inbox preview line (hidden preheader), as Gmail shows it. */
  preview: string | null
  /** Cards by section, current order; null for drafts built before the
   *  renderer stamped card markers (no Reorder button then). */
  cards: CardGroup[] | null
}

/** Something to look at before sending: leftover words (TEST, TODO…) or a
 *  date already past. */
interface SendWarning {
  /** Sent back when ticked; the server checks every current one was. */
  id: string
  kind: 'words' | 'date'
  text: string
}

/** One wave of the list (see WavePlan in src/lib/admin/newsletter.ts). */
interface WaveInfo {
  wave: number
  waves: number
  label: string
  segmentId: string
  /** Active contacts on this list in the wave now. */
  count: number | null
  /** This issue's send of the wave, once it has gone. */
  sent: {
    campaignId: string
    status: string
    finishedAt: string | null
    sent: number
    bounces: number | null
    unsubscribes: number | null
    verifiedOpens: number | null
    spamComplaints: number | null
    health: 'green' | 'amber' | 'red' | null
  } | null
}

interface WavePlan {
  error: string | null
  waves: WaveInfo[]
  active: number | null
  /** How many this issue has reached on the list so far. */
  reached: number
  next: number | null
  /** The gap after the previous wave ends then (ISO); sooner needs a
   *  typed reason. */
  notBefore: string | null
  /** Other holds a typed reason can override. */
  holds: string[]
  wait: string | null
  blocked: string | null
  wholeList: boolean
}

/** What the Approve button sends: one wave, or the whole list. */
type Choice = number | 'all'

type StopAction = 'cancel' | 'pause' | 'stop' | 'resume'

/** Must match OVERRIDE_MIN_CHARS on the server. */
const OVERRIDE_MIN_CHARS = 10

const WARNING_GROUPS: Array<{ kind: SendWarning['kind']; title: string }> = [
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
  /** When a scheduled send goes out (ISO), for the countdown. */
  scheduledAt: string | null
  sentAt: string | null
  sentTo: number
  uniqueOpens: number | null
  unsubscribes: number | null
  listNames: string[]
  baseName: string
  wave: { wave: number; waves: number } | null
  /** Named as a wave, but ActiveCampaign holds no segment for it: it goes
   *  (or went) to the whole list. */
  segmentLost: boolean
  /** Rows of one issue on one list share it (they come next to each
   *  other) and are shown together. */
  group: string
  /** Counted on aisafety.com (the links go through /api/nl since 28 Sept
   *  2026); zero for older sends. Per issue: every wave carries the same. */
  clicks: {
    total: number
    links: Array<{ label: string; url: string; clicks: number }>
  }
  /** What an approver may do to it now. */
  actions: StopAction[]
}

/** One newsletter's listings that its next issue would pick up as new
 *  (src/lib/admin/newsletter-lineup.ts). */
type LineupSection =
  | {
      items: Array<{ id: string; name: string }>
      /** "8 September 2026" (Events, Training) or "Issue #22, 2026"
       *  (Funding): what "new" is measured from. */
      since: string
      /** Funding only: closing in the next two weeks (not new). */
      closing?: Array<{ id: string; name: string }>
    }
  | { error: string }

interface Payload {
  fetchedAt: string
  /** This session may approve. Preview-only reviewers get false and no
   *  button; the API refuses them anyway. */
  canSend: boolean
  drafts: Draft[]
  recent: Recent[]
  lineup: Record<'events' | 'training' | 'funding', LineupSection>
}

const LINEUP: Array<{
  key: keyof Payload['lineup']
  label: string
  since: string
}> = [
  { key: 'events', label: 'Events', since: 'added since' },
  { key: 'training', label: 'Training', since: 'added since' },
  { key: 'funding', label: 'Funding', since: 'new since' },
]

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

/** "986 people", "1 person". */
function people(n: number | null): string {
  if (n == null) return 'an unknown number of people'
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'person' : 'people'}`
}

/** What Approve sends unless the approver picks otherwise: the next wave
 *  when the list has waves, else the whole list; null when nothing may go. */
function defaultChoice(d: Draft): Choice | null {
  const p = d.waves
  if (!p || p.error) return 'all'
  if (p.next != null) return p.next
  return p.wholeList ? 'all' : null
}

/** The chosen wave (or the whole list) may be approved now; the server
 *  checks all of it again. Holds (gap, a red verdict) still allow it: the
 *  dialog then asks for a reason. */
function choiceAllowed(d: Draft, choice: Choice | null): boolean {
  const p = d.waves
  if (choice == null) return false
  if (choice === 'all') return p == null || p.wholeList
  return (
    p != null &&
    p.error == null &&
    p.next === choice &&
    p.wait == null &&
    p.blocked == null
  )
}

/** What holds the chosen wave at `now`: the gap after the previous wave,
 *  if it hasn't passed, then the server's other holds. */
function holdsFor(d: Draft, choice: Choice | null, now: number): string[] {
  const p = d.waves
  if (!p || typeof choice !== 'number') return []
  const gap =
    p.notBefore && now < Date.parse(p.notBefore)
      ? [
          `wave ${choice - 1} finished less than 18 hours ago; wave ${choice} is due from ${when(p.notBefore)}`,
        ]
      : []
  return [...gap, ...p.holds]
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
  /** The draft a test copy is on its way for, and how the last copy of each
   *  draft went, so testing one issue leaves the others' ticks alone (Bryce,
   *  2 Oct 2026). `edited` = the draft has changed since that copy went out. */
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<
    Record<string, { kind: 'ok' | 'error'; text: string; edited?: boolean }>
  >({})
  /** The draft with edits not yet written into it (typed text, a moved card,
   *  a save in flight): a test or an approval now would go without them. */
  const [unsavedId, setUnsavedId] = useState<string | null>(null)
  /** The confirm dialog: the draft, what it goes to, and what holds that
   *  wave (the dialog then asks for a reason to send it anyway). */
  const [confirming, setConfirming] = useState<{
    draft: Draft
    choice: Choice
    holds: string[]
  } | null>(null)
  /** The wave (or 'all') picked on each draft; unset = defaultChoice. */
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  /** The Recent sends row whose Stop dialog is open, and the one whose
   *  action is on its way. */
  const [stopping, setStopping] = useState<{
    row: Recent
    action: StopAction
  } | null>(null)
  const [stopBusyId, setStopBusyId] = useState<string | null>(null)
  /** The draft whose Delete dialog is open, and the one being deleted. */
  const [deleting, setDeleting] = useState<Draft | null>(null)
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null)
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
  async function send(
    draft: Draft,
    choice: Choice,
    confirmed: string[],
    override: string | null
  ) {
    if (!draft.listId) return
    const wave =
      typeof choice === 'number'
        ? draft.waves?.waves.find(w => w.wave === choice)
        : undefined
    if (typeof choice === 'number' && !wave) return
    setConfirming(null)
    setBusyId(draft.id)
    setNotice(null)
    let res: Response | null = null
    let body: {
      error?: string
      problems?: string[]
      campaignId?: string
      name?: string
      sendAt?: string
      expected?: number | null
      held?: boolean
      sendingNow?: boolean
      approver?: string
      draftKept?: boolean
      wave?: number | null
      notes?: string[]
      needsConfirmation?: boolean
      warnings?: SendWarning[]
      needsOverride?: boolean
      holds?: string[]
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
          ...(wave
            ? { wave: { segment: wave.segmentId, k: wave.wave, n: wave.waves } }
            : {}),
          ...(override ? { override } : {}),
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
      const what = `“${body.name ?? draft.name}” (${people(body.expected ?? null)})`
      setNotice({
        kind: 'ok',
        text:
          (body.held
            ? `Approved${by}. ActiveCampaign is holding ${what} for its own review first (campaign ${body.campaignId}) – it goes out once they approve it. Don’t approve it again.`
            : body.sendingNow
              ? `Approved${by}. ActiveCampaign started sending ${what} straight away (campaign ${body.campaignId}), not at ${when(body.sendAt ?? null)}, so it can’t be canceled – only paused or stopped under Recent sends.`
              : `Approved${by}. ${what} is scheduled to send at ${when(body.sendAt ?? null)} (campaign ${body.campaignId}). You can cancel it under Recent sends until then.`) +
          (body.draftKept && body.wave != null
            ? ` The draft stays here for wave ${body.wave + 1}.`
            : '') +
          (body.notes?.length ? ` ${body.notes.join(' ')}` : ''),
      })
      if (previewId === draft.id && !body.draftKept) setPreviewId(null)
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
      setConfirming({
        draft: next,
        choice,
        holds: holdsFor(next, choice, Date.now()),
      })
      return
    } else if (res?.status === 409 && body.needsOverride && body.holds) {
      // The wave is held (the gap, a red verdict) and no reason came with
      // it: ask for one, showing what the server holds it for.
      setNotice({
        kind: 'error',
        text: 'Not sent: this wave is held. Wait until it’s due, or give a reason to send it anyway.',
      })
      setBusyId(null)
      setConfirming({ draft, choice, holds: body.holds })
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
    // Approve stays off until the lists are read again: until then the page
    // still shows the draft (or its wave) as it was before this answer.
    await load()
    setBusyId(null)
  }

  /** Mail the draft to the signed-in approver alone (ActiveCampaign's test
   *  send), so it can be read and clicked through in a real inbox first. */
  async function sendTest(draft: Draft) {
    setTestingId(draft.id)
    setTestResults(rs => {
      const rest = { ...rs }
      delete rest[draft.id]
      return rest
    })
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
      setTestResults(rs => ({
        ...rs,
        [draft.id]: {
          kind: 'ok',
          text: `Test sent to ${body.to} only. It arrives in a minute or two as “TEST: ${draft.subject}”.`,
        },
      }))
    } catch (err) {
      setTestResults(rs => ({
        ...rs,
        [draft.id]: {
          kind: 'error',
          text: `Test not sent: ${err instanceof Error ? err.message : String(err)}`,
        },
      }))
    } finally {
      setTestingId(null)
    }
  }

  /** Delete a draft (after the dialog). The lists are read again either
   *  way, so the page shows whether it went. */
  async function removeDraft(draft: Draft) {
    setDeleting(null)
    setDeleteBusyId(draft.id)
    setNotice(null)
    let res: Response | null = null
    let body: { error?: string; problems?: string[]; deleted?: boolean } = {}
    try {
      res = await fetch('/api/admin/newsletter/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign: draft.id }),
      })
      body = await res.json().catch(() => ({}))
    } catch {
      res = null
    }
    if (res?.ok) {
      setNotice({
        kind: 'ok',
        text: body.deleted
          ? `Deleted the draft “${draft.name}”.`
          : `The draft “${draft.name}” was already gone.`,
      })
      if (previewId === draft.id) setPreviewId(null)
    } else {
      setNotice({
        kind: 'error',
        text: res
          ? `Not deleted: ${
              body.problems?.length
                ? body.problems.join('; ')
                : (body.error ?? `HTTP ${res.status}`)
            }`
          : 'No answer came back, so it may or may not have been deleted. The list above updates by itself.',
      })
    }
    await load()
    setDeleteBusyId(null)
  }

  /** Cancel, pause, stop or resume a send from Recent sends (after the
   *  dialog). Only an answer that says so counts as done or refused; no
   *  answer may mean it worked, so the page says to look and rereads. */
  async function stopSend(row: Recent, action: StopAction) {
    setStopping(null)
    setStopBusyId(row.id)
    setNotice(null)
    let res: Response | null = null
    let body: {
      error?: string
      draftWaiting?: boolean | null
      uncertain?: boolean
    } = {}
    try {
      res = await fetch('/api/admin/newsletter/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign: row.id, action }),
      })
      body = await res.json().catch(() => ({}))
    } catch {
      res = null
    }
    if (res?.status === 401 && body.error === 'reauth') {
      window.location.assign('/api/admin/auth/google?next=/admin/newsletter')
      return
    }
    if (res?.ok) {
      const name = `“${row.name}”`
      setNotice({
        kind: 'ok',
        text:
          action === 'cancel'
            ? `Canceled ${name}: nobody gets it.${
                body.draftWaiting === true
                  ? ' Its draft is still waiting above, so it can be approved again.'
                  : body.draftWaiting === false
                    ? ' Its draft went when it was approved, so rebuild the issue to send it again.'
                    : ''
              }`
            : action === 'pause'
              ? `Paused ${name}. Stop it for good or resume it under Recent sends.`
              : action === 'stop'
                ? `Stopped ${name} for good. People who already got it keep it.`
                : `Resumed ${name}: it’s sending again.`,
      })
    } else {
      setNotice({
        kind: 'error',
        text: res
          ? (body.error ?? `HTTP ${res.status}`)
          : 'No answer came back, so it may or may not have worked. Recent sends updates by itself: check it there.',
      })
    }
    // The buttons stay off until Recent sends is read again, so a canceled
    // send never offers "Cancel" a second time.
    await load()
    setStopBusyId(null)
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
    setTestResults(rs => {
      const t = rs[draftId]
      return t?.kind === 'ok'
        ? { ...rs, [draftId]: { ...t, edited: true } }
        : rs
    })
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
      <NewsletterAlerts />

      {canSend && (
        <div className={`${adminStyles.notice} ${styles.liveWarning}`}>
          <strong>This sends real emails.</strong> Approving schedules an issue,
          or one wave of it, to go out five minutes later (two on the test
          lists). Until then you can cancel it under Recent sends; while it’s
          sending you can pause or stop it there. Emails already delivered can’t
          be recalled. Use with caution.
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
          <h2 className={adminStyles.editorBlockTitle}>Lined up</h2>
        </div>
        <p className={adminStyles.sectionHint}>
          What Pen would pick up if it drafted each newsletter now. Listings
          already in a draft waiting below aren’t counted.
        </p>
        <div className={styles.lineup}>
          {LINEUP.map(({ key, label, since }) => {
            const section = data?.lineup[key]
            return (
              <div key={key} className={styles.lineupTile}>
                <span className={styles.lineupLabel}>{label}</span>
                {!section ? (
                  <span className={styles.lineupCount}>—</span>
                ) : 'error' in section ? (
                  <span className={styles.noticeError}>{section.error}</span>
                ) : (
                  <LineupCounts section={section} since={since} />
                )}
              </div>
            )
          })}
        </div>
      </div>

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
          a working footer and links, and not already sent. During the warm-up a
          big list goes out in waves, one at a time, at least 18 hours apart:
          the draft stays here until its last wave.
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
          const clean = ok && draft.blocks.length === 0 && !draft.alreadySent
          // A pick that no longer fits (its wave went out) gives way to the
          // default: the next wave.
          const picked = choices[draft.id]
          const choice =
            picked != null && choiceAllowed(draft, picked)
              ? picked
              : defaultChoice(draft)
          const approvable = clean && choiceAllowed(draft, choice)
          const waiting = clean && !approvable && draft.waves?.wait != null
          const held =
            approvable &&
            holdsFor(draft, choice, Date.parse(data.fetchedAt)).length > 0
          const unsaved = unsavedId === draft.id
          const result = testResults[draft.id] ?? null
          return (
            <div key={draft.id} className={adminStyles.editorBlock}>
              <div className={adminStyles.editorBlockHeader}>
                <h3 className={adminStyles.editorBlockTitle}>{draft.name}</h3>
                <span
                  className={
                    held || waiting
                      ? styles.statusWait
                      : approvable
                        ? styles.statusOk
                        : styles.statusBad
                  }
                >
                  {draft.alreadySent
                    ? 'Already sent'
                    : held
                      ? `Wave ${choice} held`
                      : approvable
                        ? 'Verified'
                        : waiting
                          ? 'Next wave waiting'
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
              {draft.waves && (
                <WavePicker
                  draftId={draft.id}
                  plan={draft.waves}
                  choice={choice}
                  canChoose={data.canSend && clean}
                  onChoose={c => setChoices(cs => ({ ...cs, [draft.id]: c }))}
                  now={Date.parse(data.fetchedAt)}
                />
              )}
              {draft.editLock && (
                <p className={`${styles.notice} ${styles.testResult}`}>
                  {draft.editLock}.
                </p>
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
                    {testingId === draft.id ? (
                      'Sending test…'
                    ) : (
                      <>
                        Send test
                        {/* A test of the issue as it is now went out (Bryce,
                            30 Sept 2026); an edit since takes the tick away. */}
                        {result?.kind === 'ok' && !result.edited && (
                          <span className={styles.sentTick}> ✓</span>
                        )}
                      </>
                    )}
                  </button>
                )}
                {data.canSend && (
                  <button
                    type="button"
                    className={styles.buttonPrimary}
                    onClick={() =>
                      choice != null &&
                      setConfirming({
                        draft,
                        choice,
                        holds: holdsFor(draft, choice, Date.now()),
                      })
                    }
                    disabled={
                      !approvable ||
                      busyId != null ||
                      unsaved ||
                      testingId === draft.id
                    }
                    title={unsaved ? 'Waits for your edits to save' : undefined}
                  >
                    {busyId === draft.id
                      ? 'Scheduling…'
                      : typeof choice === 'number'
                        ? `Approve wave ${choice}`
                        : 'Approve & send'}
                  </button>
                )}
                {data.canSend && draft.deletable && (
                  <button
                    type="button"
                    className={`${styles.rowButton} ${styles.deleteButton}`}
                    onClick={() => setDeleting(draft)}
                    disabled={
                      busyId != null ||
                      deleteBusyId != null ||
                      testingId === draft.id ||
                      unsaved
                    }
                    title={
                      unsaved
                        ? 'Waits for your edits to save'
                        : 'Delete this draft'
                    }
                  >
                    {deleteBusyId === draft.id ? 'Deleting…' : 'Delete'}
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
              {groupRecent(data.recent).map(rows => (
                <SendRows
                  key={rows[0].group}
                  rows={rows}
                  canSend={data.canSend}
                  openClicks={openClicks}
                  onToggleClicks={key =>
                    setOpenClicks(openClicks === key ? null : key)
                  }
                  stopBusyId={stopBusyId}
                  onStop={(row, action) => setStopping({ row, action })}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirming && (
        <ConfirmSend
          // New warnings or holds (after a refused approval) start afresh.
          key={[
            ...confirming.draft.warnings.map(w => w.id),
            ...confirming.holds,
          ].join(' ')}
          draft={confirming.draft}
          choice={confirming.choice}
          holds={confirming.holds}
          onCancel={() => setConfirming(null)}
          onConfirm={(confirmed, override) =>
            void send(confirming.draft, confirming.choice, confirmed, override)
          }
        />
      )}
      {deleting && (
        <ConfirmDelete
          draft={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void removeDraft(deleting)}
        />
      )}
      {stopping && (
        <ConfirmStop
          row={stopping.row}
          action={stopping.action}
          onCancel={() => setStopping(null)}
          onConfirm={() => void stopSend(stopping.row, stopping.action)}
        />
      )}
    </div>
  )
}

const keysOf = (groups: CardGroup[]) => groups.map(g => g.cards.map(c => c.key))

/** Sets a text box's height to its text. scrollHeight leaves out the
 *  border; offset - client is exactly that. */
function fitToText(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
}

/** A text box that is always as tall as its text, while typing too (Bryce,
 *  7 Oct 2026). It refits when the text is set from outside (Pen's text),
 *  when its width changes, and once the web font has loaded. */
function GrowingTextarea(
  props: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'>
) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => fitToText(ref.current), [props.value])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    void document.fonts?.ready.then(() => fitToText(el))
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      fitToText(el)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <textarea {...props} ref={ref} rows={1} className={styles.fitTextarea} />
  )
}

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
                            <GrowingTextarea
                              value={v}
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
                          <GrowingTextarea
                            value={fitText}
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

/** The warnings as a list. */
function WarningItems({ items }: { items: SendWarning[] }) {
  return (
    <ul className={styles.warningList}>
      {items.map(w => (
        <li key={w.id}>{w.text}</li>
      ))}
    </ul>
  )
}

/** In-page confirmation for the one irreversible action on this page. It
 *  names what goes out and to how many (the wave's count for a wave). Any
 *  warnings are grouped by kind, and each group needs its own tick; a held
 *  wave also needs a typed reason before the send button works. */
function ConfirmSend({
  draft,
  choice,
  holds,
  onCancel,
  onConfirm,
}: {
  draft: Draft
  choice: Choice
  /** Why this wave is held (the gap, a red verdict); empty when it isn't. */
  holds: string[]
  onCancel: () => void
  /** With the ids of every warning, once each group has been ticked, and
   *  the reason typed for a held wave. */
  onConfirm: (confirmed: string[], override: string | null) => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  /** One tick per kind of warning (the server checks every id came back). */
  const groups = WARNING_GROUPS.map(g => ({
    ...g,
    items: draft.warnings.filter(w => w.kind === g.kind),
  })).filter(g => g.items.length > 0)
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())
  const [reason, setReason] = useState('')
  const reasonOk =
    holds.length === 0 || reason.trim().length >= OVERRIDE_MIN_CHARS
  const allTicked = groups.every(g => ticked.has(g.kind)) && reasonOk
  const wave =
    typeof choice === 'number'
      ? (draft.waves?.waves.find(w => w.wave === choice) ?? null)
      : null
  const count = wave ? wave.count : draft.activeContacts
  const listLabel =
    draft.listName ?? (draft.listId ? `list ${draft.listId}` : '')
  const who =
    count == null
      ? `everyone on ${listLabel}`
      : `${count} contact${count === 1 ? '' : 's'}`
  const delay = draft.sendDelayMinutes

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
          Send “{draft.name}”
          {wave ? ` · wave ${wave.wave} of ${wave.waves}` : ''}?
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
            {wave ? (
              <>
                {wave.label} on {listLabel}
                <span className={styles.muted}>
                  {' '}
                  · {people(wave.count)}
                  {draft.activeContacts != null &&
                    ` of ${draft.activeContacts.toLocaleString('en-US')} active`}
                </span>
              </>
            ) : (
              <>
                {listLabel}
                {count != null && (
                  <span className={styles.muted}>
                    {' '}
                    · {count} active contact{count === 1 ? '' : 's'}
                  </span>
                )}
              </>
            )}
          </dd>
        </dl>
        {(groups.length > 0 || holds.length > 0) && (
          <div className={styles.dialogChecks}>
            {holds.length > 0 && (
              <fieldset className={styles.dialogCheck}>
                <legend>This wave is held</legend>
                <ul className={styles.warningList}>
                  {holds.map(h => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
                <label className={styles.fitLabel}>
                  To send it anyway, say why (kept with the send)
                  <GrowingTextarea
                    maxLength={500}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                  />
                </label>
              </fieldset>
            )}
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
          It goes out {delay} minutes after you confirm. Until then you can
          cancel it under Recent sends; while it’s sending you can pause or stop
          it there. Emails already delivered can’t be recalled.
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
            onClick={() =>
              onConfirm(
                draft.warnings.map(w => w.id),
                holds.length > 0 ? reason.trim() : null
              )
            }
            disabled={!allTicked}
            title={
              allTicked
                ? undefined
                : reasonOk
                  ? 'Tick the checks above first'
                  : 'Say why this wave should go now'
            }
          >
            {wave
              ? count == null
                ? `Send wave ${wave.wave}`
                : `Send wave ${wave.wave} to ${who}`
              : `Send to ${who}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The list's waves on a draft: each with its size, the ones this issue
 *  has sent with their numbers, the next one ready to choose. Only the next
 *  wave (or, on a small list, the whole list) can be chosen. */
function WavePicker({
  draftId,
  plan,
  choice,
  canChoose,
  onChoose,
  now,
}: {
  draftId: string
  plan: WavePlan
  choice: Choice | null
  /** An approver, and the draft passes its checks. */
  canChoose: boolean
  onChoose: (c: Choice) => void
  /** When ActiveCampaign was read (epoch ms): "now" for the gap, fresh to
   *  within the page's 30-second reread. */
  now: number
}) {
  const due =
    plan.notBefore && now < Date.parse(plan.notBefore) ? plan.notBefore : null
  const left =
    plan.active != null ? Math.max(0, plan.active - plan.reached) : null
  return (
    <fieldset className={styles.waves}>
      <legend className={styles.wavesTitle}>
        Warm-up waves
        {plan.waves.length > 0 && (
          <span className={styles.muted}>
            {' '}
            · {plan.active?.toLocaleString('en-US') ?? '?'} active ·{' '}
            {plan.reached.toLocaleString('en-US')} have this issue ·{' '}
            {left?.toLocaleString('en-US') ?? '?'} still to get it
          </span>
        )}
      </legend>
      {plan.error && <p className={styles.noticeError}>{plan.error}</p>}
      <ul className={styles.waveList}>
        {plan.wholeList && (
          <li className={styles.waveRow}>
            <label className={styles.waveChoice}>
              <input
                type="radio"
                name={`wave-${draftId}`}
                checked={choice === 'all'}
                disabled={!canChoose}
                onChange={() => onChoose('all')}
              />
              Everyone on the list at once · {people(plan.active)}
            </label>
          </li>
        )}
        {plan.waves.map(w => {
          const isNext = w.wave === plan.next && !plan.wait && !plan.blocked
          return (
            <li key={w.segmentId} className={styles.waveRow}>
              <label
                className={`${styles.waveChoice} ${
                  isNext || w.sent ? '' : styles.waveLater
                }`}
              >
                <input
                  type="radio"
                  name={`wave-${draftId}`}
                  checked={choice === w.wave}
                  disabled={!canChoose || !isNext}
                  onChange={() => onChoose(w.wave)}
                />
                Wave {w.wave} of {w.waves}
                {w.wave === w.waves ? ' (everyone else)' : ''} ·{' '}
                {people(w.count)}
                {w.sent ? (
                  <span className={styles.statusOk}> · {w.sent.status}</span>
                ) : isNext ? (
                  <span className={styles.muted}>
                    {' '}
                    · next{due ? `, due from ${when(due)}` : ''}
                  </span>
                ) : null}
              </label>
              {w.sent && <WaveNumbers sent={w.sent} />}
            </li>
          )
        })}
      </ul>
      {plan.wait && <p className={styles.notice}>{plan.wait}.</p>}
      {plan.blocked && <p className={styles.noticeError}>{plan.blocked}.</p>}
      {plan.holds.map(h => (
        <p key={h} className={styles.warningsTitle}>
          Held: {h}.
        </p>
      ))}
    </fieldset>
  )
}

/** A sent wave's numbers, as the send watcher judges them. */
function WaveNumbers({ sent }: { sent: NonNullable<WaveInfo['sent']> }) {
  const n = (v: number | null) => (v == null ? '?' : v.toLocaleString('en-US'))
  return (
    <p className={styles.waveNumbers}>
      Campaign {sent.campaignId}
      {sent.finishedAt ? ` · finished ${when(sent.finishedAt)}` : ''} ·{' '}
      {n(sent.sent)} sent · {n(sent.bounces)} bounced · {n(sent.unsubscribes)}{' '}
      unsubscribed · {n(sent.verifiedOpens)} opened · {n(sent.spamComplaints)}{' '}
      spam complaints
      {sent.health && (
        <span
          className={
            sent.health === 'red'
              ? styles.statusBad
              : sent.health === 'amber'
                ? styles.statusWait
                : styles.statusOk
          }
        >
          {' '}
          · watcher: {sent.health}
        </span>
      )}
    </p>
  )
}

/** Consecutive rows of one issue on one list (the server puts them next to
 *  each other). */
function groupRecent(rows: Recent[]): Recent[][] {
  const out: Recent[][] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (last && last[0].group === r.group) last.push(r)
    else out.push([r])
  }
  return out
}

const STOP_LABELS: Record<StopAction, string> = {
  cancel: 'Cancel this send',
  pause: 'Pause',
  stop: 'Stop',
  resume: 'Resume',
}

/** One newsletter's numbers in the Lined up block, and the listings behind
 *  them. Funding has a second number: closing in the next two weeks. */
function LineupCounts({
  section,
  since,
}: {
  section: Extract<LineupSection, { items: unknown }>
  since: string
}) {
  const groups = [
    { title: section.closing ? 'New' : null, items: section.items },
    ...(section.closing
      ? [{ title: 'Closing in the next two weeks', items: section.closing }]
      : []),
  ].filter(g => g.items.length > 0)
  return (
    <>
      <div className={styles.lineupCounts}>
        <div className={styles.lineupStat}>
          <span className={styles.lineupCount}>{section.items.length}</span>
          <span className={styles.lineupSince}>
            {since} {section.since}
          </span>
        </div>
        {section.closing && (
          <div className={styles.lineupStat}>
            <span className={styles.lineupCount}>{section.closing.length}</span>
            <span className={styles.lineupSince}>
              closing in the next two weeks
            </span>
          </div>
        )}
      </div>
      {groups.length > 0 && (
        <details className={styles.lineupList}>
          <summary>Show listings</summary>
          {groups.map(g => (
            <div key={g.title ?? 'items'}>
              {g.title && <p className={styles.lineupGroup}>{g.title}</p>}
              <ul>
                {g.items.map(item => (
                  <li key={item.id}>{item.name}</li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
    </>
  )
}

/** One issue's rows in Recent sends. A single whole-list send is one row; an
 *  issue sent in waves gets a row with its totals (and its clicks, which
 *  are counted per issue), then a row per wave. */
function SendRows({
  rows,
  canSend,
  openClicks,
  onToggleClicks,
  stopBusyId,
  onStop,
}: {
  rows: Recent[]
  canSend: boolean
  openClicks: string | null
  onToggleClicks: (key: string) => void
  stopBusyId: string | null
  onStop: (row: Recent, action: StopAction) => void
}) {
  const first = rows[0]
  const waved = rows.length > 1 || rows.some(r => r.wave)
  const lists = first.listNames.join(', ') || '—'

  const status = (r: Recent) => (
    <>
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
      {r.segmentLost && (
        // A wave's name, but no segment in ActiveCampaign: the approval
        // deletes such a send at once, unless it was cut off first.
        <span className={styles.statusBad}>
          {' '}
          · no wave segment:{' '}
          {['sent', 'stopped', 'disabled'].includes(r.status)
            ? 'it went'
            : 'it goes'}{' '}
          to the whole list
        </span>
      )}
      {canSend && r.actions.length > 0 && (
        <span className={styles.rowActions}>
          {r.actions.map(a => (
            <button
              key={a}
              type="button"
              className={styles.rowButton}
              disabled={stopBusyId != null}
              onClick={() => onStop(r, a)}
            >
              {stopBusyId === r.id ? 'Working…' : STOP_LABELS[a]}
            </button>
          ))}
        </span>
      )}
    </>
  )
  const sentCell = (r: Recent) =>
    r.status === 'scheduled' ? (
      <>
        due {when(r.scheduledAt ?? r.scheduledFor)}
        {r.scheduledAt && <Countdown to={r.scheduledAt} />}
      </>
    ) : (
      when(r.sentAt)
    )
  const clicksButton = (r: Recent, key: string) =>
    r.clicks.total > 0 ? (
      <button
        type="button"
        className={styles.rowButton}
        aria-expanded={openClicks === key}
        title="Which links were clicked"
        onClick={() => onToggleClicks(key)}
      >
        {r.clicks.total}
      </button>
    ) : (
      <span className={styles.muted}>0</span>
    )
  const clicksRow = (r: Recent, key: string) =>
    openClicks === key && (
      <tr>
        <td colSpan={8} className={styles.clicksCell}>
          <ol className={styles.clicksList}>
            {r.clicks.links.map(l => (
              <li key={l.url} className={styles.clicksRow}>
                <span className={styles.clicksCount}>{l.clicks}</span>
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
    )

  if (!waved) {
    return (
      <>
        <tr>
          <td>{first.name}</td>
          <td className={styles.muted}>{lists}</td>
          <td>{status(first)}</td>
          <td className={styles.muted}>{sentCell(first)}</td>
          <td>{first.sentTo}</td>
          <td className={styles.muted}>{first.uniqueOpens ?? '—'}</td>
          <td>{clicksButton(first, first.id)}</td>
          <td className={styles.muted}>{first.unsubscribes ?? '—'}</td>
        </tr>
        {clicksRow(first, first.id)}
      </>
    )
  }
  const sum = (pick: (r: Recent) => number | null) => {
    const vals = rows.map(pick).filter((v): v is number => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null
  }
  const groupKey = `issue:${first.group}`
  const newestSent = rows
    .map(r => r.sentAt)
    .filter((s): s is string => s != null)
    .sort()
    .pop()
  const waves = first.wave?.waves
  return (
    <>
      <tr className={styles.groupRow}>
        <td>{first.baseName}</td>
        <td className={styles.muted}>{lists}</td>
        <td className={styles.muted}>
          {rows.length} {rows.length === 1 ? 'send' : 'sends'}
          {waves ? ` of ${waves} waves` : ''}
        </td>
        <td className={styles.muted}>{when(newestSent ?? null)}</td>
        <td>{sum(r => r.sentTo)}</td>
        <td className={styles.muted}>{sum(r => r.uniqueOpens) ?? '—'}</td>
        <td>{clicksButton(first, groupKey)}</td>
        <td className={styles.muted}>{sum(r => r.unsubscribes) ?? '—'}</td>
      </tr>
      {clicksRow(first, groupKey)}
      {rows.map(r => (
        <tr key={r.id} className={styles.waveSubRow}>
          <td>
            {r.wave ? `wave ${r.wave.wave} of ${r.wave.waves}` : 'whole list'}
          </td>
          <td className={styles.muted}>campaign {r.id}</td>
          <td>{status(r)}</td>
          <td className={styles.muted}>{sentCell(r)}</td>
          <td>{r.sentTo}</td>
          <td className={styles.muted}>{r.uniqueOpens ?? '—'}</td>
          <td className={styles.muted} title="Clicks are counted per issue">
            –
          </td>
          <td className={styles.muted}>{r.unsubscribes ?? '—'}</td>
        </tr>
      ))}
    </>
  )
}

/** " · sends in 8:41", counting down each second; " · going out now"
 *  after; nothing for a send more than two days away. */
function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const left = Date.parse(to) - now
  // Days away (a send scheduled in ActiveCampaign itself): the due time
  // beside it says enough.
  if (Number.isNaN(left) || left > 48 * 3_600_000) return null
  if (left <= 0)
    return <span className={styles.countdown}> · going out now</span>
  const h = Math.floor(left / 3_600_000)
  const m = Math.floor((left % 3_600_000) / 60_000)
  const s = Math.floor((left % 60_000) / 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  return (
    <span className={styles.countdown}>
      {' '}
      · sends in {h > 0 ? `${h}:${two(m)}` : m}:{two(s)}
    </span>
  )
}

/** Confirmation for a draft's Delete button. Focus starts on "Go back". */
function ConfirmDelete({
  draft,
  onCancel,
  onConfirm,
}: {
  draft: Draft
  onCancel: () => void
  onConfirm: () => void
}) {
  const backRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    backRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  const midWaves =
    !draft.alreadySent && (draft.waves?.waves.some(w => w.sent) ?? false)
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="confirm-delete-title" className={styles.dialogTitle}>
          Delete “{draft.name}”?
        </h2>
        <p className={styles.dialogNote}>
          The draft comes off this page and out of ActiveCampaign. Nothing is
          sent. To get it back, have Pen build the issue again.
          {midWaves &&
            ' Waves already sent aren’t affected, but its remaining waves can’t be approved without it.'}
        </p>
        <div className={styles.dialogActions}>
          <button
            ref={backRef}
            type="button"
            className={styles.button}
            onClick={onCancel}
          >
            Go back
          </button>
          <button
            type="button"
            className={styles.buttonPrimary}
            onClick={onConfirm}
          >
            Delete draft
          </button>
        </div>
      </div>
    </div>
  )
}

/** Confirmation for a Stop button on Recent sends: what the action does to
 *  this send, in plain words. Focus starts on "Go back". */
function ConfirmStop({
  row,
  action,
  onCancel,
  onConfirm,
}: {
  row: Recent
  action: StopAction
  onCancel: () => void
  onConfirm: () => void
}) {
  const backRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    backRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  const name = `“${row.name}”`
  const text: Record<StopAction, { title: string; body: string; go: string }> =
    {
      cancel: {
        title: `Cancel ${name}?`,
        body: `It hasn’t gone to anyone yet${
          row.scheduledAt ? ` (it’s due ${when(row.scheduledAt)})` : ''
        }. Canceling deletes the send in ActiveCampaign, so nobody gets it.${
          row.wave && row.wave.wave < row.wave.waves
            ? ' The draft stays, so this wave can be approved again.'
            : ''
        }`,
        go: 'Cancel this send',
      },
      pause: {
        title: `Pause ${name}?`,
        body: 'It stops going out partway. People who already got it keep it. You can then stop it for good or resume it.',
        go: 'Pause sending',
      },
      stop: {
        title: `Stop ${name} for good?`,
        body: `Nobody else gets it; people who already got it keep it. This can’t be undone.${
          row.wave
            ? ' A wave stopped after reaching people ends this issue’s waves: no later wave can be approved.'
            : ''
        }`,
        go: 'Stop for good',
      },
      resume: {
        title: `Resume ${name}?`,
        body: 'It carries on sending to everyone on its list who hasn’t got it yet.',
        go: 'Resume sending',
      },
    }
  const t = text[action]
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-stop-title"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="confirm-stop-title" className={styles.dialogTitle}>
          {t.title}
        </h2>
        <p className={styles.dialogNote}>{t.body}</p>
        <div className={styles.dialogActions}>
          <button
            ref={backRef}
            type="button"
            className={styles.button}
            onClick={onCancel}
          >
            Go back
          </button>
          <button
            type="button"
            className={styles.buttonPrimary}
            onClick={onConfirm}
          >
            {t.go}
          </button>
        </div>
      </div>
    </div>
  )
}
