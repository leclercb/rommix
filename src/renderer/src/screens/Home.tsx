import { type JSX, type Ref, useCallback, useEffect, useRef, useState } from 'react'
import type { RommRom, RomQuery } from '@shared/types'
import { CoverArt, GameRow, Hints, PlatformIcon, Spinner } from '../components'
import { useAction, useFocusable } from '../input/focus'
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

export function HomeScreen(): JSX.Element {
  const { installedIds, navigate } = useApp()

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

  // Games already on disk, resolved from whatever the shelves have loaded so
  // far — so this shelf grows as the others are scrolled.
  const onDisk = [...continuePlaying.items, ...favourites.items, ...recentlyAdded.items]
    .filter((rom, index, all) => all.findIndex((r) => r.id === rom.id) === index)
    .filter((rom) => installedIds.has(rom.id))

  // The hero is simply the head of the first shelf that has anything: the game
  // you last played, or failing that the newest in the library. Labelled,
  // because an unexplained game at the top of the screen invites the question.
  const highlight = continuePlaying.items[0] ?? recentlyAdded.items[0] ?? null
  const highlightReason = continuePlaying.items[0] ? 'Continue playing' : 'Recently added'
  const open = (rom: RommRom): void => navigate({ name: 'detail', romId: rom.id })

  return (
    <div className="content">
      {highlight ? <Hero rom={highlight} reason={highlightReason} onSelect={() => open(highlight)} /> : null}

      <GameRow
        title="Continue playing"
        roms={continuePlaying.items}
        installedIds={installedIds}
        onSelect={open}
        onEndReached={continuePlaying.loadMore}
      />
      {/* No onEndReached: this shelf is a filter over the others, not a query. */}
      <GameRow title="Ready to play" roms={onDisk} installedIds={installedIds} onSelect={open} />
      <GameRow
        title="Favourites"
        roms={favourites.items}
        installedIds={installedIds}
        onSelect={open}
        onEndReached={favourites.loadMore}
      />
      <GameRow
        title="Recently added"
        roms={recentlyAdded.items}
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
          { key: 'B', label: 'Back' }
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
        <div className="hero__hint">Press A to open</div>
      </div>
    </div>
  )
}
