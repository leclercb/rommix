import { type JSX, type Ref, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RommRom, RomQuery } from '@shared/types'
import {
  CoverArt,
  GameRow,
  Hints,
  PlatformIcon,
  Spinner,
  tileFromInstalled,
  tileFromRom
} from '../components'
import { useAction, useFocusable, useKeyLabel } from '../input/focus'
import { useApp } from '../state'

/**
 * The landing screen: a hero for the highlighted game and a few shelves,
 * mirroring how RomM's own home page groups a library.
 */

const SHELF_PAGE = 20

interface Shelf {
  items: RommRom[]
  total: number
  loaded: boolean
  error: string | null
  loadMore: () => void
}

/**
 * One shelf: a query plus its own offset, so scrolling one to the end pages
 * that shelf alone and leaves the others where they are.
 *
 * The query is serialised to key the effect. Callers pass an object literal,
 * which is a new reference every render, and comparing it by identity would
 * refetch the shelf on each one.
 */
function useShelf(query: RomQuery): Shelf {
  const [items, setItems] = useState<RommRom[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Synchronous guard: `loaded` lands a render too late to stop the row's
  // observer firing again while a request is already out.
  const inFlight = useRef(false)

  const key = JSON.stringify(query)

  const fetchPage = useCallback(
    async (offset: number): Promise<void> => {
      if (inFlight.current) return
      inFlight.current = true
      try {
        const page = await window.rommix.library.roms({
          ...(JSON.parse(key) as RomQuery),
          limit: SHELF_PAGE,
          offset
        })
        setTotal(page.total)
        setItems((current) => (offset === 0 ? page.items : [...current, ...page.items]))
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        inFlight.current = false
        setLoaded(true)
      }
    },
    [key]
  )

  useEffect(() => {
    void fetchPage(0)
  }, [fetchPage])

  const loadMore = useCallback(() => {
    if (items.length > 0 && items.length < total) void fetchPage(items.length)
  }, [fetchPage, items.length, total])

  return { items, total, loaded, error, loadMore }
}

/** How many of the games on disk the shelf shows before Downloads takes over. */
const READY_TO_PLAY_SHELF = 30

export function HomeScreen(): JSX.Element {
  const { installed, installedIds, navigate, canGoBack } = useApp()

  /**
   * The games on this device, newest install first.
   *
   * Built from the download index rather than by filtering the shelves above:
   * those are three queries with their own paging, so a game on disk appeared
   * here only if it happened to be a favourite, recent or recently played —
   * which made the one shelf about *this machine* the least reliable on the
   * screen. Downloads has the complete list; this is the top of it.
   */
  const readyToPlay = useMemo(
    () =>
      [...installed]
        .sort((a, b) => b.installedAt.localeCompare(a.installedAt))
        .slice(0, READY_TO_PLAY_SHELF)
        .map(tileFromInstalled),
    [installed]
  )

  // Y is the search button everywhere it is offered, and the only search box is
  // the library's — so here it takes you there rather than doing nothing while
  // the hint bar claims otherwise.
  useAction('search', () => navigate({ name: 'library' }))

  const continuePlaying = useShelf({
    last_played: true,
    order_by: 'last_played',
    order_dir: 'desc'
  })
  const favourites = useShelf({ favorite: true })
  const recentlyAdded = useShelf({ order_by: 'created_at', order_dir: 'desc' })

  const error = continuePlaying.error ?? favourites.error ?? recentlyAdded.error
  const ready = continuePlaying.loaded && favourites.loaded && recentlyAdded.loaded

  if (error) {
    return (
      <div className="content">
        <h1 className="page-title">Home</h1>
        <div className="notice notice--error">{error}</div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="content">
        <Spinner />
      </div>
    )
  }

  // The hero is simply the head of the first shelf that has anything: the game
  // you last played, or failing that the newest in the library. Labelled,
  // because an unexplained game at the top of the screen invites the question.
  const highlight = continuePlaying.items[0] ?? recentlyAdded.items[0] ?? null
  const highlightReason = continuePlaying.items[0] ? 'Continue playing' : 'Recently added'
  const open = (tile: { romId: number }): void => navigate({ name: 'detail', romId: tile.romId })

  return (
    <div className="content">
      {highlight ? (
        <Hero
          rom={highlight}
          reason={highlightReason}
          onSelect={() => navigate({ name: 'detail', romId: highlight.id })}
        />
      ) : null}

      <GameRow
        title="Continue playing"
        tiles={continuePlaying.items.map(tileFromRom)}
        installedIds={installedIds}
        onSelect={open}
        onEndReached={continuePlaying.loadMore}
      />
      {/* No onEndReached: this shelf is the download index, which is already
          here in full, rather than a query that pages. */}
      <GameRow
        title="Ready to play"
        tiles={readyToPlay}
        installedIds={installedIds}
        onSelect={open}
      />
      <GameRow
        title="Favourites"
        tiles={favourites.items.map(tileFromRom)}
        installedIds={installedIds}
        onSelect={open}
        onEndReached={favourites.loadMore}
      />
      <GameRow
        title="Recently added"
        tiles={recentlyAdded.items.map(tileFromRom)}
        installedIds={installedIds}
        onSelect={open}
        onEndReached={recentlyAdded.loadMore}
      />

      {continuePlaying.items.length === 0 &&
      recentlyAdded.items.length === 0 &&
      favourites.items.length === 0 ? (
        <div className="empty">
          Your RomM library looks empty. Add some ROMs on the server and run a scan.
        </div>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: 'Open' },
          { key: 'Y', label: 'Search' },
          // Nothing behind this screen means B is the way up rather than back:
          // to the menu, and from there out of RomMix. See `App`.
          { key: 'B', label: canGoBack ? 'Back' : 'Menu' }
        ]}
      />
    </div>
  )
}

/** The featured game. Focusable: it is the first thing on the screen. */
function Hero({
  rom,
  reason,
  onSelect
}: {
  rom: RommRom
  reason: string
  onSelect: () => void
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect, autoFocus: true })
  const keyLabel = useKeyLabel()
  const title = rom.name ?? rom.fs_name
  const year = rom.metadatum.first_release_date
    ? new Date(rom.metadatum.first_release_date * 1000).getFullYear()
    : null

  return (
    <div ref={ref as Ref<HTMLDivElement>} className="hero" {...props}>
      <div className="hero__art">
        <CoverArt path={rom.path_cover_large ?? rom.path_cover_small} name={title} />
      </div>
      <div>
        <div className="hero__reason">{reason}</div>
        <h1 className="hero__title">{title}</h1>
        <div className="hero__meta">
          <span className="chip chip--icon">
            <PlatformIcon slug={rom.platform_slug} size={20} label={rom.platform_display_name} />
            {rom.platform_display_name}
          </span>
          {year ? <span className="chip">{year}</span> : null}
          {rom.metadatum.genres.slice(0, 3).map((genre) => (
            <span className="chip" key={genre}>
              {genre}
            </span>
          ))}
        </div>
        {rom.summary ? <p className="hero__summary">{rom.summary}</p> : null}
        <div className="hero__hint">Press {keyLabel('A')} to open</div>
      </div>
    </div>
  )
}
