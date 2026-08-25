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
