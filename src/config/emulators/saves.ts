import type { SaveFileConventions } from './types.ts'

/**
 * What save data looks like on disk.
 *
 * These are facts about emulators rather than about RomMix — the extensions
 * libretro cores and standalone emulators write, and how deep they bury them —
 * so they live here beside the descriptors that share them rather than in the
 * code that walks the tree.
 */
export const SAVE_CONVENTIONS: SaveFileConventions = {
  saveExtensions: [
    '.srm',
    '.sav',
    '.rtc',
    '.eep',
    '.fla',
    '.mcr',
    '.mcd',
    '.gme',
    '.dsv',
    '.ss0',
    '.bsv'
  ],
  // libretro numbers its states `.state1`, `.state2`, …, and writes the
  // automatic one as `.state.auto` — its state name with `.auto` appended.
  // Dolphin numbers its slots `.s01`, `.s02`, … behind the game id. See
  // `dolphinGameId`.
  statePattern: /\.(?:state\.auto|(?:state|auto)\d*|s\d{2})$/i,
  // The PlayStation cards, which are the memory cards emulators write per
  // game rather than as one file for the whole library: DuckStation numbers
  // the slot behind an underscore, mednafen behind a dot.
  slotExtensions: ['.mcd', '.mcr', '.gme'],
  // The real-time clock a GBC or GBA game keeps beside its battery save. Synced
  // like any other save file, and never the one a slot is paired on.
  companionExtensions: ['.rtc'],
  // Deep enough for `<system>/<emulator>/<file>`, which is the longest shape any
  // frontend here nests a save under, and shallow enough that a large library
  // does not turn every launch into a full-tree walk.
  maxDepth: 3
}
