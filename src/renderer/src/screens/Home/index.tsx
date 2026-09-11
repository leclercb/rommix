import { type JSX, type Ref, useMemo, useState } from 'react'
import type { RommRom, RomQuery } from '@shared/types'
import {
  ArtBackdrop,
  CoverArt,
  FocusButton,
  GameRow,
  Hints,
  PlatformIcon,
  Spinner,
  romToOpen,
  tileFromInstalled,
  tileFromRom,
  type GameTile
} from '../../components'
import { Icon } from '../../icons'
import { useAction, useFocusable, useKeyLabel } from '../../input/focus'
import { useRomPages } from '../../paging'
import { useApp, useI18n } from '../../state'

/**
 * The landing screen: a hero for the highlighted game and a few shelves,
 * mirroring how RomM's own home page groups a library.
 */

const SHELF_PAGE = 20

interface Shelf {
  items: RommRom[]
  loaded: boolean
  error: string | null
  loadMore: () => void
  /** Ask for the first page again. See the notice `HomeScreen` draws. */
  retry: () => void
}

/**
 * One shelf: a query paged on its own, so walking one to its end fetches for
 * that shelf and leaves the others where they are.
 *
 * `useRomPages` does the paging — it is the same paging the library grid does,
 * and was written twice before it was one thing. What a shelf adds is where the
 * message goes and what being away from the server means to a row of the
 * server's own games.
 */
function useShelf(query: RomQuery, offline: boolean | null): Shelf {
  /**
   * The message this shelf is holding, if any.
   *
   * Kept here rather than in the core because Home draws one notice above all
   * three shelves and any of them can be the one that failed — see the notice
   * `HomeScreen` draws, and `useRomPages.onError`.
   */
  const [error, setError] = useState<string | null>(null)
  const { roms, settled, loadMore, reload } = useRomPages(query, {
    pageSize: SHELF_PAGE,
    // Null until the first connection answer: a shelf that asked then put a
    // fetch error over a screen that was about to narrow, and left it there
    // until the screen was navigated away from and back.
    enabled: offline === null ? null : !offline,
    // The games on a shelf are the server's, most of which are not on this
    // disk. See `useRomPages.forgetOnStandDown`.
    forgetOnStandDown: true,
    onError: setError
  })

  return { items: roms, loaded: settled, error, loadMore, retry: reload }
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
   *
   * Two of the three are grouped, as the library's grid is: a shelf holds a
   * dozen tiles and three of them being the same game in three regions is most
   * of a shelf spent saying one thing. See `RomQuery.group_by_meta_id`.
   *
   * Not this one. What it offers is the session to carry on with, and that
   * belongs to the dump that was played — the save is filed under that ROM, and
   * grouping would sooner or later hand somebody the copy the server picked
   * instead. Two versions of a game played here are two things to carry on
   * with, and this is the shelf that should say so.
   */
  const continuePlaying = useShelf(
    { last_played: true, order_by: 'last_played', order_dir: 'desc' },
    offline
  )
  const favourites = useShelf({ favorite: true, group_by_meta_id: true }, offline)
  const recentlyAdded = useShelf(
    { order_by: 'created_at', order_dir: 'desc', group_by_meta_id: true },
    offline
  )

  const error = continuePlaying.error ?? favourites.error ?? recentlyAdded.error
  const ready = continuePlaying.loaded && favourites.loaded && recentlyAdded.loaded

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
  // The copy on this disk where a grouped tile stands for several — see
  // `romToOpen`. The shelves built from the download index are one ROM each and
  // answer themselves.
  const open = (tile: GameTile): void =>
    navigate({ name: 'game', romId: romToOpen(tile, installedIds) })

  return (
    <div className="content">
      {offline ? <div className="notice notice--warn">{t('app.offlineNotice')}</div> : null}

      {/* Above the shelves rather than instead of them. One shelf's query
          failing used to replace the whole screen — including "Ready to play",
          which is built from the download index and is the one part that works
          with no server at all — and nothing came back for it: navigating to a
          section only replaces the history entry, so this screen never
          remounts and the fetch never runs again. Hence the button. */}
      {error ? (
        <div className="notice notice--error">
          <span>{error}</span>
          <FocusButton
            icon="refresh"
            onSelect={() => {
              continuePlaying.retry()
              favourites.retry()
              recentlyAdded.retry()
            }}
          >
            {t('action.tryAgain')}
          </FocusButton>
        </div>
      ) : null}

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
        tiles={continuePlaying.items.map((rom) => tileFromRom(rom))}
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
        tiles={favourites.items.map((rom) => tileFromRom(rom, true))}
        installedIds={installedIds}
        onSelect={open}
        onEndReached={favourites.loadMore}
      />
      <GameRow
        title={t('home.recentlyAdded')}
        shelf="recent"
        tiles={recentlyAdded.items.map((rom) => tileFromRom(rom, true))}
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
