import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import {
  copyLogos,
  LOGO_PREFIX,
  LOGO_THUMB_PX,
  logoPathname,
  logoThumbnail,
  logoUrlKind,
  MAX_LOGO_BYTES,
  mirrorLogoFields,
  type LogoStore,
} from './logo-mirror'

const SOURCE = 'https://80000hours.org/wp-content/uploads/2024/01/logo.png'

/** A see-through PNG, like many logos. */
function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 26, g: 127, b: 127, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer()
}

/** A fetch that answers each address from the table, or never answers until
 *  aborted (like 80k's server on 20 Oct 2026). */
function fakeFetch(answers: Record<string, () => Response>): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    const answer = answers[url]
    if (answer) return Promise.resolve(answer())
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })
  }) as typeof fetch
}

function fakeUpload() {
  const uploads = new Map<string, Buffer>()
  return {
    uploads,
    upload: async (pathname: string, body: Buffer) => {
      uploads.set(pathname, body)
      return `https://store.public.blob.vercel-storage.com/${pathname}`
    },
  }
}

describe('logoPathname', () => {
  it('is the same for the same address, and differs for another', () => {
    expect(logoPathname(SOURCE)).toBe(logoPathname(SOURCE))
    expect(logoPathname(SOURCE)).not.toBe(logoPathname(`${SOURCE}?v=2`))
  })

  it('sits under the size-versioned prefix as a .webp', () => {
    expect(logoPathname(SOURCE)).toMatch(
      new RegExp(`^${LOGO_PREFIX}[0-9a-f]{32}\\.webp$`)
    )
  })
})

describe('logoUrlKind', () => {
  it('copies web addresses on other sites', () => {
    expect(logoUrlKind(SOURCE)).toBe('copy')
    expect(logoUrlKind('http://example.org/a.jpg')).toBe('copy')
  })

  it('leaves Blob addresses alone', () => {
    expect(
      logoUrlKind('https://abc.public.blob.vercel-storage.com/logos/x.webp')
    ).toBe('blob')
  })

  it('flags text that is not a web address', () => {
    expect(logoUrlKind('logo.png')).toBe('invalid')
    expect(logoUrlKind('data:image/png;base64,AAAA')).toBe('invalid')
  })
})

describe('logoThumbnail', () => {
  it('shrinks a large logo to fit the thumbnail size, as WebP, keeping transparency', async () => {
    const source = await png(1322, 1190)
    const meta = await sharp(
      await logoThumbnail(source.buffer as ArrayBuffer)
    ).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(LOGO_THUMB_PX)
    expect(meta.height).toBe(Math.round((LOGO_THUMB_PX * 1190) / 1322))
    expect(meta.hasAlpha).toBe(true)
  })

  it('never enlarges a small logo', async () => {
    const source = await png(200, 200)
    const meta = await sharp(
      await logoThumbnail(source.buffer as ArrayBuffer)
    ).metadata()
    expect(meta.width).toBe(200)
  })

  it('throws on bytes that are not an image', async () => {
    const html = new TextEncoder().encode('<html>522</html>')
    await expect(logoThumbnail(html.buffer as ArrayBuffer)).rejects.toThrow()
  })
})

describe('copyLogos', () => {
  it('uploads a thumbnail for each distinct logo', async () => {
    const body = await png(600, 600)
    const { uploads, upload } = fakeUpload()
    const result = await copyLogos([SOURCE, SOURCE], {
      upload,
      budgetMs: 5_000,
      concurrency: 4,
      fetchImpl: fakeFetch({
        [SOURCE]: () => new Response(new Uint8Array(body)),
      }),
    })
    expect(result.failed).toEqual([])
    expect(result.skipped).toEqual([])
    expect([...result.copied.keys()]).toEqual([SOURCE])
    expect(result.copied.get(SOURCE)).toContain(logoPathname(SOURCE))
    expect(uploads.size).toBe(1)
    const meta = await sharp(uploads.get(logoPathname(SOURCE))).metadata()
    expect(meta.width).toBe(LOGO_THUMB_PX)
  })

  it('reports error answers and non-images as failed, uploading nothing', async () => {
    const down = 'https://80000hours.org/down.png'
    const page = 'https://80000hours.org/page.png'
    const { uploads, upload } = fakeUpload()
    const result = await copyLogos([down, page], {
      upload,
      budgetMs: 5_000,
      concurrency: 2,
      fetchImpl: fakeFetch({
        [down]: () => new Response('', { status: 522 }),
        [page]: () => new Response('<html>Not found</html>'),
      }),
    })
    expect(result.copied.size).toBe(0)
    expect(result.failed.map(f => f.url).sort()).toEqual([down, page])
    expect(result.failed.find(f => f.url === down)?.reason).toBe('HTTP 522')
    expect(uploads.size).toBe(0)
  })

  it('refuses a source over the size limit without reading it', async () => {
    const { upload } = fakeUpload()
    const result = await copyLogos([SOURCE], {
      upload,
      budgetMs: 5_000,
      concurrency: 1,
      fetchImpl: fakeFetch({
        [SOURCE]: () =>
          new Response('x', {
            headers: { 'content-length': String(MAX_LOGO_BYTES + 1) },
          }),
      }),
    })
    expect(result.failed[0].reason).toMatch(/over the .* limit/)
  })

  it('gives up on a source that never answers when the budget runs out', async () => {
    const hung = 'https://80000hours.org/hung.png'
    const later = 'https://80000hours.org/later.png'
    const { upload } = fakeUpload()
    const started = Date.now()
    const result = await copyLogos([hung, later], {
      upload,
      budgetMs: 300,
      concurrency: 1,
      fetchImpl: fakeFetch({}),
    })
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(result.failed).toEqual([
      { url: hung, reason: 'no answer within the 0.3 s time limit' },
    ])
    expect(result.skipped).toEqual([later])
  })

  it('reports an upload failure as failed', async () => {
    const body = await png(100, 100)
    const result = await copyLogos([SOURCE], {
      upload: async () => {
        throw new Error('Blob is down')
      },
      budgetMs: 5_000,
      concurrency: 1,
      fetchImpl: fakeFetch({
        [SOURCE]: () => new Response(new Uint8Array(body)),
      }),
    })
    expect(result.failed).toEqual([{ url: SOURCE, reason: 'Blob is down' }])
  })
})

