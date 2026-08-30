import { execFile, spawn } from 'node:child_process'
import { access, constants, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { APPIMAGE_SEARCH_DIRS } from '@config/emulators'
import type { ResolvedInstall } from '@config/emulators'
import { log } from './log.ts'
import { realHome } from './xdg.ts'
import { t } from './i18n.ts'

/**
 * Talking to the machine RomMix is installed on. Nothing here knows about any
 * particular emulator — that is `emulators.ts`.
 *
 * RomMix ships as an AppImage rather than a flatpak, so it is an ordinary
 * process on an ordinary machine: it runs other programs by running them.
 * Everything below is therefore about *other* applications' packaging — an
 * emulator installed as a flatpak still has to be found, started and stopped
 * through flatpak — and nothing about RomMix's own.
 *
 * That is a deliberate trade, not an accident of packaging. See
 * electron-builder.yml: a sandboxed RomMix can only start a host program via
 * `flatpak-spawn --host`, which reparents it onto flatpak's session helper and
 * takes it out of the process tree Steam launched — and a gamescope session
 * will not focus a window Steam has not tagged.
 */

const execFileAsync = promisify(execFile)

async function run(argv: string[], timeoutMs = 8000): Promise<string | null> {
  const [cmd, ...args] = argv
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs })
    return stdout
  } catch (cause) {
    // Null is an ordinary answer here — "no such flatpak", "not on PATH" — so
    // this is debug rather than a warning.
    log.debug('host', 'command failed', {
      command: argv.join(' '),
      reason: (cause as Error).message
    })
    return null
  }
}

/**
 * Where this flatpak is deployed, or null when it is not installed.
 *
 * The location doubles as the "is it installed" answer and as a way into the
 * application's own files — which matters for an emulator that ships
 * configuration RomMix has to read, like the ES-DE system list inside
 * RetroDECK. Asking flatpak beats constructing the path: it covers system and
 * user installations, either architecture, and any branch, none of which RomMix
 * would otherwise know.
 */
export async function flatpakLocation(appId: string): Promise<string | null> {
  const out = await run(['flatpak', 'info', '--show-location', appId])
  const path = out?.trim().split('\n')[0]
  return path ? path : null
}

/** How long a flatpak app gets to quit on its own before it is killed. */
const QUIT_GRACE_MS = 5000

/** The sandbox process of each running instance of this application. */
async function sandboxPids(appId: string): Promise<number[]> {
  const out = await run(['flatpak', 'ps', '--columns=application,child-pid'])
  return (out ?? '')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([app]) => app === appId)
    .map(([, pid]) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

/** Every process descended from `roots`, from one snapshot of the process table. */
export function descendantsOf(psOutput: string, roots: readonly number[]): number[] {
  const children = new Map<number, number[]>()
  for (const line of psOutput.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }

  const found: number[] = []
  const queue = [...roots]
  while (queue.length) {
    for (const child of children.get(queue.shift()!) ?? []) {
      // A cycle is impossible in a process tree, but a corrupt parse should not
      // become an infinite loop.
      if (found.includes(child)) continue
      found.push(child)
      queue.push(child)
    }
  }
  return found
}

/**
 * Signal a list of processes, one at a time.
 *
 * `process.kill` rather than the `kill` program: it is one fewer binary to
 * assume exists, it has no argv-length ceiling, and — the reason that matters —
 * each process reports its own outcome. `kill(1)` collapses every failure into
 * one exit code, so "the app already quit" and "those processes are not yours"
 * were indistinguishable, and both looked like nothing had happened.
 *
 * A process that has already gone (`ESRCH`) is the ordinary case and not worth
 * a line: the tree is read from one snapshot, and an emulator shutting down
 * takes its children with it while this is still walking the list.
 */
function signal(pids: readonly number[], sig: NodeJS.Signals = 'SIGTERM'): void {
  for (const pid of pids) {
    try {
      process.kill(pid, sig)
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code
      if (code === 'ESRCH') continue
      log.warn('host', 'could not signal a process', { pid, code: code ?? null })
    }
  }
}

/**
 * Stop a running flatpak application, letting it save first.
 *
 * `flatpak kill` is the documented way and the fallback here, but it SIGKILLs:
 * the emulator dies without writing the save it was holding, which for a
 * front end whose whole job is moving saves around is the wrong default.
 *
 * A signal cannot simply be sent to the process RomMix spawned either. `flatpak
 * run` hands off to bubblewrap and the application ends up parented to the
 * session, so the spawned process is a bystander and bubblewrap forwards
 * nothing — which is why the close button did nothing at all. The application's
 * own processes are visible on the host, though, and SIGTERM to those is an
 * ordinary quit that RetroArch and the rest handle by shutting down cleanly.
 *
 * Returns false when the application was not running.
 */
export async function stopFlatpakApp(appId: string): Promise<boolean> {
  const sandboxes = await sandboxPids(appId)
  if (sandboxes.length === 0) {
    log.info('host', 'no running instance to stop', { appId })
    return false
  }

  // The sandbox process is normally bubblewrap and the application is its
  // child, so the descendants are what must be asked to quit. The sandbox
  // itself is included because that layout is not guaranteed — where the
  // application *is* the sandbox process there would otherwise be nothing to
  // signal, and the grace period would expire into a kill for no reason.
  // Signalling bubblewrap when it is not the application is harmless: it does
  // not forward, which is the whole reason the descendants are listed.
  const ps = await run(['ps', '-eo', 'pid=,ppid='])
  const targets = [...descendantsOf(ps ?? '', sandboxes), ...sandboxes]
  log.info('host', 'asking a flatpak app to quit', { appId, sandboxes, targets })
  signal(targets)

  const deadline = Date.now() + QUIT_GRACE_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    if ((await sandboxPids(appId)).length === 0) {
      log.info('host', 'the app quit on its own', { appId })
      return true
    }
  }

  // It ignored the request, or there was nothing under the sandbox to ask.
  // Being stuck in an emulator with no way back is worse than a lost save.
  log.warn('host', 'the app ignored SIGTERM, killing it — a save may be lost', {
    appId,
    graceMs: QUIT_GRACE_MS
  })
  await run(['flatpak', 'kill', appId])
  return true
}

