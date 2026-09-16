import type { SaveProgress } from '@shared/api'

/**
 * Counting one save transfer for the screen watching it.
 *
 * A pull and a push report the same shape — see `SaveProgress` — and both
 * count the same way: one run per button press, whatever kinds it moves.
 */

/** What a transfer in progress tells the screen. See `SaveProgress`. */
export interface SaveRun {
  /** The file being moved, and how much of it is here where that is countable. */
  moving(fileName: string, receivedBytes?: number, totalBytes?: number): void
  /** One file has gone by, whether it arrived or was left. */
  moved(): void
}

/**
 * Count one run of transfers for the screen watching it.
 *
 * One counter across the whole run rather than one per kind: saves and states
 * are two passes over one button press, and a count that starts again half way
 * through reads as a transfer that started again.
 *
 * The first report goes out as this is made, before anything is asked of the
 * server, because that is the wait this exists for: on a slow connection the
 * listing alone is seconds of a screen with nothing on it.
 */
export function progressRun(
  romId: number,
  direction: 'pull' | 'push',
  total: number | null,
  onProgress?: (progress: SaveProgress) => void
): SaveRun {
  let done = 0
  let fileName: string | null = null
  let totalBytes = 0
  const send = (receivedBytes: number): void =>
    onProgress?.({ romId, direction, fileName, done, total, receivedBytes, totalBytes })

  send(0)
  return {
    moving(name, receivedBytes = 0, bytes = 0) {
      fileName = name
      totalBytes = bytes
      send(receivedBytes)
    },
    moved() {
      done += 1
      // The file that has just gone reads as full rather than as nothing. A
      // screen with no size to divide by draws a bar that travels instead of
      // filling, and a counter that dropped to zero between files would send it
      // there once per file. See `SaveTransfer`.
      send(totalBytes)
    }
  }
}
