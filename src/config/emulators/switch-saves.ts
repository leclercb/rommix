import {
  DESCRIPTOR_EXTENSIONS,
  SWITCH_CONTAINERS,
  SWITCH2_CONTAINERS,
  TITLE_ID_DIGITS,
  TITLE_ID_KIND_DIGITS,
  titleIdSource
} from '../romfiles.ts'
import { nupTitleId } from './nup.ts'
import { directory, joinPath } from './savepaths.ts'
import type { SaveContext, SaveEnvironment, SavePaths } from './savepaths.ts'

/**
 * Finding one game's saves in a Yuzu-lineage emulator's NAND.
 *
 * Eden, Citron, Ryujinx, Suyu and Yuzu all keep the same tree, and so does
 * Eglantine for the Switch 2:
 *
 *     <nand>/user/save/0000000000000000/<32-hex profile>/<title id>/
 *
 * Nothing in that path is the ROM's name. Both unknowns are findable, though,
 * and neither needs the emulator running:
 *
 *  - the **title id** is declared by the game itself. Every NSP and XCI carries
 *    its content-metadata entry as a file named `<title id>.cnmt`, and the name
 *    appears in the archive's own header near the front of the file, so a short
 *    read is enough to find it without loading the ROM — see `HEADER_BYTES`.
 *    A Switch 2 `.nup` lists it in its table of contents instead — see
 *    `nupTitleId`.
 *  - the **profile** is a directory on disk. A Switch emulator normally has one
 *    user, so there is normally one candidate; where there are several, the one
 *    already holding a save for this title is the answer, and failing that the
 *    most recently written one.
 *
 * A title id that cannot be resolved returns no location at all rather than a
 * guess. Writing a pulled save under the wrong title id would put another
 * game's data where this game looks for its own.
 */

/** A user profile directory: a raw 128-bit id, no separators. */
const PROFILE_DIR = /^[0-9A-Fa-f]{32}$/
/** The fixed "system" save-data-space id every profile hangs under. */
const SAVE_DATA_SPACE = '0000000000000000'

/**
 * How much of the ROM to read looking for the metadata entry.
 *
 * The NSP/XCI header and its file table live at the front, so the entry name is
 * within the first few tens of kilobytes in practice. Enough to absorb where the
 * file table lands, and still a single short read.
 */
const HEADER_BYTES = 262144

/** How a title id is recognised on one system. */
interface TitleIdPatterns {
  /** The id anywhere in a name: a file name, or a playlist entry. */
  name: RegExp
  /** The id as the name of a content-metadata entry inside the ROM. */
  cnmt: RegExp
}

/**
 * The patterns for a system's title ids, or null on a system that has none.
 *
 * An id under another system's prefix is never matched — the save it named
 * would be another game's folder.
 */
function titleIdPatterns(system: string): TitleIdPatterns | null {
  const id = titleIdSource(system)
  if (!id) return null
  return { name: new RegExp(id, 'i'), cnmt: new RegExp(`(${id})\\.cnmt`, 'i') }
}

/**
 * Reduce a title id to the base game's.
 *
 * Updates and DLC are given ids derived from the game's: an update ends `800`
 * and DLC counts upwards from the base. Saves belong to the base game, so the
 * digits that say what kind of file it is are cleared — which is also what
 * makes an update file downloaded beside the game resolve to the same save
 * folder the game uses.
 */
function baseTitleId(raw: string): string {
  const upper = raw.toUpperCase()
  if (upper.length !== TITLE_ID_DIGITS) return upper
  const kept = TITLE_ID_DIGITS - TITLE_ID_KIND_DIGITS
  return `${upper.slice(0, kept)}${'0'.repeat(TITLE_ID_KIND_DIGITS)}`
}

/**
 * Is this a container, and so worth reading a header from?
 *
 * The alternative — reading every file and skipping the ones that look like
 * playlists — gets the test backwards: it has to be extended for every new kind
 * of pointer file, and until it is, that file is scanned as though it were a
 * ROM. The formats themselves are listed with the rest of what RomMix knows
 * about ROM files, since the launch rule needs the same list.
 */
function isRomContainer(path: string): boolean {
  return hasExtension(path, SWITCH_CONTAINERS)
}

/** Is this a Switch 2 container, whose id is read from its table of contents? */
function isNupContainer(path: string): boolean {
  return hasExtension(path, SWITCH2_CONTAINERS)
}

/**
 * Is this a file that lists ROMs, and so worth reading as text?
 *
 * Anything else that is not a container is a binary of several gigabytes, and
 * reading it as text would load the whole game to find nothing in it.
 */
function isPointerFile(path: string): boolean {
  return hasExtension(path, DESCRIPTOR_EXTENSIONS)
}

function hasExtension(path: string, extensions: readonly string[]): boolean {
  const lower = path.toLowerCase()
  return extensions.some((extension) => lower.endsWith(extension))
}

/**
 * The title id this ROM declares, or null.
 *
 * Three sources, in descending order of trust:
 *
 *  1. the ROM's own metadata entry, or a `.nup`'s package records, which is
 *     the game speaking for itself;
 *  2. the files a pointer file names, for a game RomM exposes as a playlist —
 *     the playlist declares nothing itself, but the ROMs it lists do;
 *  3. the file name, for the many dumps that carry the id in brackets.
 *
 * A `.nup` stops at the first: the folder Eglantine writes is named after the
 * package it boots, which only the container can say, so a `.nup` that cannot
 * be read has no title id rather than one guessed from its name.
 *
 * The `.cnmt` scan runs only on a real container, and the loose name pattern is
 * never run against the *contents* of one. A stretch of compressed data that
 * long contains any pattern of a title id's length you care to look for, so
 * inside a binary only the anchored form is trusted — that is the difference
 * between reading a title id and inventing one.
 *
 * Every source is read against the prefix `system` declares, and a system that
 * declares none has no title id to find.
 */