/**
 * Kill a process and everything underneath it.
 *
 * What RomMix spawns is usually not the emulator. An AppImage runs its payload
 * as a child of its own runtime, a launcher script under `scripts` starts one
 * and waits, and either way a signal to the process that was spawned kills the
 * wrapper and leaves the emulator holding the screen — a force-close button
 * that closes nothing.
 *
 * The root goes first so that a wrapper watching its child cannot start another
 * one, and the descendants come from a snapshot taken before that, since a
 * process reparented by the kill would no longer be found under it.
 *
 * SIGKILL throughout: this is only reached once the user has been told the
 * emulator is not responding and has chosen to lose whatever it had not
 * written. See `forceQuit`.
 */
export async function killProcessTree(pid: number): Promise<void> {
  const ps = await run(['ps', '-eo', 'pid=,ppid='])
  const targets = [pid, ...descendantsOf(ps ?? '', [pid])]
  log.warn('host', 'killing a process tree on request — unsaved data is lost', { pid, targets })
  signal(targets, 'SIGKILL')
}

/**
 * Kill a flatpak app outright, with no grace period.
 *
 * `stopFlatpakApp` asks first and waits; this is what is left when the user has
 * been told the app is not responding and has chosen to lose whatever it had
 * not written.
 */
export async function killFlatpakApp(appId: string): Promise<void> {
  log.warn('host', 'killing a flatpak app on request — unsaved data is lost', { appId })
  await run(['flatpak', 'kill', appId])
}

/**
 * Absolute path of the first of these executables found on PATH.
 *
 * `command -v` is a shell builtin, so this has to go through `sh -c`; names are
 * screened first so a hand-written emulator descriptor cannot smuggle shell
 * metacharacters into that string.
 */
export async function binaryPath(names: readonly string[]): Promise<string | null> {
  for (const name of names) {
    if (!/^[\w.+-]+$/.test(name)) continue
    const out = await run(['sh', '-c', `command -v ${name}`], 5000)
    const path = out?.trim().split('\n')[0]
    if (path) return path
  }
  return null
}

/**
 * First file matching one of these case-insensitive filename globs.
 *
 * Only `*` is supported, which is all the patterns need, and the rest of the
 * pattern is escaped so a descriptor cannot inject regex of its own.
 */
export async function findAppImage(patterns: readonly string[]): Promise<string | null> {
  const home = realHome()
  for (const segments of APPIMAGE_SEARCH_DIRS) {
    const hit = await findMatchingFile(join(home, ...segments), patterns)
    if (hit) return hit
  }
  return null
}

