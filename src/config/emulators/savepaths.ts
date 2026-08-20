/**
 * Where an emulator keeps the save data for one game.
 *
 * This replaces the two enums a descriptor used to carry (`saveLayout` and
 * `saveTree`). They were declared on the *frontend* — RetroDECK, EmuDeck — but
 * a frontend does not write saves; the emulator it dispatched to does, and each
 * of those has its own arrangement. One pair of enums per frontend cannot
 * describe a tree that holds `saves/ps2/pcsx2/memcards` beside `states/dolphin`
 * beside `saves/PSP/PPSSPP-SA`, and getting it wrong is not a failed search: a
 * pull writes a save into a folder the emulator never reads, and the game
 * starts with the save it had before.
 *
 * So a descriptor answers a question instead of declaring a shape. It is given
 * the roots that were discovered, the game that is about to run and a small
 * read-only view of the disk, and it returns the directories involved. Nothing
 * here imports `node:` anything — the registry is loaded by the renderer too —
 * which is also what keeps these functions unit-testable against a fake
 * environment rather than a real emulator install.
 */

/**
 * How a file or directory under a save location is recognised as this game's.
 *
 *  - `rom-stem`   named after the ROM, which is what libretro and most
 *                 standalone emulators do. Matched on the file stem.
 *  - `directory`  the location *is* this game's data — a folder keyed by title
 *                 id or game id, as Eden, PPSSPP and RPCS3 keep it. Synced as
 *                 one archive, because the individual files inside carry no
 *                 name that ties them to a ROM.
 *  - `shared`     one memory card, NAND or nvram shared by every game. There is
 *                 nothing here that can honestly be attributed to this ROM, so
 *                 it is skipped rather than uploaded under this game's id.
 */
export type SaveMatch = 'rom-stem' | 'directory' | 'shared'

/** One directory an emulator reads and writes save data in. */
export interface SaveLocation {
  /**
   * Where a pulled asset is written, and the first place a push looks.
   *
   * Exactly one directory, never a guess between several: this is the path the
   * emulator itself will open.
   */
  dir: string
  /**
   * Extra directories a push may also look in. Never written to.
   *
   * For the cases where the emulator's own naming is not fully knowable from
   * outside — RetroArch sorting saves into a folder named after the core, whose
   * display name is the core's to choose — so a save that is really there is
   * still found even when the canonical guess was wrong.
   */
  search?: readonly string[]
  match: SaveMatch
  /**
   * Sync `dir` as a single archive rather than file by file. Set with
   * `match: 'directory'`, where the folder is the unit of save data.
   */
  archive?: boolean
}

/** Everything a descriptor can say about one game's save data. */
export interface SavePaths {
  saves: SaveLocation | null
  states: SaveLocation | null
  /**
   * The program that actually writes these files, when it is not the one whose
   * descriptor answered.
   *
   * RomM records an emulator against every save so a client can tell whether it
   * could load one, and for a frontend the useful answer is the emulator it
   * dispatched to — a save written by RetroDECK's PCSX2 is a PCSX2 save, and
   * saying "retrodeck" would make it unreadable to anyone not using RetroDECK.
   * Absent for a standalone emulator, where the descriptor id is already right.
   */
  emulator?: string
  /**
   * Why nothing can be synced, phrased for the button that just failed.
   *
   * Set when the emulator genuinely has no per-game save — not when a directory
   * merely happens to be missing, which is the ordinary state of a game that
   * has not been played yet.
   */
  unsyncableReason?: string
}

/**
 * A read-only view of the machine, handed to a descriptor.
 *
 * Descriptors are otherwise pure, and most of them stay that way. The ones that
 * need this need it for facts that are only on disk and cannot be templated:
 * which libretro core RetroArch last loaded, which Switch profile holds a save,
 * what title id a `.nsp` declares. Passing an interface rather than reaching
 * for `node:fs` keeps the registry loadable in the renderer and lets the tests
 * describe a whole emulator install as a literal.
 *
 * Every method answers with an empty or null value rather than throwing: a
 * descriptor asking about a directory that is not there is the normal case.
 */
