/**
 * What the files inside a game are.
 *
 * Facts about ROM and disc formats rather than about RomMix: which extensions
 * are a disc descriptor, which are documentation that came along in the archive,
 * and — for the systems that ship a game as a container instead of a disc — how
 * an update is told apart from the game it patches. Adding a format is an edit
 * here and nowhere else: the rule that uses these lives in
 * `src/shared/gamefiles.ts`.
 */

import { titleIdPrefix } from './systems.ts'

/** Files that are never the thing you hand an emulator. */
export const SIDECAR_EXTENSIONS: readonly string[] = [
  '.txt',
  '.nfo',
  '.xml',
  '.dat',
  '.md5',
  '.sfv',
  '.sbi',
  '.sub',
  '.ccd',
  '.jpg',
  '.jpeg',
  '.png'
]

/**
 * The archives RomM opens rather than treats as the game.
 *
 * RomM reads inside every one of these to work out what it is holding, and the
 * checksums it records for such a ROM describe the files it found in there —
 * not the archive around them. What it serves for that ROM is the archive, so
 * the two never agree. See `checksumOf`.
 *
 * `.tar.gz` and the rest of the double extensions are here in full: a name is
 * matched against the whole ending rather than the last dot, so `.gz` alone
 * would be a different, and wrong, answer.
 */
export const ARCHIVE_EXTENSIONS: readonly string[] = [
  '.zip',
  '.7z',
  '.rar',
  '.tar',
  '.tar.gz',
  '.tgz',
  '.tar.bz2',
  '.tbz2',
  '.tar.xz',
  '.txz'
]

/**
 * Systems where the archive is the game rather than the wrapper round it.
 *
 * An arcade game is a romset: an archive holding one dump per chip of the
 * board, named after the set. MAME, FinalBurn and Flycast are handed the
 * archive and read the set out of it — the dumps inside are named after the
 * chips and carry nothing that says which board they came off, so a romset
 * unpacked is a folder every one of them refuses.
 *
 * ES-DE system names, and read out of the `es_systems.xml` they come from:
 * these are the systems whose extension list accepts an archive and no loose
 * ROM beside it, which is the checkable form of the question. `cps2` takes
 * `.zip` and `.7z` and nothing else; `neogeocd` takes `.cue` and `.chd`, being
 * a disc rather than a board, and is not here. The ones that also list a
 * launcher script or a single-file alternative — `arcade` and `.cmd`, `neogeo`
 * and `.neo`, `lcdgames` and `.mgw` — are here all the same: a file that is
 * not an archive is not what this decides.
 */
export const ROMSET_SYSTEMS: readonly string[] = [
  // MAME and FinalBurn, and the boards ES-DE splits out from under them.
  'arcade',
  'mame',
  'mame-advmame',
  'mess',
  'fba',
  'fbneo',
  'neogeo',
  'cps',
  'cps1',
  'cps2',
  'cps3',
  'stv',
  'model2',
  'model3',
  'astrocde',
  'lcdgames',
  'consolearcade',
  // Flycast, which is handed the romsets MAME builds.
  'naomi',
  'naomi2',
  'naomigd',
  'atomiswave'
]

/**
 * Disc descriptors, in the order they should be preferred.
 *
 * These must win over the tracks they reference. Handing an emulator the `.bin`
 * of a cue+bin pair loads a headerless track and fails, and a multi-disc set is
 * the `.m3u` rather than any single disc in it — which is also why the playlist
 * outranks the descriptor.
 */
export const DESCRIPTOR_EXTENSIONS: readonly string[] = ['.m3u', '.cue', '.gdi']

/**
 * Systems whose emulators are handed the disc image, never a descriptor.
 *
 * PlayStation 2: PCSX2, and the libretro core built from it, open a disc by
 * its extension, and none of the descriptors above is one they accept — see
 * `VMManager::IsDiscFileName`. A cue sheet handed over is read as a raw image
 * and the game does not boot, whatever the file dialog's filter suggests. The
 * image it names is the disc, so the general rule's fallback to the largest
 * file is the right answer here.
 */
export const IMAGE_ONLY_SYSTEMS: readonly string[] = ['ps2']

/** How to tell one system's containers apart. See `CONTAINER_SYSTEMS`. */
export interface ContainerFormat {
  /** The extensions that are the game itself, and the only ones to launch. */
  extensions: readonly string[]
  /**
   * Names that mark a container as something applied *to* the game rather than
   * the game: an update, or downloadable content. Any match disqualifies it.
   */
  addOnPatterns: readonly RegExp[]
}

/** How many hex digits a title id has, whichever system it belongs to. */
export const TITLE_ID_DIGITS = 16

/** The trailing digits of a title id that say whether it is the game itself. */
export const TITLE_ID_KIND_DIGITS = 3

/**
 * A title id that is not a base game's, on a system that has title ids.
 *
 * The last digits of a title id say what the file is: a base game ends `000`,
 * its update ends `800`, and DLC counts up from `001`. Dumps conventionally
 * carry the id in brackets, so where one is present it is the most reliable
 * answer there is — and where it is absent nothing matches and the file stays a
 * candidate. The id has to begin with the system's own prefix: one belonging
 * to another console says nothing about what this file is.
 */
function addOnTitleIds(system: string): RegExp[] {
  const prefix = titleIdPrefix(system)
  if (!prefix) return []
  const middle = TITLE_ID_DIGITS - prefix.length - TITLE_ID_KIND_DIGITS
  const kind = `{${TITLE_ID_KIND_DIGITS}}`
  return [new RegExp(`\\b${prefix}[0-9a-f]{${middle}}(?!0${kind}\\b)[0-9a-f]${kind}\\b`, 'i')]
}

/** The container formats a Switch game is shipped in. */
export const SWITCH_CONTAINERS: readonly string[] = ['.nsp', '.xci', '.nsz', '.xcz']

/** The container format a Switch 2 game is shipped in. */
export const SWITCH2_CONTAINERS: readonly string[] = ['.nup']

/**
 * Systems where the game is one container file and a playlist is not a thing to
 * launch.
 *
 * The descriptor rule above is a rule about discs: a `.cue` or an `.m3u` is how
 * a disc-based game is handed over, so preferring it over the tracks it names is
 * right wherever there are tracks. A Switch game has none. The NSP or XCI *is*
 * the game, and the update and DLC beside it are further containers of the same
 * kind — but RomM holds all of them as one multi-file game, and a multi-file
 * game comes with an `.m3u` listing its files. Ranked as a descriptor that
 * playlist wins, and Eden is handed a text file it has no loader for.
 *
 * So on these systems the descriptors are skipped and the base game is chosen
 * directly. The update does not need naming: Eden reads external content out of
 * the game's own directory, which is where `flatLibrary` has already put it.
 */
export const CONTAINER_SYSTEMS: Readonly<Record<string, ContainerFormat>> = {
  switch: {
    extensions: SWITCH_CONTAINERS,
    addOnPatterns: [
      ...addOnTitleIds('switch'),
      /** The same thing said in words, for dumps that label rather than number. */
      /[[(](?:upd|update|dlc)[\])]/i,
      /**
       * A version other than zero. `[v0]` is the game as it shipped; every
       * later version is a patch, and is a separate file here rather than a
       * different copy of the game.
       */
      /\[v(?!0\])\d+\]/i
    ]
  },
  switch2: {
    extensions: SWITCH2_CONTAINERS,
    // The game is a single `.nup`, so there is nothing beside it to tell apart.
    addOnPatterns: []
  }
}