export function switchTitleId(
  env: SaveEnvironment,
  system: string,
  romPath: string,
  fallbackNames: readonly string[] = []
): string | null {
  const patterns = titleIdPatterns(system)
  if (!patterns) return null

  const declared = statedTitleId(env, system, patterns, romPath)
  if (declared || isNupContainer(romPath)) return declared

  for (const name of [romPath, ...fallbackNames]) {
    const match = name ? patterns.name.exec(name) : null
    if (match) return baseTitleId(match[0])
  }
  return null
}

/**
 * The id a container states, or the containers a playlist lists state.
 *
 * A `.nup`'s id is kept as it is rather than reduced to the base game's: it is
 * the id of the package Eglantine boots, and the folder it writes is named
 * after exactly that.
 */
function statedTitleId(
  env: SaveEnvironment,
  system: string,
  patterns: TitleIdPatterns,
  romPath: string
): string | null {
  if (isNupContainer(romPath)) return nupTitleId(env, system, romPath)
  if (isRomContainer(romPath)) return declaredTitleId(env, patterns, romPath)
  if (isPointerFile(romPath)) return referencedTitleId(env, patterns, romPath)
  return null
}

/** The id a container states in its own content-metadata entry. */
function declaredTitleId(
  env: SaveEnvironment,
  patterns: TitleIdPatterns,
  romPath: string
): string | null {
  const header = env.head(romPath, HEADER_BYTES)
  const match = header ? patterns.cnmt.exec(header) : null
  return match ? baseTitleId(match[1]) : null
}

/**
 * The id behind a file that points at ROMs rather than being one.
 *
 * RomM exposes a game shipped as several files — a base game and its update —
 * as an `.m3u` listing them. That playlist is not what RomMix launches: a
 * Switch emulator has no loader for one, so `chooseLaunchFile` picks the base
 * container instead. It can still be what an entry recorded before that rule
 * *points at*, and it is a perfectly good source of the id either way — each
 * line naming a container is asked in turn and the first that answers wins,
 * and since every entry belongs to one game, an update's id normalises to the
 * same base folder the game itself uses.
 */
function referencedTitleId(
  env: SaveEnvironment,
  patterns: TitleIdPatterns,
  pointerPath: string
): string | null {
  const text = env.text(pointerPath)
  if (!text) return null

  const dir = pointerPath.slice(0, pointerPath.lastIndexOf('/'))
  for (const line of text.split('\n')) {
    const entry = line.trim()
    if (!entry || entry.startsWith('#') || !isRomContainer(entry)) continue
    const path = entry.startsWith('/') ? entry : joinPath(dir, entry)

    const declared = declaredTitleId(env, patterns, path)
    if (declared) return declared
    // The entry names no readable container but may carry the id itself.
    const named = patterns.name.exec(entry)
    if (named) return baseTitleId(named[0])
  }
  return null
}

/**
 * The profile directory holding this title's saves.
 *
 * `<base>/0000000000000000/<profile>` is the standard shape; some installs keep
 * the profile folders directly under the save base, so that is tried second.
 * Among several profiles, one that already has this title beats the "most
 * recently written" heuristic outright — a user whose other profile happens to
 * have been played more recently would otherwise have this game's save resolved
 * against a profile that has never held it.
 */
export function switchProfileDir(
  env: SaveEnvironment,
  base: string,
  titleId: string | null
): string | null {
  for (const parent of [joinPath(base, SAVE_DATA_SPACE), base]) {
    const profiles = env.dirs(parent).filter((name) => PROFILE_DIR.test(name))
    if (profiles.length === 0) continue
    if (profiles.length === 1) return joinPath(parent, profiles[0])

    if (titleId) {
      const owning = profiles.filter((name) => env.exists(joinPath(parent, name, titleId)))
      if (owning.length === 1) return joinPath(parent, owning[0])
      if (owning.length > 1) {
        return joinPath(parent, newest(env, parent, owning))
      }
    }
    return joinPath(parent, newest(env, parent, profiles))
  }
  return null
}

function newest(env: SaveEnvironment, parent: string, names: readonly string[]): string {
  let best = names[0]
  let bestTime = -1
  for (const name of names) {
    const time = env.newest(joinPath(parent, name))
    if (time > bestTime) {
      bestTime = time
      best = name
    }
  }
  return best
}

/**
 * Save paths for one game under a Yuzu-lineage emulator.
 *
 * `base` is the emulator's `nand/user/save`. There are no save states: this
 * lineage keeps them inside the profile data rather than in a tree of its own,
 * so naming a states directory would only invent one.
 */
export function switchSavePaths(
  ctx: SaveContext,
  base: string | null,
  emulatorName: string
): SavePaths {
  if (!base) return { saves: null, states: null }

  const titleId = switchTitleId(ctx.env, ctx.system, ctx.romPath, [ctx.romStem])
  if (!titleId) {
    return {
      saves: null,
      states: null,
      unsyncableReason: { key: 'saves.switchNoTitleId', params: { emulator: emulatorName } }
    }
  }

  const profile = switchProfileDir(ctx.env, base, titleId)
  if (!profile) {
    return {
      saves: null,
      states: null,
      unsyncableReason: { key: 'saves.switchNoProfile', params: { emulator: emulatorName } }
    }
  }

  return { saves: directory(joinPath(profile, titleId)), states: null }
}
