import { redirect } from 'next/navigation'
import { currentAccess } from '@/lib/admin/auth'
import { adminHomeHref } from './nav'

// /admin is an index that bounces to the right place: the first area this
// session can open, or the login page when it can't open any.
export default async function AdminIndexPage() {
  redirect(adminHomeHref(await currentAccess()))
}
