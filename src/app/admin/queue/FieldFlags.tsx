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

  A proposed logo (17 Nov 2026) comes first: the record's logo beside the
  one Fable found and Logo Prep made ready, where it came from, and why.
  Its Use writes the file onto the record the way a picture dropped into
  the logo slot does (the record is unpublished; Publish takes it live),
  and Undo puts the old one back while the page still holds it.

  Since 19 Nov 2026 (Bryce: "Let's make Fable's field changes just go
  through automatically. No need to tell me about them.") the Mac writes
  each flag straight onto the unpublished record and keeps it off the row's
  list, so this panel shows only a flag the record refused.
*/

import { useState, type ReactNode } from 'react'
import {
  flagShown,
  shownFlags,
  shownPictures,
  withFlags,
  withoutFlag,
  wordDiff,
  type FieldFlag,
  type FieldFlags as Check,
  type PictureFlag,
  type PictureNow,
} from '@/lib/admin/queue-field-flags'
import type { PreparedFile } from '@/lib/admin/queue-prepared'
import own from './FieldFlags.module.css'

/** The record's file in a logo field, as the page knows it (its link too,
 *  to show it): undefined until the record has been read, null if empty. */
export type PictureHeld = (PictureNow & { url: string | null }) | null

export default function FieldFlags({
  check,
  live,
  edits,
  canEdit,
  canEditField,
  cap,
  onSetEdits,
  pictureNow = () => undefined,
  prepared = [],
  renderPicture,
  onUsePicture,
  onUndoPicture,
  canUndoPicture = () => false,
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
  /** What a logo field holds now (undefined: the record not read yet). */
  pictureNow?: (field: string) => PictureHeld | undefined
  /** The files on the row's Prepared logo field. */
  prepared?: PreparedFile[]
  /** Draws one picture with its name (the page's own picture box). */
  renderPicture?: (url: string | null, name: string | null) => ReactNode
  /** Use on a logo: writes the prepared file onto the record. Rejects with
   *  the reason it could not. */
  onUsePicture?: (flag: PictureFlag) => Promise<void>
  /** Puts back the logo Use took off (while the page holds it). */
  onUndoPicture?: (flag: PictureFlag) => Promise<void>
  canUndoPicture?: (field: string) => boolean
}) {
  // A logo being written, and why the last write failed, by field.
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<Record<string, string>>({})
  const pictures =
    renderPicture && onUsePicture
      ? shownPictures(check.pictures, pictureNow, prepared, canEditField)
      : []
  const write = async (flag: PictureFlag, how: 'use' | 'undo') => {
    const run = how === 'use' ? onUsePicture : onUndoPicture
    if (!run || busy) return
    setBusy(flag.field)
    setFailed(prev => {
      const next = { ...prev }
      delete next[flag.field]
      return next
    })
    try {
      await run(flag)
    } catch (e) {
      setFailed(prev => ({
        ...prev,
        [flag.field]: e instanceof Error ? e.message : String(e),
      }))
    } finally {
      setBusy(null)
    }
  }
  // Nothing left to offer: the Mac has put every flag on the record itself
  // (19 Nov 2026), or there were none. Bryce: "No need to tell me about
  // them", so no line either way.
  if (check.flags.length === 0 && check.pictures.length === 0) return null
  const shown = shownFlags(check.flags, live, edits, canEditField)
  // Every flag overtaken (edited by hand, changed from the chat): nothing
  // left to say.
  if (shown.length === 0 && pictures.length === 0) return null
  const open = shown.filter(x => x.state === 'open').map(x => x.flag)
  const openPictures = pictures.filter(x => x.state === 'open').map(x => x.flag)
  const openCount = open.length + openPictures.length
  const total = shown.length + pictures.length
  return (
    <section className={own.flags} aria-label="Fields Fable would change">
      <div className={own.head}>
        <span className={own.kicker}>
          Fable would change {total === 1 ? '1 field' : `${total} fields`}
        </span>
        {canEdit && openCount > 1 && (
          <button
            type="button"
            className={own.use}
            disabled={busy !== null}
            onClick={() => {
              if (open.length) onSetEdits(withFlags(open, live, edits))
              for (const p of openPictures) void write(p, 'use')
            }}
          >
            Use all <kbd>C</kbd>
          </button>
        )}
      </div>
      {renderPicture &&
        pictures.map(({ flag, state, file }) => {
          const now = pictureNow(flag.field)
          // /map's pin file sits on the map's white disc: shown on white.
          const pic = (url: string | null, name: string | null) => (
            <span
              className={`${own.side} ${/map/i.test(flag.field) ? own.onLight : ''}`}
            >
              {renderPicture(url, name)}
            </span>
          )
          return (
            <div
              key={flag.field}
              className={`${own.flag} ${state === 'used' ? own.flagUsed : ''}`}
            >
              <span className={own.field}>{flag.field}</span>
              <div className={own.pictures}>
                {state === 'open' && (
                  <>
                    {pic(
                      now?.url ?? null,
                      now === null || (now === undefined && !flag.from)
                        ? 'No logo'
                        : (now?.filename ?? flag.from?.file ?? null)
                    )}
                    <span className={own.arrow} aria-hidden="true">
                      →
                    </span>
                  </>
                )}
                {pic(file.url, file.filename)}
              </div>
              {(flag.source || flag.prep) && (
                <p className={own.source}>
                  {flag.source && `From ${flag.source}`}
                  {flag.source && flag.prep && ' · '}
                  {flag.prep}
                </p>
              )}
              <p className={own.why}>{flag.why}</p>
              {failed[flag.field] && (
                <p className={own.failed}>{failed[flag.field]}</p>
              )}
              <div className={own.foot}>
                {state === 'used' ? (
                  <>
                    <span className={own.used}>
                      Used – on the record now, goes live with Publish
                    </span>
                    {canEdit && onUndoPicture && canUndoPicture(flag.field) && (
                      <button
                        type="button"
                        className={own.link}
                        disabled={busy !== null}
                        onClick={() => void write(flag, 'undo')}
                      >
                        {busy === flag.field ? 'Undoing…' : 'Undo'}
                      </button>
                    )}
                  </>
                ) : (
                  canEdit && (
                    <button
                      type="button"
                      className={own.use}
                      disabled={busy !== null}
                      onClick={() => void write(flag, 'use')}
                    >
                      {busy === flag.field ? 'Using…' : 'Use'}
                      {openCount === 1 && busy !== flag.field && <kbd>C</kbd>}
                    </button>
                  )
                )}
              </div>
            </div>
          )
        })}
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
                  {openCount === 1 && <kbd>C</kbd>}
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
