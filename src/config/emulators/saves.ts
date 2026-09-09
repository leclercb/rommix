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
  // most recent one as `.auto`.
  statePattern: /\.(state|auto)\d*$/i,
  // The PlayStation cards, which are the memory cards emulators write per
  // game rather than as one file for the whole library: DuckStation numbers
  // the slot behind an underscore, mednafen behind a dot.
  slotExtensions: ['.mcd', '.mcr', '.gme'],
  // The real-time clock a GBC or GBA game keeps beside its battery save. Synced
  // like any other save file, and never the one a slot is paired on.
  companionExtensions: ['.rtc'],
  // Three levels covers `<system>/<emulator>/<file>` and stops a large library
  // turning every launch into a full-tree walk.
  maxDepth: 3
}
