'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ACCESS_AREAS,
  DEFAULT_NEW_ACCESS,
  describeAccess,
  type AccessFlags,
} from '@/lib/admin/access'
import {
  decodePending,
  encodePending,
  type PendingAction,
  type PendingState,
  REQUESTS_API,
  USERS_API,
} from '@/lib/admin/users-pending'
import adminStyles from '../admin.module.css'
import styles from './users.module.css'

interface Row {
  email: string
  /** Null until their first Google sign-in. */
  name: string | null
  access: AccessFlags
  builtIn: boolean
  isMe: boolean
  addedAt: string | null
  addedBy: string | null
  lastSignInAt: string | null
}

interface AccessRequest {
  email: string
  name: string | null
  firstAt: string
  lastAt: string
  count: number
}

interface Payload {
  users: Row[]
  requests: AccessRequest[]
  shared: boolean
  /** Whether this session may change anything here; false shows the same
   *  page with the controls taken away. */
  canEdit: boolean
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

const EMPTY_FORM = { email: '', access: DEFAULT_NEW_ACCESS }

// A write from a session Google minted more than 30 minutes ago is refused
// with 401 reauth. The page then leaves for Google's account chooser and lands
// back here with ?resume=1. What it was doing meanwhile sits in sessionStorage
// (this tab only): the ticks, the add form and the refused request, which is
// sent again on return so the click isn't lost.
const RESUME_PARAM = 'resume'
const REAUTH_URL = `/api/admin/auth/google?next=${encodeURIComponent(
  `/admin/users?${RESUME_PARAM}=1`
)}`
const PENDING_KEY = 'aisafety-admin-users:pending'

function stashPending(state: PendingState): void {
  try {
    sessionStorage.setItem(PENDING_KEY, encodePending(state))
  } catch {
    // Storage refused (private mode, quota): the ticks just aren't kept.
  }
}

/** Read and clear what the page stashed before leaving for Google. */
function takePending(): PendingState | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (raw !== null) sessionStorage.removeItem(PENDING_KEY)
    return decodePending(raw)
  } catch {
    return null
  }
}

/** True on the first load straight back from Google. Strips the marker, so a
 *  reload or a bookmark of this URL is an ordinary visit. */
function takeResumeMarker(): boolean {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(RESUME_PARAM)) return false
  url.searchParams.delete(RESUME_PARAM)
  window.history.replaceState(null, '', url.toString())
  return true
}

/** One request to the API, described so it can be sent now or, after a trip
 *  through Google, again. */
function action(
  method: PendingAction['method'],
  body: Record<string, unknown>,
  okText: string,
  extra: Partial<Pick<PendingAction, 'url' | 'clearForm'>> = {}
): PendingAction {
  return { method, body, okText, url: USERS_API, clearForm: false, ...extra }
}

/** One tick per tab. Tabs that can change the live site carry a second,
 *  "can edit" tick: the first opens the tab to look, the second lets its
 *  writes through. Ticking "can edit" on a closed tab opens it too; unticking
 *  the tab takes "can edit" with it. */
function AccessPicker({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: AccessFlags
  onChange?: (next: AccessFlags) => void
  disabled?: boolean
  idPrefix: string
}) {
  return (
    <div className={styles.picker} role="group" aria-label="Tabs">
      {ACCESS_AREAS.map(area => {
        const grant = value[area.key]
        return (
          <span
            key={area.key}
            className={`${styles.pick} ${grant ? styles.pickOn : ''} ${
              disabled ? styles.pickDisabled : ''
            }`}
          >
            <label className={styles.pickTab}>
              <input
                type="checkbox"
                id={`${idPrefix}-${area.key}`}
                checked={grant !== false}
                disabled={disabled}
                onChange={e =>
                  onChange?.({
                    ...value,
                    [area.key]: e.target.checked ? 'view' : false,
                  })
                }
              />
              {area.label}
            </label>
            {area.edit && (
              <label
                className={styles.pickEdit}
                title={`Can edit: ${area.edit}`}
              >
                <input
                  type="checkbox"
                  id={`${idPrefix}-${area.key}-edit`}
                  checked={grant === 'edit'}
                  disabled={disabled}
                  onChange={e =>
                    onChange?.({
                      ...value,
                      [area.key]: e.target.checked
                        ? 'edit'
                        : grant === false
                          ? false
                          : 'view',
                    })
                  }
                />
                can edit
              </label>
            )}
          </span>
        )
      })}
    </div>
  )
}

