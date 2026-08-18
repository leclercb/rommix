import { EventEmitter } from 'node:events'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, normalize, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { chooseLaunchFile } from '@shared/gamefiles'
import { resolveSystem } from '@config/systems'
import type {
  DownloadItem,
  EmulatorState,
  InstalledRom,
  LibrarySyncResult,
  RommRom
} from '@shared/types'
import { RommClient, RommError } from './romm'
import type { Store } from './store'

/**
 * Downloads ROMs from RomM into the library, and reconciles the library with
 * what is already on disk.
 *
 * Layout is `<library root>/<es-de system>/<file>`. The system directory is
 * not cosmetic: RetroDECK infers which emulator to use by matching the
 * `roms/<system>/` path segment, so a correctly placed file needs no further
 * hints — and ES-DE scrapes the same layout. One root serves every emulator,
 * because each is handed an absolute path at launch.
 *
 * Transfers run one at a time. Parallel ROM downloads mostly just make each
 * one slower and thrash the disk on a handheld, and a serial queue keeps the
 * progress UI honest.
 */

/** Reject absolute paths and `..` segments from zip entries (zip-slip). */
function safeJoin(root: string, entryName: string): string | null {
  const cleaned = entryName.replace(/\\/g, '/').replace(/^\/+/, '')
  const target = resolve(root, normalize(cleaned))
  if (target !== root && !target.startsWith(root + sep)) return null
  return target
}

/** Does this file start with the ZIP local-file-header magic? */
async function isZip(path: string): Promise<boolean> {
  const { open } = await import('node:fs/promises')
  const handle = await open(path, 'r')
  try {
    const buf = Buffer.alloc(4)
    const { bytesRead } = await handle.read(buf, 0, 4, 0)
    return bytesRead === 4 && buf.toString('latin1') === 'PK\x03\x04'
  } finally {
    await handle.close()
  }
}

/** Extract a zip archive into `destDir`, creating directories as needed. */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const root = resolve(destDir)
  await mkdir(root, { recursive: true })

  await new Promise<void>((resolvePromise, rejectPromise) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err || !zipfile) return rejectPromise(err ?? new Error('Cannot open archive'))

      zipfile.on('error', rejectPromise)
      zipfile.on('end', () => resolvePromise())

      zipfile.readEntry()
      zipfile.on('entry', (entry) => {
        const target = safeJoin(root, entry.fileName)
        if (!target) {
          // Refuse to write outside the destination and keep going.
          zipfile.readEntry()
          return
        }

        if (entry.fileName.endsWith('/')) {
          mkdir(target, { recursive: true })
            .then(() => zipfile.readEntry())
            .catch(rejectPromise)
          return
        }

        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return rejectPromise(streamErr ?? new Error('Bad zip entry'))
          mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(target)))
            .then(() => zipfile.readEntry())
            .catch(rejectPromise)
        })
      })
    })
  })
}

/** Recursive directory size, used to record what an extracted game occupies. */
async function directorySize(path: string): Promise<number> {
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
async function pickLaunchFile(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  const subdirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)

  if (files.length === 0 && subdirs.length === 1) return pickLaunchFile(join(dir, subdirs[0]))

  const sized = await Promise.all(
    files.map(async (name) => ({ name, sizeBytes: (await stat(join(dir, name))).size }))
  )
  const chosen = chooseLaunchFile(sized)
  return chosen ? join(dir, chosen) : null
}

interface InstallResult {
  path: string
  launchPath: string
  sizeBytes: number
  isDirectory: boolean
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
async function unpack(
  rom: RommRom,
  archivePath: string,
  systemDir: string,
  targetPath: string,
  asDirectory: boolean
): Promise<InstallResult> {
  const dirTarget = asDirectory ? targetPath : join(systemDir, rom.fs_name_no_ext)
  // A lone ROM is staged aside first, because where it ends up depends on what
  // the archive turns out to contain.
  const staging = asDirectory ? dirTarget : join(systemDir, `.${rom.fs_name_no_ext}.rommix-tmp`)

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
    // Several files after all, so it is a real multi-file game: promote the
    // staging directory to the name the game should have.
    await rm(dirTarget, { recursive: true, force: true })
    await rename(staging, dirTarget)
  }

