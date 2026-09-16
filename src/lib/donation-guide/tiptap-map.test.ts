import { describe, expect, it } from 'vitest'
import { SEED_GUIDE } from './seed'
import { fromTiptap, toTiptap, type TiptapNode } from './tiptap-map'
import { validateGuide } from './validate'

describe('tiptap mapping', () => {
  it('round-trips every section of the seed and the intro unchanged', () => {
    for (const tab of SEED_GUIDE.tabs) {
      for (const s of tab.sections) {
        expect(fromTiptap(toTiptap(s.body)), `${tab.id} ${s.time}`).toEqual(
          s.body
        )
      }
    }
    expect(
      fromTiptap(toTiptap(SEED_GUIDE.intro), { singleParagraph: true })
    ).toEqual(SEED_GUIDE.intro)
  })

  it('maps lists both ways, flattens nested lists and drops empty paragraphs', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            {
              type: 'text',
              text: 'world',
              // Link before bold, as the editor orders marks: the inline
              // still comes out as text, bold, href.
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://x.y/', target: '_blank', rel: 'x' },
                },
                { type: 'bold' },
              ],
            },
            { type: 'text', text: ' ' },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'nested' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'lines' }],
                },
              ],
            },
            { type: 'listItem', content: [{ type: 'paragraph' }] },
          ],
        },
        { type: 'paragraph' },
      ],
    }
    const rt = fromTiptap(doc)
    expect(
      Object.keys(
        rt.blocks[0].type === 'paragraph' ? rt.blocks[0].inlines[1] : {}
      )
    ).toEqual(['text', 'bold', 'href'])
    expect(rt).toEqual({
      blocks: [
        {
          type: 'paragraph',
          inlines: [
            { text: 'Hello ' },
            { text: 'world', bold: true, href: 'https://x.y/' },
          ],
        },
        {
          type: 'numbers',
          items: [
            [{ text: 'one' }],
            [{ text: 'nested' }],
            [{ text: 'two lines' }],
          ],
        },
      ],
    })
    // What the editor gets back carries only the href on links.
    const back = toTiptap(rt)
    expect(back.content?.[0].content?.[1].marks).toEqual([
      { type: 'bold' },
      { type: 'link', attrs: { href: 'https://x.y/' } },
    ])
    expect(fromTiptap(back)).toEqual(rt)
  })

  it('merges runs of same-format text and turns hard breaks into spaces', () => {
    const rt = fromTiptap({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
            { type: 'hardBreak' },
            { type: 'text', text: 'c', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'd', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    })
    expect(rt.blocks).toEqual([
      {
        type: 'paragraph',
        inlines: [{ text: 'ab ' }, { text: 'cd', bold: true }],
      },
    ])
  })

  it('collapses the intro to one paragraph and passes the validator', () => {
    const rt = fromTiptap(
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'One.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Two.' }] },
        ],
      },
      { singleParagraph: true }
    )
    expect(rt).toEqual({
      blocks: [{ type: 'paragraph', inlines: [{ text: 'One. Two.' }] }],
    })
    const empty = fromTiptap(
      { type: 'doc', content: [{ type: 'paragraph' }] },
      {
        singleParagraph: true,
      }
    )
    expect(empty.blocks).toEqual([{ type: 'paragraph', inlines: [] }])
    const g = JSON.parse(JSON.stringify(SEED_GUIDE))
    g.intro = empty
    expect(validateGuide(g).ok).toBe(true)
  })
})
