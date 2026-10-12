// Already replied by hand (Bryce, 12 Oct 2026: a second decline nearly went
// to someone he had answered by hand weeks earlier). Before any reply draft
// the Mac reads the request's Gmail thread; when it holds his own reply to
// them it saves no draft and writes reply.already = {date, at, message, link}
// on the row, and the page says "Already replied" where the replies would be.

export interface AlreadyReplied {
  /** The day of his reply, as the Mac writes it ("7 September 2026"). */
  date: string
  /** That reply in Gmail; null when the Mac gave none. */
  link: string | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/** The `already` of a row's reply block (or of the agent's answer), or
 *  null. Only a Gmail link is kept. */
export function alreadyRepliedOf(v: unknown): AlreadyReplied | null {
  if (!isRecord(v)) return null
  const date = typeof v.date === 'string' ? v.date.trim() : ''
  if (!date) return null
  const link = typeof v.link === 'string' ? v.link.trim() : ''
  return {
    date,
    link: link.startsWith('https://mail.google.com/') ? link : null,
  }
}
