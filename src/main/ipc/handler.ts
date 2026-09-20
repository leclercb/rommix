import { ipcMain } from 'electron'
import { log } from '../log.ts'
import { RommError } from '../romm/index.ts'
import type { RomMixApp } from '../app.ts'

/**
 * The wrapper every channel in this folder is registered through, so a thrown
 * error crosses the bridge as a readable message rather than Electron's default
 * "Error invoking remote method" wrapper, which hides the cause.
 *
 * The same wrapper announces the failure on `app:error`, so *every* call that
 * fails is reported to the user whether or not the screen that made it thought
 * to catch it. A screen that wants to say something better still can — it does
 * not have to, and a call made on a screen's behalf (a refresh, a probe,
 * something started by a keypress two screens ago) cannot fail in silence and
 * leave the UI quietly showing nothing.
 *
 * It is also where every action the user took is written to the log. One line
 * per call, from the one place every call already passes through, which is what
 * makes the log a record of what was done rather than of what a handful of
 * hand-instrumented handlers remembered to mention.
 */

/**
 * Channels logged only at debug level.
 *
 * These are the ones a screen asks on every render or every few seconds. At
 * info level they would be most of the file, and none of them says anything
 * about what the person in front of the television did.
 */
const CHATTY = new Set([
  'server:status',
  'server:pollPairing',
  'system:settings',
  'downloads:list',
  'library:installed',
  'library:favourite'
])

/** What each domain module is handed to register its own channels with. */
export type Handle = <Args extends unknown[], Result>(
  channel: string,
  fn: (...args: Args) => Promise<Result> | Result
) => void

export function handler(report: (message: string) => void): Handle {
  return function handle<Args extends unknown[], Result>(
    channel: string,
    fn: (...args: Args) => Promise<Result> | Result
  ): void {
    ipcMain.handle(channel, async (_event, ...args) => {
      const took = log.since()
      const level = CHATTY.has(channel) ? 'debug' : 'info'
      // Arguments as they were passed: a call that failed is far easier to
      // account for with the id or the query that produced it. `log` scrubs the
      // credentials out of `server:connect` on the way past.
      log[level]('ipc', `→ ${channel}`, args.length > 0 ? { args } : undefined)
      try {
        const result = await fn(...(args as Args))
        log[level]('ipc', `← ${channel}`, { ms: took() })
        return result
      } catch (cause) {
        // `instanceof Error` rather than reading `.message` off whatever it is:
        // something rejecting with `null` or `undefined` would throw a
        // `TypeError` inside this catch, skipping the log line and the report
        // and leaving the channel to fail with Electron's opaque default.
        const message =
          cause instanceof RommError || cause instanceof Error ? cause.message : String(cause)
        log.error('ipc', `✗ ${channel}`, cause, { ms: took() })
        report(message)
        // The message is what crosses the bridge — Electron serialises nothing
        // else — but `cause` keeps the original stack attached on this side, so
        // an unhandled rejection in the main process still names where it came
        // from rather than pointing back at this line.
        throw new Error(message, { cause })
      }
    })
  }
}

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
  /** How far into the file in flight, where the caller counts bytes. */
  receivedBytes?: number
  /** What that file weighs, where either end could say. */
  totalBytes?: number
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
    /**
     * The report that completes a file, which is never held back.
     *
     * The last chunk is almost never on a throttle boundary, so without this
     * the bar for that file stops wherever the throttle last let it through
     * and jumps straight to the next one, never reaching full.
     */
    const whole =
      progress.totalBytes !== undefined &&
      progress.totalBytes > 0 &&
      progress.receivedBytes === progress.totalBytes
    if (!whole && step === sentFor && now - sentAt < PROGRESS_INTERVAL_MS) return
    sentAt = now
    sentFor = step
    rommix.send(channel, progress)
  }
}
