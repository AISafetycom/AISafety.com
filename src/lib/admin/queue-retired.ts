/*
  Columns retired from the resource tables. The Funding table's "Accepting
  applications?" and the Advisors table's "Focus" gave way to Application
  status and Deadline, and Focus areas, on 27 October 2026, and were to be
  deleted once nothing read them (28 October 2026). Queue rows written
  before then still name them in their proposed changes, and Airtable
  refuses a whole write that names a field it no longer has
  (UNKNOWN_FIELD_NAME): one old field would stop every other field in the
  same Apply from landing.

  So a write from the Queue (Apply, a fix after the decision, Undo) leaves
  such a field out once the table no longer has it, and an applied row
  keeps which, so the Done view can say so. While the column is still
  there it is written as before. Pure: the client page reads it too.
*/

const FUNDING_TABLE = 'tblzMTLDZWZKqTxrq'
const ADVISORS_TABLE = 'tblf3KKYnmgcjVGhD'

export interface RetiredField {
  /** The column's name, as the proposals name it. */
  name: string
  /** Its permanent field id. */
  id: string
  /** The fields that hold it now, in words for the note. */
  now: string
}

export const RETIRED_FIELDS: Record<string, readonly RetiredField[]> = {
  [FUNDING_TABLE]: [
    {
      name: 'Accepting applications?',
      id: 'fld398tQjtRGz0Pk1',
      now: 'Application status and Deadline',
    },
  ],
  [ADVISORS_TABLE]: [
    { name: 'Focus', id: 'fldJw9XfXOInZ7mCq', now: 'Focus areas' },
  ],
}

/** The key in a row's saved edits (JSON) that lists, once a change is
 *  applied, the proposed fields Apply left out because their column was no
 *  longer in Airtable; never a field name. */
export const GONE_KEY = '(column deleted)'

function retiredField(table: string, field: string): RetiredField | null {
  return (
    RETIRED_FIELDS[table]?.find(r => r.name === field || r.id === field) ?? null
  )
}

/** The field is one of the table's retired columns, by name or id. */
export function isRetired(table: string, field: string): boolean {
  return retiredField(table, field) !== null
}

/**
 * Of `fields`, the table's retired columns that its schema (every field,
 * read from Airtable's metadata) no longer lists, in the order given. An
 * empty schema means it could not be read: then nothing counts as gone and
 * the write goes as before, so Airtable's own answer is what the admin
 * sees.
 */
export function goneFields(
  table: string,
  fields: readonly string[],
  schema: readonly { id: string; name: string }[]
): string[] {
  if (schema.length === 0) return []
  return fields.filter(
    (f, i) =>
      fields.indexOf(f) === i &&
      isRetired(table, f) &&
      !schema.some(s => s.name === f || s.id === f)
  )
}

/** The names in a saved value under GONE_KEY. */
export function goneOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((k): k is string => typeof k === 'string')
    : []
}

/** What the admin reads about the fields left out: "Accepting
 *  applications? was left out: that column is no longer in Airtable. Use
 *  Application status and Deadline instead." */
export function goneNote(table: string, fields: readonly string[]): string {
  if (fields.length === 0) return ''
  const one = fields.length === 1
  const now = [
    ...new Set(
      fields
        .map(f => retiredField(table, f)?.now)
        .filter((n): n is string => Boolean(n))
    ),
  ]
  return [
    `${fields.join(', ')} ${one ? 'was' : 'were'} left out:`,
    `${one ? 'that column is' : 'those columns are'} no longer in Airtable.`,
    ...(now.length ? [`Use ${now.join(', and ')} instead.`] : []),
  ].join(' ')
}
