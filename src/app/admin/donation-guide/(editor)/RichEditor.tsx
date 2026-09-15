'use client'

import { useEffect, useRef, useState } from 'react'
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
import Icon from '@/components/Icon'
import styles from '../donation-guide.module.css'

// One text box, typed like a document. TipTap trimmed to what the guide
// can hold: paragraphs, bold, bullet and numbered lists, links. The
// intro box is a single sentence whose only formatting is the teal
// highlight (stored as bold, drawn as the accent colour). The editor's
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
        // One undo for the whole editor (GuideEditor), not one per box.
        undoRedo: false,
        bulletList: intro ? false : undefined,
        orderedList: intro ? false : undefined,
        listItem: intro ? false : undefined,
        listKeymap: intro ? false : undefined,
      }),
      // The intro is one sentence with the teal highlight only: no links.
      ...(intro
        ? [SingleParagraph]
        : [
            Link.configure({
              openOnClick: false,
              autolink: true,
              linkOnPaste: true,
              defaultProtocol: 'https',
              HTMLAttributes: { rel: null, target: null },
            }),
          ]),
    ],
    content: toTiptap(value),
    editorProps: {
      // Cmd+K on selected words opens the link box (openLink is defined
      // below; the ref keeps this handler pointing at the latest one).
      handleKeyDown: (_view, event) => {
        if (
          !intro &&
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === 'k'
        ) {
          event.preventDefault()
          openLinkRef.current()
          return true
        }
        return false
      },
    },
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
            // A box that nobody is in has its cursor at the very start,
            // which would light Link up in a section that opens with one.
            focused: e.isFocused,
          }
        : null,
  })

  const openLinkRef = useRef<() => void>(() => {})
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

  useEffect(() => {
    openLinkRef.current = openLink
  })

  const active = (on: boolean | undefined) => Boolean(state?.focused && on)
  const tb = (on: boolean) =>
    `${styles.tbButton} ${styles.tbIcon} ${on ? styles.tbButtonOn : ''}`
  /** Toolbar clicks keep the cursor in the box. */
  const keepFocus = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div className={styles.field}>
      {editable && intro && (
        <div className={styles.toolbar}>
          <button
            type="button"
            className={`${styles.tbButton} ${active(state?.bold) ? styles.tbButtonOn : ''}`}
            onMouseDown={keepFocus}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            title="Highlight the selected words in the teal accent (Cmd+B)"
          >
            Highlight
          </button>
        </div>
      )}
      {editable && !intro && (
        <div className={styles.toolbar}>
          <button
            type="button"
            className={tb(active(state?.bold))}
            onMouseDown={keepFocus}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            title="Bold (Cmd+B)"
            aria-label="Bold"
          >
            <Icon src="/images/icons/text-bold.svg" />
          </button>
          {!intro && (
            <>
              <button
                type="button"
                className={tb(active(state?.bullets))}
                onMouseDown={keepFocus}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                title="Bullet list"
                aria-label="Bullet list"
              >
                <Icon src="/images/icons/list-bullets.svg" />
              </button>
              <button
                type="button"
                className={tb(active(state?.numbers))}
                onMouseDown={keepFocus}
                onClick={() =>
                  editor?.chain().focus().toggleOrderedList().run()
                }
                title="Numbered list"
                aria-label="Numbered list"
              >
                <Icon src="/images/icons/list-numbered.svg" />
              </button>
            </>
          )}
          <button
            type="button"
            className={tb(active(state?.link))}
            onMouseDown={keepFocus}
            onClick={openLink}
            title="Link (Cmd+K): select the words first, or paste a web address over them"
            aria-label="Link"
          >
            <Icon src="/images/icons/link.svg" />
          </button>
          {active(state?.link) && (
            <button
              type="button"
              className={styles.tbButton}
              onMouseDown={keepFocus}
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
