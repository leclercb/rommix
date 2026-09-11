import type { InstalledRom, RommRom } from '@shared/types'
import { fileNameOf } from '@shared/gamefiles'

/**
 * What a cover tile is, and which game is behind it.
 *
 * Pure, and its own module for that reason — the same split `geometry.ts` and
 * `history.ts` are. Every grid and every shelf in RomMix goes through these,
 * and the rule that matters is one they have to agree on: the version a tile
 * says is downloaded must be the version pressing it opens. `games.tsx` draws
 * them; nothing there can be reached by `npm test`, because Node's type
 * stripping cannot read JSX.
 */

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
