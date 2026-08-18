import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where RomMix keeps everything it owns.
 *
 * One folder holds the lot — config, credentials, the installed-ROM index and
 * any emulator RomMix downloaded — so the app can be moved or backed up by
 * moving a single directory, and so nothing is scattered through hidden
 * per-app folders.
 *
 * Relocating it is circular: the setting saying where the root is would live
 * inside the root. It is therefore resolved from, in order,
 *
 *   1. the ROMMIX_HOME environment variable
 *   2. a one-line pointer file in the platform's default config location
 *   3. ~/RomMix
 *
 * The pointer is deliberately tiny and outside the root, so a root on a
 * removable disk that is not mounted degrades to "cannot find it" rather than
 * to a silently different, empty configuration.
 */

// Lowercase: it sits beside the user's own directories in $HOME, where the
// convention for an application's folder is lowercase.
const DEFAULT_DIR_NAME = 'rommix'

/** Real home directory, even from inside a sandbox where HOME is remapped. */
function realHome(): string {
  return process.env.HOME ?? homedir()
}

/**
 * The pointer file's own location, which cannot itself be configurable.
 * Electron's userData is not used: this has to be readable before `app.ready`,
 * and before the userData path has been redirected at the root.
 */
function pointerPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(realHome(), '.config')
  return join(base, 'rommix', 'root')
}

export function defaultRoot(): string {
  return join(realHome(), DEFAULT_DIR_NAME)
}

/** Resolve the root without creating anything. */
export function resolveRoot(): string {
  const fromEnv = process.env.ROMMIX_HOME?.trim()
  if (fromEnv) return fromEnv

  try {
    const pointer = readFileSync(pointerPath(), 'utf8').trim()
    if (pointer) return pointer
  } catch {
    // No pointer yet: first run, or it was removed to get back to the default.
  }
  return defaultRoot()
}

/** Sub-directories of the root, so the layout is stated in exactly one place. */
export function rootPaths(root = resolveRoot()): {
  root: string
  config: string
  emulators: string
  roms: string
} {
  return {
    root,
    config: join(root, 'config'),
    emulators: join(root, 'emulators'),
    roms: join(root, 'roms')
  }
}

/** Create the root's directories if they are not there yet. */
export function ensureRoot(root = resolveRoot()): string {
  const paths = rootPaths(root)
  mkdirSync(paths.config, { recursive: true })
  mkdirSync(paths.emulators, { recursive: true })
  return root
}

/**
 * Point RomMix at a new root, bringing the current configuration along.
 *
 * The config is **copied**, never moved: if anything here fails, or the user
 * changes their mind, the old root is still a complete working installation.
 * Emulator binaries and ROMs are left where they are — those are large, and
 * silently moving tens of gigabytes because a text field changed is not a
 * decision this function should be making. Takes effect on restart, because
 * Electron's userData path is fixed before the app starts.
 */
export function relocateRoot(next: string): void {
  const current = rootPaths()
  const target = rootPaths(next)

  mkdirSync(target.config, { recursive: true })
  mkdirSync(target.emulators, { recursive: true })

  if (existsSync(current.config) && current.config !== target.config) {
    cpSync(current.config, target.config, { recursive: true, errorOnExist: false, force: true })
  }

  const pointer = pointerPath()
  mkdirSync(join(pointer, '..'), { recursive: true })
  // Written atomically: a truncated pointer would send the next launch to a
  // nonexistent root and look like every setting had been lost.
  const tmp = `${pointer}.tmp`
  writeFileSync(tmp, `${next}\n`, 'utf8')
  renameSync(tmp, pointer)
}
