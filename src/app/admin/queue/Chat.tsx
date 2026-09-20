'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import type { AgentInfo, QueueItem } from '@/lib/admin/queue'
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
// stuff"), and notes worth keeping ("Saved a memory: …").
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

/** What an auto-applied reply changed, so Undo can put it back. */
interface Undo {
  edits?: Record<string, string | undefined>
  reply?: string | null
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
function descriptionCap(item: QueueItem): DescCap {
  return {
    field:
      item.targetTable === PROJECTS_TABLE
        ? 'Description (short)'
        : 'Description',
    cap: item.page === '/events' || item.page === '/training' ? 220 : 180,
  }
}

export default function Chat({
  item,
  agent,
  edits,
  reply,
  canEditField,
  onSetEdits,
  onSetReply,
  onWrote,
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
  /** Replace the page's pending edits. */
  onSetEdits: (edits: Record<string, string>) => void
  /** Set the reply draft as edited on the page (null: as it came). */
  onSetReply: (text: string | null) => void
  /** A reply that changed Airtable has landed: re-read the live record. */
  onWrote?: () => void
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
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Text picked out of the panel to answer to: the Reply button that
  // appears over a selection, and the quote it leaves on the message.
  const [pick, setPick] = useState<{
    text: string
    x: number
    y: number
  } | null>(null)
  const [quote, setQuote] = useState<string | null>(null)
  // Messages typed while Fable was still answering. Sending one stops the
  // reply being written (the Mac kills that call; what it wrote stays, with
  // a note) and this goes as soon as its stream ends – like the Claude Code
  // app (Bryce, 15 Sept 2026: "make it interrupt it"). Several in a row go
  // in order.
  const [queued, setQueued] = useState<{ text: string; files: Pending[] }[]>([])
  // Files waiting to go with the next message, and whether one is being
  // dragged over the panel right now.
  const [files, setFiles] = useState<Pending[]>([])
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
  // Per reply (by its time stamp): what applying it changed, for Undo.
  const undoRef = useRef<Record<string, Undo>>({})
  // How many messages the page has already looked at for blocks to apply.
  const seenRef = useRef<number | null>(null)

  /** Apply the blocks in a reply that has just arrived. */
  const applyFrom = useCallback(
    (msg: Msg) => {
      if (msg.role !== 'fable') return
      if (msg.wrote) onWrote?.()
      const { edits: proposed, reply: draft } = blocksOf(textOf(msg))
      const undo: Undo = {}
      if (proposed) {
        const usable = Object.fromEntries(
          Object.entries(proposed).filter(([k]) => canEditField(k))
        )
        if (Object.keys(usable).length) {
          const before = editsRef.current
          undo.edits = Object.fromEntries(
            Object.keys(usable).map(k => [k, before[k]])
          )
          onSetEdits({ ...before, ...usable })
        }
      }
      if (draft && replyRef.current !== null) {
        undo.reply = replyRef.current
        onSetReply(draft)
      }
      if (undo.edits || undo.reply !== undefined) undoRef.current[msg.at] = undo
    },
    [canEditField, onSetEdits, onSetReply, onWrote]
  )

  const undoFor = (msg: Msg): (() => void) | undefined => {
    const u = undoRef.current[msg.at]
    if (!u) return undefined
    return () => {
      if (u.edits) {
        const next = { ...editsRef.current }
        for (const [k, v] of Object.entries(u.edits)) {
          if (v === undefined) delete next[k]
          else next[k] = v
        }
        onSetEdits(next)
      }
      if (u.reply !== undefined) onSetReply(u.reply)
      delete undoRef.current[msg.at]
    }
  }

  const call = useCallback(
    (path: string, body: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${agent.port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, id: item.id, token: agent.token }),
        cache: 'no-store',
      }),
    [agent.port, agent.token, item.id]
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
    // A reply that landed while the page was away (or reloading mid-answer)
    // still applies its blocks; ones from before the page opened do not –
    // they were applied when they came, and are on the row.
    if (seenRef.current !== null) {
      for (const msg of list.slice(seenRef.current)) applyFrom(msg)
    }
    seenRef.current = list.length
    setMessages(list)
    setPending(Boolean(data.pending))
  }, [call, applyFrom])

  useEffect(() => {
    let alive = true
    loadHistory().catch(e => {
      if (!alive) return
      setMessages([])
      setError(e instanceof Error ? e.message : 'The Mac agent did not answer.')
    })
    return () => {
      alive = false
    }
  }, [loadHistory])

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

  // Keep the newest words in view: the panel is its own scroll box.
  useEffect(() => {
    const box = endRef.current?.closest<HTMLElement>('[data-chat-scroll]')
    if (box) box.scrollTop = box.scrollHeight
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
              handle(JSON.parse(line.slice(6)) as Event)
            } catch {
              // a half line; the next chunk completes it
            }
          }
          cut = buf.indexOf('\n\n')
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The Mac agent did not answer.')
      setLive(null)
      setNote(null)
    } finally {
      setBusy(false)
    }
  }

  // The next waiting message goes the moment the reply before it ends –
  // stopped or finished (or the Mac finishes one it was still writing after
  // a reload).
  const deliverRef = useRef(deliver)
  deliverRef.current = deliver
  useEffect(() => {
    if (busy || pending || queued.length === 0) return
    const [next, ...rest] = queued
    setQueued(rest)
    void deliverRef.current(next.text, next.files)
  }, [busy, pending, queued])

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
                  onSetEdits={onSetEdits}
                  onSetReply={onSetReply}
                  undo={undoFor(m)}
                  cap={cap}
                />
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
                onSetEdits={onSetEdits}
                onSetReply={onSetReply}
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