export default function UsersAdmin() {
  const router = useRouter()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error'
    text: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [form, setForm] = useState<{ email: string; access: AccessFlags }>(
    EMPTY_FORM
  )
  /** Tabs ticked for each pending request before it is approved. */
  const [requestPicks, setRequestPicks] = useState<Record<string, AccessFlags>>(
    {}
  )
  // The latest ticks and form, for the stash: call() is memoised, so it reads
  // them through refs rather than closing over one render.
  const picksRef = useRef(requestPicks)
  const formRef = useRef(form)
  useEffect(() => {
    picksRef.current = requestPicks
  }, [requestPicks])
  useEffect(() => {
    formRef.current = form
  }, [form])

  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(USERS_API, { cache: 'no-store' })
      const body = (await res.json()) as Payload & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      // A newer load has started since: let that one set the list.
      if (seq !== loadSeq.current) return
      setData(body)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  /** One call to the API. A stale session gets 401 reauth: stash what the
   *  page is doing, go through Google, and finish on return. `replay` is that
   *  return trip, where a second refusal is shown rather than bounced again. */
  const call = useCallback(
    async (act: PendingAction, replay = false): Promise<boolean> => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await fetch(act.url, {
          method: act.method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(act.body),
        })
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        if (res.status === 401 && payload.error === 'reauth') {
          if (replay) {
            throw new Error(
              'Google did not refresh the sign-in. Try that once more.'
            )
          }
          // Changing who can sign in needs a session Google minted recently:
          // one trip through the account chooser, then straight back here to
          // pick up where this left off.
          stashPending({
            at: Date.now(),
            action: act,
            requestPicks: picksRef.current,
            form: formRef.current,
          })
          window.location.assign(REAUTH_URL)
          return false
        }
        if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`)
        setNotice({ kind: 'ok', text: act.okText })
        if (act.clearForm) setForm(EMPTY_FORM)
        await load()
        // The tab bar is server-rendered; refresh it so the pending-request
        // badge on "Admin admin" follows what just happened.
        router.refresh()
        return true
      } catch (err) {
        setNotice({
          kind: 'error',
          text: err instanceof Error ? err.message : String(err),
        })
        // Puts back whatever an optimistic tick changed.
        await load()
        return false
      } finally {
        setBusy(false)
      }
    },
    [load, router]
  )

  // First load. Back within the hour of leaving for Google, the ticks and the
  // add form come back as they were; straight back from Google, the refused
  // request is sent again as well.
  useEffect(() => {
    const pending = takePending()
    const resume = takeResumeMarker()
    if (pending) {
      setRequestPicks(pending.requestPicks)
      setForm(pending.form)
    }
    void (async () => {
      await load()
      if (resume && pending?.action) await call(pending.action, true)
    })()
  }, [load, call])

  const who = (u: Row) => u.name ?? u.email
  // False while the list is still loading, so nothing is offered that the
  // API would then refuse.
  const canEdit = data?.canEdit ?? false

  /** Tick or untick a tab for someone: shown at once, then saved. */
  function setAccess(u: Row, next: AccessFlags) {
    setData(prev =>
      prev
        ? {
            ...prev,
            users: prev.users.map(x =>
              x.email === u.email ? { ...x, access: next } : x
            ),
          }
        : prev
    )
    void call(
      action(
        'PATCH',
        { email: u.email, access: next },
        `${who(u)} now has: ${describeAccess(next).join(', ') || 'nothing'}.`
      )
    )
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    await call(
      action(
        'POST',
        form,
        `${form.email.trim().toLowerCase()} can now sign in.`,
        { clearForm: true }
      )
    )
  }

  return (
    <div className={adminStyles.editorColumn}>
      <div className={adminStyles.pageHeading}>
        <h1 className={adminStyles.pageTitle}>Admin admin</h1>
        <p className={adminStyles.pageMeta}>
          {data ? (
            <>
              <span className={adminStyles.pageMetaValue}>
                {data.users.length}
              </span>{' '}
              {data.users.length === 1 ? 'person' : 'people'} can sign in
            </>
          ) : (
            'Reading the list…'
          )}
        </p>
      </div>

      {data && !canEdit && (
        <p className={styles.notice}>
          View only: you can see who can sign in and what they can open, but
          adding, changing or removing anyone stays with people who can edit
          this page.
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
          Could not read the user list: {loadError}
        </p>
      )}

      {data && data.requests.length > 0 && (
        <div className={adminStyles.editorBlock}>
          <div className={adminStyles.editorBlockHeader}>
            <h2 className={adminStyles.editorBlockTitle}>
              Waiting for approval · {data.requests.length}
            </h2>
          </div>
          <p className={adminStyles.sectionHint}>
            These people signed in with Google but aren&apos;t on the list.
            {canEdit
              ? ' Tick the tabs they should get and approve, or dismiss. Nothing is granted until you approve.'
              : ' Nothing is granted until someone who can edit this page approves them.'}
          </p>
          <div className={styles.people}>
            {data.requests.map(r => {
              const picks = requestPicks[r.email] ?? DEFAULT_NEW_ACCESS
              return (
                <div key={r.email} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div className={styles.cardWho}>
                      {r.name && (
                        <span className={styles.cardName}>{r.name}</span>
                      )}
                      <span className={styles.cardEmail}>{r.email}</span>
                    </div>
                    {canEdit && (
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={adminStyles.editorButtonPrimary}
                          disabled={busy}
                          onClick={() =>
                            void call(
                              action(
                                'POST',
                                { email: r.email, access: picks },
                                `${r.name ?? r.email} can now sign in.`
                              )
                            )
                          }
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className={styles.linkButton}
                          disabled={busy}
                          onClick={() =>
                            void call(
                              action(
                                'DELETE',
                                { email: r.email },
                                `Request from ${r.name ?? r.email} dismissed.`,
                                { url: REQUESTS_API }
                              )
                            )
                          }
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                  <AccessPicker
                    idPrefix={`r-${r.email}`}
                    value={picks}
                    disabled={busy || !canEdit}
                    onChange={next =>
                      setRequestPicks({ ...requestPicks, [r.email]: next })
                    }
                  />
                  <div className={styles.cardMeta}>
                    <span>
                      Tried {r.count === 1 ? 'once' : `${r.count} times`}, last{' '}
                      {when(r.lastAt)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className={adminStyles.editorBlock}>
        <div className={adminStyles.editorBlockHeader}>
          <h2 className={adminStyles.editorBlockTitle}>Who can sign in</h2>
        </div>
        <p className={adminStyles.sectionHint}>
          Each person signs in with the Google account shown and sees only the
          tabs ticked here. A tab on its own is for looking; &ldquo;can
          edit&rdquo; also lets them change things from it, which on these tabs
          means the live site. Ticking or unticking applies on their next click;
          removing someone signs them out immediately. Built-in rows live in the
          code and can&apos;t be changed from this page.
        </p>
        {data && (
          <div className={styles.people}>
            {data.users.map(u => (
              <div key={u.email} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardWho}>
                    {u.name ? (
                      <span className={styles.cardName}>{u.name}</span>
                    ) : (
                      <span className={styles.cardPending}>
                        Name appears after their first sign-in
                      </span>
                    )}
                    <span className={styles.cardEmail}>{u.email}</span>
                    {u.builtIn && (
                      <span className={styles.badge}>built in</span>
                    )}
                    {u.isMe && (
                      <span className={`${styles.badge} ${styles.badgeYou}`}>
                        you
                      </span>
                    )}
                  </div>
                  {canEdit && !u.builtIn && !u.isMe && (
                    <div className={styles.rowActions}>
                      {removing === u.email ? (
                        <>
                          <span className={styles.confirmInline}>
                            Remove {who(u)}?
                          </span>
                          <button
                            type="button"
                            className={`${styles.linkButton} ${styles.danger}`}
                            disabled={busy}
                            onClick={() => {
                              setRemoving(null)
                              void call(
                                action(
                                  'DELETE',
                                  { email: u.email },
                                  `${who(u)} can no longer sign in.`
                                )
                              )
                            }}
                          >
                            Yes, remove
                          </button>
                          <button
                            type="button"
                            className={styles.linkButton}
                            onClick={() => setRemoving(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={styles.linkButton}
                          disabled={busy}
                          onClick={() => setRemoving(u.email)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <AccessPicker
                  idPrefix={`u-${u.email}`}
                  value={u.access}
                  disabled={busy || u.builtIn || !canEdit}
                  onChange={next => setAccess(u, next)}
                />
                <div className={styles.cardMeta}>
                  <span>
                    {u.addedAt
                      ? `Added ${when(u.addedAt)}${u.addedBy ? ` by ${u.addedBy}` : ''}`
                      : 'Built into the code'}
                  </span>
                  <span>Last sign-in {when(u.lastSignInAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {!data && loading && <p className={styles.notice}>Loading…</p>}
      </div>

      {canEdit && (
        <div className={adminStyles.editorBlock}>
          <div className={adminStyles.editorBlockHeader}>
            <h2 className={adminStyles.editorBlockTitle}>Add someone</h2>
          </div>
          <p className={adminStyles.sectionHint}>
            Enter the address of the Google account they will sign in with and
            tick the tabs they should see. They go to /admin/login, click Sign
            in with Google, and allow the app once; their name is picked up from
            Google then.
          </p>
          <form className={styles.form} onSubmit={add}>
            <label className={`${styles.field} ${styles.emailField}`}>
              <span className={styles.fieldLabel}>Google account email</span>
              <input
                type="email"
                required
                className={adminStyles.editorInput}
                value={form.email}
                disabled={busy}
                placeholder="name@example.com"
                onChange={e => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Tabs they can open</span>
              <AccessPicker
                idPrefix="new"
                value={form.access}
                disabled={busy}
                onChange={access => setForm({ ...form, access })}
              />
            </div>
            <div className={styles.formActions}>
              <button
                type="submit"
                className={`${adminStyles.editorButtonPrimary} ${styles.addButton}`}
                disabled={busy || !data}
              >
                {busy ? 'Saving…' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      )}

      {data && !data.shared && (
        <p className={styles.notice}>
          Local copy: this checkout has no shared database, so the list above is
          stored in .admin-dev/users.json and only applies here.
        </p>
      )}
    </div>
  )
}
