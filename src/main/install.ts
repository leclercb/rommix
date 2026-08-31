import { readdir, rename, rm, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { chooseLaunchFile } from '@shared/gamefiles'
import type { RommRom } from '@shared/types'
import { safeJoin } from './safepath.ts'
import { extractZip } from './zip.ts'
import { t } from './i18n.ts'

/**
 * What a downloaded game turns into on disk.
 *
 * The archive RomM sends is not the layout an emulator wants, and the gap
 * between the two is everything in this file: a lone ROM zipped for transport
 * has to come back out of its folder, a genuine multi-file game has to keep
 * one, and an emulator that does not look inside directories needs the files
 * loose. Kept apart from the queue that runs the transfers, since none of it
 * has anything to do with when or in what order a download happens.
 */

/** Recursive directory size, used to record what an extracted game occupies. */
export async function directorySize(path: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    total += entry.isDirectory() ? await directorySize(child) : (await stat(child)).size
  }
  return total
}

/**
 * Walk an extracted game and nominate the file to launch.
 *
 * The choice itself is `chooseLaunchFile`; this only gathers what it needs off
 * disk, and descends through the single wrapper folder that archives so often
 * add.
 */
export async function pickLaunchFile(dir: string, system: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  const subdirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)

  if (files.length === 0 && subdirs.length === 1) {
    return pickLaunchFile(join(dir, subdirs[0]), system)
  }

  const sized = await Promise.all(
    files.map(async (name) => ({ name, sizeBytes: (await stat(join(dir, name))).size }))
  )
  const chosen = chooseLaunchFile(sized, system)
  return chosen ? join(dir, chosen) : null
}

export interface InstallResult {
  path: string
  launchPath: string
  sizeBytes: number
  isDirectory: boolean
  /**
   * Every file the install consists of, beyond the one `path` names.
   *
   * Loose files in the system folder, where uninstalling has to remove the
   * whole game rather than only the file that happens to launch it — and the
   * contents of a game given a directory, relative to it. Absent for a game
   * that is the single file `path` names.
   */
  files?: string[]
}

/**
 * Every file below a directory, however deep, as absolute paths.
 *
 * Real files only — a symlink is passed over. Everything this is asked about
 * has just come out of an archive, so there are none, and following one would
 * mean moving whatever it points at rather than the link.
 *
 * Not to be confused with `zip.ts`'s walk, which answers for the same tree with
 * names relative to it and does follow a link to a directory. See the comment
 * there for why.
 */
export async function filePathsUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const found: string[] = []
  for (const entry of entries) {
    const child = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await filePathsUnder(child)))
    else if (entry.isFile()) found.push(child)
  }
  return found
}

/**
 * What a game consists of, relative to the directory holding it.
 *
 * The whole tree rather than the top of it: a disc set unpacked into folders
 * is its tracks, and a listing that stopped at the first level recorded the
 * folder names and showed them as if each were a file. Sorted, so the record
 * does not depend on the order the filesystem hands entries back.
 */
export async function installedFiles(dir: string): Promise<string[]> {
  const found = await filePathsUnder(dir)
  return found.map((path) => relative(dir, path)).sort()
}

/**
 * Unpack a downloaded archive and work out what actually landed on disk.
 *
 * RomM zips lone ROMs for transport as well as genuine multi-file games, and
 * the two must not be installed the same way. A single ROM unpacked into a
 * directory of its own leaves ES-DE showing a folder instead of the game and
 * the emulator with a directory it cannot open, so it is lifted into the
 * system folder and the staging directory thrown away.
 */
