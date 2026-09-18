import { getLiveGuide } from '@/lib/donation-guide/live'
import { guideChatText } from '@/lib/donation-guide/text'

let cached: { version: number; text: string } | null = null

/** The donation guide's full body text, broken down by amount bracket, from
 *  the same JSON the page renders (live from the store, or the seed). Built
 *  once per published version, so a publish reaches the chatbot on the next
 *  conversation. */
export async function getDonationGuideText(): Promise<string> {
  const { version, guide } = await getLiveGuide()
  if (!cached || cached.version !== version) {
    cached = { version, text: guideChatText(guide) }
  }
  return cached.text
}
