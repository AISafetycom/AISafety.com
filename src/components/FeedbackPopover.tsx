'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import Button from '@/components/Button'
import Popover, { pageBox } from '@/components/Popover'
import TextField from '@/components/TextField'
import { trackFeedbackForm, trackedPath } from '@/lib/analytics'
import type { SearchEntry } from '@/lib/data/search-index'
import { FEEDBACK_FORM_EVENT, type FeedbackRequest } from '@/lib/feedback-form'
import { findListing, pickableListings } from '@/lib/listing-pick'
import { quoteForForm, resourceForPath } from '@/lib/selection-feedback'
import { RESOURCE_CHOICES } from '@/lib/site-feedback'
import styles from './FeedbackPopover.module.css'

// The site's correction and feedback form, in a <Popover> right where the
// visitor is, instead of an Airtable form in a new tab (the design follows
// Vercel's docs feedback box: a text box and one Send button). Mounted once
// in the root layout; the selection menu, the footer's links, the pages'
// "Suggest a correction" buttons and the Field map's "Suggest correction"
// item open it with openFeedbackForm(). It posts to
// /api/site-feedback, which saves a row in the same Airtable table the
// Airtable form did.

interface Draft {
  resource: string
  listingName: string
  text: string
  email: string
  /** Honeypot: hidden from people, filled in by naive bots. */
  website: string
}

const EMPTY_DRAFT: Draft = {
  resource: '',
  listingName: '',
  text: '',
  email: '',
  website: '',
}

// Same shape the server accepts for ?view= (src/lib/site-feedback.ts).
const VIEW_RE = /^[a-z-]{1,40}$/

type Status = 'editing' | 'sending' | 'sent' | 'error' | 'limited'

interface Opened extends FeedbackRequest {
  /** The page it was opened on, as analytics records it. */
  path: string
  view?: string
  /** What was typed into this form before, if it was closed unsent. */
  draft: Draft
  /** Counts openings, so each one starts a fresh form. */
  n: number
}

// The listings "Which listing?" offers: the site search's index, loaded once
// the first time the box is shown and kept for the page's life. null when it
// couldn't load: then any typed name goes, as before.
let listingIndex: Promise<SearchEntry[] | null> | null = null
function loadListingIndex(): Promise<SearchEntry[] | null> {
  listingIndex ??= fetch('/api/search-index', { credentials: 'omit' })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<unknown>
    })
    .then(body => {
      if (!Array.isArray(body)) throw new Error('not an array')
      return body as SearchEntry[]
    })
    .catch(err => {
      console.warn(
        'Corrections form: the listings to pick from did not load',
        err
      )
      listingIndex = null
      return null
    })
  return listingIndex
}

// The name the selected text is marked under while the form is open.
const HIGHLIGHT = 'feedback-quote'

/** What was typed is kept for the same form on the same text, so closing it
 *  by accident (a click on the page) loses nothing. */
function draftKey(o: Pick<Opened, 'kind' | 'path' | 'listing' | 'quote'>) {
  return [o.kind, o.path, o.listing?.name ?? '', o.quote ?? ''].join('\n')
}