  return {
    path: dirTarget,
    launchPath: (await pickLaunchFile(dirTarget)) ?? dirTarget,
    sizeBytes: await directorySize(dirTarget),
    isDirectory: true
  }
}

/** The one file an archive unpacked to, or null when it held more than one. */
async function onlyFile(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  if (entries.length !== 1) return null
  const [entry] = entries
  if (entry.isDirectory()) return onlyFile(join(dir, entry.name))
  return entry.isFile() ? join(dir, entry.name) : null
}

export class DownloadManager extends EventEmitter {
  private readonly queue: DownloadItem[] = []
  private readonly controllers = new Map<number, AbortController>()
  private running = false

  constructor(
    private readonly store: Store,
    private readonly client: RommClient,
    private readonly getEmulator: (system?: string) => EmulatorState | null
  ) {
    super()
  }

  get items(): DownloadItem[] {
    return this.queue.map((item) => ({ ...item }))
  }

  /**
   * Is this entry a copy the emulator now in charge of its platform cannot see?
   *
   * Each emulator keeps its games in its own tree, so pointing a platform at a
   * different emulator does not move anything — the file stays where it was,
   * in a folder the new emulator never looks at. Continuing to show the game
   * as downloaded would leave the user with a Play button that launches an
   * emulator against a ROM outside its library, or nothing to press to get a
   * copy where it now belongs.
   *
   * A *missing* emulator is not a changed one: with nothing installed for the
   * platform there is no new answer, so the entry is left alone rather than
   * making an unplugged Steam Deck look like it lost its library.
   */
  isStale(entry: InstalledRom): boolean {
    const current = this.getEmulator(entry.system)
    if (!current) return false
    return current.id !== entry.emulatorId
  }

  /** The index entry for a ROM, unless it belongs to a different emulator. */
  installedNow(romId: number): InstalledRom | undefined {
    const entry = this.store.getInstalled(romId)
    return entry && !this.isStale(entry) ? entry : undefined
  }

  /** Everything on disk for the emulators currently in charge. */
  get installed(): InstalledRom[] {
    return this.store.installed.filter((entry) => !this.isStale(entry))
  }

  /**
   * Work out where a ROM should land. Returns the target path plus whether it
   * needs to be unpacked into a directory of its own.
   */
  private plan(rom: RommRom): {
    dir: string
    path: string
    system: string
    emulatorId: string
    asDirectory: boolean
  } {
    // The system is worked out first: it decides which emulators are even
    // candidates, so asking for one before knowing the system could pick an
    // emulator that cannot run this ROM.
    const system = resolveSystem(
      rom.platform_slug,
      rom.platform_fs_slug,
      this.store.settings.systemOverrides
    )
    if (!system) {
      throw new RommError(
        `RomMix does not know which folder "${rom.platform_display_name}" maps to. ` +
          `Add a mapping for "${rom.platform_slug}" to settings.systemOverrides.`
      )
    }

    const emulator = this.getEmulator(system)
    if (!emulator) {
      throw new RommError(
        `No installed emulator can run "${system}". Install RetroDECK, which covers most ` +
          `systems, or an emulator for this one.`
      )
    }
    // The emulator's own ROM folder, so a game stays visible to that emulator
    // when it is started outside RomMix. Every descriptor declares one, so this
    // is only null when the emulator was never probed.
    const root = emulator.paths.roms
    if (!root) {
      throw new RommError(`RomMix does not know where ${emulator.name} keeps its games`)
    }

    // Multi-file games (CD images with cue+bin, multi-disc sets) arrive as a
    // zip and are unpacked into their own directory.
    const asDirectory = rom.has_multiple_files
    const dir = join(root, system)
    const path = asDirectory ? join(dir, rom.fs_name_no_ext) : join(dir, rom.fs_name)
    return { dir, path, system, emulatorId: emulator.id, asDirectory }
  }

