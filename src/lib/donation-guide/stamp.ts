import { guideStore } from './store'

/** Changes whenever what the preview shows would change: the draft's save
 *  time when there is one, else the live version number. */
export async function guideStamp(): Promise<string> {
  const [draft, live] = await Promise.all([
    guideStore.getDraft(),
    guideStore.getLive(),
  ])
  return draft ? `draft:${draft.savedAt}` : `live:${live?.version ?? 0}`
}
