/** How dates, times and sizes are written wherever the UI writes them. */

/**
 * Dates and times, always on a 24-hour clock.
 *
 * The locale is still the user's — month order, separators and the names of the
 * months all follow it — but the clock does not. `hourCycle: 'h23'` rather than
 * `hour12: false`, which in some locales resolves to the h24 cycle and prints
 * midnight as 24:00.
 *
 * Built once. `Intl.DateTimeFormat` is expensive to construct and these run per
 * row, on lists that can be hundreds of saves long.
 */
const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
  hourCycle: 'h23'
})

const DATE_ONLY = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' })

/**
 * An ISO timestamp as a date and a 24-hour time, or null when it is not one.
 *
 * Null rather than "Invalid Date": every caller is describing a file or a
 * release, and a row that cannot say when is better off saying nothing there.
 */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : DATE_TIME.format(at)
}

/** A date with no time of day, for a release year rather than a file's mtime. */
export function formatDate(value: Date | number | string): string | null {
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : DATE_ONLY.format(at)
}

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