  enqueue(rom: RommRom): DownloadItem {
    const existing = this.queue.find(
      (item) => item.romId === rom.id && (item.state === 'queued' || item.state === 'downloading')
    )
    if (existing) return { ...existing }

    const { path, system } = this.plan(rom)
    const item: DownloadItem = {
      romId: rom.id,
      name: rom.name ?? rom.fs_name,
      coverPath: rom.path_cover_small ?? rom.path_cover_large,
      system,
      platformName: rom.platform_display_name,
      state: 'queued',
      receivedBytes: 0,
      totalBytes: rom.fs_size_bytes,
      error: null,
      targetPath: path
    }

    // Replace any finished entry for the same ROM so the list stays readable.
    const stale = this.queue.findIndex((i) => i.romId === rom.id)
    if (stale >= 0) this.queue.splice(stale, 1)

    this.queue.push(item)
    this.emitUpdate()
    void this.pump(rom)
    return { ...item }
  }

  cancel(romId: number): void {
    this.controllers.get(romId)?.abort()
    const item = this.queue.find((i) => i.romId === romId)
    if (item && (item.state === 'queued' || item.state === 'downloading')) {
      item.state = 'cancelled'
      this.emitUpdate()
    }
  }

  clearFinished(): void {
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      const state = this.queue[i].state
      if (state === 'done' || state === 'error' || state === 'cancelled') this.queue.splice(i, 1)
    }
    this.emitUpdate()
  }

  private emitUpdate(): void {
    this.emit('update', this.items)
  }

  /** Drain the queue one item at a time. */
  private async pump(seed: RommRom): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const item = this.queue.find((i) => i.state === 'queued')
        if (!item) break
        // The seeded ROM is already loaded; anything else needs a fresh fetch
        // so we have the current file list.
        const rom = item.romId === seed.id ? seed : await this.client.rom(item.romId)
        await this.runOne(item, rom)
      }
    } finally {
      this.running = false
    }
  }

  private async runOne(item: DownloadItem, rom: RommRom): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(rom.id, controller)
    item.state = 'downloading'
    this.emitUpdate()

    const { dir, path, system, emulatorId, asDirectory } = this.plan(rom)
    // Multi-file games download to a temporary archive next to their target.
    const downloadTo = asDirectory ? `${path}.zip` : path

    try {
      await mkdir(dir, { recursive: true })
      await this.client.downloadRom(
        rom,
        downloadTo,
        (progress) => {
          item.receivedBytes = progress.received
          if (progress.total) item.totalBytes = progress.total
          this.emitUpdate()
        },
        controller.signal
      )

      let installed: InstallResult
      if (asDirectory || (await isZip(downloadTo))) {
        item.state = 'extracting'
        this.emitUpdate()
        installed = await unpack(rom, downloadTo, dir, path, asDirectory)
      } else {
        installed = {
          path,
          launchPath: path,
          sizeBytes: (await stat(path)).size,
          isDirectory: false
        }
      }

      await this.recordInstalled(rom, system, emulatorId, installed)
      item.targetPath = installed.path

      item.state = 'done'
      item.receivedBytes = item.totalBytes
      this.emitUpdate()
    } catch (cause) {
      const aborted = controller.signal.aborted
      item.state = aborted ? 'cancelled' : 'error'
      item.error = aborted ? null : (cause as Error).message
      await rm(downloadTo, { force: true }).catch(() => undefined)
      this.emitUpdate()
    } finally {
      this.controllers.delete(rom.id)
    }
  }

  private async recordInstalled(
    rom: RommRom,
    system: string,
    emulatorId: string,
    installed: InstallResult
  ): Promise<InstalledRom> {
    const entry: InstalledRom = {
      romId: rom.id,
      emulatorId,
      path: installed.path,
      launchPath: installed.launchPath,
      name: rom.name ?? rom.fs_name,
      coverPath: rom.path_cover_small ?? rom.path_cover_large,
      files: installed.isDirectory
        ? (await readdir(installed.path).catch(() => [])).sort()
        : [basename(installed.path)],
      system,
      platformName: rom.platform_display_name,
      fileName: basename(installed.path),
      sizeBytes: installed.sizeBytes,
      installedAt: new Date().toISOString(),
      isDirectory: installed.isDirectory
    }
    this.store.addInstalled(entry)
    this.emit('installed', entry)
    return entry
  }

  /**
   * Adopt ROMs that are already on disk but missing from the index.
   *
   * The index records what RomMix downloaded; it is not the truth about
   * the disk, and the two drift apart easily — the index moved with RomMix's
   * folder while the ROMs stayed in the emulator's library, a backup was
   * restored, or the files were put there by something else. Making the user
   * download a game they already have because a JSON file went missing is the
   * wrong answer, so each ROM the UI asks about is checked against the place
   * it would have been installed to.
   *
   * Two stats per unknown ROM, and only for what is actually on screen.
   */
  async adopt(roms: readonly RommRom[]): Promise<InstalledRom[]> {
    const adopted: InstalledRom[] = []
    for (const rom of roms) {
      // A stale entry — the platform now runs on a different emulator — is
      // treated as unknown, so the new emulator's own library is searched. If
      // a copy is there it is adopted; if not, the old entry stays put and
      // comes back the moment the platform is pointed back.
      const known = this.store.getInstalled(rom.id)
      if (known && !this.isStale(known)) continue

      let target: { dir: string; system: string; emulatorId: string }
      try {
        target = this.plan(rom)
      } catch {
        // Unmapped platform, or no emulator can run it: nothing to look for.
        continue
      }

      // The two shapes an install can take, matching what `unpack` produces.
      const asFile = join(target.dir, rom.fs_name)
      const asDirectory = join(target.dir, rom.fs_name_no_ext)

      const fileInfo = await stat(asFile).catch(() => null)
      if (fileInfo?.isFile()) {
        adopted.push(
          await this.recordInstalled(rom, target.system, target.emulatorId, {
            path: asFile,
            launchPath: asFile,
            sizeBytes: fileInfo.size,
            isDirectory: false
          })
        )
        continue
      }

      const dirInfo = await stat(asDirectory).catch(() => null)
      if (dirInfo?.isDirectory()) {
        adopted.push(
          await this.recordInstalled(rom, target.system, target.emulatorId, {
            path: asDirectory,
            launchPath: (await pickLaunchFile(asDirectory)) ?? asDirectory,
            sizeBytes: await directorySize(asDirectory).catch(() => 0),
            isDirectory: true
          })
        )
      }
    }

    // Announced as a group: a library page can adopt dozens at once, and one
    // notification per game would bury the screen.
    if (adopted.length > 0) this.emit('adopted', adopted)
    return adopted
  }

  /**
   * Reconcile the whole index against the disk, on demand.
   *
   * `adopt` only ever looks at the ROMs a screen happens to have loaded, which
   * is right for browsing — two stats per game, and only for what is visible —
   * but it means a library page never visited stays wrong indefinitely. Games
   * deleted with a file manager keep a Play button, and ROMs copied in by hand
   * are still offered as downloads.
   *
   * This walks the entire server library once, so the answer afterwards is
   * complete rather than "complete for what you happened to scroll past".
   * Paged rather than fetched whole: a large library is tens of thousands of
   * ROMs, and this way the progress callback has something to report.
   */
  async sync(onProgress?: (checked: number, total: number) => void): Promise<LibrarySyncResult> {
    // Drop what is gone first, so a game deleted from disk and then re-copied
    // elsewhere is re-adopted in the same pass rather than the next one.
    const removed = this.store.pruneInstalled()

    const PAGE = 200
    let checked = 0
    let adopted = 0
    let total = 0

    do {
      const page = await this.client.roms({ limit: PAGE, offset: checked })
      total = page.total
      if (page.items.length === 0) break
      adopted += (await this.adopt(page.items)).length
      checked += page.items.length
      onProgress?.(checked, total)
    } while (checked < total)

    if (removed > 0) this.emit('installed', null)
    return { checked, removed, adopted }
  }

  /**
   * The file to hand an emulator for an installed ROM.
   *
   * An entry whose recorded file has since gone is resolved from disk instead,
   * so a game whose directory was reorganised does not have to be downloaded
   * again to become playable.
   */
  async launchTarget(entry: InstalledRom): Promise<string> {
    if (existsSync(entry.launchPath)) return entry.launchPath
    if (!entry.isDirectory) return entry.path
    return (await pickLaunchFile(entry.path)) ?? entry.path
  }

  /** Delete a ROM from disk and drop it from the index. */
  async uninstall(romId: number): Promise<void> {
    const entry = this.store.getInstalled(romId)
    if (!entry) return
    await rm(entry.path, { recursive: true, force: true })
    this.store.removeInstalled(romId)
  }
}
