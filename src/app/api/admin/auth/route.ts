import { clearAdminCookie } from '@/lib/admin/auth'

// Sign-out. Signing in is Google only: see ./google and ./google/callback.
export const runtime = 'nodejs'

export async function DELETE() {
  await clearAdminCookie()
  return new Response(null, { status: 204 })
}