/** First file in `dir` matching one of the globs, or null. */
export async function findMatchingFile(
  dir: string,
  patterns: readonly string[]
): Promise<string | null> {
  const matchers = patterns.map(
    (pattern) =>
      new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`, 'i')
  )

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }
  const hit = entries.find((entry) => matchers.some((matcher) => matcher.test(entry)))
  return hit ? join(dir, hit) : null
}

/**
 * argv prefix that starts a resolved install.
 *
 * Whatever this returns is spawned directly, so the emulator is a child of
 * RomMix — which is the point, and the reason RomMix is not itself sandboxed.
 * A gamescope session only focuses a window Steam has tagged, and Steam only
 * tags what is inside the process tree it launched.
 *
 * An AppImage is executed directly, never through `appimage-run`: that helper
 * unpacks a squashfs payload, and an AppImage built with uruntime — as Eden's
 * is — carries DwarFS instead, so a perfectly good image fails to start. The
 * image's own runtime handles either format.
 *
 * A `scripts` install has no single program — the launcher to run depends on
 * the system — so it gets nothing here and the descriptor names the script.
 */
export function execPrefix(
  install: ResolvedInstall,
  env: Readonly<Record<string, string>> = {}
): string[] {
  // A flatpak emulator gets a sandbox of its own, and setting a variable on the
  // process that calls `flatpak run` does not put it inside that one — flatpak
  // decides what crosses the boundary, and an emulator that needs a variable to
  // start would not see it. `--env` is the way in, and it belongs before the
  // application id: after it, flatpak passes it to the application as an
  // ordinary argument. Anything else takes the variable from the spawn options.
  const passed = Object.entries(env).map(([key, value]) => `--env=${key}=${value}`)

  if (install.kind === 'flatpak') return ['flatpak', 'run', ...passed, install.ref]
  return install.kind === 'scripts' ? [] : [install.ref]
}

/** The remote every emulator RomMix installs comes from. */
const FLATHUB_REMOTE = 'flathub'
const FLATHUB_REPO = 'https://dl.flathub.org/repo/flathub.flatpakrepo'

/**
 * Is Flathub configured for the user installation RomMix installs into?
 *
 * Separate from "is flatpak installed", because the two fail for different
 * reasons and only one of them is obvious. Debian, Ubuntu and Arch install the
 * flatpak package with no remotes at all, and Fedora ships a Flathub that is
 * filtered until the user enables it — so a machine can answer yes to flatpak
 * and still have nowhere to install RetroDECK from.
 *
 * `--user` on the query as well as on the install: a remote added system-wide
 * is not necessarily one a user installation can resolve, and reporting on a
 * different installation than the one that will be used is worse than not
 * reporting at all.
 */
export async function flathubConfigured(): Promise<boolean> {
  const out = await run(['flatpak', 'remotes', '--user', '--columns=name'], 5000)
  return (out ?? '')
    .split('\n')
    .map((line) => line.trim())
    .includes(FLATHUB_REMOTE)
}

/**
 * Add the Flathub remote to the user installation, unless it is already there.
 *
 * `--if-not-exists` makes this a no-op on the overwhelming majority of machines,
 * which is why it is simply done rather than asked about. It is also the whole
 * fix for the most likely first-run failure RomMix has: without it, "Install
 * RetroDECK" on a stock Debian or Fedora ends in a raw flatpak error about an
 * unknown remote, on a machine whose pre-flight check has just said flatpak is
 * available.
 */
async function ensureFlathub(onLine: (line: string) => void): Promise<void> {
  if (await flathubConfigured()) return
  onLine(t('host.addingFlathub'))
  log.info('host', 'flathub is not configured for the user installation, adding it')

  const added = await run([
    'flatpak',
    'remote-add',
    '--user',
    '--if-not-exists',
    FLATHUB_REMOTE,
    FLATHUB_REPO
  ])
  if (added === null) {
    throw new Error(t('host.flathubFailed', { remote: FLATHUB_REMOTE, repo: FLATHUB_REPO }))
  }
  log.info('host', 'flathub remote added', { remote: FLATHUB_REMOTE })
}

/**
 * Install a flatpak from Flathub, reporting progress lines as they arrive.
 *
 * `--user` keeps it out of the system installation, which would need a polkit
 * prompt RomMix cannot answer from a fullscreen UI — and is why the remote has
 * to be present in that same user installation first. See `ensureFlathub`.
 */
export async function installFlatpak(appId: string, onLine: (line: string) => void): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/.test(appId)) {
    throw new Error(t('host.suspiciousAppId', { appId }))
  }
  await ensureFlathub(onLine)

  return new Promise((resolvePromise, rejectPromise) => {
    const [cmd, ...args] = [
      'flatpak',
      'install',
      '--user',
      '--noninteractive',
      '--assumeyes',
      FLATHUB_REMOTE,
      appId
    ]

    log.info('host', 'installing a flatpak', { appId, command: [cmd, ...args].join(' ') })
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString()
      tail = (tail + text).slice(-4000)
      for (const line of text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean))
        onLine(line)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)

    child.on('error', (err) => {
      log.error('host', 'flatpak could not be run', err, { appId })
      rejectPromise(new Error(t('host.flatpakFailed', { reason: err.message })))
    })
    child.on('close', (code) => {
      if (code === 0) {
        log.info('host', 'flatpak install finished', { appId })
        resolvePromise()
        return
      }
      log.error('host', 'flatpak install failed', undefined, {
        appId,
        code,
        output: tail.slice(-1000)
      })
      rejectPromise(
        new Error(tail.trim().split('\n').slice(-3).join(' ') || `flatpak install exited ${code}`)
      )
    })
  })
}

/** Can we actually write into this directory tree? */
export async function isWritable(path: string | null): Promise<boolean> {
  if (!path) return false
  try {
    await access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Is flatpak installed at all?
 *
 * Worth asking separately from "is RetroDECK installed", because without
 * flatpak the answer to that question is always no and the reason is invisible:
 * every flatpak-packaged emulator simply reports itself missing, and the
 * pre-flight check would advise installing them one at a time through a command
 * that is not there either.
 */
export async function flatpakAvailable(): Promise<boolean> {
  return (await run(['flatpak', '--version'], 5000)) != null
}
