/*
  Asks Claude which listings already in an area of the Field map a new one
  is most like (the question and the reading of its answer: map-alike.ts).
  Server only: it needs ANTHROPIC_API_KEY.
*/

import Anthropic from '@anthropic-ai/sdk'
import { DEFAULT_MODEL_ID, outputConfig } from '@/lib/assistant/models'
import {
  ALIKE_SCHEMA,
  alikePrompt,
  readAlike,
  type AlikeText,
} from './map-alike'

// The chatbot's model (kept on the newest Opus), at low effort: a short
// judgment over a list of sixty lines, with Bryce waiting on the strip.
const MODEL = DEFAULT_MODEL_ID

/** The ids of up to three of `among` most like `listing`, most alike
 *  first. */
export async function askAlike(
  listing: Omit<AlikeText, 'id'>,
  among: AlikeText[],
  area: string
): Promise<string[]> {
  if (!among.length) return []
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: {
      ...outputConfig(MODEL, 'low'),
      format: { type: 'json_schema', schema: ALIKE_SCHEMA },
    },
    messages: [{ role: 'user', content: alikePrompt(listing, among, area) }],
  })
  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to compare the listings')
  }
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
  return readAlike(text, among)
}
