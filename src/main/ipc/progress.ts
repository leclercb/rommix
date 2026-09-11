import type { RomMixApp } from '../app.ts'

/**
 * Throttling a per-file byte counter on its way to the renderer.
 *
 * Saves and firmware both report the same shape of progress for the same
 * reason, and both wrote the same eight lines: a chunk lands thousands of
 * times over a directory save or a console's firmware, the bar cannot show the
 * difference between one and the next, and every message crosses IPC and
 * redraws the screen. The download queue has a third copy, differently shaped,
 * because its unit is a queue rather than a run of files.
 */

/**
 * How often the bytes of the file in flight are reported.
 *
 * Fast enough that a bar moves smoothly at any transfer speed, slow enough
 * that a large file costs a few hundred messages rather than thousands.
 */
const PROGRESS_INTERVAL_MS = 250

/** What both kinds of progress carry, and all this needs of either. */
interface Step {
  done: number
  /** Null between files, which is a step of its own. */
  fileName: string | null
}

/**
 * One run's progress, throttled per file.
 *
 * Anything that moves the run along — a new file, a file finished — goes
 * straight out, so the count and the name are never stale. Only the byte
 * counter inside one file is held back.
 */
export function throttledProgress<T extends Step>(
  rommix: RomMixApp,
  channel: 'saves:progress' | 'bios:progress'
): (progress: T) => void {
  let sentAt = 0
  let sentFor: string | null = null

  return (progress) => {
    const step = `${progress.done}:${progress.fileName}`
    const now = Date.now()
    if (step === sentFor && now - sentAt < PROGRESS_INTERVAL_MS) return
    sentAt = now
    sentFor = step
    rommix.send(channel, progress)
  }
}