export interface SaveEnvironment {
  exists(path: string): boolean
  /** Subdirectory names directly under `path`. */
  dirs(path: string): readonly string[]
  /** File names directly under `path`. */
  files(path: string): readonly string[]
  /** Whole contents of a text file. */
  text(path: string): string | null
  /**
   * The first `bytes` of a file, decoded as latin1 so byte offsets survive.
   * For reading a ROM header without loading the ROM.
   */
  head(path: string, bytes: number): string | null
  /** Newest modification time (ms) of any file under `path`; 0 when there is none. */
  newest(path: string): number
}

/** Everything a descriptor is told about the game whose saves are wanted. */
export interface SaveContext {
  /** The roots the probe discovered for this emulator. */
  paths: {
    home: string | null
    roms: string | null
    saves: string | null
    states: string | null
    bios: string | null
  }
  /** ES-DE system directory name, e.g. 'snes'. */
  system: string
  /** The file handed to the emulator — not the game directory. */
  romPath: string
  /**
   * The directory `romPath` sits in. RetroArch's "sort saves by content
   * directory" names its subfolder after this, so it is a path component
   * rather than merely context.
   */
  romDir: string
  /** `romPath`'s base name with the extension dropped. */
  romStem: string
  /**
   * The user's real home directory.
   *
   * Not derivable from `paths`: for a flatpak those all point inside
   * `~/.var/app/<id>/`, while an emulator's config may still be named relative
   * to the home the user actually has — and a `~` inside a config file has to
   * expand to something.
   */
  home: string
  /**
   * The emulator's own config and data roots, as the probe resolved them:
   * inside `~/.var/app/<id>/` for a flatpak, the XDG roots otherwise.
   *
   * Separate from `paths`, which holds the *emulation* directories a frontend
   * records for itself. The two are not the same place and neither derives from
   * the other — RetroDECK's `paths.home` is `~/retrodeck`, while the
   * `retroarch.cfg` deciding where its libretro saves land is inside the
   * flatpak tree.
   */
  configDir: string | null
  dataDir: string | null
  /**
   * Where the emulator's *own* files were deployed, when RomMix knows.
   *
   * Not a place anything is written: it is how a descriptor reads configuration
   * the emulator ships rather than configuration the user wrote. RetroDECK
   * decides which of its bundled emulators runs a system from an ES-DE system
   * list inside its own flatpak, and reading that beats keeping a copy of its
   * conclusions here that goes stale on the next release.
   */
  installDir: string | null
  /** The launch variant the user chose, when the emulator offers several. */
  variant?: string
  env: SaveEnvironment
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Join path segments. A local one because this module is loaded by the
 * renderer, where `node:path` does not exist.
 *
 * Empty and null segments are dropped, so a caller can splice in a component
 * that is only sometimes present without branching around it.
 */
export function joinPath(...parts: readonly (string | null | undefined)[]): string {
  const kept = parts.filter((part): part is string => part != null && part !== '')
  if (kept.length === 0) return ''
  return kept
    .map((part, index) => (index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, '')))
    .filter((part, index) => part !== '' || index === 0)
    .join('/')
}

/** Last component of a path, with any trailing slashes ignored. */
export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const cut = trimmed.lastIndexOf('/')
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}

/** Everything above the last component. */
export function dirName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const cut = trimmed.lastIndexOf('/')
  return cut <= 0 ? '/' : trimmed.slice(0, cut)
}

/** A location that cannot be attributed to one game, with the reason to say so. */
export function shared(dir: string): SaveLocation {
  return { dir, match: 'shared' }
}

/** A location whose whole directory is this game's save data. */
export function directory(dir: string): SaveLocation {
  return { dir, match: 'directory', archive: true }
}

/** A location holding files named after the ROM. */
export function perRom(dir: string, search?: readonly string[]): SaveLocation {
  return search && search.length > 0
    ? { dir, match: 'rom-stem', search }
    : { dir, match: 'rom-stem' }
}
