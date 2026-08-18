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
  // Three levels covers `<system>/<emulator>/<file>` and stops a large library
  // turning every launch into a full-tree walk.
  maxDepth: 3
}
