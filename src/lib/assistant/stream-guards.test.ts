// Tests for the reply-shape guards in runAssistantStream: the narrated-search
// and missing-marker redos (a real conversation on 22 August 2026 received an
// 11,000-character raw reasoning dump because the model never emitted
// [[/thinking]], never called a tool, and hit the token limit mid-word), plus
// the history-index map that keeps the admin's position-keyed badges
// (delivery, ratings, clicks) attached to the right replies after windowing.

import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import {
  NARRATED_SEARCH_RE,
  looksLikeReasoningText,
  runAssistantStream,
  validateLogHistoryWithIndices,
} from './stream'
import type { Catalog } from './types'

describe('NARRATED_SEARCH_RE', () => {
  it('matches search announcements seen in the leaked reply', () => {
    for (const s of [
      'Let me search for orgs working on unlearning.',
      "I'm going to look for orgs working on data filtering.",
      'Let me look at which orgs work on unlearning and safeguards.',
      'Let me run several searches.',
      'I’ll search for open fellowships now.',
      'Let me quickly check the listings.',
    ]) {
      expect(s).toMatch(NARRATED_SEARCH_RE)
    }
  })

  it('ignores ordinary "let me" phrasing in real answers', () => {
    for (const s of [
      'Let me name it precisely, because your framing undersells you.',
      'Let me be honest about the trade-offs.',
      "Let me know if you'd like more detail on either.",
      'You can search the training page yourself with the filters.',
      'Let me flag one thing about the 13 September deadline.',
    ]) {
      expect(s).not.toMatch(NARRATED_SEARCH_RE)
    }
  })
})

describe('looksLikeReasoningText', () => {
  it('recognises the leaked reasoning voice', () => {
    expect(
      looksLikeReasoningText(
        'The user has shared their rejected ERA proposal and implicitly wants feedback. Let me be honest and specific.'
      )
    ).toBe(true)
    expect(
      looksLikeReasoningText(
        'Okay, the visitor wants a concrete plan. I need to keep it short.'
      )
    ).toBe(true)
    // Two self-talk phrases mid-text, without an opening cue.
    expect(
      looksLikeReasoningText(
        'Deepfakes sit outside the frame. Let me weigh this. Let me check the strongest option next.'
      )
    ).toBe(true)
  })

  it('passes real answers and refusals through', () => {
    expect(
      looksLikeReasoningText(
        'MATS Winter 2027 is open now, with applications closing 6 September.'
      )
    ).toBe(false)
    expect(
      looksLikeReasoningText(
        "I can't help with that here — this chat covers AI-safety resources."
      )
    ).toBe(false)
    expect(
      looksLikeReasoningText('Good luck with it. Let me know how the run goes.')
    ).toBe(false)
  })
})

describe('validateLogHistoryWithIndices', () => {
  it('keeps original positions across mid-list drops', () => {
    const { history, indices } = validateLogHistoryWithIndices([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second question' },
      // An errored turn's reply bubble: empty content, dropped by cleaning.
      { role: 'assistant', content: '' },
      { role: 'user', content: 'third question' },
    ])
    expect(history.map(m => m.content)).toEqual([
      'first question',
      'first answer',
      'second question',
      'third question',
    ])
    expect(indices).toEqual([0, 1, 2, 4])
  })

  it('keeps original positions across the 50-message window', () => {
    const messages: { role: 'user' | 'assistant'; content: string }[] = []
    for (let i = 0; i < 30; i++) {
      messages.push({ role: 'user', content: `q${i}` })
      messages.push({ role: 'assistant', content: `a${i}` })
    }
    messages.push({ role: 'user', content: 'final' })
    const { history, indices } = validateLogHistoryWithIndices(messages)
    expect(history).toHaveLength(50)
    expect(indices).toHaveLength(50)
    // Last kept message is the final user turn at its true position.
    expect(indices[indices.length - 1]).toBe(60)
    expect(history[0].content).toBe(messages[11].content)
    expect(indices[0]).toBe(11)
  })

  it('drops an oversized assistant reply without shifting later positions', () => {
    const { history, indices } = validateLogHistoryWithIndices([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'x'.repeat(12001) },
      { role: 'user', content: 'q2' },
    ])
    expect(history.map(m => m.content)).toEqual(['q', 'q2'])
    expect(indices).toEqual([0, 2])
  })
})

// ---------------------------------------------------------------------------
// runAssistantStream integration, with a scripted fake Anthropic client. Each
// call to messages.create pops the next scripted generation; the loop's redo
// paths are exercised exactly as in production.

interface ScriptedGeneration {
  text: string
  stopReason: 'end_turn' | 'max_tokens'
}

function fakeClient(script: ScriptedGeneration[]): {
  client: Anthropic
  calls: Anthropic.MessageParam[][]
} {
  const calls: Anthropic.MessageParam[][] = []
  const client = {
    messages: {
      create: async (params: { messages: Anthropic.MessageParam[] }) => {
        calls.push(JSON.parse(JSON.stringify(params.messages)))
        const gen = script.shift()
        if (!gen) throw new Error('fake client script exhausted')
        // Copy the fields out: TypeScript does not carry the guard above into
        // a hoisted function* declaration, so `gen` would still be possibly
        // undefined inside it.
        const { text, stopReason } = gen
        async function* events() {
          yield {
            type: 'message_start',
            message: {
              usage: {
                input_tokens: 1,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
            },
          }
          yield { type: 'content_block_start', content_block: { type: 'text' } }
          // Stream in small chunks so the marker hold-back gate is exercised.
          for (let i = 0; i < text.length; i += 7) {
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: text.slice(i, i + 7) },
            }
          }
          yield { type: 'content_block_stop' }
          yield {
            type: 'message_delta',
            delta: { stop_reason: stopReason },
          }
        }
        const iterable = events() as AsyncGenerator & {
          controller: { abort: () => void }
        }
        iterable.controller = { abort: () => {} }
        return iterable
      },
    },
  }
  return { client: client as unknown as Anthropic, calls }
}

