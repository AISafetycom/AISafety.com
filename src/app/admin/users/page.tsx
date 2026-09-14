import UsersAdmin from './UsersAdmin'

// Nothing here is prerendered: the page reads the user list live in the
// browser via /api/admin/users.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function UsersAdminPage() {
  return <UsersAdmin />
}
