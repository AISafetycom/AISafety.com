// Listing card logos load lazily, as each card nears the screen (see
// ListingCard), so a page counts as loaded without waiting for hundreds of
// logos and a slow logo host can't hold it up. On a slow connection, though,
// someone scrolling fast would see empty logo squares for a moment. So a
// second after the page has loaded, fetch every card logo on it in the
// background: by the time those cards scroll into view, their logos are
// already in the browser's cache.

/** Wait this long after the page's load event, so the warm-up never competes
 *  with the page itself or the logos already on screen. */
const DELAY_MS = 1000

const queued = new Set<string>()
const requested = new Set<string>()
// A fetching Image is held until it settles, then let go: the browser's cache
// keeps the file, and nothing keeps hundreds of decoded logos in memory.
const inFlight = new Set<HTMLImageElement>()
let scheduled = false

/** Visitors who have asked their browser to save data get only the logos
 *  they scroll to. */
function savesData(): boolean {
  const { connection } = navigator as Navigator & {
    connection?: { saveData?: boolean }
  }
  return connection?.saveData === true
}

function warmUp() {
  scheduled = false
  for (const src of queued) {
    requested.add(src)
    const img = new window.Image()
    // A logo that fails here fails in its card too, which hides it.
    img.onload = img.onerror = () => inFlight.delete(img)
    inFlight.add(img)
    img.src = src
  }
  queued.clear()
}

function schedule() {
  if (scheduled) return
  scheduled = true
  const start = () => setTimeout(warmUp, DELAY_MS)
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

/** Queue a card logo for the background warm-up. Call it from an effect: it
 *  touches the browser. Cards that mount later (a filter change, another
 *  page) are picked up by a fresh warm-up a second after they appear. */
export function warmUpLogo(src: string): void {
  if (queued.has(src) || requested.has(src) || savesData()) return
  queued.add(src)
  schedule()
}
