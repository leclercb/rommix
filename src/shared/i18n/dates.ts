import type { Locale } from './locales.ts'

/**
 * How RomMix writes a date.
 *
 * Four, because between them they cover what people expect a date to look like:
 * the two orders most of the world writes numerically, the international
 * standard, and the language's own way of putting it. There is no fifth answer
 * worth a row in Settings — what remains is separators and month names, which
 * is taste rather than a convention anyone reads by.
 *
 * The clock is not part of the choice. RomMix shows a 24-hour time throughout,
 * which is unambiguous at a glance and the same width every hour of the day;
 * every one of these formats is a date with that time after it.
 */
export const DATE_FORMATS = ['dmy', 'mdy', 'iso', 'language'] as const

export type DateFormat = (typeof DATE_FORMATS)[number]

/**
 * Day first, which is what most of the world writes.
 *
 * Not `language`, tempting as following the locale is: the number of people
 * reading a date day-first is far larger than the number reading it any other
 * way, and it is the one order that is right for a reader whose language RomMix
 * does not have. Anyone the default does not suit changes one row.
 */
export const DEFAULT_DATE_FORMAT: DateFormat = 'dmy'

/** What one format writes, for a date alone and for a date with a time. */
export interface DateFormatters {
  date(at: Date): string
  dateTime(at: Date): string
}

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * The formatters for one language and one chosen format.
 *
 * The three fixed formats are built rather than asked of `Intl`, which offers
 * no way to say "day first" — the usual trick is to format under a locale known
 * to do it, which quietly borrows that locale's separators and calendar too.
 * Padded to two digits so a column of dates lines up, and read off the local
 * clock, which is the one the times are being compared against.
 */
export function dateFormatters(locale: Locale, format: DateFormat): DateFormatters {
  if (format === 'language') {
    // `hourCycle: 'h23'` rather than `hour12: false`, which in some locales
    // resolves to the h24 cycle and prints midnight as 24:00.
    const dateTime = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23'
    })
    const dateOnly = new Intl.DateTimeFormat(locale, { dateStyle: 'long' })
    return { date: (at) => dateOnly.format(at), dateTime: (at) => dateTime.format(at) }
  }

  const date = (at: Date): string => {
    const year = String(at.getFullYear())
    const month = pad(at.getMonth() + 1)
    const day = pad(at.getDate())
    if (format === 'iso') return `${year}-${month}-${day}`
    return format === 'dmy' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`
  }

  return { date, dateTime: (at) => `${date(at)} ${pad(at.getHours())}:${pad(at.getMinutes())}` }
}

/**
 * One date written every way, so the Settings row shows what it is offering.
 *
 * Christmas rather than today: the day is past the twelfth, so day-first and
 * month-first cannot be read as each other in the very list where somebody is
 * telling them apart — which two of today's dates in twelve would be.
 *
 * The date alone. The time that follows it is the same under every format, so a
 * row of four would repeat it four times, and these sit side by side in a
 * segmented control that has only so much width before it wraps.
 */
const SAMPLE = new Date(2026, 11, 25)

export function dateFormatSample(locale: Locale, format: DateFormat): string {
  return dateFormatters(locale, format).date(SAMPLE)
}
