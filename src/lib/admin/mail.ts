// Email for the admin: the owner hears when someone requests access, a
// person hears when they have been approved, and the owner hears (at most
// once a day) when someone else publishes the donation guide.
//
// Sent the same way the hackathon forms send their confirmations: a small
// Google Apps Script web app in the owner's Google account (source mirrored
// in docs/admin-mail-script.md) that accepts one JSON POST and sends the mail
// from the owner's Gmail with MailApp. No mail provider, no DNS; Google allows
// that script about a hundred emails a day, which is far more than this needs.
//
//   ADMIN_MAIL_SCRIPT_URL   the script's /exec URL
//   ADMIN_MAIL_SECRET       shared with the script; it refuses anything else
//
// The script also limits what a leaked secret could do: a "request" or
// "digest" mail can only ever go to the owner's own address (fixed in the
// script), and an "approved" mail is a fixed template with the recipient as
// its only variable.
//
// Off until both variables are set; every send is best effort and logged,
// never something the sign-in or the approval waits on or fails over.

export type MailKind = 'request' | 'approved' | 'digest'

export interface Mail {
  subject: string
  text: string
  html: string
}

export function mailConfigured(): boolean {
  return Boolean(
    process.env.ADMIN_MAIL_SCRIPT_URL && process.env.ADMIN_MAIL_SECRET
  )
}

/** Send one email through the script. Resolves true when the script reports
 *  the mail went out; false (and a log line) otherwise. Never throws. */
export async function sendAdminMail(
  kind: MailKind,
  to: string,
  mail: Mail,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  if (!mailConfigured()) {
    console.log(
      `[admin-mail] not configured; would have sent "${mail.subject}" (${kind})`
    )
    return false
  }
  try {
    // Apps Script answers with a 302 that fetch follows; the JSON is behind it.
    const res = await fetchImpl(process.env.ADMIN_MAIL_SCRIPT_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.ADMIN_MAIL_SECRET,
        kind,
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    })
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      emailed?: boolean
      error?: string
    }
    if (!res.ok || !body.ok || body.emailed === false) {
      console.warn(
        `[admin-mail] script did not send "${mail.subject}" (${kind}): HTTP ${res.status} ${body.error ?? ''}`
      )
      return false
    }
    return true
  } catch (err) {
    console.warn(
      `[admin-mail] could not send "${mail.subject}" (${kind}):`,
      err
    )
    return false
  }
}

// ─── Templates ──────────────────────────────────────────────────────────────
// House style for automated mail: HTML with a plain-text twin, dates as
// "4 September 2026", real lists, short.

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function longDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
    timeZoneName: 'short',
  })
}

function wrap(bodyHtml: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">${bodyHtml}</div>`
}

/** To the owner: someone signed in with Google but isn't on the list. */
export function requestMail(p: {
  email: string
  name: string | null
  at: string
  count: number
  adminUrl: string
}): Mail {
  const who = p.name ? `${p.name} (${p.email})` : p.email
  const tries = p.count === 1 ? 'first try' : `try number ${p.count}`
  const subject = `Admin access requested by ${p.name ?? p.email}`
  const text = [
    `${who} signed in to the AISafety.com admin with Google and isn't on the list.`,
    '',
    `When: ${longDate(p.at)} (${tries})`,
    `Approve or dismiss: ${p.adminUrl}`,
    '',
    'Nothing has been granted. This email was sent by the admin itself.',
  ].join('\n')
  const html = wrap(
    `<p><strong>${esc(who)}</strong> signed in to the AISafety.com admin with Google and isn&rsquo;t on the list.</p>` +
      `<ul><li><strong>When:</strong> ${esc(longDate(p.at))} (${tries})</li>` +
      `<li><strong>Approve or dismiss:</strong> <a href="${esc(p.adminUrl)}">${esc(p.adminUrl)}</a></li></ul>` +
      `<p style="color:#666;font-size:13px">Nothing has been granted. This email was sent by the admin itself.</p>`
  )
  return { subject, text, html }
}

/** To the person: they can sign in now. Same mail whether they asked first or
 *  were added directly. Neutral voice: it comes from the admin, not a person. */
export function approvedMail(p: {
  email: string
  name: string | null
  loginUrl: string
}): Mail {
  const hi = p.name ? `Hi ${p.name.split(' ')[0]},` : 'Hi,'
  const subject = 'You now have access to the AISafety.com admin'
  const text = [
    hi,
    '',
    `Your Google account (${p.email}) now has access to the AISafety.com admin.`,
    '',
    `Sign in: ${p.loginUrl}`,
    '',
    'Use the "Sign in with Google" button and pick that account. This email was sent by the admin itself; reply to it if something looks wrong.',
  ].join('\n')
  const html = wrap(
    `<p>${esc(hi)}</p>` +
      `<p>Your Google account (<strong>${esc(p.email)}</strong>) now has access to the AISafety.com admin.</p>` +
      `<p><strong>Sign in:</strong> <a href="${esc(p.loginUrl)}">${esc(p.loginUrl)}</a></p>` +
      `<p style="color:#666;font-size:13px">Use the &ldquo;Sign in with Google&rdquo; button and pick that account. This email was sent by the admin itself; reply to it if something looks wrong.</p>`
  )
  return { subject, text, html }
}

/** To the owner: someone else published the donation guide. One email
 *  covers every publish since the last one (never more than one a day). */
export function digestMail(p: {
  publishes: {
    version: number
    by: { name: string; email: string }
    at: string
    changes: string[]
  }[]
  adminUrl: string
  pageUrl: string
}): Mail {
  const n = p.publishes.length
  const names = [...new Set(p.publishes.map(x => x.by.name))].join(', ')
  const subject =
    n === 1
      ? `Donation guide published by ${names} (version ${p.publishes[0].version})`
      : `Donation guide: ${n} publishes by ${names}`
  const textBlocks = p.publishes.map(x =>
    [
      `Version ${x.version} by ${x.by.name} (${x.by.email}), ${longDate(x.at)}`,
      ...(x.changes.length
        ? x.changes.map(c => `  - ${c}`)
        : ['  - No text changes']),
    ].join('\n')
  )
  const text = [
    n === 1
      ? 'The donation guide was published from the admin.'
      : `The donation guide was published ${n} times from the admin.`,
    '',
    ...textBlocks,
    '',
    `Live page: ${p.pageUrl}`,
    `History and restore: ${p.adminUrl}`,
    '',
    'This email was sent by the admin itself, at most once a day.',
  ].join('\n')
  const htmlBlocks = p.publishes
    .map(
      x =>
        `<p><strong>Version ${x.version}</strong> by ${esc(x.by.name)} (${esc(x.by.email)}), ${esc(longDate(x.at))}</p>` +
        `<ul>${
          x.changes.length
            ? x.changes.map(c => `<li>${esc(c)}</li>`).join('')
            : '<li>No text changes</li>'
        }</ul>`
    )
    .join('')
  const html = wrap(
    `<p>${
      n === 1
        ? 'The donation guide was published from the admin.'
        : `The donation guide was published ${n} times from the admin.`
    }</p>` +
      htmlBlocks +
      `<p><strong>Live page:</strong> <a href="${esc(p.pageUrl)}">${esc(p.pageUrl)}</a><br>` +
      `<strong>History and restore:</strong> <a href="${esc(p.adminUrl)}">${esc(p.adminUrl)}</a></p>` +
      `<p style="color:#666;font-size:13px">This email was sent by the admin itself, at most once a day.</p>`
  )
  return { subject, text, html }
}
