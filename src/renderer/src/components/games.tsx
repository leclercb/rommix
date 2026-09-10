import { type JSX, useEffect, useRef, type Ref } from 'react'
import type { InstalledRom, RommRom } from '@shared/types'
import { FocusGroup, useFocusable } from '../input/focus'
import { useI18n } from '../state'
import { CoverArt, PlatformIcon } from './art'
import { fileNameOf } from '@shared/gamefiles'

/** A game as the library draws it: a cover, a title, a shelf of them. */

/**
 * What a cover tile needs to draw itself.
 *
 * A game can be shown from two directions — a record on the server, or a copy
 * on this disk — and only one of them has a RomM platform slug. Normalising
 * both to this is what lets a shelf be built from the download index without
 * fetching every game back from the server one at a time.
 */
export interface GameTile {
  romId: number
  title: string
  coverPath: string | null
  platformName: string
  /** RomM's platform slug when it is known; the ES-DE system otherwise. */
  platformSlug: string
  /** ES-DE system, which carries the curated fallback icon. */
  system?: string | null
  /**
   * Every ROM this tile stands for, the one it is named after first.
   *
   * Set only where the list was asked for grouped — see
   * `RomQuery.group_by_meta_id` — and left undefined everywhere else. A row
   * carries its siblings either way, so this is not a question the row can
   * answer: on an ungrouped shelf every version is a tile of its own, and one
   * of them claiming to stand for the pair would be two tiles claiming it.
   */
  group?: number[]
}

/**
 * Which of a tile's ROMs a press opens.
 *
 * The copy on this disk, where the group has one: that is the version that
 * plays without downloading anything and the one whose saves are on this
 * machine, so it is what somebody pressing the tile means. The ROM the server
 * grouped the rest under otherwise.
 */
export function romToOpen(tile: GameTile, installedIds: Set<number>): number {
  return tile.group?.find((romId) => installedIds.has(romId)) ?? tile.romId
}

/**
 * Is any version this tile stands for on this disk?
 *
 * Asked of the group rather than of the tile's own ROM, so the mark agrees with
 * what pressing it opens — a grid that grouped three dumps under the one the
 * server picked would otherwise call a game undownloaded while the European
 * copy of it is sitting on the drive.
 */
export function tileInstalled(tile: GameTile, installedIds: Set<number>): boolean {
  return (tile.group ?? [tile.romId]).some((romId) => installedIds.has(romId))
}

/**
 * `grouped` says the list this row came from was asked for one tile per game,
 * which is the only thing that makes its siblings the tile's to stand for. See
 * `GameTile.group`.
 */
export function tileFromRom(rom: RommRom, grouped = false): GameTile {
  // Through a set because whether RomM counts a row among its own siblings is
  // its business and not something to count twice — the number is drawn on the
  // tile.
  const group = grouped
    ? [...new Set([rom.id, ...rom.sibling_roms.map((sibling) => sibling.id)])]
    : []
  return {
    romId: rom.id,
    title: rom.name ?? rom.fs_name,
    coverPath: rom.path_cover_small ?? rom.path_cover_large,
    platformName: rom.platform_display_name,
    platformSlug: rom.platform_slug,
    group: group.length > 1 ? group : undefined
  }
}

export function tileFromInstalled(entry: InstalledRom): GameTile {
  return {
    romId: entry.romId,
    title: entry.name || fileNameOf(entry.path),
    coverPath: entry.coverPath,
    platformName: entry.platformName,
    // The index records the ES-DE system rather than RomM's slug, which the
    // icon lookup falls back to happily.
    platformSlug: entry.system,
    system: entry.system
  }
}

/** A cover-art tile in a row or grid. */
export function GameCard({
  tile,
  installed,
  onSelect,
  showPlatform = false
}: {
  tile: GameTile
  installed: boolean
  onSelect: () => void
  showPlatform?: boolean
}): JSX.Element {
  const { t } = useI18n()
  const { ref, props } = useFocusable({ onSelect, actionLabel: t('action.open') })

  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      className="card"
      // Which game this is, for `npm run test:app` — the title is the server's
      // and a test that matched on it would be asserting against somebody's
      // library rather than against RomMix. See `data-action` on FocusButton.
      data-rom={tile.romId}
      {...props}
    >
      <div style={{ position: 'relative' }}>
        <CoverArt path={tile.coverPath} name={tile.title} />
        {installed ? (
          <span className="card__installed" title={t('library.downloadedMark')} />
        ) : null}
        {/* Said on the tile rather than left to the game's page: a grouped grid
            is one cover where there were three, and without this the two that
            went are simply missing. */}
        {tile.group ? (
          <span className="card__versions">
            {t('library.versions', { count: tile.group.length })}
          </span>
        ) : null}
      </div>
      <div className="card__title">{tile.title}</div>
      {showPlatform ? (
        <div className="card__meta">
          <PlatformIcon
            slug={tile.platformSlug}
            system={tile.system}
            size={26}
            label={tile.platformName}
          />
          <span>{tile.platformName}</span>
        </div>
      ) : null}
    </button>
  )
}

/**
 * A horizontally scrolling shelf of games.
 *
 * `onEndReached` makes the shelf endless. The sentinel is observed against the
 * row itself rather than the viewport, because this scroller moves sideways
 * independently of the page — and the margin is horizontal so the next batch
 * is requested while the end of the shelf is still off to the right.
 *
 * A focus group, keyed by the shelf's own title: walking onto a shelf from the
 * hero arrives at its first card, or at the card last left on it, rather than
 * at whichever one happens to sit under the column the press came down. From
 * one shelf to the next the geometry decides, so Down lands on the tile drawn
 * below the highlight. See `FocusGroup`.
 */
export function GameRow({
  title,
  shelf,
  tiles,
  installedIds,
  onSelect,
  onEndReached
}: {
  title: string
  /** Which shelf this is, for `npm run test:app`. See CONTRIBUTING. */
  shelf?: string
  tiles: GameTile[]
  installedIds: Set<number>
  onSelect: (tile: GameTile) => void
  onEndReached?: () => void
}): JSX.Element | null {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const row = rowRef.current
    const sentinel = sentinelRef.current
    if (!onEndReached || !row || !sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onEndReached()
      },
      { root: row, rootMargin: '0px 600px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // `tiles.length` is not read in the effect and is here on purpose: the
    // sentinel does not move when a page is appended, so without re-observing,
    // an intersection that is still true after the shelf grows never fires
    // again and the row stops paging.
  }, [onEndReached, tiles.length])

  // After the hooks: bailing earlier would call a different number of them.
  if (tiles.length === 0) return null

  return (
    <section data-shelf={shelf}>
      <h2 className="section-title">{title}</h2>
      <FocusGroup id={`shelf:${title}`}>
        <div className="row" ref={rowRef}>
          {tiles.map((tile) => (
            <GameCard
              key={tile.romId}
              tile={tile}
              installed={tileInstalled(tile, installedIds)}
              onSelect={() => onSelect(tile)}
              showPlatform
            />
          ))}
          {onEndReached ? (
            <div className="row__sentinel" ref={sentinelRef} aria-hidden="true" />
          ) : null}
        </div>
      </FocusGroup>
    </section>
  )
}