describe('mirrorLogoFields', () => {
  const LOGO = 'fldLogo'
  const OTHER = 'https://80000hours.org/wp-content/uploads/2024/01/other.png'
  const BLOB = 'https://store.public.blob.vercel-storage.com'

  afterEach(() => vi.restoreAllMocks())

  function jobs(...logos: unknown[]) {
    return logos.map((logo, i) => ({ id: `rec${i}`, fields: { [LOGO]: logo } }))
  }

  function memoryStore(existing: Map<string, string> = new Map()) {
    const store: LogoStore & { puts: string[] } = {
      puts: [],
      list: async () => existing,
      put: async pathname => {
        store.puts.push(pathname)
        return `${BLOB}/${pathname}`
      },
    }
    return store
  }

  it('serves logos copied before without fetching them again', async () => {
    const records = jobs(SOURCE, SOURCE)
    const store = memoryStore(
      new Map([[logoPathname(SOURCE), `${BLOB}/copied.webp`]])
    )
    const fetchImpl = vi.fn()
    await mirrorLogoFields(records, [LOGO], {
      store,
      budgetMs: 5_000,
      concurrency: 4,
      fetchImpl,
    })
    expect(records.map(r => r.fields[LOGO])).toEqual([
      `${BLOB}/copied.webp`,
      `${BLOB}/copied.webp`,
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.puts).toEqual([])
  })

  it('copies a new logo once, serves it, and remembers it', async () => {
    const body = new Uint8Array(await png(300, 300))
    const records = jobs(SOURCE, SOURCE)
    const existing = new Map<string, string>()
    const store = memoryStore(existing)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await mirrorLogoFields(records, [LOGO], {
      store,
      budgetMs: 5_000,
      concurrency: 4,
      fetchImpl: fakeFetch({ [SOURCE]: () => new Response(body) }),
    })
    const copy = `${BLOB}/${logoPathname(SOURCE)}`
    expect(records.map(r => r.fields[LOGO])).toEqual([copy, copy])
    expect(store.puts).toEqual([logoPathname(SOURCE)])
    expect(existing.get(logoPathname(SOURCE))).toBe(copy)
  })

  it('keeps the source address of a logo it cannot copy, and says so', async () => {
    const body = new Uint8Array(await png(300, 300))
    const records = jobs(SOURCE, OTHER)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await mirrorLogoFields(records, [LOGO], {
      store: memoryStore(),
      budgetMs: 5_000,
      concurrency: 4,
      fetchImpl: fakeFetch({
        [SOURCE]: () => new Response(body),
        [OTHER]: () => new Response('', { status: 522 }),
      }),
    })
    expect(records[0].fields[LOGO]).toBe(`${BLOB}/${logoPathname(SOURCE)}`)
    expect(records[1].fields[LOGO]).toBe(OTHER)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain(`${OTHER}: HTTP 522`)
  })

  it('keeps every source address, with a warning, without a store', async () => {
    const records = jobs(SOURCE)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mirrorLogoFields(records, [LOGO], {
      store: null,
      budgetMs: 5_000,
      concurrency: 4,
    })
    expect(records[0].fields[LOGO]).toBe(SOURCE)
    expect(warn.mock.calls[0][0]).toContain('BLOB_READ_WRITE_TOKEN not set')
  })

  it('keeps every source address, with a warning, when the listing fails', async () => {
    const records = jobs(SOURCE)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mirrorLogoFields(records, [LOGO], {
      store: {
        list: async () => {
          throw new Error('Blob is down')
        },
        put: async () => 'unused',
      },
      budgetMs: 5_000,
      concurrency: 4,
    })
    expect(records[0].fields[LOGO]).toBe(SOURCE)
    expect(warn.mock.calls[0][0]).toContain('Blob is down')
  })

  it('leaves attachments, Blob addresses and empty fields alone, and flags text that is not an address', async () => {
    const attachment = [
      { id: 'att1', url: 'https://x/y.png', filename: 'y.png' },
    ]
    const blob = `${BLOB}/logos/256/abc.webp`
    const records = jobs(attachment, blob, undefined, 'see website')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = memoryStore()
    const list = vi.spyOn(store, 'list')
    await mirrorLogoFields(records, [LOGO], {
      store,
      budgetMs: 5_000,
      concurrency: 4,
    })
    expect(records.map(r => r.fields[LOGO])).toEqual([
      attachment,
      blob,
      undefined,
      'see website',
    ])
    expect(list).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain('rec3: "see website"')
  })
})