export async function unpack(
  rom: RommRom,
  archivePath: string,
  systemDir: string,
  system: string,
  targetPath: string,
  asDirectory: boolean,
  flat = false
): Promise<InstallResult> {
  // `targetPath` came through `Library.plan`, which has already refused a name
  // that leaves the system folder; the staging name is derived here and gets
  // the same check.
  const staged = safeJoin(systemDir, rom.fs_name_no_ext)
  if (!staged) throw new Error(t('error.unsafeName', { name: rom.fs_name }))
  const dirTarget = asDirectory ? targetPath : staged
  /**
   * A lone ROM is staged aside first, because where it ends up depends on what
   * the archive turns out to contain.
   *
   * Hidden, because for as long as it exists it is a directory sitting in a
   * folder an emulator browses: ES-DE reading the tree mid-unpack would show it
   * as a game. The dot goes on the leaf rather than the whole name, so a name
   * carrying a directory hides what RomMix made and not the folder above it.
   */
  const staging = asDirectory ? dirTarget : join(dirname(staged), `.${basename(staged)}.rommix-tmp`)

  await extractZip(archivePath, staging)
  await rm(archivePath, { force: true })

  if (!asDirectory) {
    const single = await onlyFile(staging)
    if (single) {
      const finalPath = join(systemDir, basename(single))
      await rm(finalPath, { force: true })
      await rename(single, finalPath)
      await rm(staging, { recursive: true, force: true })
      return {
        path: finalPath,
        launchPath: finalPath,
        sizeBytes: (await stat(finalPath)).size,
        isDirectory: false
      }
    }
    if (flat) {
      /**
       * Several files, for an emulator that does not look inside folders.
       *
       * They go loose into the system folder, keeping only their own names —
       * the archive's directory tree is discarded, since a path is exactly
       * what this emulator cannot follow. Same-named files from two branches
       * collapse onto one another, which is the same thing unpacking an
       * archive over itself has always done.
       */
      const moved: string[] = []
      for (const file of await filePathsUnder(staging)) {
        const target = join(systemDir, basename(file))
        await rm(target, { force: true })
        await rename(file, target)
        moved.push(basename(target))
      }
      await rm(staging, { recursive: true, force: true })

      const sized = await Promise.all(
        moved.map(async (name) => ({ name, sizeBytes: (await stat(join(systemDir, name))).size }))
      )
      const chosen = chooseLaunchFile(sized, system) ?? moved[0]
      const launchPath = join(systemDir, chosen)
      return {
        path: launchPath,
        launchPath,
        sizeBytes: sized.reduce((sum, file) => sum + file.sizeBytes, 0),
        isDirectory: false,
        files: moved
      }
    }

    // Several files after all, so it is a real multi-file game: promote the
    // staging directory to the name the game should have.
    await rm(dirTarget, { recursive: true, force: true })
    await rename(staging, dirTarget)
  }

  return {
    path: dirTarget,
    launchPath: (await pickLaunchFile(dirTarget, system)) ?? dirTarget,
    sizeBytes: await directorySize(dirTarget),
    isDirectory: true,
    files: await installedFiles(dirTarget)
  }
}

/**
 * Index a system folder, by exact name and by name with the extension dropped.
 *
 * Only files have an extension dropped. A directory's name is the whole name —
 * `Final Fantasy VII (Disc 1.1)` is not a folder called `Final Fantasy VII
 * (Disc 1` — and games really are punctuated like that.
 *
 * Sorted before indexing so the answer does not depend on the order the
 * filesystem happens to hand entries back, and a directory beats a file of the
 * same name: a multi-file game and a stray loose file can share a stem, and the
 * directory is the one that holds the game.
 */
export async function listDir(dir: string): Promise<DirListing> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const byStem = new Map<string, Dirent>()
  const byName = new Map<string, Dirent>()
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() && !entry.isDirectory()) continue
    byName.set(entry.name.toLowerCase(), entry)

    const stem = entry.isDirectory()
      ? entry.name.toLowerCase()
      : entry.name.slice(0, entry.name.length - extname(entry.name).length).toLowerCase()
    const held = byStem.get(stem)
    if (!held || (entry.isDirectory() && !held.isDirectory())) byStem.set(stem, entry)
  }
  return { byStem, byName }
}

/**
 * A system folder indexed two ways: by exact name, for the files a multi-file
 * game is made of, and by stem, for the single file whose extension changed.
 */
export interface DirListing {
  byStem: Map<string, Dirent>
  byName: Map<string, Dirent>
}

/**
 * What a single-file download should be called on disk.
 *
 * Normally `fs_name`, which is the file's own name on the server. But a ROM
 * that RomM holds as a *folder* containing one file reports the folder's name
 * there, extension and all missing — a Switch title arrives as `F-ZERO 99`
 * rather than `F-ZERO 99.nsp`. The bytes are right and RomMix can still launch
 * it, since an emulator handed a path reads the file's header; but the
 * emulator's own library never finds it, because scanners match on extension.
 * A game that is downloaded, playable from RomMix, and absent from the
 * emulator's game list is the most confusing state RomMix can leave behind.
 *
 * The name of the file inside the folder is the honest answer, and RomM sends
 * it on every ROM RomMix asks for: the detailed endpoint carries `files`
 * always, and the paged listing is only ever requested with `with_files=true`.
 * A game whose folder holds more than one file is a multi-file game and takes
 * the directory path instead, so `fs_name` is the answer there.
 */
export function installName(rom: RommRom): string {
  if (rom.fs_extension) return rom.fs_name
  return rom.files.length === 1 ? rom.files[0].file_name : rom.fs_name
}

/** The one file an archive unpacked to, or null when it held more than one. */
export async function onlyFile(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  if (entries.length !== 1) return null
  const [entry] = entries
  if (entry.isDirectory()) return onlyFile(join(dir, entry.name))
  return entry.isFile() ? join(dir, entry.name) : null
}
