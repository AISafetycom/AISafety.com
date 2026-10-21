'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fableChangesOf,
  wentOut,
  wentOutNote,
  type FableChange,
} from '@/lib/admin/queue-fable'
import {
  flagShown,
  parseFlag,
  verdictWords,
  type FlagUpdate,
} from '@/lib/admin/queue-flag'
import Icon from '@/components/Icon'
import type { AgentInfo, QueueItem } from '@/lib/admin/queue'
import { reviewNewerThanChat } from '@/lib/admin/queue-reopen'
import styles from './queue.module.css'

// A conversation with Fable about the open item, beside the verdict. Each
// message goes to the agent on the owner's Mac (~/Queue/agent.py, POST
// /chat), which runs one headless Claude Code call from the home folder –
// so Fable has the same memory every session on that Mac has, the Airtable
// tools (reading and writing, since 15 Sept 2026), the web and the rulebooks
// – and streams the reply back as it is written. The thread continues across
// messages (the CLI resumes its own session) and is stored on the Mac, so it
// is there again when the item is reopened. Changes to OTHER records Fable
// makes itself and says so; wording for this item's own record arrives in an
// ```edits block, applied on the page, and reaches Airtable with Accept.
// Files go with a message too (the clip, a paste or a drop – 20 Sept 2026,
// Bryce: "I want to be able to attach things (e.g. images) to the Fable
// chat"): they are saved on the Mac beside the thread and Fable opens them.

// A reply's parts: its prose, what it was doing at that point (shown only
// while it is still answering – one line that changes; Bryce, 14 Sept 2026:
// "I don't really care what it's doing, I just want to know it's doing
// stuff"), and notes worth keeping ("Saved a memory: …"). Of the prose only
// the answer shows, not the lines written between lookups (answerPart).
type Part =
  | { t: 'text'; text: string }
  | { t: 'tool'; label: string }
  | { t: 'note'; label: string }

/** A file sent with a message. Saved on the Mac under the item's thread;
 *  the page fetches it back (POST /chat/file) for the thumbnail. `url` is
 *  set only on the page that sent it, until the history is re-read. */
interface Attachment {
  name: string
  type: string
  size: number
  file: string
  url?: string
}

/** A file picked, pasted or dropped, waiting to go with the next message. */
interface Pending {
  file: File
  name: string
  type: string
  size: number
  /** An object URL for the thumbnail (pictures only). */
  url?: string
}

const MAX_FILES = 8
const MAX_FILE_BYTES = 15 * 1024 * 1024

// A message half typed when Bryce moves to another item waits in the box
// for him when he comes back (13 Oct 2026: "when I start typing then switch
// listings, please make it save my text"). The words and a picked quote are
// kept in this browser per item, so a reload keeps them too; files can't
// be, so those wait only while the page stays open. Drafts untouched for a
// month drop out.
const DRAFTS_KEY = 'aisafety-admin-queue:chat-drafts'
const DRAFT_DAYS = 30

interface Draft {
  text: string
  quote: string | null
  at: number
}

function readDrafts(): Record<string, Draft> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      return saved as Record<string, Draft>
    }
  } catch {
    // storage refused or garbled: no drafts
  }
  return {}
}

function draftOf(id: string): Draft | null {
  const d = readDrafts()[id]
  return d && typeof d.text === 'string' ? d : null
}

function saveDraft(id: string, text: string, quote: string | null) {
  const drafts = readDrafts()
  const cutoff = Date.now() - DRAFT_DAYS * 86_400_000
  for (const [k, d] of Object.entries(drafts)) {
    if (!(d?.at > cutoff)) delete drafts[k]
  }
  if (text.trim() || quote) drafts[id] = { text, quote, at: Date.now() }
  else delete drafts[id]
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    // storage refused: the draft lasts only while the item stays open
  }
}

// Files waiting to go, per item, while the page stays open.
const draftFiles = new Map<string, Pending[]>()

// Fable's edits and reply drafts go on the page by themselves, with a
// small Undo (Bryce, 16 Oct 2026: "let's make edits apply automatically,
// and instead have a small Undo Edit button"). They used to apply only
// when the reply finished while its item was open, so one that finished
// after Bryce had moved on waited behind an Apply button (Guidelight AI's
// link, 13–16 Oct 2026). The page now keeps, per item in this browser, the
// time of the newest message it has looked at – anything newer is applied
// when the item next opens – and what each applied reply replaced, so Undo
// works after moving away and back, and after a reload.
const APPLIED_KEY = 'aisafety-admin-queue:chat-applied'

interface Applied {
  /** The newest message looked at ('' for a thread that was empty). */
  seen: string
  /** Per reply (by its time stamp): what applying it replaced. */
  undo: Record<string, Undo>
  at: number
}

function readApplied(): Record<string, Applied> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(APPLIED_KEY) ?? '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      return saved as Record<string, Applied>
    }
  } catch {
    // storage refused or garbled: nothing kept
  }
  return {}
}

function appliedOf(id: string): Applied | null {
  const a = readApplied()[id]
  return a && typeof a.seen === 'string' ? a : null
}

function saveApplied(id: string, seen: string, undo: Record<string, Undo>) {
  const all = readApplied()
  const cutoff = Date.now() - DRAFT_DAYS * 86_400_000
  for (const [k, a] of Object.entries(all)) {
    if (!(a?.at > cutoff)) delete all[k]
  }
  all[id] = { seen, undo, at: Date.now() }
  try {
    localStorage.setItem(APPLIED_KEY, JSON.stringify(all))
  } catch {
    // storage refused: only replies that land while the item is open apply
  }
}

interface Msg {
  role: 'you' | 'fable' | 'error'
  text?: string
  parts?: Part[]
  attachments?: Attachment[]
  at: string
  /** e.g. "Fable is at its usage limit until … – this reply is from Opus" */
  note?: string
  /** Fable wrote to Airtable while answering: the page re-reads the record. */
  wrote?: boolean
  /** What that reply changed on this item's own listing, read by the Mac
   *  before and after it. */
  changed?: FableChange[]
  /** A new verdict and reasons for the item, when the reply found the flag
   *  out of date (the ```flag block, taken off the text on the Mac;
   *  queue-flag.ts). Shown as a card with an Update flag button. */
  flag?: unknown
}

interface Event {
  type:
    | 'start'
    | 'text'
    | 'tool'
    | 'note'
    | 'switch'
    | 'reset'
    | 'done'
    | 'error'
  text?: string
  label?: string
  message?: Msg
  error?: string
}

/** Shown when a reply's stream stops before it says it is done: the Mac
 *  agent stopped mid-answer, usually a restart. The Mac leaves the same
 *  note in the thread when it starts again (7 Oct 2026: a question about
 *  Athena Mentorship Program, sent a second before a restart, sat there
 *  with nothing under it). */
const CUT_OFF =
  "Fable's reply was cut off – the Queue helper on the Mac stopped. Send your message again."

const EDITS_RE = /```edits\s*\n([\s\S]*?)```/g
const REPLY_RE = /```reply\s*\n([\s\S]*?)```/g
const BLOCK_RE = /```(edits|reply)\s*\n([\s\S]*?)```/g

