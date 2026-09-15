'use client'

import { useEffect, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import {
  fromTiptap,
  toTiptap,
  type TiptapNode,
} from '@/lib/donation-guide/tiptap-map'
import { validHref } from '@/lib/donation-guide/validate'
import type { RichText } from '@/lib/donation-guide/types'
import styles from '../donation-guide.module.css'

// One text box, typed like a document. TipTap trimmed to what the guide
// can hold: paragraphs, bold, bullet and numbered lists, links, undo. The
// intro box is a single paragraph with bold and links only. The editor's
// document is mapped to the guide's JSON on every change (tiptap-map.ts)
// and the server validates that again on save.

/** Enter does nothing: the intro is one sentence. */
const SingleParagraph = Extension.create({
  name: 'singleParagraph',
  addKeyboardShortcuts() {
    return { Enter: () => true, 'Shift-Enter': () => true }
  },
})

interface Props {
  /** Loaded once, when the box mounts: switch sections by remounting. */
  value: RichText
  onChange: (value: RichText) => void
  mode: 'section' | 'intro'
  editable: boolean
}

export default function RichEditor({ value, onChange, mode, editable }: Props) {
  const intro = mode === 'intro'
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        italic: false,
        hardBreak: false,
        underline: false,
        link: false,
        bulletList: intro ? false : undefined,
        orderedList: intro ? false : undefined,
        listItem: intro ? false : undefined,
        listKeymap: intro ? false : undefined,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: null, target: null },
      }),
      ...(intro ? [SingleParagraph] : []),
    ],
    content: toTiptap(value),
    onUpdate: ({ editor }) => {
      onChange(
        fromTiptap(editor.getJSON() as TiptapNode, { singleParagraph: intro })
      )
    },
  })

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            bullets: e.isActive('bulletList'),
            numbers: e.isActive('orderedList'),
            link: e.isActive('link'),
            href: (e.getAttributes('link').href as string | undefined) ?? '',
            hasSelection: !e.state.selection.empty,
          }
        : null,
  })

  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)

  function openLink() {
    if (!editor || !state) return
    if (!state.link && !state.hasSelection) {
      setLinkError('Select the words to link first.')
      setLinkOpen(true)
      setLinkValue('')
      return
    }
    setLinkError(null)
    setLinkValue(state.href)
    setLinkOpen(true)
  }

  function applyLink() {
    if (!editor) return
    const raw = linkValue.trim()
    if (!raw) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      setLinkOpen(false)
      return
    }
    const href =
      raw.startsWith('/') || /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    if (!validHref(href)) {
      setLinkError('That is not a web address or a site path like /events.')
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    setLinkOpen(false)
    setLinkError(null)
  }

  const tb = (on: boolean) =>
    `${styles.tbButton} ${on ? styles.tbButtonOn : ''}`

  return (
    <div className={styles.field}>
      {editable && (
        <div className={styles.toolbar}>
          <button
            type="button"
            className={tb(Boolean(state?.bold))}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            title="Bold (Cmd+B)"
          >
            Bold
          </button>
          {!intro && (
            <>
              <button
                type="button"
                className={tb(Boolean(state?.bullets))}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              >
                Bullets
              </button>
              <button
                type="button"
                className={tb(Boolean(state?.numbers))}
                onClick={() =>
                  editor?.chain().focus().toggleOrderedList().run()
                }
              >
                Numbered
              </button>
            </>
          )}
          <button
            type="button"
            className={tb(Boolean(state?.link))}
            onClick={openLink}
            title="Select words, then add a link (or paste a URL over them)"
          >
            Link
          </button>
          {state?.link && (
            <button
              type="button"
              className={styles.tbButton}
              onClick={() =>
                editor
                  ?.chain()
                  .focus()
                  .extendMarkRange('link')
                  .unsetLink()
                  .run()
              }
            >
              Remove link
            </button>
          )}
          <button
            type="button"
            className={styles.tbButton}
            onClick={() => editor?.chain().focus().undo().run()}
            title="Undo (Cmd+Z)"
          >
            Undo
          </button>
        </div>
      )}
      {linkOpen && (
        <div className={styles.linkPop}>
          <input
            className={styles.input}
            value={linkValue}
            onChange={e => setLinkValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyLink()
              }
              if (e.key === 'Escape') setLinkOpen(false)
            }}
            placeholder="https://… or /events"
            autoFocus
            disabled={Boolean(
              linkError && !state?.hasSelection && !state?.link
            )}
          />
          <button
            type="button"
            className={styles.tbButton}
            onClick={applyLink}
            disabled={Boolean(
              linkError && !state?.hasSelection && !state?.link
            )}
          >
            {linkValue.trim() ? 'Set link' : 'Remove link'}
          </button>
          <button
            type="button"
            className={styles.tbButton}
            onClick={() => setLinkOpen(false)}
          >
            Cancel
          </button>
          {linkError && <span className={styles.linkHint}>{linkError}</span>}
        </div>
      )}
      <div className={`${styles.prose} ${intro ? styles.proseIntro : ''}`}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
