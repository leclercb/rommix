import { ipcMain } from 'electron'
import { log } from '../log.ts'
import { RommError } from '../romm.ts'

/**
 * The wrapper every channel in this folder is registered through, so a thrown
 * error crosses the bridge as a readable message rather than Electron's default
 * "Error invoking remote method" wrapper, which hides the cause.
 *
 * The same wrapper announces the failure on `app:error`, so *every* call that
 * fails is reported to the user whether or not the screen that made it thought
 * to catch it. A screen that wants to say something better still can — it just
 * no longer has to, and a call made on a screen's behalf (a refresh, a probe,
 * something started by a keypress two screens ago) can no longer fail in
 * silence and leave the UI quietly showing nothing.
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
        const message =
          cause instanceof RommError ? cause.message : ((cause as Error).message ?? String(cause))
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
