'use client'

/*
  The work test's screen: the admin Queue's look (its stylesheet is reused
  as it is) around a fixed set of past suggestions. One item in focus, Fable's
  verdict beside it, and a decision plus a one-line reason at the foot.

  Unlike the Queue, nothing here acts on a listing: a decision is only saved
  as the candidate's answer (/api/work-test). Answers save as they are made;
  submitting a round locks it and moves on.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDate } from '@/lib/format-date'
import {
  CHANGE_DECISIONS,
  DECISIONS,
  isComplete,
  type Answer,
  type BriefingItem,
  type Move,
  type Part,
  type PublicItem,
  type ReviewLine,
  type Stage,
  type WorkTestState,
} from '@/lib/work-test/flow'
import q from '../../admin/queue/queue.module.css'
import s from './work-test.module.css'

const API = '/api/work-test'
const POLICY = 'https://www.aisafety.com/listing-policy'

/** How long typing rests before it is saved. */
const SAVE_AFTER_MS = 700

type SaveState = 'saving' | 'saved' | 'failed'

const STAGE_LABEL: Record<Stage, string> = {
  intro: 'Briefing',
  round1: 'Round one',
  review: 'Round one, what we decided',
  round2: 'Round two',
  part4: 'Checks and replies',
  done: 'Finished',
}

const GROUP_TITLE: Record<Part, string> = {
  Briefing: 'Briefing',
  'Round one': 'Round one',
  'Round two': 'Round two',
  'Change check': 'Change checks',
  Description: 'Descriptions',
  Reply: 'Replies',
  'Push back': 'Push back',
}

const SUBMIT_LABEL: Partial<Record<Stage, string>> = {
  round1: 'Submit round one',
  round2: 'Submit round two',
  part4: 'Submit and finish',
}

function verdictClass(verdict: string): string {
  if (verdict === 'Publish' || verdict === 'Fix') return q.yes
  if (verdict === 'Unsure') return q.maybe
  return verdict ? q.no : ''
}

function niceDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : formatDate(d)
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)
  )
}

const EMPTY: Answer = { answer: '', text: '' }