export default function FeedbackPopover() {
  const pathname = usePathname()
  const [opened, setOpened] = useState<Opened | null>(null)
  const [open, setOpen] = useState(false)
  // Moving to another page closes it (and coming back doesn't reopen it).
  const [shownOn, setShownOn] = useState(pathname)
  if (pathname !== shownOn) {
    setShownOn(pathname)
    setOpen(false)
  }
  const triggerRef = useRef<HTMLElement | SVGElement | null>(null)
  const drafts = useRef(new Map<string, Draft>())

  useEffect(() => {
    function onRequest(e: Event) {
      const request = (e as CustomEvent<FeedbackRequest>).detail
      const path = trackedPath(window.location.pathname)
      const view =
        new URLSearchParams(window.location.search).get('view') ?? undefined
      triggerRef.current = request.trigger
      const quote = request.quote ? quoteForForm(request.quote) : undefined
      const draft =
        drafts.current.get(draftKey({ ...request, path, quote })) ?? EMPTY_DRAFT
      setOpened(prev => ({
        ...request,
        anchor: request.anchor ?? pageBox(request.trigger),
        quote,
        resource:
          request.kind === 'correction'
            ? (request.resource ?? resourceForPath(path, view))
            : undefined,
        path,
        view: view && VIEW_RE.test(view) ? view : undefined,
        draft,
        n: (prev?.n ?? 0) + 1,
      }))
      setOpen(true)
      trackFeedbackForm(
        'open',
        request.kind,
        request.entry,
        request.listing?.id
      )
    }
    window.addEventListener(FEEDBACK_FORM_EVENT, onRequest)
    return () => window.removeEventListener(FEEDBACK_FORM_EVENT, onRequest)
  }, [])

  // The selected text stays marked while the form is open, as if still
  // selected (the ::highlight(feedback-quote) rule in globals.css). Browsers
  // without the CSS Highlight API just don't mark it.
  const range = open ? opened?.range : undefined
  useEffect(() => {
    if (!range || !('highlights' in CSS)) return
    CSS.highlights.set(HIGHLIGHT, new Highlight(range))
    return () => {
      CSS.highlights.delete(HIGHLIGHT)
    }
  }, [range])

  const close = useCallback(() => setOpen(false), [])
  const saveDraft = useCallback((key: string, draft: Draft | null) => {
    if (draft) drafts.current.set(key, draft)
    else drafts.current.delete(key)
  }, [])

  if (!opened) return null

  const correction = opened.kind === 'correction'
  const key = draftKey(opened)

  return (
    <Popover
      open={open}
      onClose={close}
      triggerRef={triggerRef}
      anchor={opened.anchor}
      anchorLines={opened.anchorLines}
      label={correction ? 'Suggest a correction' : 'Give feedback'}
    >
      <div className="padding-top-24px padding-bottom-24px padding-left-24px padding-right-24px">
        <FeedbackForm
          key={opened.n}
          opened={opened}
          onDraft={draft => saveDraft(key, draft)}
          onSent={() => saveDraft(key, null)}
          onClose={() => {
            close()
            triggerRef.current?.focus()
          }}
        />
      </div>
    </Popover>
  )
}

