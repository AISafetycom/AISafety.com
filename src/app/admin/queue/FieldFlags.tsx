'use client'

/*
  "Fields Fable would change", under its Publish verdict (Bryce, 16 Nov
  2026: "if Fable says, yes, this thing should be added, then it checks all
  the fields and flags any fields that it thinks should be changed").

  The Mac's field check (~/Queue/fieldcheck.py) leaves its flags on the row
  (queue-field-flags.ts). Each shows the field, what it holds and what Fable
  would make it, one line on why, and Use: that puts the value into the
  page's edits, where it reads "edited" like anything typed by hand and
  goes out with Publish. Nothing is written before then, and Undo takes it
  back off. A flag whose field has since been changed some other way drops
  out of the list.
*/

import {
  flagShown,
  shownFlags,
  withFlags,
  withoutFlag,
  wordDiff,
  type FieldFlag,
  type FieldFlags as Check,
} from '@/lib/admin/queue-field-flags'
import own from './FieldFlags.module.css'

export default function FieldFlags({
  check,
  live,
  edits,
  canEdit,
  canEditField,
  cap,
  onSetEdits,
}: {
  check: Check
  /** The record's own values, by field name. */
  live: Record<string, unknown>
  /** The page's pending edits (text, as its editors hold them). */
  edits: Record<string, string>
  /** False for a view-only session or an item being revised: no buttons. */
  canEdit: boolean
  canEditField: (field: string) => boolean
  /** The Description's field name and length cap on this page. */
  cap: { field: string; cap: number }
  onSetEdits: (edits: Record<string, string>) => void
}) {
  if (check.flags.length === 0) {
    return (
      <p className={own.none}>
        Fable checked {check.checked > 0 ? `all ${check.checked}` : 'the'}{' '}
        fields and would change nothing.
      </p>
    )
  }
  const shown = shownFlags(check.flags, live, edits, canEditField)
  // Every flag overtaken (edited by hand, changed from the chat): nothing
  // left to say.
  if (shown.length === 0) return null
  const open = shown.filter(x => x.state === 'open').map(x => x.flag)
  return (
    <section className={own.flags} aria-label="Fields Fable would change">
      <div className={own.head}>
        <span className={own.kicker}>
          Fable would change{' '}
          {shown.length === 1 ? '1 field' : `${shown.length} fields`}
        </span>
        {canEdit && open.length > 1 && (
          <button
            type="button"
            className={own.use}
            onClick={() => onSetEdits(withFlags(open, live, edits))}
          >
            Use all <kbd>C</kbd>
          </button>
        )}
      </div>
      {shown.map(({ flag, state }) => (
        <div
          key={flag.field}
          className={`${own.flag} ${state === 'used' ? own.flagUsed : ''}`}
        >
          <span className={own.field}>{flag.field}</span>
          <Change flag={flag} cap={flag.field === cap.field ? cap.cap : null} />
          <p className={own.why}>{flag.why}</p>
          <div className={own.foot}>
            {state === 'used' ? (
              <>
                <span className={own.used}>Used – goes with Publish</span>
                {canEdit && (
                  <button
                    type="button"
                    className={own.link}
                    onClick={() => onSetEdits(withoutFlag(flag, live, edits))}
                  >
                    Undo
                  </button>
                )}
              </>
            ) : (
              canEdit && (
                <button
                  type="button"
                  className={own.use}
                  onClick={() => onSetEdits(withFlags([flag], live, edits))}
                >
                  Use
                  {open.length === 1 && <kbd>C</kbd>}
                </button>
              )
            )}
          </div>
        </div>
      ))}
    </section>
  )
}

/** What the field holds and what Fable would make it: a longer text word
 *  by word (what is cut struck through, what is new marked), anything else
 *  as old → new. */
function Change({ flag, cap }: { flag: FieldFlag; cap: number | null }) {
  const parts = wordDiff(flag.from, flag.to)
  const n = cap !== null && typeof flag.to === 'string' ? flag.to.length : null
  const count = n !== null && cap !== null && (
    <span className={n > cap ? own.countOver : own.count}>
      {n > cap
        ? `${n} characters – over the ${cap} cap`
        : `${n} / ${cap} characters`}
    </span>
  )
  if (parts) {
    return (
      <p className={own.change}>
        {parts.map((p, i) => (
          <span
            key={i}
            className={
              p.kind === 'cut'
                ? own.cut
                : p.kind === 'new'
                  ? own.fresh
                  : undefined
            }
          >
            {p.text}{' '}
          </span>
        ))}
        {count}
      </p>
    )
  }
  const empty = flag.from === null || flag.from === '' || flag.from === false
  return (
    <p className={own.change}>
      {!empty && (
        <>
          <span className={own.cut}>{flagShown(flag.from)}</span>
          <span className={own.arrow} aria-hidden="true">
            {' → '}
          </span>
        </>
      )}
      <span className={own.to}>{flagShown(flag.to)}</span>
      {count}
    </p>
  )
}
