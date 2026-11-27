// Who is acting, for the row's History.
//
// Every entry the site adds to a Queue row's History names the admin who
// did it (`by`, queue-history.ts). A name is only a label, though: it comes
// from a Google profile, and two people can share one. The Mac, which
// applies some rules only on the owner's own Apply, goes by the address the
// person signed in with, so the site writes that beside the name (`email`).
//
// The address is kept for the length of one request here, rather than
// handed down through every function that ends in a History write: the
// Queue's route runs its action inside `actingAs`, and the one place that
// writes an entry asks `actorEmail`. Each request has its own, however many
// run at once. Outside a request (a test, a script) there is none, and the
// entry is written without one.
import { AsyncLocalStorage } from 'node:async_hooks'

const actor = new AsyncLocalStorage<{ email: string | null }>()

/** Run `work` as this person: History entries written inside it carry
 *  their address. */
export function actingAs<T>(
  email: string | null | undefined,
  work: () => Promise<T>
): Promise<T> {
  const address = (email ?? '').trim().toLowerCase()
  return actor.run({ email: address || null }, work)
}

/** The address of whoever this request acts for; null when nobody is
 *  named. */
export function actorEmail(): string | null {
  return actor.getStore()?.email ?? null
}
