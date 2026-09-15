/**
 * The colours RomMix draws itself in.
 */

/**
 * A theme, by name.
 *
 * Every one of these is a file under `styles/themes/`, which is what makes a
 * theme a stylesheet rather than a feature: nothing outside that folder knows
 * any of these names, and no component branches on one. Adding one is adding a
 * file, a name here and a line in each catalogue.
 *
 * Most of them are a place — a console somebody owned, the light in a room, a
 * cabinet — because that is what gives a palette somewhere to start and somewhere
 * to stop. Nothing here requires it: what a theme owes is a name somebody can
 * pick from a sofa, and `contrast` earns its place by being the easiest of them
 * to read rather than by being anywhere.
 */
export const THEMES = [
  /** The dark blue RomMix has always drawn itself in. */
  'midnight',
  /** Light, for a room with the curtains open. */
  'daylight',
  /** And the other half of that: one warm bulb in a dark room. */
  'lamplight',
  'atari',
  'c64',
  'spectrum',
  'famicom',
  'macintosh',
  'amiga',
  'megadrive',
  'gameboy',
  'superfamicom',
  'virtualboy',
  'dreamcast',
  /** The Dreamcast's memory card: a blue-grey LCD. */
  'vmu',
  'gamecube',
  /** Phosphor on a black tube. */
  'crt',
  /** A cabinet in a dark room: pixels, neon and scan lines. */
  'arcade',
  /** The light half of that: pixels printed on squared paper. */
  'paper',
  /** Black, white and one yellow, for a screen read from across the room. */
  'contrast'
] as const

export type Theme = (typeof THEMES)[number]

/**
 * Midnight, which is the theme every screenshot and every description of
 * RomMix was made in.
 */
export const DEFAULT_THEME: Theme = 'midnight'

/**
 * What `Settings.dismissedNotices` holds once the notice announcing all of this
 * has been seen. See `ThemesNotice` and the `announce-themes` migration.
 *
 * Here rather than beside the component, because both sides of the question
 * read it: the renderer to know whether to draw the notice, and the main
 * process to put the key there for an installation that has nothing to be told.
 */
export const THEMES_NOTICE = 'themes'