function lastText(parts: Part[]): number {
  for (let i = parts.length - 1; i >= 0; i--)
    if (parts[i].t === 'text') return i
  return -1
}

/** Fable's reply: prose with any ```edits blocks turned into Apply cards,
 *  and the muted lines saying what was looked up on the way. */
function Parts({
  parts,
  edits,
  reply,
  canEditField,
  onSetEdits,
  onSetReply,
  undo,
  streaming,
  cap,
}: {
  parts: Part[]
  edits: Record<string, string>
  reply: string | null
  canEditField: (field: string) => boolean
  onSetEdits: (edits: Record<string, string>) => void
  onSetReply: (text: string | null) => void
  undo?: () => void
  streaming?: boolean
  cap: DescCap
}) {
  return (
    <div className={styles.chatFable}>
      {parts.map((p, i) =>
        p.t === 'tool' ? null : p.t === 'note' ? (
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
            onSetEdits={onSetEdits}
            onSetReply={onSetReply}
            undo={undo}
            caret={Boolean(streaming) && i === lastText(parts)}
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
  onSetEdits,
  onSetReply,
  undo,
  caret,
  cap,
}: {
  text: string
  edits: Record<string, string>
  reply: string | null
  canEditField: (field: string) => boolean
  onSetEdits: (edits: Record<string, string>) => void
  onSetReply: (text: string | null) => void
  undo?: () => void
  caret: boolean
  cap: DescCap
}) {
  const out: React.ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(BLOCK_RE)) {
    const i = m.index ?? 0
    if (i > last)
      out.push(<Markdown key={`t${n}`} text={text.slice(last, i)} />)
    if (m[1] === 'reply') {
      out.push(
        <ReplyCard
          key={`r${n}`}
          proposed={m[2].trim()}
          current={reply}
          onSet={onSetReply}
          undo={undo}
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
            onSet={onSetEdits}
            undo={undo}
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
  if (last < text.length)
    out.push(<Markdown key={`t${n}`} text={text.slice(last)} />)
  return (
    <>
      {out}
      {caret && <span className={styles.chatCaret} />}
    </>
  )
}

/** Field values from a reply. They are applied the moment the reply
 *  lands; the card shows what changed, with Undo, and turns back into an
 *  Apply button if the page's value is later edited away from it. */
function EditsCard({
  proposed,
  edits,
  canEditField,
  onSet,
  undo,
  cap,
}: {
  proposed: Record<string, string>
  edits: Record<string, string>
  canEditField: (field: string) => boolean
  onSet: (edits: Record<string, string>) => void
  undo?: () => void
  cap: DescCap
}) {
  // Only what the page can take: a formula or housekeeping field Fable
  // named is dropped rather than shown and silently skipped.
  const usable = Object.fromEntries(
    Object.entries(proposed).filter(([k]) => canEditField(k))
  )
  const keys = Object.keys(usable)
  const applied = keys.length > 0 && keys.every(k => edits[k] === usable[k])
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
              {n !== null && (
                <span
                  className={
                    n > cap.cap ? styles.chatCountOver : styles.chatCount
                  }
                >
                  {n > cap.cap
                    ? `${n} characters – over the ${cap.cap} cap`
                    : `${n} / ${cap.cap} characters`}
                </span>
              )}
            </span>
          </div>
        )
      })}
      <CardFoot
        applied={applied}
        appliedText="Applied – goes with Accept"
        applyText="Apply to the listing"
        onApply={() => onSet({ ...edits, ...usable })}
        undo={undo}
      />
    </div>
  )
}

/** A new reply draft from a reply: put on the page's draft the moment it
 *  lands (it is a draft – nothing is sent), with Undo. */
function ReplyCard({
  proposed,
  current,
  onSet,
  undo,
}: {
  proposed: string
  current: string | null
  onSet: (text: string | null) => void
  undo?: () => void
}) {
  if (current === null) {
    return (
      <p className={styles.chatTool}>This item has no reply draft to update.</p>
    )
  }
  const applied = current === proposed
  return (
    <div className={styles.chatEdits}>
      <span className={styles.chatWho}>
        {applied ? 'Reply draft, updated' : 'New reply draft'}
      </span>
      <pre className={styles.chatPre}>{proposed}</pre>
      <CardFoot
        applied={applied}
        appliedText="The draft on the page is updated"
        applyText="Use as the reply draft"
        onApply={() => onSet(proposed)}
        undo={undo}
      />
    </div>
  )
}

function CardFoot({
  applied,
  appliedText,
  applyText,
  onApply,
  undo,
}: {
  applied: boolean
  appliedText: string
  applyText: string
  onApply: () => void
  undo?: () => void
}) {
  return (
    <div className={styles.chatCardFoot}>
      {applied ? (
        <>
          <span className={styles.chatTool}>{appliedText}</span>
          {undo && (
            <button type="button" className={styles.chatLink} onClick={undo}>
              Undo
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          onClick={onApply}
        >
          {applyText}
        </button>
      )}
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
