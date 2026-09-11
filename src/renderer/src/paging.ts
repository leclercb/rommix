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

/** What the shared core answers with. See `useRomPages`. */
export interface RomPages {
  /** Every page fetched so far, in the order they came. */
  roms: RommRom[]
  /** What the server counted, or null where it did not say. */
  total: number | null
  /** Whether the server has more to give: false means this is the whole of it. */
  more: boolean
  /** A request is out right now. */
  loading: boolean
  /**
   * Whether this has finished having a go — answered, failed, or stood down.
   *
   * Not `!loading`: nothing has been attempted before the first fetch either,
   * and a shelf that drew itself as finished then would be an empty row where
   * a spinner belongs.
   */
  settled: boolean
  /** Ask for the page after what is held, if there is one. */
  loadMore: () => void
  /** Ask for the first page again, whatever is held. */
  reload: () => void
}

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

/**
 * One query, fetched a page at a time, with what that costs accounted for.
 *
 * The whole of the paging: which fetch is the live one, whether a request is
 * already out, what a page does to what is held, and what standing down means.
 * Both things in RomMix that page a query are this plus a way of asking for the
 * next page — a sentinel below a grid, or a row that reports reaching its end —
 * and they were written twice. They drifted both ways while they were: one
 * cleared its in-flight flag on behalf of a request it had stopped listening
 * to, and only one of them exempted a first page from the guard, which is what
 * left a shelf empty after a handheld came back into range.
 */
export function useRomPages(
  query: RomQuery,
  {
    pageSize,
    enabled = true,
    forgetOnStandDown = false,
    onError
  }: {
    /**
     * Whether there is anything to fetch — and `null` for not knowing yet.
     *
     * False disowns whatever is on the wire as well as refusing the next
     * request: a page that lands after the screen has stopped listening
     * arrives as an error over a screen working perfectly well without it. The
     * library's downloaded scope and a device out of range are both this.
     *
     * Null is the answer before the first connection check has come back. It
     * does nothing at all rather than standing down, because standing down is
     * a statement — it settles the caller — and nothing is known yet.
     */
    enabled?: boolean | null
    /**
     * Whether standing down throws away what is held.
     *
     * Home's shelves do: they are games on the server, most of which are not
     * on this disk, and a tile left on screen is one that opens a game page
     * with nothing behind it. The library grid does not, because its caller
     * swaps in the downloaded index instead and never draws the stale pages.
     */
    forgetOnStandDown?: boolean
    pageSize: number
    /**
     * Where a failed page is reported, and where it is cleared on the way into
     * every request — so a grid that failed and then succeeded does not keep
     * the old message. The screens draw one notice for everything that can go
     * wrong on them, so the message is theirs to hold. It has to be stable; a
     * `useState` setter is.
     */
    onError: (message: string | null) => void
  }
): RomPages {
  const [roms, setRoms] = useState<RommRom[]>([])
  const [total, setTotal] = useState<number | null>(0)
  /** Whether the last page came back full. See `hasMorePages`. */
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [settled, setSettled] = useState(false)
  // Synchronous guard: `loading` lands a render too late to stop the sentinel
  // firing again while one request is already out.
  const inFlight = useRef(false)
  /**
   * Which fetch this is listening to.
   *
   * A request already on the wire when the query changes, or when the server
   * goes away, lands *after* the screen has moved on — and its answer, or its
   * rejection, would be drawn over one that is already right. Bumping this
   * disowns whatever is still out.
   */
  const run = useRef(0)

  /**
   * The same query, with an identity that only changes when the query does.
   *
   * Callers pass an object literal, which is a new reference every render —
   * compared by identity it would reset to the first page on each one.
   * Serialised and rebuilt, so what the fetch closes over is what its
   * dependencies say it is.
   */
  const key = JSON.stringify(query)
  const asked = useMemo(() => JSON.parse(key) as RomQuery, [key])

  const load = useCallback(
    async (offset: number): Promise<void> => {
      // Nothing is known yet, so there is nothing to say. See `enabled`.
      if (enabled === null) return

      if (!enabled) {
        run.current += 1
        // The flag goes with the run it belonged to. Left set, the first page
        // asked for once there is something to ask would be refused on behalf
        // of a request nothing is listening to any more.
        inFlight.current = false
        if (forgetOnStandDown) {
          setRoms([])
          setMore(false)
          onError(null)
          setSettled(true)
        }
        return
      }

      // The next page, while the last one is still coming: the sentinel stays
      // in view and fires again, and one request per page is enough. A first
      // page is the opposite case — the query has changed under it, or the
      // server has come back — so it takes over from whatever is out rather
      // than being dropped.
      if (inFlight.current && offset > 0) return
      inFlight.current = true
      const mine = ++run.current
      setLoading(true)
      onError(null)
      try {
        const page = await window.rommix.library.roms({ ...asked, limit: pageSize, offset })
        if (mine !== run.current) return
        setTotal(page.total)
        setMore(hasMorePages(page))
        setRoms((current) => (offset === 0 ? page.items : [...current, ...page.items]))
      } catch (cause) {
        if (mine === run.current) onError((cause as Error).message)
      } finally {
        // Only where this is still the request being listened to: one that has
        // been taken over lands afterwards, and clearing the flag on its way
        // out would let a second page start beside the first.
        if (mine === run.current) {
          inFlight.current = false
          setLoading(false)
          setSettled(true)
        }
      }
    },
    [asked, enabled, forgetOnStandDown, onError, pageSize]
  )

  // Back to the first page whenever the query changes.
  useEffect(() => {
    void load(0)
  }, [load])

  const loadMore = useCallback(() => {
    if (roms.length > 0 && more) void load(roms.length)
  }, [load, more, roms.length])

  const reload = useCallback(() => void load(0), [load])

  return { roms, total, more, loading, settled, loadMore, reload }
}

/**
 * A grid that pages itself from a sentinel below it.
 *
 * `useRomPages` plus the thing that asks for the next page: an element under
 * the grid that fetches when it comes into view. That suits a controller —
 * moving focus scrolls, so walking towards the bottom row brings the sentinel
 * up and there is nothing to aim at and press.
 */
export function usePagedRoms(
  query: RomQuery,
  {
    enabled = true,
    onError
  }: {
    /** See `useRomPages`. */
    enabled?: boolean
    /** See `useRomPages`. */
    onError: (message: string | null) => void
  }
): PagedRoms {
  const sentinel = useRef<HTMLDivElement | null>(null)
  const { roms, total, more, loading, loadMore } = useRomPages(query, {
    pageSize: PAGE_SIZE,
    enabled,
    onError
  })

  useEffect(() => {
    const element = sentinel.current
    if (!element) return
    // Nothing below an empty grid worth watching, and nothing to fetch once
    // the server has run out of pages.
    if (roms.length === 0 || !more) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { rootMargin: LOOKAHEAD }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [loadMore, roms.length, more])

  return { roms, total, more, loading, sentinel }
}
