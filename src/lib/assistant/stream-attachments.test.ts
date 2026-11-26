// What the server does with documents attached to chatbot messages: what it
// accepts, how the model is shown them, and that their text never reaches
// the conversation log.

import { describe, expect, it } from 'vitest'
import {
  MAX_ATTACHMENT_CHARS,
  MAX_CONVERSATION_ATTACHMENT_CHARS,
} from './attachments'
import {
  buildApiMessages,
  logContent,
  validateFullHistoryWithIndices,
  validateLogHistoryWithIndices,
  validateMessages,
} from './stream'

const cv = { name: 'cv.pdf', text: 'Jane Doe. Ten years in machine learning.' }

describe('validateMessages with attached documents', () => {
  it('keeps a document on the message it came with', () => {
    expect(
      validateMessages([
        { role: 'user', content: 'Any jobs?', attachments: [cv] },
      ])
    ).toEqual([{ role: 'user', content: 'Any jobs?', attachments: [cv] }])
  })

  it('accepts a message that is a document and no words', () => {
    expect(
      validateMessages([{ role: 'user', content: '', attachments: [cv] }])
    ).toEqual([{ role: 'user', content: '', attachments: [cv] }])
  })

  it('still drops a message with neither words nor a document', () => {
    expect(() =>
      validateMessages([{ role: 'user', content: '', attachments: [] }])
    ).toThrow('no valid messages')
  })

  it('ignores documents on the assistant’s own messages', () => {
    const cleaned = validateMessages([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello', attachments: [cv] },
      { role: 'user', content: 'Any jobs?' },
    ])
    expect(cleaned[1]).toEqual({ role: 'assistant', content: 'Hello' })
  })

  it('refuses a conversation carrying more document text than the widget allows', () => {
    const big = { name: 'big.pdf', text: 'x'.repeat(MAX_ATTACHMENT_CHARS) }
    const turns = Math.floor(
      MAX_CONVERSATION_ATTACHMENT_CHARS / MAX_ATTACHMENT_CHARS
    )
    const messages: unknown[] = []
    for (let i = 0; i < turns + 1; i++) {
      messages.push({ role: 'user', content: `Part ${i}`, attachments: [big] })
      messages.push({ role: 'assistant', content: 'Thanks' })
    }
    messages.push({ role: 'user', content: 'What do you think?' })
    expect(() => validateMessages(messages)).toThrow(
      'too much attached document text'
    )
  })
})

describe('buildApiMessages with attached documents', () => {
  it('leaves messages without documents as plain strings', () => {
    expect(
      buildApiMessages(
        [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
          { role: 'user', content: 'Any jobs?' },
        ],
        '[context]'
      )
    ).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: '[context]\n\nAny jobs?' },
    ])
  })

  it('puts the document before the context line and the visitor’s words', () => {
    const [message] = buildApiMessages(
      [{ role: 'user', content: 'Any jobs?', attachments: [cv] }],
      '[context]'
    )
    expect(message.content).toEqual([
      {
        type: 'text',
        text: `<attached_document name="cv.pdf">\n${cv.text}\n</attached_document>`,
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: '[context]\n\nAny jobs?' },
    ])
  })

  it('shows the document the same way on a later turn, so the cache still matches', () => {
    const first = buildApiMessages(
      [{ role: 'user', content: 'Any jobs?', attachments: [cv] }],
      '[context]'
    )
    const later = buildApiMessages(
      [
        { role: 'user', content: 'Any jobs?', attachments: [cv] },
        { role: 'assistant', content: 'Here are three.' },
        { role: 'user', content: 'And funding?' },
      ],
      '[other context]'
    )
    const documentBlock = (m: (typeof first)[number]) =>
      Array.isArray(m.content) ? m.content[0] : null
    expect(documentBlock(later[0])).toEqual(documentBlock(first[0]))
    expect(later[2]).toEqual({
      role: 'user',
      content: '[other context]\n\nAnd funding?',
    })
  })

  it('marks only the newest document as the cache point', () => {
    const second = { name: 'proposal.docx', text: 'A proposal.' }
    const built = buildApiMessages(
      [
        { role: 'user', content: 'My CV', attachments: [cv] },
        { role: 'assistant', content: 'Thanks' },
        { role: 'user', content: 'And these', attachments: [second, cv] },
      ],
      '[context]'
    )
    const marked = built.flatMap(m =>
      Array.isArray(m.content)
        ? m.content.filter(b => 'cache_control' in b && b.cache_control)
        : []
    )
    expect(marked).toHaveLength(1)
    expect(marked[0]).toMatchObject({
      text: expect.stringContaining('name="cv.pdf"'),
    })
    // It is the last document of the last message that has any.
    const last = built[2].content
    expect(Array.isArray(last) && last[1]).toBe(marked[0])
  })

  it('tells the model when a document came with no message', () => {
    const [message] = buildApiMessages(
      [{ role: 'user', content: '', attachments: [cv] }],
      '[context]'
    )
    expect(Array.isArray(message.content) && message.content[1]).toEqual({
      type: 'text',
      text: '[context]\n\n(The visitor attached the document above and typed no message.)',
    })
  })
})

