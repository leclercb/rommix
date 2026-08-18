import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, constants, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ResolvedInstall } from '@shared/emulators'

/**
 * Talking to the machine Rommix is installed on, from either side of a flatpak
 * sandbox. Nothing here knows about any particular emulator — that is
 * `emulators.ts`.
 */

const execFileAsync = promisify(execFile)

/**
 * True when Rommix is itself running inside a flatpak sandbox. Flatpak always
 * writes /.flatpak-info into the sandbox, and sets FLATPAK_ID.
 */
export function inFlatpak(): boolean {
  return Boolean(process.env.FLATPAK_ID) || existsSync('/.flatpak-info')
}

/**
 * Wrap a command so it runs on the host rather than inside our sandbox.
 *
 * `flatpak run` cannot be nested, so a sandboxed Rommix has to hop out via
 * flatpak-spawn (which needs --talk-name=org.freedesktop.Flatpak in the
 * manifest). Outside a sandbox the command is returned untouched.
 */
export function hostCommand(argv: string[]): string[] {
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
 * sandbox it points at Rommix's own config directory, so using it would look
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
  const matchers = patterns.map(
    (pattern) =>
      new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`, 'i')
  )

  for (const dir of appImageDirs()) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    const hit = entries.find((entry) => matchers.some((matcher) => matcher.test(entry)))
    if (hit) return join(dir, hit)
  }
  return null
}

/**
 * How to actually execute an AppImage.
 *
 * On NixOS an AppImage cannot run itself: its payload is dynamically linked
 * against a generic-linux loader that does not exist there, exactly like the
 * Electron binary npm ships. `appimage-run` unpacks it into an FHS environment
 * instead. Where it is absent the AppImage is run directly, which is right
 * everywhere else and on a NixOS with binfmt registration.
 */
export async function appImageWrapper(): Promise<readonly string[] | undefined> {
  return (await binaryPath(['appimage-run'])) ? ['appimage-run'] : undefined
}

/** argv prefix that starts a resolved install, from inside or outside a sandbox. */
export function execPrefix(install: ResolvedInstall): string[] {
  const argv =
    install.kind === 'flatpak' ? ['flatpak', 'run', install.ref] : [...(install.wrapper ?? []), install.ref]
  return hostCommand(argv)
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
