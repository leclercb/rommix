/**
 * What an emulator's process did, read from how it ended and what it said.
 *
 * Kept apart from the launcher because none of it needs a process: it is four
 * rules over an exit code, a clock and a few kilobytes of output, and every one
 * of them is a decision the user feels. Reading a real session as a failed
 * launch abandons the saves it wrote; reading a launch that never started as a
 * clean exit is the Play button that appears to do nothing at all.
 *
 * The sentences are built here too, in RomMix's own words rather than the
 * emulator's, because what to say and what happened are the same decision —
 * see `readExit`.
 */

import type { CoreProgress } from '@shared/api'
import { t } from './i18n.ts'

/**
 * How long after the spawn an exit is still read as "it never started".
 *
 * Emulators are not consistent about their exit code on an ordinary quit — a
 * few return non-zero after a perfectly good session, and a launcher that
 * dispatches to one reports its *own* success rather than the emulator's, so
 * zero does not mean a game ran either. RetroDECK is the second kind: asked to
 * start a game it cannot start, it says so on stdout and exits 0.
 *
 * So the exit code cannot decide this on its own. What it can be paired with is
 * the clock: a process that is gone this quickly showed the user nothing,
 * whatever it returned, and a session someone actually played lasted longer
 * than any startup failure does.
 */
export const STARTUP_MS = 5000

/**
 * How the emulator's process ended.
 *
 * Two answers rather than one string, because they lead to opposite handling
 * and conflating them is what makes either one dangerous. An emulator that
 * never started has no session to account for and the launch failed. An
 * emulator that ran and then exited oddly has written save files, and treating
 * its parting complaint as a failure would abandon them unsent — the exit code
 * would cost the user the very session it was reporting on.
 */
export interface ExitReport {
  /** Why the emulator never got going, or null when it ran. */
  startupError: string | null
  /** Something it complained about, worth repeating but not worth failing on. */
  warning: string | null
}

/** Which of the four ways a process can have ended this was. */
export type ExitKind =
  /** Stopped from RomMix, or killed from outside. Somebody asked for this. */
  | 'asked'
  /** It ran and exited cleanly. */
  | 'clean'
  /** It ran, then exited non-zero — a session that happened, with a grumble. */
  | 'complained'
  /** Gone before it could have shown the user anything. */
  | 'never-started'

/** How the exit was read, and what to say about it. */
export interface ExitReading {
  kind: ExitKind
  report: ExitReport
  /**
   * What the emulator said for itself, where it is worth repeating.
   *
   * Separate from the report so the log can carry it under its own key: the
   * report holds a sentence written for the user, and this is the emulator's
   * own words that sentence was built from.
   */
  detail: string | null
}

/** Everything known about a process that has just closed. */
export interface Exit {
  code: number | null
  signal: NodeJS.Signals | null
  /** True when RomMix asked it to stop. */
  signalled: boolean
  /** How long it was up, in milliseconds. */
  ranMs: number
  /** The tail of stdout and stderr together. */
  output: string
}

/**
 * The lines an emulator marked as its own errors, or null when it marked none.
 *
 * Emulators log their whole run, so the tail is usually shader compilation and
 * audio device names — true, and no use to anyone reading a notification. The
 * lines that say what went wrong announce themselves, and the ones here all use
 * the same few words to do it.
 */
export function flaggedLines(output: string): string | null {
  const flagged = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /\berror\b|\bfatal\b/i.test(line))
    .slice(-3)
  return flagged.length ? flagged.join(' ') : null
}

/** The last of whatever the emulator said, for one that flags nothing. */
export function tailOf(output: string): string | null {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
  return lines.length ? lines.join(' ') : null
}

/**
 * The emulator's own account of why it died: whatever it flagged, or failing
 * that the last thing it said.
 *
 * The fallback is what makes a silent failure reportable. An emulator that
 * exits without flagging anything still leaves its final lines, and those beat
 * a notification that names no reason at all.
 */
export function complaint(output: string): string | null {
  return flaggedLines(output) ?? tailOf(output)
}

/**
 * Decide what an exit was, and what to tell the user about it.
 *
 * The order of the three questions is the whole of it. Being asked to stop
 * comes first, because a session the user ended is not a failure whatever the
 * process returned. The clock comes next, because it is the only thing that
 * separates a session from a launch that never happened. The exit code is asked
 * last and decides the least: by then it can only choose between a clean exit
 * and one worth repeating.
 */
export function readExit({ code, signal, signalled, ranMs, output }: Exit): ExitReading {
  const clean = { startupError: null, warning: null }

  if (signalled || signal) return { kind: 'asked', report: clean, detail: null }

  // Long enough to have been a session, so whatever the code meant, the
  // emulator ran and may have written saves.
  if (ranMs >= STARTUP_MS) {
    if (code === 0) return { kind: 'clean', report: clean, detail: null }
    // Anything it flagged is worth passing on; it is not worth throwing the
    // session away over.
    const flagged = flaggedLines(output)
    return {
      kind: 'complained',
      detail: flagged,
      report: {
        startupError: null,
        warning: flagged ? t('launch.emulatorReported', { detail: flagged }) : null
      }
    }
  }

  // Gone before it could have shown the user anything. This is the launch that
  // silently did nothing — a missing libretro core is exactly this shape — so
  // it is reported even when the emulator explained nothing.
  const detail = complaint(output)
  return {
    kind: 'never-started',
    detail,
    report: {
      startupError: detail
        ? t('launch.quitImmediatelyDetail', { detail })
        : code === 0
          ? // Zero is the least informative thing an exit can say, and quoting
            // it invites the reply that nothing went wrong.
            t('launch.quitImmediately')
          : t('launch.quitImmediatelyCode', { code: code ?? 0 }),
      warning: null
    }
  }
}

/** The core download, as a line to put under the Play button. */
export function stageFor(progress: CoreProgress): string {
  if (!progress.totalBytes) return t('launch.installingCore', { core: progress.core })
  return t('launch.installingCorePercent', {
    core: progress.core,
    percent: Math.round((progress.receivedBytes / progress.totalBytes) * 100)
  })
}
