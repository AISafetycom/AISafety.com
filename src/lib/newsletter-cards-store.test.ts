import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ put: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: h.put }))

// A manifest the way render.py writes it: compact JSON, non-ASCII kept.
const MANIFEST = JSON.stringify({
  v: 1,
  groups: [{ id: 'g1', label: 'Online – this week', cards: [{ key: 'rec1' }] }],
  text: [{ t: 'Week 47 · “Alignment” café' }],
})
const B = createHash('sha256')
  .update(MANIFEST, 'utf8')
  .digest('hex')
  .slice(0, 16)
const ENCODED = Buffer.from(MANIFEST, 'utf8').toString('base64')
const INLINE = `<!--aisafety-issue:aaaaaaaaaaaaaaaa--><p>cards</p><!--aisafety-cards:${ENCODED}-->\n</body>`
const STORED = `<!--aisafety-issue:aaaaaaaaaaaaaaaa--><p>cards</p><!--aisafety-cards-ref:${B}-->\n</body>`
const URL_ = `https://vfnmdozpctvdobh7.public.blob.vercel-storage.com/newsletter/cards/${B}.json`

async function store() {
  vi.resetModules()
  return import('./newsletter-cards-store')
}

beforeEach(() => {
  h.put.mockReset()
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-token')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('cardsFile / withInlineCards', () => {
  it('names the file as the pipeline does (~/Newsletter tests/test_cards_store.py pins the same name)', () => {
    expect(B).toBe('b4762965c73fe2b3')
  })

  it('swaps the inline manifest for a reference named by its SHA-256', async () => {
    const { cardsFile } = await store()
    expect(cardsFile(INLINE)).toEqual({ b: B, body: MANIFEST, html: STORED })
  })

  it('puts it back byte for byte', async () => {
    const { withInlineCards } = await store()
    expect(withInlineCards(STORED, MANIFEST)).toBe(INLINE)
  })

  it('leaves an email without inline card data alone', async () => {
    const { cardsFile } = await store()
    expect(cardsFile(STORED)).toBeNull()
    expect(cardsFile('<p>no cards</p>')).toBeNull()
  })

  it('strips both forms for the web version', async () => {
    const { withoutCards } = await store()
    expect(withoutCards(INLINE)).toBe(withoutCards(STORED))
    expect(withoutCards(STORED)).not.toMatch(/aisafety-cards/)
  })
})

describe('storeCards', () => {
  it('stores the manifest under newsletter/cards/ and returns the email with the reference', async () => {
    h.put.mockResolvedValue({ url: URL_ })
    const { storeCards } = await store()
    expect(await storeCards(INLINE)).toBe(STORED)
    expect(h.put).toHaveBeenCalledWith(`newsletter/cards/${B}.json`, MANIFEST, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/json; charset=utf-8',
    })
  })

  it('takes "already exists" as stored: the name is the content', async () => {
    h.put.mockRejectedValue(new Error('Vercel Blob: This blob already exists'))
    const { storeCards } = await store()
    expect(await storeCards(INLINE)).toBe(STORED)
  })

  it('refuses when the file can’t be stored, so the email isn’t written', async () => {
    h.put.mockRejectedValue(new Error('network down'))
    const { storeCards, CardsStoreError } = await store()
    await expect(storeCards(INLINE)).rejects.toBeInstanceOf(CardsStoreError)
  })

  it('refuses without a Blob token', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const { storeCards } = await store()
    await expect(storeCards(INLINE)).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('refuses a file that landed somewhere else', async () => {
    h.put.mockResolvedValue({ url: 'https://elsewhere.example/x.json' })
    const { storeCards } = await store()
    await expect(storeCards(INLINE)).rejects.toThrow(/doesn’t read/)
  })

  it('passes an email that is already stored straight through', async () => {
    const { storeCards } = await store()
    expect(await storeCards(STORED)).toBe(STORED)
    expect(h.put).not.toHaveBeenCalled()
  })
})

describe('inlineCards', () => {
  it('reads the stored manifest back into the email', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(MANIFEST, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { inlineCards } = await store()
    expect(await inlineCards(STORED)).toBe(INLINE)
    expect(fetchMock.mock.calls[0][0]).toBe(URL_)
    // A file never changes: the second read is kept from the first.
    expect(await inlineCards(STORED)).toBe(INLINE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('needs no read for an email it just stored', async () => {
    h.put.mockResolvedValue({ url: URL_ })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { inlineCards, storeCards } = await store()
    expect(await inlineCards(await storeCards(INLINE))).toBe(INLINE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves an inline or card-less email alone', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { inlineCards } = await store()
    expect(await inlineCards(INLINE)).toBe(INLINE)
    expect(await inlineCards('<p>none</p>')).toBe('<p>none</p>')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says so when the file is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 404 }))
    )
    const { inlineCards } = await store()
    await expect(inlineCards(STORED)).rejects.toThrow(/isn’t there/)
  })

  it('refuses a file that doesn’t match its name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(`${MANIFEST} `, { status: 200 }))
    )
    const { inlineCards } = await store()
    await expect(inlineCards(STORED)).rejects.toThrow(/doesn’t match its name/)
  })

  it('says to try again when the store can’t be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    const { inlineCards } = await store()
    await expect(inlineCards(STORED)).rejects.toThrow(/try again in a minute/)
  })
})
