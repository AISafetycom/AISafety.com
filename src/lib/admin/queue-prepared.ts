/*
  Logo Prep's files on a Queue row – its Prepared logo field.

  The Mac runs Logo Prep (~/LogoPrep/logo_prep.py) on a picture it proposes
  and keeps the result on the row: transparent, cropped, with ink that
  reads on the dark card, and for /map a second, dark file for the map's
  white pin, named "…-map". Airtable's links to the files expire within
  hours, so the page reads them from the row on every load and never keeps
  one anywhere else.

  Two readers:
  - Fable's field check (~/Queue/fieldcheck.py, 17 Nov 2026) proposes a
    logo for an addition; its flag names the file on the row
    (queue-field-flags.ts), and Use copies that file onto the record.
  - A Change that proposes a picture from an org's site (Broom's logo
    fixes, a rebrand): until 17 Nov 2026 the page showed and Apply
    attached the raw file, and the Mac's logos duty swapped the prepared
    one in afterwards. Now the prepared file is what the page shows and
    Apply attaches; the logos duty stays as the fallback for a row Logo
    Prep had not reached yet.
*/

import type { ProposedChange } from './queue'

/** The Queue table, whose own rows a hosted picture's copy_from can name. */
const QUEUE_TABLE_ID = 'tblonlKwIFJ7Aa8QN'

export interface PreparedFile {
  /** The file itself on Airtable (fresh: read with the row). */
  url: string
  filename: string
  size: number | null
  width: number | null
  height: number | null
  type: string | null
}

const PICTURE_FIELD_RE = /logo|image/i

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Pure: the files on a row's Prepared logo field, in the order the Mac
 *  attached them. `expired` drops a link that has run out. */
export function preparedFilesOf(
  v: unknown,
  expired: (url: string) => boolean = () => false
): PreparedFile[] {
  if (!Array.isArray(v)) return []
  const out: PreparedFile[] = []
  for (const x of v) {
    if (!isRecord(x) || typeof x.url !== 'string' || !x.url) continue
    if (typeof x.filename !== 'string' || !x.filename.trim()) continue
    if (expired(x.url)) continue
    out.push({
      url: x.url,
      filename: x.filename.trim().slice(0, 200),
      size: num(x.size),
      width: num(x.width),
      height: num(x.height),
      type: typeof x.type === 'string' ? x.type : null,
    })
  }
  return out
}

/** Pure: the prepared file for one picture field – the "-map" file for a
 *  map field, the first other file for any other (the Mac names them that
 *  way; worker.py's _prepared_for reads them the same). */
export function preparedFor(
  field: string,
  files: PreparedFile[]
): PreparedFile | null {
  const isMap = /map/i.test(field)
  for (const f of files) {
    const stem = f.filename.replace(/\.[^.]+$/, '')
    if (stem.endsWith('-map') === isMap) return f
  }
  return null
}

/** Pure: the file a flag names, by name (and size, when both know it). */
export function preparedNamed(
  name: string,
  size: number | null,
  files: PreparedFile[]
): PreparedFile | null {
  return (
    files.find(
      f =>
        f.filename === name &&
        (size === null || f.size === null || f.size === size)
    ) ?? null
  )
}

function linkPicture(to: unknown): boolean {
  const first: unknown = Array.isArray(to) ? to[0] : to
  return (
    isRecord(first) &&
    typeof first.url === 'string' &&
    /^https?:\/\//i.test(first.url)
  )
}

/** Pure: a Change's proposed pictures with the row's prepared file in
 *  place of the raw one. `raw` is the proposal's own `changes` list (for
 *  `copy_from`). A picture copied from ANOTHER listing is left alone: it is
 *  that listing's file, which Bryce picked, and the logos duty leaves it
 *  too. One copied from this row (an embedded picture the Mac hosted
 *  there) is this row's file already, and reads fresh. */
export function withPreparedPictures(
  changes: ProposedChange[],
  raw: unknown,
  files: PreparedFile[]
): ProposedChange[] {
  if (!files.length) return changes
  const rawByField = new Map<string, Record<string, unknown>>()
  for (const r of Array.isArray(raw) ? raw : []) {
    if (isRecord(r) && typeof r.field === 'string') rawByField.set(r.field, r)
  }
  return changes.map(c => {
    if (!PICTURE_FIELD_RE.test(c.field) || !linkPicture(c.to)) return c
    const copy = rawByField.get(c.field)?.copy_from
    if (isRecord(copy) && copy.table !== QUEUE_TABLE_ID) return c
    const file = preparedFor(c.field, files)
    return file ? { ...c, to: [{ url: file.url, filename: file.filename }] } : c
  })
}