/** The fenced blocks Fable's reply may carry: new field values and a new
 *  reply draft. Both are applied to the page the moment the reply lands
 *  (nothing reaches Airtable's live records before Accept, and a reply
 *  draft is never sent), so asking for a change makes the change –
 *  Bryce, 14 Sept 2026: "It should update the actual draft". */
function blocksOf(text: string): {
  edits: Record<string, string> | null
  reply: string | null
} {
  let edits: Record<string, string> | null = null
  let reply: string | null = null
  for (const m of text.matchAll(EDITS_RE)) edits = parseEdits(m[1]) ?? edits
  for (const m of text.matchAll(REPLY_RE)) reply = m[1].trim() || reply
  return { edits, reply }
}

/** Values as the page's editors hold them: text, and a list (a
 *  multiple-select) as one comma-separated string. */
function parseEdits(json: string): Record<string, string> | null {
  try {
    const obj = JSON.parse(json) as unknown
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === 'string'
          ? v
          : Array.isArray(v)
            ? v.map(x => String(x)).join(', ')
            : JSON.stringify(v),
      ])
    )
  } catch {
    return null
  }
}

function textOf(msg: Msg): string {
  return (msg.parts ?? []).map(p => (p.t === 'text' ? p.text : '')).join('')
}

/** What an applied reply changed, so Undo can put it back. */
interface Undo {
  /** Each field's edit before (null: the field had none). */
  edits?: Record<string, string | null>
  /** The reply draft before. */
  reply?: string
}

/** What a reply's cards can do once it has landed: put its edits or draft
 *  on the page (again), or take them back off. */
interface CardActs {
  applyEdits: (usable: Record<string, string>) => void
  applyReply: (text: string) => void
  undoEdits?: () => void
  undoReply?: () => void
}

/** A decided item, opened from Done today: its cards are read-only and
 *  say what became of them, with no Apply or Undo. */
export interface Decided {
  /** The button the decision was made with: "Publish", "Apply change". */
  label: string
  /** The row's saved edits as the page's editors hold them, when the
   *  decision wrote them to the listing; empty when it wrote nothing (a
   *  rejection). */
  sent: Record<string, string>
  /** The reply draft that went with the decision; null when none did. */
  reply: string | null
}
const LINK_RE = /https?:\/\/[^\s<>)\]]+/g
const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|https?:\/\/[^\s<>)\]]+)/g
const BULLET_RE = /^\s*(?:[-•*]|\d+[.)])\s+/

/** The Description length cap for the item's page – the numbers in
 *  ~/Comb/description-rules.md section 1 (events and training 150–220,
 *  every other page at most 180), shown on the edits card so an
 *  over-long proposal is visible at once (16 Sept 2026: a /funding
 *  description arrived at 244 characters and Bryce had to ask). The
 *  Projects table calls the field "Description (short)". */
interface DescCap {
  field: string
  cap: number
}
const PROJECTS_TABLE = 'tblHT29QNgMYKB8iW'
export function descriptionCap(item: QueueItem): DescCap {
  return {
    field:
      item.targetTable === PROJECTS_TABLE
        ? 'Description (short)'
        : 'Description',
    cap: item.page === '/events' || item.page === '/training' ? 220 : 180,
  }
}

/** A description's length against its page's cap, in red once over. */
export function CharCount({ n, cap }: { n: number; cap: number }) {
  return (
    <span className={n > cap ? styles.chatCountOver : styles.chatCount}>
      {n > cap
        ? `${n} characters – over the ${cap} cap`
        : `${n} / ${cap} characters`}
    </span>
  )
}

