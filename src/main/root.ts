import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { realHome, xdgConfigHome } from './xdg.ts'

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
 *   3. ~/rommix
 *
 * The pointer is deliberately tiny and outside the root, so a root on a
 * removable disk that is not mounted degrades to "cannot find it" rather than
 * to a silently different, empty configuration.
 */

// Lowercase: it sits beside the user's own directories in $HOME, where the
// convention for an application's folder is lowercase.
const DEFAULT_DIR_NAME = 'rommix'

/**
 * The pointer file's own location, which cannot itself be configurable.
 * Electron's userData is not used: this has to be readable before `app.ready`,
 * and before the userData path has been redirected at the root.
 */
function pointerPath(): string {
  return join(xdgConfigHome(), 'rommix', 'root')
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
  offline: string
  saves: string
} {
  return {
    root,
    config: join(root, 'config'),
    emulators: join(root, 'emulators'),
    roms: join(root, 'roms'),
    offline: join(root, 'offline'),
    saves: join(root, 'saves')
  }
}

/** Create the root's directories if they are not there yet. */
export function ensureRoot(root = resolveRoot()): string {
  const paths = rootPaths(root)
  mkdirSync(paths.config, { recursive: true })
  mkdirSync(paths.emulators, { recursive: true })
  // Created up front, not on first download: this is the folder emulators with
  // no library of their own are pointed at, and the user has to be able to add
  // it to Eden's Game Directories before anything has been downloaded into it.
  mkdirSync(paths.roms, { recursive: true })
  // What RomM said about each game that was downloaded, so the games on this
  // disk can still be looked at and started with nothing to ask. See
  // `OfflineCache`.
  mkdirSync(paths.offline, { recursive: true })
  // Created up front like the ROM folder, and for the same reason: the settings
  // screen tells the user their displaced saves are kept here, and a folder
  // that only appears once something has gone wrong is one nobody finds at the
  // moment they need it. See `keepBackup`.
  mkdirSync(paths.saves, { recursive: true })
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
 *
 * The saves displaced by a pull come along, on the other side of that trade:
 * they are the one thing here that cannot be fetched again, and they are small.
 *
 * What was written down for playing offline comes along with the config rather
 * than staying with the ROMs, because it is only useful beside the configuration
 * that names the games: left behind, the new root would have an index of
 * installed games and nothing to say about any of them away from the server, and
 * nothing would ever fill it again — `runMigrations` reads the record of what it
 * has already done from the config that was just copied.
 */
export function relocateRoot(next: string): void {
  const current = rootPaths()
  const target = rootPaths(next)

  // The same layout `ensureRoot` creates, so the new root is complete before
  // the next launch rather than half-built until something writes to it.
  mkdirSync(target.config, { recursive: true })
  mkdirSync(target.emulators, { recursive: true })
  mkdirSync(target.roms, { recursive: true })
  mkdirSync(target.offline, { recursive: true })
  mkdirSync(target.saves, { recursive: true })

  for (const [from, to] of [
    [current.config, target.config],
    [current.offline, target.offline],
    [current.saves, target.saves]
  ]) {
    if (existsSync(from) && from !== to) {
      cpSync(from, to, { recursive: true, errorOnExist: false, force: true })
    }
  }

  const pointer = pointerPath()
  mkdirSync(join(pointer, '..'), { recursive: true })
  // Written atomically: a truncated pointer would send the next launch to a
  // nonexistent root and look like every setting had been lost.
  const tmp = `${pointer}.tmp`
  writeFileSync(tmp, `${next}\n`, 'utf8')
  renameSync(tmp, pointer)
}
