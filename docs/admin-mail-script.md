# Admin mail script

The Google Apps Script web app that sends the admin's two emails (who asked for access → the owner; you're approved → the person). Same pattern as the hackathon forms (`docs/hackathon-signup.md`): a standalone script in the owner's Google account, deployed as a web app executing as the owner with access "Anyone", called by `src/lib/admin/mail.ts` with a shared secret. Env: `ADMIN_MAIL_SCRIPT_URL` (the /exec URL) and `ADMIN_MAIL_SECRET`.

The secret below is a placeholder; the deployed copy carries the real one. Redeploy after edits: paste, Cmd+S, Deploy → Manage deployments → new version (the URL stays the same).

```js
// AISafety.com admin mail — Google Apps Script web app.
// Sends the two emails the admin's sign-in flow needs, from the owner's Gmail:
//   kind "request"  → to the OWNER only: someone asked for access
//   kind "approved" → to the person: they can sign in now
// The site (src/lib/admin/mail.ts) POSTs JSON {secret, kind, to, subject, text,
// html}. Anything without the shared secret is refused. Deployed as a web app
// executing as the owner, "Anyone" may call it (the secret is the gate).

var SHARED_SECRET = '__SECRET__'
var OWNER = 'bryceerobertson@gmail.com'
var SENDER_NAME = 'AISafety.com Admin'

function doPost(e) {
  var out = ContentService.createTextOutput().setMimeType(
    ContentService.MimeType.JSON
  )
  try {
    var data = JSON.parse(e.postData.contents)
    if (!data || data.secret !== SHARED_SECRET) {
      return out.setContent(
        JSON.stringify({ ok: false, error: 'unauthorized' })
      )
    }
    var kind = String(data.kind || '')
    var to = String(data.to || '')
      .trim()
      .toLowerCase()
    var subject = String(data.subject || '').slice(0, 200)
    var text = String(data.text || '').slice(0, 20000)
    var html = String(data.html || '').slice(0, 60000)
    if (kind === 'request') {
      // Never anyone but the owner, whatever the request says.
      to = OWNER
    } else if (kind !== 'approved') {
      return out.setContent(JSON.stringify({ ok: false, error: 'bad kind' }))
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !subject || !text) {
      return out.setContent(JSON.stringify({ ok: false, error: 'bad input' }))
    }
    if (MailApp.getRemainingDailyQuota() < 1) {
      return out.setContent(
        JSON.stringify({ ok: true, emailed: false, error: 'quota' })
      )
    }
    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: text,
      htmlBody: html || undefined,
      name: SENDER_NAME,
    })
    return out.setContent(
      JSON.stringify({ ok: true, emailed: true, kind: kind })
    )
  } catch (err) {
    return out.setContent(
      JSON.stringify({
        ok: false,
        error: String(err && err.message ? err.message : err),
      })
    )
  }
}

// Handy while setting up: run once from the editor to trigger the
// authorisation prompt and prove sending works.
function testSend() {
  MailApp.sendEmail({
    to: OWNER,
    subject: 'AISafety.com admin mail: test',
    body: 'If you can read this, the admin mail script can send from your Gmail.',
    name: SENDER_NAME,
  })
}
```
