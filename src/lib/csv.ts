/** CSV text as rows of fields (RFC 4180): quoted fields may hold commas,
 *  line breaks and doubled quotes; lines may end in CRLF or LF. A trailing
 *  line break doesn't make an empty last row. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** CSV rows as objects keyed by the header row's names. */
export function csvRecords(text: string): Record<string, string>[] {
  const [head, ...rows] = parseCsv(text.replace(/^﻿/, ''))
  if (!head) return []
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}
