/**
 * The languages RomMix is drawn in, and how one of them is picked.
 *
 * Four, because that is what there are complete catalogues for — every string
 * in `en.ts` exists in each of the others, which is enforced by the type rather
 * than by a script: a catalogue is declared as `Catalog`, so a key added to
 * English and forgotten anywhere else fails the typecheck.
 *
 * This file has no imports on purpose. Both processes and the browser demo read
 * it, and it is what `Settings.language` is typed against.
 */

export const LOCALES = ['en', 'fr', 'de', 'es'] as const

export type Locale = (typeof LOCALES)[number]

/**
 * What the user has chosen in Settings: a language, or "whatever this machine
 * is set to".
 *
 * `auto` is stored rather than resolved once at first run. A resolved value
 * would freeze the choice a machine made before its owner ever looked at the
 * setting, and would not follow a desktop that later changes language.
 */
export type LanguageChoice = 'auto' | Locale

/**
 * Each language named in itself.
 *
 * Not translated, and deliberately so: someone looking for their own language
 * in this list is, by definition, reading it in one they may not have. The
 * whole point of the row is to be recognisable before the interface changes.
 */
export const LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español'
}

/** One shape of a flag: a filled band, or a stroked bar of a cross. */
export interface FlagShape {
  /** Path data in `FLAG_VIEWBOX` coordinates. */
  d: string
  /** Absent on a stroked shape, which is drawn unfilled. */
  fill?: string
  stroke?: string
  strokeWidth?: number
}

/**
 * The box every flag is drawn in.
 *
 * Four thirds, where a real Union Jack is two to one. These sit in a row of
 * icons and want to read as one set, and the odd one out at a different ratio
 * reads as a mistake rather than as accuracy.
 */
export const FLAG_VIEWBOX = '0 0 24 18'

/**
 * A flag per language, for the row in Settings and the site's language menu.
 *
 * A language is not a country and these are approximations: English is spoken
 * in more places than the United Kingdom, and Spanish in more than Spain. They
 * are here because a flag is picked out of a row of five faster than a word is,
 * and the word is next to it either way.
 *
 * Drawn rather than typed, which these used to be. Having a glyph for the emoji
 * is not the same as drawing a flag: Noto Emoji — the *monochrome* one — ligates
 * the pair exactly as a colour font does and renders it as the two-letter
 * country code in a box, and fontconfig ranks it ahead of Noto Color Emoji
 * wherever both are installed. Windows ships no flag glyph at all, and falls
 * back to the two letters loose. So one string was a flag under Electron, `GB`
 * in a browser on the same machine, and `GB` again for most of the people
 * reading the site. Shapes are the same everywhere.
 *
 * Shapes rather than a component or a file, because there are two renderers:
 * `Flag` in the interface, and `scripts/build-landing.mjs`, which writes these
 * into the landing page as an SVG sprite. Drawing is the caller's half; which
 * lines make a flag is this table's.
 *
 * The saltire on the Union Jack is centred rather than counterchanged as the
 * real flag has it. At the size these are drawn that offset is a smear, and
 * enough of a flag to be known is the whole job here.
 */
export const LANGUAGE_FLAGS: Record<Locale, readonly FlagShape[]> = {
  en: [
    { d: 'M0 0h24v18H0z', fill: '#012169' },
    { d: 'm0 0 24 18M24 0 0 18', stroke: '#ffffff', strokeWidth: 3.6 },
    { d: 'm0 0 24 18M24 0 0 18', stroke: '#c8102e', strokeWidth: 2 },
    { d: 'M12 0v18M0 9h24', stroke: '#ffffff', strokeWidth: 6 },
    { d: 'M12 0v18M0 9h24', stroke: '#c8102e', strokeWidth: 3.6 }
  ],
  fr: [
    { d: 'M0 0h24v18H0z', fill: '#ffffff' },
    { d: 'M0 0h8v18H0z', fill: '#002654' },
    { d: 'M16 0h8v18h-8z', fill: '#ce1126' }
  ],
  de: [
    { d: 'M0 0h24v6H0z', fill: '#000000' },
    { d: 'M0 6h24v6H0z', fill: '#dd0000' },
    { d: 'M0 12h24v6H0z', fill: '#ffce00' }
  ],
  es: [
    { d: 'M0 0h24v18H0z', fill: '#aa151b' },
    // The middle band is half the height, which is what makes it Spain's rather
    // than any other red-and-yellow tricolour.
    { d: 'M0 4.5h24v9H0z', fill: '#f1bf00' }
  ]
}

/** What RomMix falls back to: the language every other catalogue is written from. */
export const DEFAULT_LOCALE: Locale = 'en'

/**
 * A BCP 47 tag — `fr`, `de-AT`, `es_MX` — as one of the languages RomMix has.
 *
 * Only the primary subtag is looked at. RomMix does not distinguish regional
 * variants, and treating `fr-CA` as unknown would put a French desktop into
 * English for a distinction none of the catalogues make.
 */
export function resolveLocale(tag: string | null | undefined): Locale {
  const primary = (tag ?? '').toLowerCase().split(/[-_]/)[0]
  return (LOCALES as readonly string[]).includes(primary) ? (primary as Locale) : DEFAULT_LOCALE
}

/**
 * The language to draw in: the stored choice, or the system's when it is `auto`.
 *
 * `system` is `app.getLocale()` in the main process and `navigator.language` in
 * the renderer — the same question asked of the two things that can answer it.
 */
export function localeFor(
  choice: LanguageChoice | null | undefined,
  system: string | null | undefined
): Locale {
  return choice && choice !== 'auto' ? choice : resolveLocale(system)
}
