import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, constants, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ResolvedInstall } from '@shared/emulators'

/**
 * Talking to the machine RomMix is installed on, from either side of a flatpak
 * sandbox. Nothing here knows about any particular emulator — that is
 * `emulators.ts`.
 */

const execFileAsync = promisify(execFile)

/**
 * True when RomMix is itself running inside a flatpak sandbox. Flatpak always
 * writes /.flatpak-info into the sandbox, and sets FLATPAK_ID.
 */
export function inFlatpak(): boolean {
  return Boolean(process.env.FLATPAK_ID) || existsSync('/.flatpak-info')
}

/**
 * Wrap a command so it runs on the host rather than inside our sandbox.
 *
 * `flatpak run` cannot be nested, so a sandboxed RomMix has to hop out via
 * flatpak-spawn (which needs --talk-name=org.freedesktop.Flatpak in the
 * manifest). Outside a sandbox the command is returned untouched.
 */
function hostCommand(argv: string[]): string[] {
  return inFlatpak() ? ['flatpak-spawn', '--host', ...argv] : argv
}

/** Real home directory, even from inside a sandbox where HOME is remapped. */
export function realHome(): string {
  // Inside a flatpak, HOME points at the sandboxed home only when the app has
  // no home access; with --filesystem=home it is the actual user home.
  return process.env.HOME ?? homedir()
}

/**
 * XDG config and data roots on the *host*.
 *
 * XDG_CONFIG_HOME from the environment is deliberately ignored: inside our
 * sandbox it points at RomMix's own config directory, so using it would look
 * for another application's settings in entirely the wrong place.
 */
export function xdgConfigHome(): string {
  return join(realHome(), '.config')
}

export function xdgDataHome(): string {
  return join(realHome(), '.local', 'share')
}

async function runHost(argv: string[], timeoutMs = 8000): Promise<string | null> {
  const [cmd, ...args] = hostCommand(argv)
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs })
    return stdout
  } catch {
    return null
  }
}

/** Is this flatpak application installed on the host? */
export async function flatpakInstalled(appId: string): Promise<boolean> {
  const out = await runHost(['flatpak', 'info', '--show-location', appId])
  return out != null && out.trim().length > 0
}

/**
 * Absolute path of the first of these executables found on the host's PATH.
 *
 * `command -v` is a shell builtin, so this has to go through `sh -c`; names are
 * screened first so a hand-written emulator descriptor cannot smuggle shell
 * metacharacters into that string.
 */
export async function binaryPath(names: readonly string[]): Promise<string | null> {
  for (const name of names) {
    if (!/^[\w.+-]+$/.test(name)) continue
    const out = await runHost(['sh', '-c', `command -v ${name}`], 5000)
    const path = out?.trim().split('\n')[0]
    if (path) return path
  }
  return null
}

/**
 * Directories an AppImage is plausibly sitting in. AppImages are loose files
 * rather than installs, so there is nothing to query — they have to be looked
 * for where people put them.
 */
function appImageDirs(): string[] {
  const home = realHome()
  return [
    join(home, 'Applications'),
    join(home, '.local', 'bin'),
    join(home, '.local', 'share', 'applications'),
    join(home, 'Downloads'),
    join(home, 'bin')
  ]
}

/**
 * First file matching one of these case-insensitive filename globs.
 *
 * Only `*` is supported, which is all the patterns need, and the rest of the
 * pattern is escaped so a descriptor cannot inject regex of its own.
 */
export async function findAppImage(patterns: readonly string[]): Promise<string | null> {
  for (const dir of appImageDirs()) {
    const hit = await findMatchingFile(dir, patterns)
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
 * argv prefix that starts a resolved install, from inside or outside a sandbox.
 *
 * An AppImage is executed directly rather than through a helper. RomMix used
 * to prefix `appimage-run` on hosts that had it, which is actively wrong: that
 * helper unpacks a squashfs payload, and an AppImage built with uruntime — as
 * Eden's is — carries DwarFS instead, so a perfectly good image fails to
 * start. The image's own runtime handles either format, so the right thing is
 * to get out of its way and let the OS resolve the rest.
 */
export function execPrefix(
  install: ResolvedInstall,
  env: Readonly<Record<string, string>> = {}
): string[] {
  const argv = install.kind === 'flatpak' ? ['flatpak', 'run', install.ref] : [install.ref]
  if (!inFlatpak()) return argv

  // flatpak-spawn starts a *fresh* process on the host and does not carry our
  // environment across, so anything the emulator needs has to be passed
  // explicitly. Outside the sandbox the spawn options handle it instead.
  const passed = Object.entries(env).map(([key, value]) => `--env=${key}=${value}`)
  return ['flatpak-spawn', '--host', ...passed, ...argv]
}

/**
 * Install a flatpak from Flathub, reporting progress lines as they arrive.
 *
 * Runs on the host for the same reason emulators do: a nested `flatpak
 * install` inside our sandbox would install into the sandbox. `--user` keeps
 * it out of the system installation, which would need a polkit prompt RomMix
 * cannot answer from a fullscreen UI.
 */
export function installFlatpak(
  appId: string,
  onLine: (line: string) => void
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    if (!/^[A-Za-z0-9._-]+$/.test(appId)) {
      rejectPromise(new Error(`Refusing to install a suspicious app id: ${appId}`))
      return
    }
    const [cmd, ...args] = hostCommand([
      'flatpak',
      'install',
      '--user',
      '--noninteractive',
      '--assumeyes',
      'flathub',
      appId
    ])

    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString()
      tail = (tail + text).slice(-4000)
      for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) onLine(line)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)

    child.on('error', (err) => rejectPromise(new Error(`Could not run flatpak: ${err.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(tail.trim().split('\n').slice(-3).join(' ') || `flatpak install exited ${code}`))
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

/** Verify flatpak-spawn works, so we can warn early instead of at launch time. */
export async function canSpawnHost(): Promise<boolean> {
  if (!inFlatpak()) return true
  const out = await runHost(['flatpak', '--version'], 5000)
  return out != null
}