export default function Chat({
  item,
  agent,
  edits,
  reply,
  canEditField,
  decided,
  onSetEdits,
  onSetReply,
  onWrote,
  onFlag,
  onFableChanges,
  focusTick,
}: {
  item: QueueItem
  agent: AgentInfo
  /** The page's pending edits, so an applied change shows as applied. */
  edits: Record<string, string>
  /** The reply draft as the page shows it now (null: the item has none). */
  reply: string | null
  /** Whether the page lets this field be edited (no formulas, no
   *  housekeeping); a change to any other field is left out. */
  canEditField: (field: string) => boolean
  /** Set once the item is decided: nothing applies any more. */
  decided: Decided | null
  /** Replace the page's pending edits. */
  onSetEdits: (edits: Record<string, string>) => void
  /** Set the reply draft as edited on the page (null: as it came). */
  onSetReply: (text: string | null) => void
  /** A reply that changed Airtable has landed: re-read the live record. */
  onWrote?: () => void
  /** Write a flag update onto the row, or undo it; resolves to an error
   *  to show, or null. */
  onFlag: (
    body: { flag: FlagUpdate } | { undo: true }
  ) => Promise<string | null>
  /** The fields Fable has changed on the listing so far in this thread. */
  onFableChanges?: (changes: FableChange[]) => void
  /** Bumped by the F key: focus the box. */
  focusTick: number
}) {
  // null while the history is loading
  const [messages, setMessages] = useState<Msg[] | null>(null)
  // The Mac is still answering a message sent earlier (page reloaded).
  const [pending, setPending] = useState(false)
  // The reply being streamed now.
  const [live, setLive] = useState<Part[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // What was typed here before, if Bryce left this item mid-message.
  const [text, setText] = useState(() => draftOf(item.id)?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Text picked out of the panel to answer to: the Reply button that
  // appears over a selection, and the quote it leaves on the message.
  const [pick, setPick] = useState<{
    text: string
    x: number
    y: number
  } | null>(null)
  const [quote, setQuote] = useState<string | null>(
    () => draftOf(item.id)?.quote ?? null
  )
  // Messages typed while Fable was still answering. Sending one stops the
  // reply being written (the Mac kills that call; what it wrote stays, with
  // a note) and this goes as soon as its stream ends – like the Claude Code
  // app (Bryce, 15 Sept 2026: "make it interrupt it"). Several in a row go
  // in order.
  const [queued, setQueued] = useState<{ text: string; files: Pending[] }[]>([])
  // Files waiting to go with the next message, and whether one is being
  // dragged over the panel right now.
  const [files, setFiles] = useState<Pending[]>(
    () => draftFiles.get(item.id) ?? []
  )
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  // The page's current values, readable from inside stream handlers.
  const editsRef = useRef(edits)
  editsRef.current = edits
  const cap = descriptionCap(item)
  const replyRef = useRef(reply)
  replyRef.current = reply
  // What this browser kept for the item last time: the newest message it
  // looked at, and what each applied reply replaced (APPLIED_KEY).
  const [kept] = useState(() => appliedOf(item.id))
  // Per reply (by its time stamp): what applying it changed, for Undo.
  const undoRef = useRef<Record<string, Undo>>(kept?.undo ?? {})
  // The newest message looked at; null until the thread first loads in a
  // browser that had not seen it before.
  const seenAtRef = useRef<string | null>(kept?.seen ?? null)
  const keep = useCallback(() => {
    if (seenAtRef.current !== null) {
      saveApplied(item.id, seenAtRef.current, undoRef.current)
    }
  }, [item.id])
  // Whether this item is still the open one. A reply's stream outlives the
  // panel when Bryce moves on mid-answer; what lands after that is left
  // for the next time the item opens (it is newer than seenAtRef), rather
  // than applied on top of the edits as they stood when he left.
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  /** Note a message as looked at, once its blocks are applied. */
  const markSeen = useCallback(
    (at: string) => {
      if (!mountedRef.current) return
      if (seenAtRef.current === null || at > seenAtRef.current) {
        seenAtRef.current = at
        keep()
      }
    },
    [keep]
  )
  // How many messages the page has already looked at for blocks to apply.
  const seenRef = useRef<number | null>(null)
  // Whether the thread has loaded from the Mac yet.
  const loadedRef = useRef(false)

  // The page's changed fields list what Fable changed on the listing.
  const onChangesRef = useRef(onFableChanges)
  onChangesRef.current = onFableChanges
  useEffect(() => {
    if (messages) onChangesRef.current?.(fableChangesOf(messages))
  }, [messages])

  /** Put a reply's field values on the page, keeping what they replace
   *  for its Undo. The refs move at once, so a second reply applied in the
   *  same breath builds on this one rather than on what came before. */
  const putEdits = useCallback(
    (at: string, usable: Record<string, string>) => {
      const before = editsRef.current
      const moved = Object.keys(usable).filter(k => before[k] !== usable[k])
      if (!moved.length) return
      undoRef.current[at] = {
        ...undoRef.current[at],
        edits: Object.fromEntries(moved.map(k => [k, before[k] ?? null])),
      }
      const next = { ...before, ...usable }
      editsRef.current = next
      onSetEdits(next)
      keep()
    },
    [keep, onSetEdits]
  )
  /** The same for a reply's new reply draft. */
  const putReply = useCallback(
    (at: string, text: string) => {
      const before = replyRef.current
      if (before === null || before === text) return
      undoRef.current[at] = { ...undoRef.current[at], reply: before }
      replyRef.current = text
      onSetReply(text)
      keep()
    },
    [keep, onSetReply]
  )

  /** Apply the blocks in a reply that has just arrived. */
  const applyFrom = useCallback(
    (msg: Msg) => {
      if (msg.role !== 'fable' || !mountedRef.current) return
      if (msg.wrote) onWrote?.()
      // A decided item keeps what went with its decision: a reply that
      // lands after it changes nothing on the page.
      if (decided) return
      const { edits: proposed, reply: draft } = blocksOf(textOf(msg))
      if (proposed) {
        const usable = Object.fromEntries(
          Object.entries(proposed).filter(([k]) => canEditField(k))
        )
        if (Object.keys(usable).length) putEdits(msg.at, usable)
      }
      if (draft) putReply(msg.at, draft)
    },
    [canEditField, decided, onWrote, putEdits, putReply]
  )
  // Read through a ref by loadHistory, so that it changes only with the
  // item. The page hands down new callbacks on every render, and each
  // loaded history re-renders the page (the changed fields above): with
  // applyFrom as a dependency the history reloaded the
  // moment it landed, thousands of times a minute, and an expired token
  // turned that into 2.4 million refusals in the Mac agent's log (7 Oct 2026).
  const applyFromRef = useRef(applyFrom)
  applyFromRef.current = applyFrom

  /** Forget one part of a reply's Undo once it has been used. */
  const dropUndo = (at: string, part: keyof Undo) => {
    const rest = { ...undoRef.current[at] }
    delete rest[part]
    if (rest.edits || rest.reply !== undefined) undoRef.current[at] = rest
    else delete undoRef.current[at]
    keep()
  }

  /** What a landed reply's cards can do: its edits and its draft each have
   *  their own Undo, and their own Apply once taken back off. */
  const actsFor = (msg: Msg): CardActs => {
    const u = undoRef.current[msg.at]
    const edits = u?.edits
    const draft = u?.reply
    return {
      applyEdits: usable => putEdits(msg.at, usable),
      applyReply: text => putReply(msg.at, text),
      undoEdits: edits
        ? () => {
            const next = { ...editsRef.current }
            for (const [k, v] of Object.entries(edits)) {
              if (v === null) delete next[k]
              else next[k] = v
            }
            editsRef.current = next
            onSetEdits(next)
            dropUndo(msg.at, 'edits')
          }
        : undefined,
      undoReply:
        draft !== undefined
          ? () => {
              replyRef.current = draft
              onSetReply(draft)
              dropUndo(msg.at, 'reply')
            }
          : undefined,
    }
  }

  // The page gets a fresh token with every list refresh (each minute, and
  // on coming back to the tab), so it is read through a ref: a new token
  // must not reload the thread. It did, and a reload that landed before the
  // Mac had saved the message just sent took it off the screen while Fable
  // answered (15 Oct 2026, "Didn't we get contacted about this?" on
  // Organization Builders Program).
  const tokenRef = useRef(agent.token)
  tokenRef.current = agent.token
  const call = useCallback(
    (path: string, body: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${agent.port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, id: item.id, token: tokenRef.current }),
        cache: 'no-store',
      }),
    [agent.port, item.id]
  )

  /** A file from an earlier message, back from the Mac. */
  const fetchFile = useCallback(
    async (file: string) => {
      const res = await call('/chat/file', { file })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.blob()
    },
    [call]
  )

  const loadHistory = useCallback(async () => {
    const res = await call('/chat/history', {})
    const data = (await res.json()) as {
      ok?: boolean
      error?: string
      messages?: Msg[]
      pending?: boolean
    }
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
    const list = data.messages ?? []
    // A reply that landed since the page last looked applies its blocks:
    // one that came while this item stayed open (the pending poll), and
    // one that came while Bryce was on another item or the page was shut
    // (newer than the last message this browser looked at). Older ones
    // were applied when they came, and are on the row.
    if (seenRef.current !== null) {
      for (const msg of list.slice(seenRef.current)) applyFromRef.current(msg)
    } else if (seenAtRef.current !== null) {
      const since = seenAtRef.current
      for (const msg of list) if (msg.at > since) applyFromRef.current(msg)
    }
    seenRef.current = list.length
    markSeen(list.reduce((a, m) => (m.at > a ? m.at : a), ''))
    loadedRef.current = true
    setMessages(list)
    setPending(Boolean(data.pending))
    return { list, pending: Boolean(data.pending) }
  }, [call, markSeen])

  // The thread loads once per item. One that could not load (the Mac was
  // down, or the token had run out) tries again with the page's next token.
  useEffect(() => {
    if (loadedRef.current) return
    let alive = true
    loadHistory().then(
      () => {
        if (alive) setError(null)
      },
      e => {
        if (!alive) return
        setMessages([])
        setError(
          e instanceof Error ? e.message : 'The Mac agent did not answer.'
        )
      }
    )
    return () => {
      alive = false
    }
  }, [loadHistory, agent.token])

  // A reply still being written on the Mac lands in the history when done.
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => void loadHistory().catch(() => {}), 3000)
    return () => clearInterval(t)
  }, [pending, loadHistory])

  // Only a fresh press of F focuses the box. The count lives on the page and
  // outlives this component (it remounts per item), so a mount that sees an
  // old count must not focus: that put the cursor in the box on every switch
  // of item, and the letter shortcuts stopped working (Bryce, 15 Sept 2026).
  const focusSeen = useRef(focusTick)
  useEffect(() => {
    if (focusTick === focusSeen.current) return
    focusSeen.current = focusTick
    inputRef.current?.focus()
  }, [focusTick])

  // Keep the newest words in view – the panel is its own scroll box – but
  // after the thread first opens, only while the panel is already at its
  // foot. Scrolled up to read something, the view stays put when a message
  // goes, Fable starts thinking, writes or finishes (Bryce, 30 Sept 2026:
  // "it jumps the viewer to the bottom"). An item that came back or was
  // reviewed again since the chat's last word opens at the panel's top
  // instead, on Fable's verdict (reviewNewerThanChat). The panel stays on
  // the page from one item to the next, so it is put there, not left.
  const atFootRef = useRef(true)
  const openedRef = useRef(false)
  useEffect(() => {
    const box = inputRef.current?.closest<HTMLElement>('[data-chat-scroll]')
    if (!box) return
    const onScroll = () => {
      atFootRef.current =
        box.scrollHeight - box.scrollTop - box.clientHeight < 40
    }
    box.addEventListener('scroll', onScroll)
    return () => box.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const opening = messages !== null && !openedRef.current
    if (opening) openedRef.current = true
    if (!opening && !atFootRef.current) return
    const box = endRef.current?.closest<HTMLElement>('[data-chat-scroll]')
    if (!box) return
    const newest = (messages ?? []).reduce((a, m) => (m.at > a ? m.at : a), '')
    if (opening && reviewNewerThanChat(item, newest || null)) {
      box.scrollTop = 0
      atFootRef.current = box.scrollHeight - box.clientHeight < 40
      return
    }
    box.scrollTop = box.scrollHeight
    // Only the opening reads the item: a list refresh must not scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, live, note, queued])

  // Select words anywhere in the panel (Fable's verdict included) and a
  // Reply button appears by them; it quotes them into the next message,
  // the way the Claude desktop app does (Bryce, 14 Sept 2026). The panel
  // is found from the box to type in, which is always on the page.
  useEffect(() => {
    const read = () => {
      const box = inputRef.current?.closest<HTMLElement>('[data-chat-scroll]')
      const sel = window.getSelection()
      const picked = sel?.toString().trim() ?? ''
      if (
        !box ||
        !sel ||
        sel.isCollapsed ||
        !picked ||
        !sel.anchorNode ||
        !box.contains(sel.anchorNode) ||
        document.activeElement === inputRef.current
      ) {
        setPick(null)
        return
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setPick({ text: picked, x: rect.left, y: rect.bottom })
    }
    const onUp = () => setTimeout(read, 0)
    const onChange = () => {
      if (window.getSelection()?.isCollapsed) setPick(null)
    }
    document.addEventListener('mouseup', onUp)
    document.addEventListener('selectionchange', onChange)
    document.addEventListener('scroll', onChange, true)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('selectionchange', onChange)
      document.removeEventListener('scroll', onChange, true)
    }
  }, [])

  const takeQuote = () => {
    if (!pick) return
    setQuote(pick.text)
    setPick(null)
    window.getSelection()?.removeAllRanges()
    inputRef.current?.focus()
  }

  /** Files picked with the clip, pasted into the box or dropped on the
   *  panel: shown as chips until the next message takes them. */
  const addFiles = (list: Iterable<File>) => {
    const next = [...files]
    const problems: string[] = []
    for (const f of Array.from(list)) {
      if (next.length >= MAX_FILES) {
        problems.push(`Up to ${MAX_FILES} files per message.`)
        break
      }
      if (f.size > MAX_FILE_BYTES) {
        problems.push(`${f.name} is over 15 MB.`)
        continue
      }
      next.push({
        file: f,
        name: f.name || 'image.png',
        type: f.type,
        size: f.size,
        url: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
      })
    }
    setFiles(next)
    setError(problems.length ? problems.join(' ') : null)
    inputRef.current?.focus()
  }

  const dropFile = (i: number) => {
    setFiles(cur => {
      const f = cur[i]
      if (f?.url) URL.revokeObjectURL(f.url)
      return cur.filter((_, j) => j !== i)
    })
  }

  // A file dragged over the panel: a dashed frame says it can be dropped.
  // Enter/leave fire for every child, so a depth count tells the real leave.
  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('Files')
  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current++
    setDragging(true)
  }
  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const handle = (ev: Event) => {
    switch (ev.type) {
      case 'text':
        setLive(p => {
          const parts = p ? [...p] : []
          const last = parts[parts.length - 1]
          if (last && last.t === 'text') {
            parts[parts.length - 1] = {
              t: 'text',
              text: last.text + (ev.text ?? ''),
            }
          } else {
            parts.push({ t: 'text', text: ev.text ?? '' })
          }
          return parts
        })
        break
      case 'tool':
        setLive(p => [...(p ?? []), { t: 'tool', label: ev.label ?? '' }])
        break
      case 'note':
        setLive(p => [...(p ?? []), { t: 'note', label: ev.label ?? '' }])
        break
      case 'switch':
        setNote(ev.text ?? null)
        setLive([])
        break
      case 'reset':
        setLive([])
        break
      case 'done':
        if (ev.message) {
          const msg = ev.message
          applyFrom(msg)
          setMessages(m => [...(m ?? []), msg])
          seenRef.current = (seenRef.current ?? 0) + 1
          markSeen(msg.at)
        }
        setLive(null)
        setNote(null)
        break
      case 'error':
        seenRef.current = (seenRef.current ?? 0) + 1
        setMessages(m => [
          ...(m ?? []),
          {
            role: 'error',
            text: ev.error ?? 'Fable could not answer.',
            at: '',
          },
        ])
        setLive(null)
        setNote(null)
        break
      default:
        break
    }
  }

  /** Enter: what was typed goes now; while Fable is still answering it
   *  stops that reply and goes right after (the Mac takes one message per
   *  item at a time). */
  const submit = () => {
    const typed = text.trim()
    if (!typed && !quote && files.length === 0) return
    // The quote goes first, as a markdown quote, then what was typed.
    const msg = quote
      ? '> ' + quote.replace(/\n+/g, '\n> ') + (typed ? '\n\n' + typed : '')
      : typed
    const going = files
    setText('')
    setQuote(null)
    setFiles([])
    if (inputRef.current) inputRef.current.style.height = 'auto'
    if (busy || pending) {
      setQueued(q => [...q, { text: msg, files: going }])
      // The Mac stops the call being written; its stream ends with what
      // was written so far, and the effect below sends this one.
      void call('/chat/interrupt', {}).catch(() => {})
      return
    }
    void deliver(msg, going)
  }

  /** The reply's stream stopped without ending. Re-read the thread: a Mac
   *  that is still answering lands the reply through the pending poll, and
   *  one that restarted has put the note in the thread itself. A Mac that
   *  is down (or left the message unanswered) gets the note here. */
  const cutOff = async () => {
    setLive(null)
    setNote(null)
    try {
      const { list, pending } = await loadHistory()
      if (pending || list[list.length - 1]?.role !== 'you') return
    } catch {
      // The Mac is not answering yet (a restart takes a few seconds).
    }
    seenRef.current = (seenRef.current ?? 0) + 1
    setMessages(m => [...(m ?? []), { role: 'error', text: CUT_OFF, at: '' }])
  }

  const deliver = async (msg: string, going: Pending[]) => {
    setError(null)
    setBusy(true)
    const sent = asSent(going)
    setMessages(m => [
      ...(m ?? []),
      {
        role: 'you',
        text: msg,
        at: new Date().toISOString(),
        ...(sent.length ? { attachments: sent } : {}),
      },
    ])
    seenRef.current = (seenRef.current ?? 0) + 1
    setLive([])
    // Every reply ends with a done or error event; a stream that stops
    // without one was cut off.
    let streaming = false
    let ended = false
    try {
      // The files go as base64 beside the words; the Mac saves them and
      // lists their paths under the message for Fable.
      const attachments = await Promise.all(
        going.map(async f => ({
          name: f.name,
          type: f.type,
          data: await base64Of(f.file),
        }))
      )
      const res = await call(
        '/chat',
        attachments.length ? { message: msg, attachments } : { message: msg }
      )
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      streaming = true
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let cut = buf.indexOf('\n\n')
        while (cut >= 0) {
          const chunk = buf.slice(0, cut)
          buf = buf.slice(cut + 2)
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              const ev = JSON.parse(line.slice(6)) as Event
              if (ev.type === 'done' || ev.type === 'error') ended = true
              handle(ev)
            } catch {
              // a half line; the next chunk completes it
            }
          }
          cut = buf.indexOf('\n\n')
        }
      }
      if (!ended) await cutOff()
    } catch (e) {
      if (streaming && !ended) {
        await cutOff()
      } else {
        setError(
          e instanceof Error ? e.message : 'The Mac agent did not answer.'
        )
        setLive(null)
        setNote(null)
      }
    } finally {
      setBusy(false)
    }
  }

  // The next waiting message goes the moment the reply before it ends –
  // stopped or finished (or the Mac finishes one it was still writing after
  // a reload).
  const deliverRef = useRef(deliver)
  deliverRef.current = deliver
  const queuedRef = useRef(queued)
  queuedRef.current = queued
  useEffect(() => {
    if (busy || pending || queued.length === 0) return
    const [next, ...rest] = queued
    queuedRef.current = rest
    setQueued(rest)
    void deliverRef.current(next.text, next.files)
  }, [busy, pending, queued])

  // Messages still waiting when the panel closes – Bryce moved to another
  // item before the stopped reply ended – go anyway, as one message. The Mac
  // answers in the background and the item shows under "Fable chats".
  // Before, they were thrown away, and the reply they had stopped was never
  // answered (8 Oct 2026, Mexico Tech Policy Panel).
  const callRef = useRef(call)
  callRef.current = call
  useEffect(
    () => () => {
      const waiting = queuedRef.current
      if (waiting.length === 0) return
      const msg = waiting
        .map(q => q.text)
        .filter(Boolean)
        .join('\n\n')
      const going = waiting.flatMap(q => q.files)
      void (async () => {
        const attachments = await Promise.all(
          going.map(async f => ({
            name: f.name,
            type: f.type,
            data: await base64Of(f.file),
          }))
        )
        const res = await callRef.current(
          '/chat',
          attachments.length ? { message: msg, attachments } : { message: msg }
        )
        if (!res.ok) {
          console.warn(
            `Queue chat: a waiting message was not taken (HTTP ${res.status})`
          )
        }
        // The Mac keeps answering after the page lets go of the stream.
        await res.body?.cancel()
      })().catch(e => {
        console.warn('Queue chat: a waiting message did not reach the Mac', e)
      })
    },
    []
  )

  const startOver = async () => {
    if (busy || pending) return
    try {
      const res = await call('/chat/clear', {})
      if (res.ok) {
        setMessages([])
        setQueued([])
      }
    } catch {
      setError('The Mac agent did not answer.')
    }
  }

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }

  // Keep the half-typed message for this item; sending it clears the box
  // and so the draft.
  const itemId = item.id
  useEffect(() => saveDraft(itemId, text, quote), [itemId, text, quote])
  useEffect(() => {
    if (files.length) draftFiles.set(itemId, files)
    else draftFiles.delete(itemId)
  }, [itemId, files])
  // A draft brought back is as tall as it was.
  useEffect(() => {
    if (inputRef.current?.value) grow(inputRef.current)
  }, [])

  const thread = messages ?? []
  const hasThread = thread.length > 0 || live !== null

  return (
    <div
      className={`${styles.chat}${dragging ? ` ${styles.chatDropping}` : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {hasThread && (
        <div className={styles.chatThread}>
          {thread.map((m, i) =>
            m.role === 'you' ? (
              <div key={i} className={styles.chatMsg}>
                <span className={styles.chatWho}>You</span>
                <YouText
                  text={m.text ?? ''}
                  attachments={m.attachments}
                  fetchFile={fetchFile}
                />
              </div>
            ) : m.role === 'error' ? (
              <p key={i} className={styles.chatError}>
                {m.text}
              </p>
            ) : (
              <div key={i} className={styles.chatMsg}>
                <span className={styles.chatWho}>Fable</span>
                {m.note && <p className={styles.chatTool}>{m.note}</p>}
                <Parts
                  parts={m.parts ?? []}
                  edits={edits}
                  reply={reply}
                  canEditField={canEditField}
                  decided={decided}
                  acts={actsFor(m)}
                  cap={cap}
                />
                {m.flag !== undefined && (
                  <FlagCard
                    raw={m.flag}
                    item={item}
                    decided={decided}
                    onFlag={onFlag}
                  />
                )}
              </div>
            )
          )}
          {live !== null && (
            <div className={styles.chatMsg}>
              <span className={styles.chatWho}>Fable</span>
              {note && <p className={styles.chatTool}>{note}</p>}
              <Parts
                parts={live}
                edits={edits}
                reply={reply}
                canEditField={canEditField}
                decided={decided}
                streaming
                cap={cap}
              />
              <p className={styles.chatStatus}>{statusLine(live)}</p>
            </div>
          )}
          {pending && live === null && (
            <p className={styles.chatTool}>
              Fable is still answering an earlier message…
            </p>
          )}
          {queued.map((q, i) => (
            <div
              key={`q${i}`}
              className={`${styles.chatMsg} ${styles.chatQueued}`}
            >
              <span className={styles.chatWho}>You · sending</span>
              <YouText text={q.text} attachments={asSent(q.files)} />
              <button
                type="button"
                className={styles.chatLink}
                onClick={() => setQueued(qs => qs.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
      {error && <p className={styles.chatError}>{error}</p>}
      {pick && (
        <button
          type="button"
          className={styles.chatReplyBtn}
          style={{ left: pick.x, top: pick.y + 6 }}
          onMouseDown={e => e.preventDefault()}
          onClick={takeQuote}
        >
          Reply
        </button>
      )}
      <div className={styles.chatInputRow}>
        {quote && (
          <div className={styles.chatQuoteChip}>
            <span className={styles.chatQuoteText}>{quote}</span>
            <button
              type="button"
              className={styles.chatQuoteX}
              aria-label="Drop the quote"
              onClick={() => setQuote(null)}
            >
              ×
            </button>
          </div>
        )}
        {files.length > 0 && (
          <div className={styles.chatFiles}>
            {files.map((f, i) => (
              <span key={i} className={styles.chatFileChip} title={f.name}>
                {f.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt="" className={styles.chatFileThumb} />
                ) : (
                  <Icon src="/images/icons/paper.svg" size={16} />
                )}
                <span className={styles.chatFileName}>{f.name}</span>
                <button
                  type="button"
                  className={styles.chatQuoteX}
                  aria-label={`Remove ${f.name}`}
                  onClick={() => dropFile(i)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className={styles.chatBox}>
          <textarea
            ref={inputRef}
            className={styles.chatInput}
            rows={1}
            placeholder={
              quote
                ? 'Your reply to that…'
                : files.length
                  ? 'Anything to add? Enter sends…'
                  : thread.length
                    ? 'Reply…'
                    : 'Ask Fable, or say what should change…'
            }
            value={text}
            onChange={e => setText(e.target.value)}
            onInput={e => grow(e.currentTarget)}
            onPaste={e => {
              // A screenshot on the clipboard lands as a file.
              const pasted = e.clipboardData?.files
              if (pasted && pasted.length > 0) {
                e.preventDefault()
                addFiles(pasted)
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              } else if (e.key === 'Escape' && quote) {
                e.preventDefault()
                setQuote(null)
              }
            }}
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={e => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className={styles.chatAttach}
            aria-label="Attach a file"
            title="Attach a file – or paste or drop one here"
            onClick={() => fileRef.current?.click()}
          >
            <Icon src="/images/icons/paperclip.svg" size={16} />
          </button>
        </div>
        {thread.length > 0 && (
          // Always there once a thread exists, so the panel's foot keeps
          // its height while Fable answers (the box looked cut off at the
          // bottom edge without it – Bryce, 15 Sept 2026).
          <div className={styles.chatHint}>
            <span>{queued.length > 0 ? `${queued.length} waiting` : ''}</span>
            {!busy && !pending && (
              <button
                type="button"
                className={styles.chatLink}
                onClick={() => void startOver()}
              >
                Start over
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** A message of Bryce's: a quoted passage (lines starting "> ") as a
 *  quote block, then his words, then the files that went with it. */
function YouText({
  text,
  attachments,
  fetchFile,
}: {
  text: string
  attachments?: Attachment[]
  fetchFile?: (file: string) => Promise<Blob>
}) {
  const lines = text.split('\n')
  const quoted: string[] = []
  let i = 0
  while (i < lines.length && lines[i].startsWith('> ')) {
    quoted.push(lines[i].slice(2))
    i++
  }
  const rest = lines.slice(i).join('\n').trim()
  return (
    <div className={styles.chatYou}>
      {quoted.length > 0 && (
        <blockquote className={styles.chatQuoteBlock}>
          {quoted.join('\n')}
        </blockquote>
      )}
      {rest}
      {attachments && attachments.length > 0 && (
        <div className={styles.chatSent}>
          {attachments.map((a, i) => (
            <Sent key={i} att={a} fetchFile={fetchFile} />
          ))}
        </div>
      )}
    </div>
  )
}

/** One file in the thread: a picture as a thumbnail that opens full size
 *  in a new tab, anything else as a chip with its name that opens the
 *  file. A file from an earlier visit is fetched back from the Mac. */
function Sent({
  att,
  fetchFile,
}: {
  att: Attachment
  fetchFile?: (file: string) => Promise<Blob>
}) {
  const isImage = att.type.startsWith('image/')
  const [src, setSrc] = useState<string | null>(att.url ?? null)
  const madeRef = useRef<string | null>(null)
  useEffect(() => {
    if (att.url || !isImage || !att.file || !fetchFile) return
    let alive = true
    fetchFile(att.file)
      .then(b => {
        if (!alive) return
        madeRef.current = URL.createObjectURL(b)
        setSrc(madeRef.current)
      })
      .catch(() => {})
    return () => {
      alive = false
      if (madeRef.current) URL.revokeObjectURL(madeRef.current)
      madeRef.current = null
    }
  }, [att.url, att.file, fetchFile, isImage])
  const open = async () => {
    if (src) {
      window.open(src, '_blank', 'noopener')
      return
    }
    if (!att.file || !fetchFile) return
    try {
      const b = await fetchFile(att.file)
      window.open(URL.createObjectURL(b), '_blank', 'noopener')
    } catch {
      // the Mac did not answer; nothing to open
    }
  }
  if (isImage && src) {
    return (
      <button
        type="button"
        className={styles.chatSentPic}
        onClick={() => void open()}
        title={att.name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={att.name} />
      </button>
    )
  }
  return (
    <button
      type="button"
      className={styles.chatFileChip}
      onClick={() => void open()}
      title={att.name}
    >
      <Icon src="/images/icons/paper.svg" size={16} />
      <span className={styles.chatFileName}>{att.name}</span>
    </button>
  )
}

/** Pending files as the thread shows them (their own object URLs). */
function asSent(files: Pending[]): Attachment[] {
  return files.map(f => ({
    name: f.name,
    type: f.type,
    size: f.size,
    file: '',
    url: f.url,
  }))
}

/** A file's bytes as base64, the way the Mac agent takes them. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.onerror = () => reject(new Error(`${file.name} could not be read.`))
    r.readAsDataURL(file)
  })
}

/** What Fable is doing right now, for the one line under a reply in
 *  progress: its latest lookup, or "Thinking…" before anything has come. */
function statusLine(live: Part[]): string {
  for (let i = live.length - 1; i >= 0; i--) {
    const p = live[i]
    if (p.t === 'tool') return p.label + '…'
    if (p.t === 'text') return 'Writing…'
  }
  return 'Thinking…'
}

function isCommand(label: string): boolean {
  return label.startsWith('Ran: ')
}

/** The one piece of prose a reply shows: its answer. Text written between
 *  lookups is Fable thinking out loud ("I'll read the record…", "Next I
 *  need…") and is hidden (Bryce, 24 Sept 2026: "I don't want to see the
 *  thinking process"). A finished reply shows its last piece of text; one
 *  still coming shows text only once nothing has followed it, so a line
 *  written before a lookup goes when the lookup starts. */
function answerPart(parts: Part[], streaming: boolean): number {
  if (streaming)
    return parts.length && parts[parts.length - 1].t === 'text'
      ? parts.length - 1
      : -1
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p.t === 'text' && p.text.trim()) return i
  }
  return -1
}

/** Fable's reply: its answer, with any ```edits blocks turned into Apply
 *  cards, and the notes worth keeping ("Saved a memory: …"). */
function Parts({
  parts,
  edits,
  reply,
  canEditField,
  decided,
  acts,
  streaming,
  cap,
}: {
  parts: Part[]
  edits: Record<string, string>
  reply: string | null
  canEditField: (field: string) => boolean
  decided: Decided | null
  /** Missing while the reply is still being written. */
  acts?: CardActs
  streaming?: boolean
  cap: DescCap
}) {
  const answer = answerPart(parts, Boolean(streaming))
  return (
    <div className={styles.chatFable}>
      {parts.map((p, i) =>
        // The "Ran: <command>" lines stay in the thread saved on the Mac but
        // are not shown here (Bryce, 23 Sept 2026: "I don't want to see all
        // this ugly grey text").
        p.t === 'tool' ||
        (p.t === 'note' && isCommand(p.label)) ? null : p.t === 'note' ? (
          <p key={i} className={styles.chatTool}>
            {p.label}
          </p>
        ) : (
          <Prose
            key={i}
            text={p.text}
            edits={edits}
            reply={reply}
            canEditField={canEditField}
            decided={decided}
            acts={acts}
            caret={Boolean(streaming) && i === answer}
            blocksOnly={i !== answer}
            cap={cap}
          />
        )
      )}
    </div>
  )
}

function Prose({
  text,
  edits,
  reply,
  canEditField,
  decided,
  acts,
  caret,
  blocksOnly,
  cap,
}: {
  text: string
  edits: Record<string, string>
  reply: string | null
  canEditField: (field: string) => boolean
  decided: Decided | null
  acts?: CardActs
  caret: boolean
  /** Text that isn't the answer: only its edits and reply cards show, so a
   *  change Fable proposed before its last lookup still has its Undo. */
  blocksOnly: boolean
  cap: DescCap
}) {
  const out: React.ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(BLOCK_RE)) {
    const i = m.index ?? 0
    if (i > last && !blocksOnly)
      out.push(<Markdown key={`t${n}`} text={text.slice(last, i)} />)
    if (m[1] === 'reply') {
      out.push(
        <ReplyCard
          key={`r${n}`}
          proposed={m[2].trim()}
          current={reply}
          decided={decided}
          acts={acts}
        />
      )
    } else {
      const parsed = parseEdits(m[2])
      out.push(
        parsed ? (
          <EditsCard
            key={`e${n}`}
            proposed={parsed}
            edits={edits}
            canEditField={canEditField}
            decided={decided}
            acts={acts}
            cap={cap}
          />
        ) : (
          <pre key={`e${n}`} className={styles.chatPre}>
            {m[2]}
          </pre>
        )
      )
    }
    last = i + m[0].length
    n++
  }
  if (last < text.length && !blocksOnly)
    out.push(<Markdown key={`t${n}`} text={text.slice(last)} />)
  return (
    <>
      {out}
      {caret && <span className={styles.chatCaret} />}
    </>
  )
}

/** Field values from a reply. They go on the page by themselves once the
 *  reply has landed (into the item's edits – the listing itself changes
 *  only with Accept); the card shows what changed with a small Undo, and
 *  a small Apply once they are off the page again (undone, or edited away
 *  by hand). On a decided item it only says whether they went out with
 *  the decision. */
function EditsCard({
  proposed,
  edits,
  canEditField,
  decided,
  acts,
  cap,
}: {
  proposed: Record<string, string>
  edits: Record<string, string>
  canEditField: (field: string) => boolean
  decided: Decided | null
  acts?: CardActs
  cap: DescCap
}) {
  // Only what the page can take: a formula or housekeeping field Fable
  // named is dropped rather than shown and silently skipped.
  const usable = Object.fromEntries(
    Object.entries(proposed).filter(([k]) => canEditField(k))
  )
  const keys = Object.keys(usable)
  const went = decided ? wentOut(usable, decided.sent) : []
  const applied = decided
    ? keys.length > 0 && went.length === keys.length
    : keys.length > 0 && keys.every(k => edits[k] === usable[k])
  if (keys.length === 0) {
    return (
      <p className={styles.chatTool}>
        The suggested edits name fields the page cannot change.
      </p>
    )
  }
  return (
    <div className={styles.chatEdits}>
      <span className={styles.chatWho}>
        {applied ? 'Changed on the listing' : 'Suggested edits'}
      </span>
      {keys.map(k => {
        const n = k === cap.field ? usable[k].trim().length : null
        return (
          <div key={k} className={styles.chatEditRow}>
            <span className={styles.label}>{k}</span>
            <span>
              {usable[k]}
              {n !== null && <CharCount n={n} cap={cap.cap} />}
            </span>
          </div>
        )
      })}
      {decided ? (
        <DecidedFoot
          done={applied}
          text={wentOutNote(keys, went, decided.label)}
        />
      ) : (
        <CardFoot
          applied={applied}
          appliedText="Applied – goes with Accept"
          offText="Not applied"
          waitText="Applies when Fable finishes"
          applyText="Apply"
          onApply={acts ? () => acts.applyEdits(usable) : undefined}
          undoText={keys.length > 1 ? 'Undo edits' : 'Undo edit'}
          undo={acts?.undoEdits}
        />
      )}
    </div>
  )
}

/** A new reply draft from a reply: put on the page's draft once the reply
 *  has landed (it is a draft – nothing is sent), with a small Undo. */
function ReplyCard({
  proposed,
  current,
  decided,
  acts,
}: {
  proposed: string
  current: string | null
  decided: Decided | null
  acts?: CardActs
}) {
  if (current === null) {
    return (
      <p className={styles.chatTool}>This item has no reply draft to update.</p>
    )
  }
  const applied = decided
    ? decided.reply?.trim() === proposed
    : current === proposed
  return (
    <div className={styles.chatEdits}>
      <span className={styles.chatWho}>
        {applied ? 'Reply draft, updated' : 'New reply draft'}
      </span>
      <pre className={styles.chatPre}>{proposed}</pre>
      {decided ? (
        <DecidedFoot
          done={applied}
          text={applied ? `Went with ${decided.label}` : 'Not used'}
        />
      ) : (
        <CardFoot
          applied={applied}
          appliedText="The draft on the page is updated"
          offText="Not the draft on the page"
          waitText="Goes on the draft when Fable finishes"
          applyText="Use it"
          onApply={acts ? () => acts.applyReply(proposed) : undefined}
          undoText="Undo"
          undo={acts?.undoReply}
        />
      )}
    </div>
  )
}

/** A field change's new value, as the card shows it. */
function shownValue(v: unknown): string {
  if (v === true) return 'ticked'
  if (v === false) return 'unticked'
  if (v === null || v === '') return 'empty'
  if (Array.isArray(v)) return v.map(x => String(x)).join(', ')
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/** The flag as Fable now sees it (queue-flag.ts; Bryce, 13 Oct 2026: "the
 *  chat should end with an 'update flag' button"). Unlike edits it is not
 *  applied when the reply lands: the button writes it onto the row, and
 *  Undo puts back what the row said before. On a decided item it only
 *  says whether the decision was made on it. */
function FlagCard({
  raw,
  item,
  decided,
  onFlag,
}: {
  raw: unknown
  item: QueueItem
  decided: Decided | null
  onFlag: (
    body: { flag: FlagUpdate } | { undo: true }
  ) => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsed = parseFlag(raw, item.type)
  if ('error' in parsed) {
    return (
      <p className={styles.chatTool}>
        Fable&apos;s new flag could not be used: {parsed.error}
      </p>
    )
  }
  const flag = parsed.flag
  const shown = flagShown(item, flag)
  const noun = item.type === 'Add' ? 'verdict' : 'flag'
  const run = async (body: { flag: FlagUpdate } | { undo: true }) => {
    setBusy(true)
    setError(null)
    const failed = await onFlag(body)
    setBusy(false)
    if (failed) setError(failed)
  }
  return (
    <div className={styles.chatEdits}>
      <span className={styles.chatWho}>
        {shown
          ? `${noun === 'flag' ? 'Flag' : 'Verdict'} updated`
          : `New ${noun}`}
      </span>
      <div className={styles.chatEditRow}>
        <span className={styles.label}>Verdict</span>
        <span>{verdictWords(flag.verdict)}</span>
      </div>
      <div className={styles.chatEditRow}>
        <span className={styles.label}>Reasons</span>
        <ul className={styles.reasons}>
          {flag.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
      {flag.title && (
        <div className={styles.chatEditRow}>
          <span className={styles.label}>Title</span>
          <span>{flag.title}</span>
        </div>
      )}
      {flag.changes && (
        <div className={styles.chatEditRow}>
          <span className={styles.label}>Changes</span>
          {flag.changes.length ? (
            <ul className={styles.reasons}>
              {flag.changes.map((c, i) => (
                <li key={i}>
                  {c.field} → {shownValue(c.to)}
                </li>
              ))}
            </ul>
          ) : (
            <span>None</span>
          )}
        </div>
      )}
      {flag.chips && (
        <div className={styles.chatEditRow}>
          <span className={styles.label}>Reject reasons</span>
          <ul className={styles.reasons}>
            {flag.chips.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {decided ? (
        <DecidedFoot
          done={shown}
          text={shown ? `Decided on this ${noun}` : 'Not used'}
        />
      ) : (
        <CardFoot
          applied={shown}
          appliedText={`The item shows this ${noun}`}
          applyText={busy ? 'Updating…' : `Update ${noun}`}
          onApply={() => void run({ flag })}
          undo={
            item.flagUndo && !busy ? () => void run({ undo: true }) : undefined
          }
          busy={busy}
        />
      )}
      {error && <p className={styles.chatError}>{error}</p>}
    </div>
  )
}

/** A card's foot on a decided item: what became of it, nothing to click. */
function DecidedFoot({ done, text }: { done: boolean; text: string }) {
  return (
    <div className={styles.chatCardFoot}>
      <span
        className={`${styles.chatTool} ${done ? '' : styles.chatNotApplied}`}
      >
        {text}
      </span>
    </div>
  )
}

function CardFoot({
  applied,
  appliedText,
  offText,
  waitText,
  applyText,
  onApply,
  undoText = 'Undo',
  undo,
  busy = false,
}: {
  applied: boolean
  appliedText: string
  /** Set on a card that applies by itself: once off the page its Apply is
   *  a small link beside these words, not a button. */
  offText?: string
  /** What such a card says while its reply is still being written
   *  (onApply missing). */
  waitText?: string
  applyText: string
  onApply?: () => void
  undoText?: string
  undo?: () => void
  /** A write is on its way: the button waits. */
  busy?: boolean
}) {
  if (applied) {
    return (
      <div className={styles.chatCardFoot}>
        <span className={styles.chatTool}>{appliedText}</span>
        {undo && (
          <button type="button" className={styles.chatLink} onClick={undo}>
            {undoText}
          </button>
        )}
      </div>
    )
  }
  if (offText !== undefined) {
    return (
      <div className={styles.chatCardFoot}>
        <span className={`${styles.chatTool} ${styles.chatNotApplied}`}>
          {onApply ? offText : waitText}
        </span>
        {onApply && (
          <button type="button" className={styles.chatLink} onClick={onApply}>
            {applyText}
          </button>
        )}
      </div>
    )
  }
  return (
    <div className={styles.chatCardFoot}>
      <button
        type="button"
        className={`${styles.button} ${styles.primary}`}
        disabled={busy}
        onClick={onApply}
      >
        {applyText}
      </button>
    </div>
  )
}

/** Just enough markdown: paragraphs, bullet lists, fenced code, **bold**,
 *  `code`, links. Fable writes short replies; anything fancier shows as
 *  text. */
function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = []
  const lines = text.split('\n')
  let para: string[] = []
  let list: string[] = []
  let code: string[] | null = null
  let n = 0
  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={n++}>
          {para.map((l, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {inline(l)}
            </span>
          ))}
        </p>
      )
      para = []
    }
  }
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={n++}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>
      )
      list = []
    }
  }
  for (const raw of lines) {
    if (code !== null) {
      if (raw.trim().startsWith('```')) {
        blocks.push(
          <pre key={n++} className={styles.chatPre}>
            {code.join('\n')}
          </pre>
        )
        code = null
      } else {
        code.push(raw)
      }
      continue
    }
    const line = raw.replace(/\s+$/, '')
    if (line.trim().startsWith('```')) {
      flushPara()
      flushList()
      code = []
    } else if (line.trim() === '') {
      flushPara()
      flushList()
    } else if (BULLET_RE.test(line)) {
      flushPara()
      list.push(line.replace(BULLET_RE, ''))
    } else if (/^#{1,4}\s/.test(line)) {
      flushPara()
      flushList()
      blocks.push(
        <p key={n++} className={styles.chatHead}>
          {inline(line.replace(/^#+\s/, ''))}
        </p>
      )
    } else if (list.length && /^\s{2,}/.test(raw)) {
      // a wrapped bullet continues the last one
      list[list.length - 1] += ' ' + line.trim()
    } else {
      flushList()
      para.push(line)
    }
  }
  if (code !== null) {
    blocks.push(
      <pre key={n++} className={styles.chatPre}>
        {code.join('\n')}
      </pre>
    )
  }
  flushPara()
  flushList()
  return <>{blocks}</>
}

function inline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of s.matchAll(INLINE_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push(s.slice(last, i))
    const tok = m[0]
    if (tok.startsWith('**')) {
      out.push(<strong key={n++}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      out.push(<code key={n++}>{tok.slice(1, -1)}</code>)
    } else if (LINK_RE.test(tok)) {
      LINK_RE.lastIndex = 0
      const trimmed = tok.replace(/[.,;:]+$/, '')
      out.push(
        <a key={n++} href={trimmed} target="_blank" rel="noreferrer">
          {trimmed.replace(/^https?:\/\//, '')}
        </a>
      )
      if (trimmed.length < tok.length) out.push(tok.slice(trimmed.length))
    } else {
      out.push(tok)
    }
    last = i + tok.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