const EMPTY_CATALOG: Catalog = { listings: [], generatedAt: '2026-01-01' }

function runOptions(client: Anthropic, sent: [string, unknown][]) {
  return {
    client,
    systemPrompt: 'system',
    pagesBlock: 'pages',
    donationGuide: 'guide',
    model: 'claude-test',
    apiMessages: [
      { role: 'user' as const, content: 'What should I apply to?' },
    ],
    catalog: EMPTY_CATALOG,
    send: (event: string, data: unknown) => {
      sent.push([event, data])
    },
  }
}

describe('runAssistantStream reply-shape guards', () => {
  it('redoes a finished reply that is raw reasoning with no [[/thinking]]', async () => {
    const reasoningDump =
      'The user has shared their rejected proposal and implicitly wants feedback. I should be specific about the weaknesses I can see here, and honest.'
    const rewrite = '[[/thinking]]\nHere is direct feedback on your proposal.'
    const { client, calls } = fakeClient([
      { text: reasoningDump, stopReason: 'end_turn' },
      { text: rewrite, stopReason: 'end_turn' },
    ])
    const sent: [string, unknown][] = []
    const result = await runAssistantStream(runOptions(client, sent))

    expect(result.toolCalls.map(c => c.name)).toContain(
      'redo_after_missing_marker'
    )
    // The rewrite's answer is what follows the last marker.
    const answer = result.assistantText.split('[[/thinking]]').pop() ?? ''
    expect(answer.trim()).toBe('Here is direct feedback on your proposal.')
    // The widget was told a redo is happening and got a draft-closing marker.
    expect(sent.some(([e]) => e === 'redo')).toBe(true)
    // The second call carried the corrective instruction.
    const secondCallMessages = calls[1]
    const last = secondCallMessages[secondCallMessages.length - 1]
    expect(String(last.content)).toContain('AUTOMATED FORMAT AUDIT')
  })

  it('redoes a reply that narrates a search no tool ran', async () => {
    const narrated =
      'Let me search for orgs working on unlearning.\n[[/thinking]]\nTwo useful hits: EleutherAI and Redwood Research.'
    const rewrite = '[[/thinking]]\nThe field map lists relevant orgs.'
    const { client, calls } = fakeClient([
      { text: narrated, stopReason: 'end_turn' },
      { text: rewrite, stopReason: 'end_turn' },
    ])
    const sent: [string, unknown][] = []
    const result = await runAssistantStream(runOptions(client, sent))

    expect(result.toolCalls.map(c => c.name)).toContain(
      'redo_after_narrated_search'
    )
    const answer = result.assistantText.split('[[/thinking]]').pop() ?? ''
    expect(answer.trim()).toBe('The field map lists relevant orgs.')
    const secondCallMessages = calls[1]
    const last = secondCallMessages[secondCallMessages.length - 1]
    expect(String(last.content)).toContain('AUTOMATED TOOL-CALL AUDIT')
  })

  it('redoes and flags a reply cut off at the token limit before its marker', async () => {
    const truncated =
      'Your proposal has five issues worth addressing. First, the scope sits outsi'
    const rewrite = '[[/thinking]]\nYour proposal has five issues. First...'
    const { client } = fakeClient([
      { text: truncated, stopReason: 'max_tokens' },
      { text: rewrite, stopReason: 'end_turn' },
    ])
    const sent: [string, unknown][] = []
    const result = await runAssistantStream(runOptions(client, sent))

    const names = result.toolCalls.map(c => c.name)
    expect(names).toContain('reply_hit_token_limit')
    expect(names).toContain('redo_after_missing_marker')
    const answer = result.assistantText.split('[[/thinking]]').pop() ?? ''
    expect(answer.trim()).toBe('Your proposal has five issues. First...')
  })

  it('leaves a short direct answer without a marker untouched', async () => {
    const direct =
      'MATS Winter 2027 is open now, with applications closing 6 September.'
    const { client, calls } = fakeClient([
      { text: direct, stopReason: 'end_turn' },
    ])
    const sent: [string, unknown][] = []
    const result = await runAssistantStream(runOptions(client, sent))

    expect(calls).toHaveLength(1)
    expect(result.toolCalls).toHaveLength(0)
    expect(result.assistantText).toBe(direct)
    expect(sent.some(([e]) => e === 'redo')).toBe(false)
  })

  it('accepts a normal reasoning + marker + answer reply without a redo', async () => {
    const normal =
      'The user asks about deadlines. Let me answer from the conversation.\n[[/thinking]]\nThe deadline is 6 September.'
    const { client, calls } = fakeClient([
      { text: normal, stopReason: 'end_turn' },
    ])
    const sent: [string, unknown][] = []
    const result = await runAssistantStream(runOptions(client, sent))

    expect(calls).toHaveLength(1)
    expect(result.toolCalls).toHaveLength(0)
    const answer = result.assistantText.split('[[/thinking]]').pop() ?? ''
    expect(answer.trim()).toBe('The deadline is 6 September.')
  })
})
