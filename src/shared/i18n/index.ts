import type { Catalog } from './catalog.ts'
import { de } from './de.ts'
import { en } from './en.ts'
import { es } from './es.ts'
import { fr } from './fr.ts'
import { DEFAULT_DATE_FORMAT, dateFormatters, type DateFormat } from './dates.ts'
import type { Locale } from './locales.ts'

/**
 * Everything the interface says, in whichever language it is being read in.
 *
 * One catalogue per language, English being the one the others are written
 * from: `Catalog` is `typeof en`, so every other file is checked against it and
 * a key added here and forgotten there is a typecheck failure rather than a
 * word that silently comes out in English.
 *
 * Both processes use this. The main process translates before a message crosses
 * IPC — a `RommError` arrives at the renderer as a sentence, not as a key — so
 * there is exactly one place that decides what language RomMix is speaking, and
 * it is `Settings.language`.
 *
 * Everything RomMix says is in here, the emulator descriptors included: they
 * name a phrase with `Text` and something with a language to hand resolves it.
 * Nothing anywhere holds a sentence of its own.
 */

export { DATE_FORMATS, DEFAULT_DATE_FORMAT, dateFormatSample, type DateFormat } from './dates.ts'

export {
  DEFAULT_LOCALE,
  FLAG_VIEWBOX,
  LANGUAGE_FLAGS,
  LANGUAGE_NAMES,
  LOCALES,
  localeFor,
  resolveLocale,
  type FlagShape,
  type LanguageChoice,
  type Locale
} from './locales.ts'

export type { Catalog } from './catalog.ts'

type CatalogKey = keyof Catalog & string

/**
 * The stem of a plural entry, so `t('x.games', { count })` can be written for a
 * catalogue that declares `x.games_one` and `x.games_other`.
 *
 * The variants stay callable too — nothing gains from forbidding it — but the
 * stem is what call sites use, since only `Intl.PluralRules` knows which
 * variant a number wants in a given language.
 */
type PluralStem<K extends string> = K extends `${infer Stem}_other` ? Stem : never

export type MessageKey = CatalogKey | PluralStem<CatalogKey>

/** Values substituted into `{name}` placeholders. `count` also picks the plural. */
export type MessageParams = Readonly<Record<string, string | number>>

/**
 * A phrase named now and translated later.
 *
 * The emulator descriptors are what it is for. They are pure functions of an
 * install — no settings, no window, nothing that knows which language RomMix is
 * being read in — and some of what they report is a sentence: why a shared
 * memory card cannot be synced, what is still to be set up by hand. So they name
 * the phrase and `localize` resolves it at the boundary, where there is an
 * `I18n` to resolve it with.
 *
 * A bare key is the common case; the object form carries the values a phrase
 * needs filled in. Both are checked against the catalogue by the compiler, so a
 * descriptor cannot quietly hold a sentence of its own.
 */
export interface Message {
  readonly key: MessageKey
  readonly params?: MessageParams
}

export type Text = MessageKey | Message

/** One `Text`, in the language this `I18n` speaks. */
export function localize(text: Text, i18n: I18n): string
export function localize(text: Text | null | undefined, i18n: I18n): string | null
export function localize(text: Text | null | undefined, i18n: I18n): string | null {
  if (text == null) return null
  return typeof text === 'string' ? i18n.t(text) : i18n.t(text.key, text.params)
}

const CATALOGS: Record<Locale, Catalog> = { en, fr, de, es }

/**
 * The catalogue, the plural rules and the number and date formats for one
 * language, built once.
 *
 * `Intl` constructors are expensive and these run per row on lists that can be
 * hundreds of saves long, so an instance is cached per locale and handed to
 * every caller asking for that language.
 */
export interface I18n {
  readonly locale: Locale
  /**
   * One phrase, with `{placeholders}` filled in.
   *
   * A `count` parameter also picks the plural form, by the rules of the
   * language rather than by `=== 1`: French keeps the singular for zero and
   * Spanish and German do not, which is exactly the sort of thing that is wrong
   * everywhere the moment it is written out by hand.
   */
  t(key: MessageKey, params?: MessageParams): string
  formatNumber(value: number): string
  /** Human-readable byte size, with the language's own decimal separator. */
  formatBytes(bytes: number): string
  /** A date with no time of day, for a release year rather than a file's mtime. */
  formatDate(value: Date | number | string): string | null
  /**
   * An ISO timestamp as a date and a 24-hour time, or null when it is not one.
   *
   * Null rather than "Invalid Date": every caller is describing a file or a
   * release, and a row that cannot say when is better off saying nothing there.
   *
   * How it is written is `Settings.dateFormat` — see `DATE_FORMATS`. Every date
   * the interface shows comes through here or `formatDate`, which is what keeps
   * one setting able to answer for all of them.
   */
  formatDateTime(iso: string | null | undefined): string | null
}

const CACHE = new Map<string, I18n>()

export function createI18n(locale: Locale, dateFormat: DateFormat = DEFAULT_DATE_FORMAT): I18n {
  // Keyed by both, the pair being what the formatters are built from.
  const cacheKey = `${locale}:${dateFormat}`
  const cached = CACHE.get(cacheKey)
  if (cached) return cached

  const catalog = CATALOGS[locale] ?? en
  const plurals = new Intl.PluralRules(locale)
  const numbers = new Intl.NumberFormat(locale)
  const decimals = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const dates = dateFormatters(locale, dateFormat)

  const i18n: I18n = {
    locale,

    t(key, params) {
      const template = entry(catalog, key, params, plurals) ?? entry(en, key, params, plurals)
      // The key itself rather than an empty string: a missing phrase is a bug,
      // and one that shows up as `game.play` on the button is one somebody
      // reports. This cannot happen through the types; it can through a
      // hand-written key.
      if (template === undefined) return key
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
        const value = params[name]
        return value === undefined
          ? whole
          : typeof value === 'number'
            ? numbers.format(value)
            : value
      })
    },

    formatNumber: (value) => numbers.format(value),

    formatBytes(bytes) {
      if (!bytes) return '—'
      // The units are the same in every language RomMix speaks; the separator
      // inside the number is not, which is what the formatter is for.
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let value = bytes
      let unit = 0
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
      }
      const shown =
        value < 10 && unit > 0 ? decimals.format(value) : numbers.format(Math.round(value))
      return `${shown} ${units[unit]}`
    },

    formatDate(value) {
      const at = new Date(value)
      return Number.isNaN(at.getTime()) ? null : dates.date(at)
    },

    formatDateTime(iso) {
      if (!iso) return null
      const at = new Date(iso)
      return Number.isNaN(at.getTime()) ? null : dates.dateTime(at)
    }
  }

  CACHE.set(cacheKey, i18n)
  return i18n
}

/** The phrase for a key, taking the plural form when the caller passed a count. */
function entry(
  catalog: Catalog,
  key: string,
  params: MessageParams | undefined,
  plurals: Intl.PluralRules
): string | undefined {
  const table = catalog as Record<string, string | undefined>
  const direct = table[key]
  if (direct !== undefined) return direct

  const count = params?.count
  if (typeof count !== 'number') return undefined
  return table[`${key}_${plurals.select(count)}`] ?? table[`${key}_other`]
}
