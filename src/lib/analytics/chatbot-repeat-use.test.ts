import { describe, expect, it } from 'vitest'
import { chatbotRepeatUse, type AnalyticsEvent } from './events'

const at = (minutes: number) =>
  new Date(Date.parse('2026-09-01T09:00:00Z') + minutes * 60_000).toISOString()
const ev = (vid: string | undefined, type: string, minutes: number) =>
  ({ type, vid, ts: at(minutes) }) as AnalyticsEvent

describe('chatbot repeat use', () => {
  it('counts a later visit, and a message on it, per visitor', () => {
    const result = chatbotRepeatUse([
      // a: messages, leaves, comes back two hours later and messages again.
      ev('a', 'page_view', 0),
      ev('a', 'chatbot_message', 1),
      ev('a', 'page_view', 120),
      ev('a', 'chatbot_message', 121),
      // b: messages, comes back the next day but only browses.
      ev('b', 'chatbot_message', 0),
      ev('b', 'page_view', 1440),
      // c: several messages in one visit, never returns.
      ev('c', 'chatbot_message', 0),
      ev('c', 'chatbot_message', 20),
      ev('c', 'chatbot_message', 45),
      // d: browsed earlier, first message on the last visit — nothing after.
      ev('d', 'page_view', 0),
      ev('d', 'chatbot_message', 300),
      // e: never messaged; f: no visitor id. Neither counts.
      ev('e', 'chatbot_open', 0),
      ev('e', 'chatbot_open', 500),
      ev(undefined, 'chatbot_message', 0),
      ev(undefined, 'chatbot_message', 500),
    ])
    expect(result).toEqual({ tried: 4, cameBack: 2, usedAgain: 1 })
  })

  it('reads newest-first input the same as oldest-first', () => {
    const events = [
      ev('a', 'chatbot_message', 0),
      ev('a', 'page_view', 29),
      ev('a', 'chatbot_message', 90),
    ]
    expect(chatbotRepeatUse([...events].reverse())).toEqual(
      chatbotRepeatUse(events)
    )
    expect(chatbotRepeatUse(events)).toEqual({
      tried: 1,
      cameBack: 1,
      usedAgain: 1,
    })
  })

  it('treats activity within 30 minutes as the same visit', () => {
    expect(
      chatbotRepeatUse([
        ev('a', 'chatbot_message', 0),
        ev('a', 'page_view', 25),
        ev('a', 'chatbot_message', 50),
      ])
    ).toEqual({ tried: 1, cameBack: 0, usedAgain: 0 })
  })
})