function FeedbackForm({
  opened,
  onDraft,
  onSent,
  onClose,
}: {
  opened: Opened
  onDraft: (draft: Draft) => void
  onSent: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(opened.draft)
  const [status, setStatus] = useState<Status>('editing')
  const correction = opened.kind === 'correction'
  const title = correction ? 'Suggest a correction' : 'Give feedback'
  // A correction names its listing. From a card it's known; from a button,
  // the visitor types it, and picks the page too when this one isn't a
  // resource page.
  const askListing = correction && !opened.listing
  const askResource = askListing && !opened.resource
  // "Which listing?" suggests the site's listings as the name is typed, on
  // the page chosen when there is one, and Send takes only one of them.
  const [index, setIndex] = useState<SearchEntry[] | null>(null)
  const [listingError, setListingError] = useState('')
  useEffect(() => {
    if (!askListing) return
    let live = true
    void loadListingIndex().then(loaded => {
      if (live) setIndex(loaded)
    })
    return () => {
      live = false
    }
  }, [askListing])
  const resource = opened.resource ?? (draft.resource || undefined)
  const listings = useMemo(
    () => (index ? pickableListings(index, resource) : []),
    [index, resource]
  )
  // Without a page chosen, each suggestion says which page it's on.
  const suggestions = useMemo(
    () =>
      listings.map(l => ({
        value: l.title,
        detail: resource ? undefined : l.resource,
      })),
    [listings, resource]
  )

  function set(field: keyof Draft) {
    return (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) => {
      const next = { ...draft, [field]: e.target.value }
      setDraft(next)
      onDraft(next)
    }
  }

  function setListingName(name: string) {
    const next = { ...draft, listingName: name }
    // A listing picked before its page: the page follows from it.
    const match = askResource && !draft.resource && findListing(listings, name)
    if (match && match !== 'ambiguous') next.resource = match.resource
    setDraft(next)
    onDraft(next)
    setListingError('')
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'sending') return
    const picked =
      askListing && index ? findListing(listings, draft.listingName) : undefined
    if (askListing && index && (!picked || picked === 'ambiguous')) {
      setListingError(
        picked === 'ambiguous'
          ? 'Listings on more than one page have this name. Choose the page above.'
          : 'Choose a listing from the list that shows as you type its name.'
      )
      return
    }
    const listing = picked && picked !== 'ambiguous' ? picked : undefined
    setStatus('sending')
    const track = (stage: 'sent' | 'error') =>
      trackFeedbackForm(stage, opened.kind, opened.entry, opened.listing?.id)
    try {
      const res = await fetch('/api/site-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: opened.kind,
          text: draft.text,
          email: draft.email,
          quote: opened.quote,
          path: opened.path,
          view: opened.view,
          listingName:
            opened.listing?.name ?? listing?.title ?? draft.listingName,
          listingId: opened.listing?.id ?? listing?.id,
          resource: opened.resource ?? (draft.resource || listing?.resource),
          website: draft.website,
        }),
      })
      if (res.ok) {
        setStatus('sent')
        onSent()
        track('sent')
      } else {
        setStatus(res.status === 429 ? 'limited' : 'error')
        track('error')
      }
    } catch {
      setStatus('error')
      track('error')
    }
  }

  const header = (
    <div className="flex items-center justify-between gap-16px">
      <h2 className="paragraph-small-bold">{title}</h2>
      {/* An X plainly means close, so no tooltip (Melissa, 23 November
          2026). */}
      <Button
        variant="clear"
        size="xs"
        icon="/images/icons/x.svg"
        iconPosition="only"
        aria-label="Close"
        tooltip={false}
        onClick={onClose}
      />
    </div>
  )

  if (status === 'sent') {
    return (
      <div className={`flex flex-col gap-8px ${styles.body}`} role="status">
        {header}
        <p className="paragraph-small">Thanks, it&apos;s been sent.</p>
        <p className="paragraph-small color-teal-grey-300">
          The team reads every message.
        </p>
      </div>
    )
  }

  const airtableLink = (
    <a
      href={opened.fallbackHref}
      target="_blank"
      rel="noopener noreferrer"
      className="link"
    >
      the form on Airtable
    </a>
  )

  return (
    <div className={styles.body}>
      <form className="flex flex-col gap-16px" onSubmit={send}>
        {header}

        {opened.quote && (
          <figure className={`padding-left-12px ${styles.quote}`}>
            <blockquote>
              <p className="paragraph-xs color-teal-grey-300">
                &ldquo;{opened.quote}&rdquo;
              </p>
            </blockquote>
            {opened.listing && (
              <figcaption className="paragraph-xs">
                {opened.listing.name}
              </figcaption>
            )}
          </figure>
        )}

        {askResource && (
          <TextField
            as="select"
            label="Which page is it on?"
            options={RESOURCE_CHOICES}
            placeholder="Choose a page"
            value={draft.resource}
            onChange={set('resource')}
            required
            data-autofocus
          />
        )}

        {askListing && (
          <TextField
            label="Which listing?"
            placeholder="Start typing its name"
            suggestions={suggestions}
            onSuggestion={setListingName}
            noSuggestions={
              index
                ? resource
                  ? `No listing on ${resource} matches.`
                  : 'No listing on the site matches.'
                : undefined
            }
            value={draft.listingName}
            onChange={e => setListingName(e.target.value)}
            error={listingError || undefined}
            maxLength={200}
            required
            data-autofocus={!askResource || undefined}
          />
        )}

        <TextField
          as="textarea"
          label={correction ? "What's wrong?" : 'Your feedback'}
          value={draft.text}
          onChange={set('text')}
          maxLength={5000}
          required
          data-autofocus={!askListing || undefined}
        />

        <TextField
          type="email"
          label="Your email"
          optional="(optional, for a reply)"
          autoComplete="email"
          value={draft.email}
          onChange={set('email')}
          maxLength={320}
        />

        <div className="visually-hidden" aria-hidden="true">
          <label htmlFor="feedback-website">Website</label>
          <input
            id="feedback-website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={draft.website}
            onChange={set('website')}
          />
        </div>

        <div className="flex flex-col gap-8px">
          <div>
            <Button type="submit" loading={status === 'sending'}>
              Send
            </Button>
          </div>
          {status === 'error' && (
            <p className="paragraph-xs color-red-300" role="alert">
              Something went wrong and it wasn&apos;t sent. Please try again, or
              use {airtableLink}.
            </p>
          )}
          {status === 'limited' && (
            <p className="paragraph-xs color-red-300" role="alert">
              Too many messages from your connection. Please try again in an
              hour, or use {airtableLink}.
            </p>
          )}
        </div>
      </form>
    </div>
  )
}
