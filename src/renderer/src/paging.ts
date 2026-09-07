import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasMorePages, type RommRom, type RomQuery } from '@shared/types'

/**
 * A grid that fills as it is walked down: one page of covers at a time, the
 * next asked for as the end of what is drawn comes into view.
 *
 * Two screens are one of these — the whole library and a single collection —
 * and both page from a sentinel below the grid rather than from a "Load more"
 * button. That is what suits a controller: moving focus scrolls, so walking
 * towards the bottom row brings the sentinel into view and fetches, and there
 * is nothing to aim at and press. Home's shelves page the same way along a row
 * instead of down a grid — see `useShelf`.
 */

/** How many covers a page is. One number, so the two grids page alike. */
export const PAGE_SIZE = 60

/**
 * How far ahead of the sentinel a page is asked for.
 *
 * Generous on purpose: a page is more than a screenful of covers, so starting
 * the request before the end is reached usually means the next rows are there
 * by the time focus arrives, and the grid never visibly stalls.
 */
const LOOKAHEAD = '600px 0px'

export interface PagedRoms {
  /** Every page fetched so far, in the order they came. */
  roms: RommRom[]
  /** What the server counted, or null where it did not say. */
  total: number | null
  /** Whether the server has more to give: false means this is the whole of it. */
  more: boolean
  loading: boolean
  /** Goes on an element directly below the grid: crossing it fetches. */
  sentinel: React.RefObject<HTMLDivElement | null>
}

export function usePagedRoms(
  query: RomQuery,
  {
    enabled = true,
    onError
  }: {
    /**
     * Whether there is anything to fetch at all.
     *
     * False disowns whatever is still on the wire as well as refusing the next
     * request — see `run` — because a page that lands after the screen has
     * stopped listening arrives as an error over a screen that is working
     * perfectly well without it. The library's downloaded scope and a device
     * out of range are both this.
     */
    enabled?: boolean
    /**
     * Where a failed page is reported. Cleared on the way into every request,
     * so a grid that failed and then succeeded does not keep the old message.
     *
     * The screen's own, rather than state here, because the screens draw one
     * notice for everything that can go wrong on them. It has to be stable —
     * a `useState` setter is.
     */
    onError: (message: string | null) => void
  }
): PagedRoms {
  const [roms, setRoms] = useState<RommRom[]>([])
  const [total, setTotal] = useState<number | null>(0)
  /** Whether the last page came back full. See `hasMorePages`. */
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const sentinel = useRef<HTMLDivElement | null>(null)
  // Synchronous guard: `loading` lands a render too late to stop the observer
  // firing several times while one request is still in flight.
  const inFlight = useRef(false)
  /** Which fetch the grid is listening to. See `enabled`, and `useShelf`. */
  const run = useRef(0)

  /**
   * The same query, with an identity that only changes when the query does.
   *
   * Callers pass an object literal, which is a new reference every render —
   * compared by identity it would reset the grid to its first page on each
   * one. Serialised and rebuilt, so what the fetch closes over is what its
   * dependencies say it is.
   */
  const key = JSON.stringify(query)
  const asked = useMemo(() => JSON.parse(key) as RomQuery, [key])

  const load = useCallback(
    async (offset: number): Promise<void> => {
      // Nothing to ask for, and whatever is still out is disowned rather than
      // waited for — see `enabled`. The flag goes with it, so the next page
      // asked for once there is something to ask is not held off by a request
      // this grid has stopped listening to.
      if (!enabled) {
        run.current += 1
        inFlight.current = false
        return
      }
      // The next page, while the last one is still coming: the sentinel stays
      // in view and fires again, and one request per page is enough. A first
      // page is the opposite case — the query has changed under it, so it
      // takes over from whatever is out rather than being dropped, which used
      // to leave the grid showing an answer to a question nobody asked.
      if (inFlight.current && offset > 0) return
      inFlight.current = true
      const mine = ++run.current
      setLoading(true)
      onError(null)
      try {
        const page = await window.rommix.library.roms({ ...asked, limit: PAGE_SIZE, offset })
        if (mine !== run.current) return
        setTotal(page.total)
        setMore(hasMorePages(page))
        setRoms((current) => (offset === 0 ? page.items : [...current, ...page.items]))
      } catch (cause) {
        if (mine === run.current) onError((cause as Error).message)
      } finally {
        // Only where this is still the request the grid is listening to: one
        // that has been taken over lands afterwards, and clearing the flag on
        // its way out would let a second page start beside the first.
        if (mine === run.current) {
          inFlight.current = false
          setLoading(false)
        }
      }
    },
    [asked, enabled, onError]
  )

  // Back to the first page whenever the query changes.
  useEffect(() => {
    void load(0)
  }, [load])

  useEffect(() => {
    const element = sentinel.current
    if (!element) return
    // Nothing below an empty grid worth watching, and nothing to fetch once
    // the server has run out of pages.
    if (roms.length === 0 || !more) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load(roms.length)
      },
      { rootMargin: LOOKAHEAD }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [load, roms.length, more])

  return { roms, total, more, loading, sentinel }
}