export default function WorkTest({
  token,
  initial,
}: {
  token: string
  initial: WorkTestState
}) {
  const [state, setState] = useState(initial)
  const [drafts, setDrafts] = useState<Record<string, Answer>>(initial.answers)
  const [selected, setSelected] = useState(initial.items[0]?.key ?? '')
  const [saves, setSaves] = useState<Record<string, SaveState>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<'briefing' | 'review' | null>(null)

  // What is waiting to be saved, and the saves on their way, so a submit
  // can wait for every one of them.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const latest = useRef(new Map<string, Answer>())
  const inFlight = useRef(new Set<Promise<void>>())

  const send = useCallback(
    (key: string): Promise<void> => {
      const answer = latest.current.get(key)
      if (!answer) return Promise.resolve()
      latest.current.delete(key)
      setSaves(v => ({ ...v, [key]: 'saving' }))
      const run = fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'save', key, ...answer }),
      })
        .then(res => {
          if (!res.ok) throw new Error(`Save failed with ${res.status}`)
          setSaves(v => ({ ...v, [key]: 'saved' }))
        })
        .catch((e: unknown) => {
          // Kept for the next try, unless a newer edit is already waiting.
          if (!latest.current.has(key)) latest.current.set(key, answer)
          setSaves(v => ({ ...v, [key]: 'failed' }))
          console.warn('Work test: an answer was not saved', e)
        })
        .finally(() => {
          inFlight.current.delete(run)
        })
      inFlight.current.add(run)
      return run
    },
    [token]
  )

  const change = useCallback(
    (key: string, next: Answer, now: boolean) => {
      setDrafts(v => ({ ...v, [key]: next }))
      latest.current.set(key, next)
      const waiting = timers.current.get(key)
      if (waiting) clearTimeout(waiting)
      if (now) {
        timers.current.delete(key)
        void send(key)
      } else {
        timers.current.set(
          key,
          setTimeout(() => {
            timers.current.delete(key)
            void send(key)
          }, SAVE_AFTER_MS)
        )
      }
    },
    [send]
  )

  /** Sends everything still waiting and waits for it to land. */
  const flush = useCallback(async () => {
    for (const [key, timer] of timers.current) {
      clearTimeout(timer)
      timers.current.delete(key)
    }
    await Promise.all([...latest.current.keys()].map(send))
    await Promise.all([...inFlight.current])
    return latest.current.size === 0
  }, [send])

  // Typing that has not been saved yet is sent when the tab is hidden or
  // closed, so a pause of less than a second is never lost.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [flush])

  const move = useCallback(
    async (action: Move) => {
      setBusy(true)
      setError('')
      try {
        if (!(await flush())) {
          setError(
            'Some answers have not saved. Check your connection and try again.'
          )
          return
        }
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, action }),
        })
        const data = (await res.json()) as {
          state?: WorkTestState
          error?: string
          missing?: string[]
        }
        if (!res.ok || !data.state) {
          if (data.missing?.[0]) setSelected(data.missing[0])
          setError(data.error ?? 'That did not work. Try again.')
          return
        }
        setState(data.state)
        setDrafts(data.state.answers)
        setSelected(data.state.items[0]?.key ?? '')
        setSaves({})
        setPanel(null)
        window.scrollTo(0, 0)
      } catch (e) {
        console.warn('Work test: the step failed', e)
        setError('That did not work. Check your connection and try again.')
      } finally {
        setBusy(false)
      }
    },
    [flush, token]
  )

  const { stage, items } = state
  const current = items.find(i => i.key === selected) ?? items[0]
  const done = items.filter(i => isComplete(i, drafts[i.key])).length
  const working = stage === 'round1' || stage === 'round2' || stage === 'part4'

  // J and K move through the list, as in the Queue.
  useEffect(() => {
    if (!working || panel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      const step = e.key === 'j' ? 1 : e.key === 'k' ? -1 : 0
      if (!step) return
      const at = items.findIndex(i => i.key === selected)
      const next = items[at + step]
      if (next) setSelected(next.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [working, panel, items, selected])

  const groups = useMemo(() => {
    const out: { part: Part; items: PublicItem[] }[] = []
    for (const item of items) {
      const last = out[out.length - 1]
      if (last && last.part === item.part) last.items.push(item)
      else out.push({ part: item.part, items: [item] })
    }
    return out
  }, [items])

  const submitLabel = SUBMIT_LABEL[stage]

  return (
    <div className={`${q.queue} ${s.root}`}>
      <header className={q.top}>
        <div className={q.topLeft}>
          <h1 className={q.h1}>Queue</h1>
          <span className={q.topMeta}>Work test · {STAGE_LABEL[stage]}</span>
        </div>
        <div className={`${q.topRight} ${s.topRight}`}>
          {working && (
            <span className={q.topMeta}>
              {done} of {items.length} done
            </span>
          )}
          {working && (
            <button
              type="button"
              className={q.ghost}
              onClick={() => setPanel(panel === 'briefing' ? null : 'briefing')}
            >
              {panel === 'briefing' ? 'Back to the items' : 'Briefing'}
            </button>
          )}
          {stage === 'round2' && (
            <button
              type="button"
              className={q.ghost}
              onClick={() => setPanel(panel === 'review' ? null : 'review')}
            >
              {panel === 'review' ? 'Back to the items' : 'Round one answers'}
            </button>
          )}
          {submitLabel && (
            <button
              type="button"
              className={`${q.button} ${q.primary}`}
              disabled={busy || done < items.length}
              onClick={() => void move('submit')}
            >
              {submitLabel}
            </button>
          )}
        </div>
      </header>

      {error && <p className={`${q.error} ${s.banner}`}>{error}</p>}

      {stage === 'intro' && (
        <div className={s.page}>
          <Briefing items={state.briefing} />
          <div className={s.pageFoot}>
            <button
              type="button"
              className={`${q.button} ${q.primary}`}
              disabled={busy}
              onClick={() => void move('start')}
            >
              Start round one
            </button>
          </div>
        </div>
      )}

      {stage === 'review' && (
        <div className={s.page}>
          <Review lines={state.review} />
          <div className={s.pageFoot}>
            <button
              type="button"
              className={`${q.button} ${q.primary}`}
              disabled={busy}
              onClick={() => void move('next')}
            >
              Start round two
            </button>
          </div>
        </div>
      )}

      {stage === 'done' && (
        <div className={s.page}>
          <div className={s.prose}>
            <h2 className={q.title}>That&apos;s everything</h2>
            <p>
              Thank you. Your answers are in, and we&apos;ll be in touch soon.
            </p>
          </div>
        </div>
      )}

      {working && panel === 'briefing' && (
        <div className={s.page}>
          <Briefing items={state.briefing} />
        </div>
      )}

      {working && panel === 'review' && (
        <div className={s.page}>
          <Review lines={state.review} />
        </div>
      )}

      {working && !panel && current && (
        <div className={`${q.split} ${s.split}`}>
          <div className={q.listCol}>
            <div className={q.list}>
              {groups.map(group => (
                <div key={group.part} className={q.group}>
                  <div className={`${q.groupHead} ${q.groupHeadStatic}`}>
                    {GROUP_TITLE[group.part]}
                    <span className={q.groupCount}>{group.items.length}</span>
                  </div>
                  {group.items.map(item => {
                    const a = drafts[item.key]
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`${q.row} ${item.key === current.key ? q.rowActive : ''}`}
                        onClick={() => setSelected(item.key)}
                      >
                        <span
                          className={`${s.dot} ${isComplete(item, a) ? s.dotDone : ''}`}
                          aria-hidden
                        />
                        <span className={q.rowBody}>
                          <span className={q.rowTitle}>{item.name}</span>
                          <span className={q.rowMeta}>
                            {item.page && <span>{item.page}</span>}
                            {a?.answer && <span>{a.answer}</span>}
                            {a?.answer && a.text.trim() === '' && (
                              <span className={q.maybe}>Needs a reason</span>
                            )}
                            {saves[item.key] === 'failed' && (
                              <span className={q.no}>Not saved</span>
                            )}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className={q.detail} key={current.key}>
            <Detail
              item={current}
              answer={drafts[current.key] ?? EMPTY}
              save={saves[current.key]}
              onChange={(next, now) => change(current.key, next, now)}
              onRetry={() => void send(current.key)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── One item ───────────────────────────────────────────────────────────────

function Detail({
  item,
  answer,
  save,
  onChange,
  onRetry,
}: {
  item: PublicItem
  answer: Answer
  save: SaveState | undefined
  onChange: (next: Answer, now: boolean) => void
  onRetry: () => void
}) {
  const decision = item.part === 'Round one' || item.part === 'Round two'
  const check = item.part === 'Change check'
  const hasAside = decision || check || item.part === 'Description'
  const [message, ask] = item.prompt.split('\n---\n')

  const status = (
    <span className={s.status} role="status">
      {save === 'saving' && 'Saving'}
      {save === 'saved' && 'Saved'}
      {save === 'failed' && (
        <>
          <span className={q.no}>Not saved.</span>{' '}
          <button type="button" className={q.linkButton} onClick={onRetry}>
            Try again
          </button>
        </>
      )}
    </span>
  )

  return (
    <div className={`${q.detailInner} ${hasAside ? q.detailTwoCol : ''}`}>
      <div className={q.detailMain}>
        <div className={q.detailHead}>
          <div className={q.pills}>
            {item.page &&
              (item.page.startsWith('/') ? (
                <a
                  className={q.pageTag}
                  href={item.page}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.page}
                </a>
              ) : (
                <span className={q.pageTag}>{item.page}</span>
              ))}
            {item.decidedOn && (
              <span className={q.when}>
                Decided {niceDate(item.decidedOn)}. Judge it as if today were
                that date.
              </span>
            )}
          </div>
          <h2 className={q.title}>{item.name}</h2>
          {item.link && (
            <div>
              <a href={item.link} target="_blank" rel="noopener noreferrer">
                {hostOf(item.link)} ↗
              </a>
            </div>
          )}
        </div>

        {decision && (
          <>
            {item.description && (
              <div className={q.block}>
                <h3 className={q.h3}>Description</h3>
                <div className={q.value}>{item.description}</div>
              </div>
            )}
            <FieldList fields={item.fields} />
            {item.related && (
              <div className={q.block}>
                <h3 className={q.h3}>Related listings already on the site</h3>
                <div className={q.value}>{item.related}</div>
              </div>
            )}
          </>
        )}

        {check && (
          <>
            <div className={q.block}>
              <h3 className={q.h3}>What Broom found</h3>
              <div className={q.value}>{item.prompt}</div>
            </div>
            <div className={q.block}>
              <h3 className={q.h3}>Proposed change</h3>
              <div className={q.diffRow}>
                <span className={q.label}>{item.fields.Field}</span>
                <span className={q.from}>{item.fields.Now}</span>
                <span className={q.arrow} aria-hidden>
                  →
                </span>
                <span className={q.to}>{item.fields.Proposed}</span>
              </div>
            </div>
            <div className={q.note}>
              Open the organization&apos;s site and check it as it is today.
            </div>
          </>
        )}

        {item.part === 'Description' && (
          <>
            <div className={q.block}>
              <h3 className={q.h3}>As submitted</h3>
              <div className={q.quote}>{item.description}</div>
            </div>
            <div className={q.note}>{item.prompt}</div>
            <div className={q.block}>
              <h3 className={q.h3}>Your version</h3>
              <textarea
                className={q.input}
                rows={5}
                value={answer.text}
                onChange={e =>
                  onChange({ answer: '', text: e.target.value }, false)
                }
                onBlur={() => onChange(answer, true)}
              />
              <span className={q.when}>
                {answer.text.length} characters.{' '}
                {item.page === '/events' || item.page === '/training'
                  ? 'This page takes 150 to 220.'
                  : 'This page takes 180 at most.'}
              </span>
            </div>
          </>
        )}

        {item.part === 'Reply' && (
          <>
            {item.source && <div className={q.when}>{item.source}</div>}
            <div className={q.block}>
              <h3 className={q.h3}>What they wrote</h3>
              <div className={q.quote}>{message}</div>
            </div>
            {ask && <div className={q.note}>{ask}</div>}
            <div className={q.block}>
              <h3 className={q.h3}>Your reply</h3>
              <textarea
                className={q.input}
                rows={7}
                value={answer.text}
                onChange={e =>
                  onChange({ answer: '', text: e.target.value }, false)
                }
                onBlur={() => onChange(answer, true)}
              />
            </div>
          </>
        )}

        {item.part === 'Push back' && (
          <div className={q.block}>
            <div className={q.value}>{item.prompt}</div>
            <textarea
              className={q.input}
              rows={8}
              value={answer.text}
              onChange={e =>
                onChange({ answer: '', text: e.target.value }, false)
              }
              onBlur={() => onChange(answer, true)}
            />
          </div>
        )}

        {!decision && !check && status}
      </div>

      {(decision || check) && (
        <aside
          className={`${q.detailAside} ${verdictClass(item.fableVerdict)}`}
        >
          {item.source && (
            <div className={q.asideFound}>
              <span className={q.verdictKicker}>Source</span>
              <span>{item.source}</span>
            </div>
          )}
          <div className={q.verdictHead}>
            <span className={q.verdictKicker}>Fable says</span>
            <span className={q.verdictBig}>{item.fableVerdict}</span>
          </div>
          {item.fableReasons.length > 0 && (
            <ul className={q.reasons}>
              {item.fableReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </aside>
      )}

      {item.part === 'Description' && (
        <aside className={q.detailAside}>
          <div className={q.verdictHead}>
            <span className={q.verdictKicker}>House style</span>
          </div>
          <ul className={q.reasons}>
            <li>
              Plain and factual. Say what it is and what it covers, with no
              hype, no mission statements, and no &quot;we&quot;.
            </li>
            <li>
              Only what the organization&apos;s own page says. Never add a
              detail it doesn&apos;t state.
            </li>
            <li>
              Don&apos;t repeat what the card already shows, which is location,
              dates, length, deadline, and cost.
            </li>
            <li>Don&apos;t open by restating the name.</li>
            <li>
              Call the field &quot;AI safety&quot;. Use American English, and
              write numbers one to ten as words.
            </li>
            <li>Two sentences rather than one long one.</li>
          </ul>
        </aside>
      )}

      {(decision || check) && (
        <div className={q.actions}>
          <div className={`${q.buttons} ${s.decide}`}>
            {(decision ? DECISIONS : CHANGE_DECISIONS).map(choice => (
              <button
                key={choice}
                type="button"
                aria-pressed={answer.answer === choice}
                className={`${q.button} ${answer.answer === choice ? q.primary : ''}`}
                onClick={() => onChange({ ...answer, answer: choice }, true)}
              >
                {check && choice === 'Apply' ? 'Apply change' : choice}
              </button>
            ))}
            <input
              className={`${q.input} ${s.reason}`}
              type="text"
              maxLength={600}
              placeholder="Your reason, in one line"
              aria-label="Your reason, in one line"
              value={answer.text}
              onChange={e =>
                onChange({ ...answer, text: e.target.value }, false)
              }
              onBlur={() => onChange(answer, true)}
            />
            {status}
          </div>
        </div>
      )}
    </div>
  )
}

function FieldList({ fields }: { fields: Record<string, string> }) {
  const rows = Object.entries(fields)
  if (rows.length === 0) return null
  return (
    <div className={q.block}>
      <h3 className={q.h3}>Fields</h3>
      <div className={q.fields}>
        {rows.map(([label, value]) => (
          <div key={label} className={q.fieldRow}>
            <span className={q.label}>{label}</span>
            <span className={q.value}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Briefing and review ────────────────────────────────────────────────────

function Briefing({ items }: { items: BriefingItem[] }) {
  return (
    <div className={s.prose}>
      <h2 className={q.title}>How this works</h2>
      <p>
        This is a paid test of the main part of the job, which is deciding what
        gets listed on AISafety.com.
      </p>
      <p>
        People and Claude suggest listings. An AI reviewer, Fable, checks each
        one and gives a verdict, and then a person makes the final call. That
        person would be you. Fable is right much of the time, but not always,
        and the cases where it&apos;s wrong are why the role exists.
      </p>
      <p>
        We&apos;re trying to avoid testing what you already know about AI
        safety, instead testing how quickly you pick up how we decide.
      </p>
      <p>Here&apos;s what you&apos;ll do:</p>
      <ol>
        <li>
          Read this page and our{' '}
          <a href={POLICY} target="_blank" rel="noopener noreferrer">
            listing policy
          </a>
          . Remember the listing policy is incomplete (it&apos;s a WIP).
        </li>
        <li>Round one: Decide 12 real past suggestions.</li>
        <li>See what we actually decided in round one, and why.</li>
        <li>Round two: Decide 12 more. This round counts the most.</li>
        <li>
          Check three proposed changes, fix two descriptions, and reply to two
          real messages.
        </li>
        <li>
          Tell us one thing that&apos;s wrong with our policy or our process.
        </li>
      </ol>

      <h3 className={q.h3}>Your three choices</h3>
      <table className={s.table}>
        <tbody>
          <tr>
            <th scope="row">Publish</th>
            <td>It clears the policy for the page it was suggested for.</td>
          </tr>
          <tr>
            <th scope="row">Reject</th>
            <td>
              It doesn&apos;t, or it&apos;s the right thing in the wrong place
              or at the wrong time.
            </td>
          </tr>
          <tr>
            <th scope="row">Ask Bryce</th>
            <td>
              You can&apos;t settle it from the card and the policy. For
              example, it touches an earlier decision of ours and you can&apos;t
              see why we made it, or an organization is disputing one. This
              isn&apos;t a safe default. In the job, most items shouldn&apos;t
              need him (but some will).
            </td>
          </tr>
        </tbody>
      </table>

      <h3 className={q.h3}>Three things the policy doesn&apos;t spell out</h3>
      <ul>
        <li>
          <strong>Timing.</strong> An event that has already happened, or that
          happens the day we&apos;d list it, is too late. The same goes for a
          program whose applications have closed.
        </li>
        <li>
          <strong>Duplicates.</strong> Every item is a new suggestion, so if the
          same thing is already listed, it&apos;s a duplicate. In round two,
          check AISafety.com yourself before you decide.
        </li>
        <li>
          <strong>Fable&apos;s reasons.</strong> They&apos;re worth reading even
          when its verdict is wrong, since the facts it found are usually right.
        </li>
      </ul>

      <h3 className={q.h3}>A few rules</h3>
      <ul>
        <li>
          <strong>Round one</strong> uses past suggestions. Each shows the date
          we decided it, so judge it as if today were that date. Decide from
          what&apos;s on the card. <strong>Round two</strong> is judged as of
          today.
        </li>
        <li>Give each decision a one-line reason.</li>
        <li>
          You can use AI tools, but everything you write has to be in your own
          words.
        </li>
        <li>
          Your answers save as you go, so you can close this page and come back
          to it. Once you submit a round, it&apos;s locked.
        </li>
      </ul>

      {items.length > 0 && (
        <>
          <h3 className={q.h3}>Past decisions</h3>
          <p>
            These are real suggestions from the last two months, with what Fable
            said and what we did. These will help orient you somewhat.
          </p>
          <div className={s.scroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Suggestion</th>
                  <th scope="col">What it was</th>
                  <th scope="col">Fable said</th>
                  <th scope="col">We</th>
                  <th scope="col">
                    Why
                    <span className={s.sub}>
                      (approximately. It&apos;s what Bryce chose as the reason
                      when given 3 suggested reasons at the time of making the
                      decision)
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.key}>
                    <th scope="row">
                      {item.name}
                      <span className={s.sub}>{item.page}</span>
                    </th>
                    <td>{item.description}</td>
                    <td>{item.fableVerdict}</td>
                    <td>
                      {item.ourAnswer === 'Publish' ? 'Published' : 'Rejected'}
                    </td>
                    <td>{item.ourReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Review({ lines }: { lines: ReviewLine[] }) {
  const same = lines.filter(l => l.yourAnswer === l.ourAnswer).length
  return (
    <div className={s.prose}>
      <h2 className={q.title}>Round one, what we decided</h2>
      <p>
        You matched us on {same} of {lines.length}. Read our reasons before you
        start round two. You can come back to this page during round two.
      </p>
      <div className={s.scroll}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Suggestion</th>
              <th scope="col">You</th>
              <th scope="col">We</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(line => (
              <tr key={line.key}>
                <th scope="row">
                  {line.name}
                  <span className={s.sub}>{line.page}</span>
                </th>
                <td>
                  <span
                    className={
                      line.yourAnswer === line.ourAnswer ? q.yes : q.no
                    }
                  >
                    {line.yourAnswer}
                  </span>
                  <span className={s.sub}>{line.yourReason}</span>
                </td>
                <td className={s.nowrap}>{line.ourAnswer}</td>
                <td>{line.ourReason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
