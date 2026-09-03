import { type JSX, type Ref, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasMorePages } from '@shared/types'
import type { RommRom, RomQuery } from '@shared/types'
import {
  ArtBackdrop,
  CoverArt,
  GameRow,
  Hints,
  PageTitle,
  PlatformIcon,
  Spinner,
  tileFromInstalled,
  tileFromRom
} from '../../components'
import { Icon } from '../../icons'
import { useAction, useFocusable, useKeyLabel } from '../../input/focus'
import { useApp, useI18n } from '../../state'

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
function useShelf(query: RomQuery, offline: boolean | null): Shelf {
  const [items, setItems] = useState<RommRom[]>([])
  const [total, setTotal] = useState<number | null>(0)
  /** Whether the last page came back full. See `hasMorePages`. */
  const [more, setMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Synchronous guard: `loaded` lands a render too late to stop the row's
  // observer firing again while a request is already out.
  const inFlight = useRef(false)
  /**
   * Which fetch the shelf is currently listening to.
   *
   * A request already on the wire when the server goes away lands *after* the
   * shelf has stood itself down, and its rejection would put the error back
   * over a screen that had just finished narrowing — which is a Home page
   * showing nothing but "fetch failed" until it is navigated away from and
   * back. Bumping this disowns whatever is still out.
   */
  const run = useRef(0)

  /**
   * The same query, with an identity that only changes when the query does.
   *
   * Rebuilt from the serialised form rather than kept from the argument, so
   * that this is what the fetch closes over and `key` is honestly the only
   * thing it depends on. Once per change of query, rather than once per page.
   */
  const key = JSON.stringify(query)
  const asked = useMemo(() => JSON.parse(key) as RomQuery, [key])

  const fetchPage = useCallback(
    async (offset: number): Promise<void> => {
      // Before the first connection answer there is nothing to do but wait:
      // asking then is what put a fetch error over a screen that was about to
      // narrow, and left it there until the screen was navigated away from and
      // back. The shelf stays unloaded, which is the spinner it already has.
      if (offline === null) return

      /**
       * Nothing to query while the server is away, and nothing left standing
       * from when it was there.
       *
       * The error goes because Home draws it in place of the whole screen, and
       * a request that failed on the way out of range would otherwise leave
       * that error over a screen with a perfectly good shelf on it. The items
       * go because they are games from the server, most of which are not on
       * this disk — a tile still on screen is one that opens a game page with
       * nothing behind it. Loaded, so the shelves that do have something draw
       * rather than waiting behind a spinner.
       */
      if (offline) {
        run.current += 1
        setItems([])
        setTotal(0)
        setError(null)
        setLoaded(true)
        return
      }
      if (inFlight.current) return
      inFlight.current = true
      const mine = ++run.current
      // Cleared on the way in, not only set on the way out: a shelf that failed
      // and then succeeded would otherwise keep the message from the attempt
      // before, and Home draws it instead of the screen.
      setError(null)
      try {
        const page = await window.rommix.library.roms({
          ...asked,
          limit: SHELF_PAGE,
          offset
        })
        if (mine !== run.current) return
        setTotal(page.total)
        setMore(hasMorePages(page))
        setItems((current) => (offset === 0 ? page.items : [...current, ...page.items]))
      } catch (cause) {
        if (mine === run.current) setError((cause as Error).message)
      } finally {
        inFlight.current = false
        if (mine === run.current) setLoaded(true)
      }
    },
    [asked, offline]
  )

  useEffect(() => {
    void fetchPage(0)
  }, [fetchPage])

  const loadMore = useCallback(() => {
    if (items.length > 0 && more) void fetchPage(items.length)
  }, [fetchPage, items.length, more])

  return { items, total: total ?? items.length, loaded, error, loadMore }
}

/** How many of the games on disk the shelf shows before Downloads takes over. */
const READY_TO_PLAY_SHELF = 30

export function HomeScreen(): JSX.Element {
  const { t } = useI18n()
  const { installed, installedIds, navigate, canGoBack, offline } = useApp()

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

  /**
   * Three of the four shelves are queries, and one is the download index.
   *
   * Which is the whole of what happens to this screen away from the server: the
   * queries stand down and the shelf that was always about this machine is what
   * is left, with a line above it saying why. The alternative — a screen of its
   * own for the same games — was a different application appearing whenever the
   * network dropped.
   */
  const continuePlaying = useShelf(
    { last_played: true, order_by: 'last_played', order_dir: 'desc' },
    offline
  )
  const favourites = useShelf({ favorite: true }, offline)
  const recentlyAdded = useShelf({ order_by: 'created_at', order_dir: 'desc' }, offline)

  const error = continuePlaying.error ?? favourites.error ?? recentlyAdded.error
  const ready = continuePlaying.loaded && favourites.loaded && recentlyAdded.loaded

  if (error) {
    return (
      <div className="content">
        <PageTitle icon="home">{t('home.title')}</PageTitle>
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
  const highlightReason = continuePlaying.items[0]
    ? t('home.continuePlaying')
    : t('home.recentlyAdded')
  const open = (tile: { romId: number }): void => navigate({ name: 'game', romId: tile.romId })

  return (
    <div className="content">
      {offline ? <div className="notice notice--warn">{t('app.offlineNotice')}</div> : null}

      {highlight ? (
        <Hero
          rom={highlight}
          reason={highlightReason}
          onSelect={() => navigate({ name: 'game', romId: highlight.id })}
        />
      ) : null}

      <GameRow
        title={t('home.continuePlaying')}
        shelf="continue"
        tiles={continuePlaying.items.map(tileFromRom)}
        installedIds={installedIds}
        onSelect={open}
        onEndReached={continuePlaying.loadMore}
      />
      {/* No onEndReached: this shelf is the download index, which is already
          here in full, rather than a query that pages. */}
      <GameRow
        title={t('home.readyToPlay')}
        shelf="ready"
        tiles={readyToPlay}
        installedIds={installedIds}
        onSelect={open}
      />
      <GameRow
        title={t('home.favourites')}
        shelf="favourites"
        tiles={favourites.items.map(tileFromRom)}
        installedIds={installedIds}
        onSelect={open}
        onEndReached={favourites.loadMore}
      />
      <GameRow
        title={t('home.recentlyAdded')}
        shelf="recent"
        tiles={recentlyAdded.items.map(tileFromRom)}
        installedIds={installedIds}
        onSelect={open}
        onEndReached={recentlyAdded.loadMore}
      />

      {continuePlaying.items.length === 0 &&
      recentlyAdded.items.length === 0 &&
      favourites.items.length === 0 &&
      readyToPlay.length === 0 ? (
        <div className="empty">{offline ? t('home.emptyOffline') : t('home.empty')}</div>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: t('action.open') },
          { key: 'Y', label: t('action.search') },
          // Nothing behind this screen means B is the way up rather than back:
          // to the menu, and from there out of RomMix. See `App`.
          { key: 'B', label: canGoBack ? t('action.back') : t('action.menu') }
        ]}
      />
    </div>
  )
}

/**
 * The featured game. Focusable: it is the first thing on the screen.
 *
 * Drawn over its own artwork, the same wash the game screen uses, so the first
 * thing RomMix shows is coloured by the game it is offering rather than by the
 * page it is drawn on.
 */
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
  const { t } = useI18n()
  const keyLabel = useKeyLabel()
  const title = rom.name ?? rom.fs_name
  const year = rom.metadatum.first_release_date
    ? new Date(rom.metadatum.first_release_date).getFullYear()
    : null

  return (
    <div ref={ref as Ref<HTMLDivElement>} className="hero" {...props}>
      <ArtBackdrop
        paths={[rom.merged_screenshots?.[0], rom.path_cover_large, rom.path_cover_small]}
      />
      <div className="hero__art">
        <CoverArt path={rom.path_cover_large ?? rom.path_cover_small} name={title} />
      </div>
      <div className="hero__text">
        <div className="hero__reason">{reason}</div>
        <h1 className="hero__title">{title}</h1>
        <div className="hero__meta">
          <span className="chip chip--icon">
            <PlatformIcon slug={rom.platform_slug} size={20} label={rom.platform_display_name} />
            {rom.platform_display_name}
          </span>
          {/* Marked like the same chip on the game's own banner, genres
              included in staying unmarked. See `GameHero`. */}
          {year ? (
            <span className="chip chip--icon">
              <Icon name="time" size={14} />
              {year}
            </span>
          ) : null}
          {rom.metadatum.genres.slice(0, 3).map((genre) => (
            <span className="chip" key={genre}>
              {genre}
            </span>
          ))}
        </div>
        {rom.summary ? <p className="hero__summary">{rom.summary}</p> : null}
        <div className="hero__hint">{t('home.pressToOpen', { key: keyLabel('A') })}</div>
      </div>
    </div>
  )
}