describe('the conversation log never gets a document’s text', () => {
  const messages = [
    { role: 'user', content: 'Any jobs?', attachments: [cv] },
    { role: 'assistant', content: 'Here are three.' },
    { role: 'user', content: '', attachments: [cv] },
  ]
  const note =
    '[Attached: cv.pdf (40 characters). Document text is not stored.]'

  it('swaps each document for a note in the log’s window', () => {
    const { history, indices } = validateLogHistoryWithIndices(messages)
    expect(history).toEqual([
      { role: 'user', content: `Any jobs?\n\n${note}` },
      { role: 'assistant', content: 'Here are three.' },
      { role: 'user', content: note },
    ])
    expect(indices).toEqual([0, 1, 2])
    expect(JSON.stringify(history)).not.toContain('Jane Doe')
  })

  it('and in the full transcript kept for long chats', () => {
    const { history } = validateFullHistoryWithIndices(messages)
    expect(JSON.stringify(history)).not.toContain('Jane Doe')
    expect(history[2]).toEqual({ role: 'user', content: note })
  })
})

describe('logContent', () => {
  const cv = { name: 'cv.pdf', text: 'x'.repeat(5200) }
  const docNote =
    '[Attached: cv.pdf (5,200 characters). Document text is not stored.]'

  it('adds the document note after the typed words', () => {
    expect(
      logContent({
        role: 'user',
        content: 'Any jobs for me?',
        attachments: [cv],
      })
    ).toBe(`Any jobs for me?\n\n${docNote}`)
  })

  it('is just the note for a message with no words', () => {
    expect(logContent({ role: 'user', content: '', attachments: [cv] })).toBe(
      docNote
    )
  })

  it('marks a dictated message, before any document note', () => {
    expect(
      logContent({ role: 'user', content: 'Any jobs?', dictated: true })
    ).toBe('Any jobs?\n\n[Dictated with the microphone.]')
    expect(
      logContent({
        role: 'user',
        content: 'Any jobs?',
        dictated: true,
        attachments: [cv],
      })
    ).toBe(`Any jobs?\n\n[Dictated with the microphone.]\n\n${docNote}`)
  })

  it('leaves an ordinary message as it is', () => {
    expect(logContent({ role: 'user', content: 'Hello' })).toBe('Hello')
  })
})

describe('dictated messages', () => {
  it('keeps the mark on a visitor’s message with words', () => {
    expect(
      validateMessages([
        { role: 'user', content: 'any evals roles', dictated: true },
      ])
    ).toEqual([{ role: 'user', content: 'any evals roles', dictated: true }])
  })

  it('drops it on the assistant’s messages, on empty words, and on anything but true', () => {
    const cleaned = validateMessages([
      { role: 'user', content: '', dictated: true, attachments: [cv] },
      { role: 'assistant', content: 'Hello', dictated: true },
      { role: 'user', content: 'Any jobs?', dictated: 'yes' },
    ])
    expect(cleaned.map(m => m.dictated)).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })

  it('tells the model a word may be misheard, on this turn and later ones', () => {
    const built = buildApiMessages(
      [
        { role: 'user', content: 'any air safety jobs', dictated: true },
        { role: 'assistant', content: 'Here are some.' },
        { role: 'user', content: 'and funding', dictated: true },
      ],
      '[context]'
    )
    const note = '[Dictated with the microphone: a word may be misheard.]'
    expect(built[0].content).toBe(`${note}\nany air safety jobs`)
    expect(built[2].content).toBe(`[context]\n\n${note}\nand funding`)
  })

  it('puts the note with the words, after any document', () => {
    const [message] = buildApiMessages(
      [
        {
          role: 'user',
          content: 'what fits me',
          dictated: true,
          attachments: [cv],
        },
      ],
      '[context]'
    )
    expect(Array.isArray(message.content) && message.content[1]).toEqual({
      type: 'text',
      text: '[context]\n\n[Dictated with the microphone: a word may be misheard.]\nwhat fits me',
    })
  })

  it('shows in the conversation log', () => {
    const { history } = validateLogHistoryWithIndices([
      { role: 'user', content: 'any evals roles', dictated: true },
    ])
    expect(history[0].content).toBe(
      'any evals roles\n\n[Dictated with the microphone.]'
    )
  })
})
