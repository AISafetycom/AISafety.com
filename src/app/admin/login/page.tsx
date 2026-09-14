import { googleSignInConfigured, pendingRequestEmail } from '@/lib/admin/auth'
import styles from '../admin.module.css'

// Why a sign-in attempt came back here, keyed by the ?error= code the Google
// routes redirect with. Anything unknown gets the generic line.
const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed':
    "That Google account isn't on the admin list and no request could be left. Contact the site admin directly.",
  cancelled: 'Google sign-in was cancelled.',
  expired: 'That sign-in attempt expired. Start again.',
  state:
    'That sign-in attempt could not be matched to this browser. Start again.',
  google: "Google sign-in didn't complete. Try again.",
  'google-unconfigured':
    "Google sign-in isn't set up on this deployment (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, ADMIN_SESSION_SECRET).",
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; requested?: string }>
}) {
  const { error, requested } = await searchParams
  const google = googleSignInConfigured()
  const message = error
    ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.google)
    : null

  if (requested) {
    // Someone signed in with a Google account that isn't on the list. Their
    // request is now waiting on /admin/users; tell them so and stop here.
    const email = await pendingRequestEmail()
    return (
      <div className={styles.loginWrap}>
        <div className={styles.loginCard}>
          <div className={styles.loginTick} aria-hidden="true">
            ✓
          </div>
          <h1 className={styles.loginTitle}>Access requested</h1>
          <p className={styles.loginText}>
            {email ? (
              <>
                <strong>{email}</strong> isn&apos;t on the admin list yet.
              </>
            ) : (
              <>That account isn&apos;t on the admin list yet.</>
            )}{' '}
            You&apos;ll get an email once you&apos;re approved.
          </p>
          <a href="/api/admin/auth/google" className={styles.loginGoogle}>
            <GoogleMark />
            Sign in with a different account
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.loginWrap}>
      <div className={styles.loginCard}>
        <h1 className={styles.loginTitle}>AISafety.com Admin</h1>
        {google ? (
          <a href="/api/admin/auth/google" className={styles.loginGoogle}>
            <GoogleMark />
            Sign in with Google
          </a>
        ) : (
          <p className={styles.loginText}>
            {ERROR_MESSAGES['google-unconfigured']}
          </p>
        )}
        {message && <div className={styles.loginError}>{message}</div>}
      </div>
    </div>
  )
}

// Google's "G", as an image so the icon lint rule (which wants site icons to
// go through <Icon>) doesn't apply to a third-party brand mark.
function GoogleMark() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/images/google-g.svg" alt="" width={18} height={18} />
}
