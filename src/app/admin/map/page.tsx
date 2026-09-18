import { canEditMap } from '@/lib/admin/auth'
import MapEditor from './MapEditor'

// Nothing here is prerendered: the editor reads Airtable live in the browser
// via /api/admin/map, so a build never touches the Map table for this page.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function MapEditorPage() {
  // View-only sessions see the map as the editor draws it, with nothing to
  // drag or change; the API refuses their writes regardless.
  return <MapEditor canEdit={await canEditMap()} />
}
