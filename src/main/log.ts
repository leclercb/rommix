import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { rootPaths } from './root'

/**
 * RomMix's own log file.
 *
 * Everything the main process does ends up here: the calls the interface made,
 * what was sent to RomM and what came back, where a ROM was installed, and the
 * exit code of an emulator that died. The reason it is a file rather than the
 * terminal is that nobody running this has a terminal — RomMix is started from
 * Steam, from a desktop entry, or from gamescope, and its output goes wherever
 * the session decided. A user asked "why did that not start" can be asked for
 * one file instead.
 *
 * It lives in RomMix's own root beside everything else RomMix owns, so it moves
 * with the folder and is deleted with it.
 *
 * Writes are synchronous. The volume is a few lines per user action, and the
 * one moment the log has to be right is the moment the process is dying — an
 * async write queued behind a crash is a log that stops before the interesting
 * part.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** Ordinary runs record what happened; `ROMMIX_LOG=debug` records how. */
function configuredLevel(): LogLevel | 'off' {
  const wanted = process.env.ROMMIX_LOG?.trim().toLowerCase()
  if (wanted === 'off' || wanted === 'none') return 'off'
  if (wanted && wanted in ORDER) return wanted as LogLevel
  return 'info'
}

const LEVEL = configuredLevel()

/**
 * When the current file is rolled over, and how many are kept.
 *
 * One generation, because the question a log answers here is "what happened
 * just now"; a handheld with a full SD card is a worse problem than a lost
 * session from last week.
 */
const MAX_BYTES = 5 * 1024 * 1024

/** Resolved once: relocating the root only takes effect on the next start. */
let logFile: string | null = null

/** Set after a failed write, so an unwritable disk is complained about once. */
let fileDisabled = false

function filePath(): string | null {
  if (fileDisabled) return null
  if (logFile) return logFile
  try {
    const dir = join(rootPaths().root, 'logs')
    mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'rommix.log')
    return logFile
  } catch (cause) {
    fileDisabled = true
    console.error(`[rommix] cannot open the log file: ${(cause as Error).message}`)
    return null
  }
}

/** Roll the file over once it is big enough, keeping the previous one. */
function rotate(path: string): void {
  try {
    if (statSync(path).size < MAX_BYTES) return
    renameSync(path, `${path}.1`)
  } catch {
    // No file yet, or a rename that lost a race with another rotation. Either
    // way the append below is still the right next step.
  }
}

/**
 * Keys whose values never go in the log.
 *
 * The log is a file people paste into bug reports, and half of what passes
 * through here is an authenticated request. Matched on the key rather than the
 * value so a token in an unexpected shape is still caught.
 */
const SECRET_KEY = /token|password|secret|authorization|credential|cookie|api[-_]?key/i

/** Anything that looks like a credential in free text, whatever it was called. */
function scrubText(value: string): string {
  return value
    .replace(/\brmm_[A-Za-z0-9._-]+/g, 'rmm_***')
    .replace(/\beyJ[A-Za-z0-9._-]{20,}/g, 'jwt_***')
    .replace(/([?&](?:token|access_token|refresh_token|password)=)[^&\s]+/gi, '$1***')
}

/** The same, for the structured half of a line. */
function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value)
  if (value === null || typeof value !== 'object' || depth > 4) return value
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrub(item, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? (child == null ? child : '***') : scrub(child, depth + 1)
  }
  return out
}

/** JSON that cannot itself throw, whatever it is handed. */
function encode(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(scrub(data))
  } catch {
    return '{"log":"unserialisable"}'
  }
}

function write(
  level: LogLevel,
  area: string,
  message: string,
  data?: Record<string, unknown>
): void {
  if (LEVEL === 'off' || ORDER[level] < ORDER[LEVEL]) return

  const detail = data && Object.keys(data).length > 0 ? ` ${encode(data)}` : ''
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${area.padEnd(10)} ${scrubText(message)}${detail}\n`

  // Still on the console as well: `npm run dev` has one, and a packaged run
  // started from a terminal is exactly the case someone is watching it live.
  if (level === 'error' || level === 'warn') process.stderr.write(line)
  else process.stdout.write(line)

  const path = filePath()
  if (!path) return
  try {
    rotate(path)
    appendFileSync(path, line)
  } catch (cause) {
    fileDisabled = true
    console.error(`[rommix] logging to file stopped: ${(cause as Error).message}`)
  }
}

/**
 * What is worth keeping about a thrown value.
 *
 * The stack is trimmed to the frames that name RomMix's own code: the whole of
 * it is mostly Node's internals, and a log nobody reads to the end is one that
 * did not have to be this long.
 */
function describe(cause: unknown): Record<string, unknown> {
  if (!(cause instanceof Error)) return { error: String(cause) }
  const status = (cause as { status?: unknown }).status
  return {
    error: cause.message,
    errorName: cause.name,
    ...(typeof status === 'number' ? { status } : {}),
    stack: (cause.stack ?? '')
      .split('\n')
      .slice(1, 5)
      .map((frame) => frame.trim())
  }
}

export const log = {
  debug(area: string, message: string, data?: Record<string, unknown>): void {
    write('debug', area, message, data)
  },
  info(area: string, message: string, data?: Record<string, unknown>): void {
    write('info', area, message, data)
  },
  warn(area: string, message: string, data?: Record<string, unknown>): void {
    write('warn', area, message, data)
  },
  error(area: string, message: string, cause?: unknown, data?: Record<string, unknown>): void {
    write('error', area, message, { ...data, ...(cause === undefined ? {} : describe(cause)) })
  },

  /**
   * Where the file is, for the pre-flight check to point at.
   *
   * Computed rather than opened: asking where the log would be should not be
   * what creates the folder, least of all on a run with logging switched off.
   */
  path(): string {
    return logFile ?? join(rootPaths().root, 'logs', 'rommix.log')
  },

  /**
   * A timer for one operation, so its duration is reported by whatever ends it.
   *
   * Returned rather than wrapped around a callback because the interesting
   * operations here end in several different places — a download can finish,
   * fail or be cancelled — and each of those wants to say something different.
   */
  since(): () => number {
    const started = Date.now()
    return () => Date.now() - started
  }
}

/**
 * The line every run starts with.
 *
 * A log that opens with the version, the platform and where the root is answers
 * most of what would otherwise be the first three questions in a bug report.
 */
export function logSession(versions: Record<string, unknown>): void {
  write('info', 'app', '--- RomMix starting ---', {
    ...versions,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    root: rootPaths().root,
    logLevel: LEVEL
  })
}
