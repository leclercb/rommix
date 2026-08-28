import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { chooseLaunchFile, isLaunchable, type GameFile } from '@shared/gamefiles'
import { emulatorById, emulatorsForSystem } from '@config/emulators'
import { resolveSystem } from '@config/systems'
import { SHARED_LIBRARY } from '@shared/types'
import type {
  DownloadItem,
  EmulatorState,
  InstalledRom,
  LibrarySyncResult,
  RommRom
} from '@shared/types'
import {
  directorySize,
  installName,
  listDir,
  pickLaunchFile,
  unpack,
  type DirListing,
  type InstallResult
} from './install.ts'
import { log } from './log.ts'
import { RommClient, RommError } from './romm.ts'
import { rootPaths } from './root.ts'
import { isZip } from './zip.ts'
import type { Store } from './store.ts'
import { t } from './i18n.ts'

/**
 * Downloads ROMs from RomM into the library, and reconciles the library with
 * what is already on disk.
 *
 * Layout is `<a ROM root>/<es-de system>/<file>`. The system directory is not
 * cosmetic: RetroDECK infers which emulator to use by matching the
 * `roms/<system>/` path segment, so a correctly placed file needs no further
 * hints — and ES-DE scrapes the same layout.
 *
 * Which root, though, is the user's choice — see `RomStorage`. It is either the
 * ROM folder of the emulator that runs the platform, which keeps the game
 * visible to that emulator when it is started on its own, or RomMix's own
 * shared tree, which keeps it in one place no matter which emulator is in
 * charge. Both go through `plan`, and the rest of this file does not care which
 * was chosen.
 *
 * Transfers run one at a time. Parallel ROM downloads mostly just make each
 * one slower and thrash the disk on a handheld, and a serial queue keeps the
 * progress UI honest.
 */

/**
 * How often byte progress is reported to the renderer.
 *
 * Four times a second: fast enough that a progress bar moves smoothly at any
 * transfer speed, slow enough that a 4 GB ROM costs a few hundred IPC messages
 * rather than the sixty-odd thousand one-per-chunk produced.
 */
const PROGRESS_INTERVAL_MS = 250

export class DownloadManager extends EventEmitter {
  private readonly queue: DownloadItem[] = []
  private readonly controllers = new Map<number, AbortController>()
  private running = false
  /** When the renderer was last told anything. See `throttledUpdate`. */
  private lastEmit = 0

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

  /** True when downloads go to RomMix's own shared tree. See `RomStorage`. */
  private get shared(): boolean {
    return this.store.settings.romStorage === 'rommix'
  }

  /**
   * Is this entry a copy that is no longer where RomMix would look for it?
   *
   * With per-emulator storage each emulator keeps its games in its own tree, so
   * pointing a platform at a different emulator does not move anything — the
   * file stays where it was, in a folder the new emulator never looks at.
   * Continuing to show the game as downloaded would leave the user with a Play
   * button that launches an emulator against a ROM outside its library, or
   * nothing to press to get a copy where it now belongs.
   *
   * A *missing* emulator is not a changed one: with nothing installed for the
   * platform there is no new answer, so the entry is left alone rather than
   * making an unplugged Steam Deck look like it lost its library.
   *
   * Shared storage removes the question entirely — one tree, whoever is in
   * charge — so the only thing that can be stale there is a game downloaded
   * under the *other* setting, and vice versa. Switching the setting therefore
   * hides the old copies rather than deleting them, and switching back brings
   * them straight home; `adopt` finds whichever set is in the right place now.
   */
  isStale(entry: InstalledRom): boolean {
    if (this.shared) return entry.emulatorId !== SHARED_LIBRARY
    if (entry.emulatorId === SHARED_LIBRARY) return true

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
    flat: boolean
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
        t('error.noFolderMapping', {
          platform: rom.platform_display_name,
          slug: rom.platform_slug
        })
      )
    }

    const emulator = this.getEmulator(system)

    /**
     * The tree this game belongs in, and what to record it under.
     *
     * With shared storage an emulator is welcome but not required: the folder
     * is RomMix's own, so there is somewhere to put the game whether or not
     * anything can yet play it — which is the whole point of the setting.
     * Per-emulator storage has no such answer, because the destination *is* the
     * emulator, so a missing one is a refusal rather than a fallback.
     */
    const library = ((): { root: string | null; emulatorId: string } => {
      if (this.shared) return { root: rootPaths().roms, emulatorId: SHARED_LIBRARY }
      if (emulator) return { root: emulator.paths.roms, emulatorId: emulator.id }

      // Named from the registry rather than written out, so this cannot go on
      // recommending an emulator RomMix no longer ships a descriptor for.
      const covers = emulatorsForSystem(system)
        .map((descriptor) => descriptor.name)
        .join(' or ')
      throw new RommError(
        covers
          ? t('error.noEmulatorInstallOne', { system, name: covers })
          : t('error.noEmulatorForSystem', { system })
      )
    })()

    // Every descriptor declares a ROM folder, so this is only null when the
    // emulator was found but never probed.
    if (!library.root) {
      throw new RommError(t('error.noRomFolder', { name: emulator?.name ?? 'RomMix' }))
    }

    // Multi-file games (CD images with cue+bin, multi-disc sets) arrive as a
    // zip and are unpacked into their own directory — unless the emulator
    // reads its library flat, in which case a folder is a place its game list
    // will never look and the files go loose into the system folder instead.
    // With no emulator at all there is nothing making that demand, and a
    // directory is the shape that keeps a disc set together for whichever one
    // arrives later.
    const flat = emulator ? emulatorById(emulator.id)?.flatLibrary === true : false
    const asDirectory = rom.has_multiple_files && !flat
    const dir = join(library.root, system)
    const path = asDirectory ? join(dir, rom.fs_name_no_ext) : join(dir, installName(rom))
    return { dir, path, system, emulatorId: library.emulatorId, asDirectory, flat }
  }

  enqueue(rom: RommRom): DownloadItem {
    const existing = this.queue.find(
      (item) => item.romId === rom.id && (item.state === 'queued' || item.state === 'downloading')
    )
    if (existing) {
      log.debug('download', 'already queued', { romId: rom.id, state: existing.state })
      return { ...existing }
    }

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
    log.info('download', 'queued', {
      romId: rom.id,
      name: item.name,
      system,
      platform: rom.platform_display_name,
      totalBytes: item.totalBytes,
      targetPath: path,
      queued: this.queue.filter((i) => i.state === 'queued').length
    })
    this.emitUpdate()
    void this.pump(rom)
    return { ...item }
  }

  cancel(romId: number): void {
    this.controllers.get(romId)?.abort()
    const item = this.queue.find((i) => i.romId === romId)
    if (item && (item.state === 'queued' || item.state === 'downloading')) {
      log.info('download', 'cancelled', { romId, name: item.name, was: item.state })
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
    this.lastEmit = Date.now()
    this.emit('update', this.items)
  }

  /**
   * The same, but at most a few times a second.
   *
   * Only for byte progress, which arrives once per chunk of the transfer — tens
   * of thousands of times for a large ROM. Each one copies the whole queue,
   * crosses IPC and re-renders every screen reading the download list, and the
   * bar it is driving cannot show the difference between one chunk and the next
   * anyway. A state change still goes through `emitUpdate` directly, so the
   * moment a download finishes or fails is never delayed.
   */
  private throttledUpdate(): void {
    if (Date.now() - this.lastEmit < PROGRESS_INTERVAL_MS) return
    this.emitUpdate()
  }

  /**
   * Drain the queue one item at a time.
   *
   * Every failure has to be recorded against the item that caused it. The loop
   * only ever ends when nothing is left queued, so an exception escaping here
   * would strand not just the failed download but every one behind it, still
   * showing "Waiting" with nothing left to move them.
   */
  private async pump(seed: RommRom): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const item = this.queue.find((i) => i.state === 'queued')
        if (!item) break
        try {
          // The seeded ROM is already loaded; anything else needs a fresh fetch
          // so we have the current file list.
          const rom = item.romId === seed.id ? seed : await this.client.rom(item.romId)
          await this.runOne(item, rom)
        } catch (cause) {
          // Reached when the ROM could not even be fetched from the server, so
          // `runOne` never got to record the failure against the item itself.
          log.error('download', 'could not start the queued download', cause, {
            romId: item.romId,
            name: item.name
          })
          item.state = 'error'
          item.error = (cause as Error).message
          this.emitUpdate()
        }
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

    // Planned inside the try: the emulator for this platform can have been
    // changed, or become unavailable, between queueing and starting, and that
    // belongs on this item as an error rather than thrown at the queue.
    let downloadTo: string | null = null
    const took = log.since()

    try {
      const { dir, path, system, emulatorId, asDirectory, flat } = this.plan(rom)
      // Multi-file games download to a temporary archive next to their target.
      downloadTo = asDirectory ? `${path}.zip` : path

      log.info('download', 'started', {
        romId: rom.id,
        name: item.name,
        system,
        emulator: emulatorId,
        totalBytes: item.totalBytes,
        multiFile: rom.has_multiple_files,
        asDirectory,
        flat,
        downloadTo
      })

      await mkdir(dir, { recursive: true })
      // Progress is reported per chunk and would be thousands of lines a game.
      // A tenth of the transfer is enough to see where one stalled.
      let reported = 0
      await this.client.downloadRom(
        rom,
        downloadTo,
        (progress) => {
          item.receivedBytes = progress.received
          if (progress.total) item.totalBytes = progress.total
          const share = progress.total ? Math.floor((progress.received / progress.total) * 10) : 0
          if (share > reported) {
            reported = share
            log.debug('download', `${share * 10}%`, {
              romId: rom.id,
              received: progress.received,
              total: progress.total
            })
          }
          this.throttledUpdate()
        },
        controller.signal
      )
      // The last chunk is almost never on a throttle boundary, so the final
      // byte count has to be sent explicitly — otherwise a finished transfer
      // can sit at 98% until the state change below redraws it.
      this.emitUpdate()

      let installed: InstallResult
      if (asDirectory || (await isZip(downloadTo))) {
        item.state = 'extracting'
        this.emitUpdate()
        log.info('download', 'extracting the archive', { romId: rom.id, from: downloadTo })
        installed = await unpack(rom, downloadTo, dir, system, path, asDirectory, flat)
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
      log.info('download', 'installed', {
        romId: rom.id,
        name: item.name,
        path: installed.path,
        launchPath: installed.launchPath,
        sizeBytes: installed.sizeBytes,
        isDirectory: installed.isDirectory,
        ms: took()
      })
      this.emitUpdate()
    } catch (cause) {
      const aborted = controller.signal.aborted
      item.state = aborted ? 'cancelled' : 'error'
      item.error = aborted ? null : (cause as Error).message
      const detail = { romId: rom.id, name: item.name, downloadTo, ms: took() }
      if (aborted) log.info('download', 'abandoned after cancellation', detail)
      else log.error('download', 'failed', cause, detail)
      if (downloadTo) await rm(downloadTo, { force: true }).catch(() => undefined)
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
        : (installed.files ?? [basename(installed.path)]),
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
   * Two stats per unknown ROM, and only for what is actually on screen — plus
   * at most one listing per system folder, for the ROMs whose installed name is
   * not their name on the server.
   */
  async adopt(roms: readonly RommRom[]): Promise<InstalledRom[]> {
    const adopted: InstalledRom[] = []
    // One listing per system folder, shared across the whole batch: a library
    // page is 200 ROMs and most of them land in a handful of folders.
    const listings = new Map<string, DirListing>()
    const listing = async (dir: string): Promise<DirListing> => {
      const cached = listings.get(dir)
      if (cached) return cached
      const found = await listDir(dir)
      listings.set(dir, found)
      return found
    }

    for (const rom of roms) {
      // A stale entry — the platform now runs on a different emulator — is
      // treated as unknown, so the new emulator's own library is searched. If
      // a copy is there it is adopted; if not, the old entry stays put and
      // comes back the moment the platform is pointed back.
      const known = this.store.getInstalled(rom.id)
      if (known && !this.isStale(known)) continue

      let target: { dir: string; system: string; emulatorId: string; flat: boolean }
      try {
        target = this.plan(rom)
      } catch {
        // Unmapped platform, or no emulator can run it: nothing to look for.
        continue
      }

      const record = async (path: string, isDirectory: boolean): Promise<void> => {
        adopted.push(
          await this.recordInstalled(rom, target.system, target.emulatorId, {
            path,
            launchPath: isDirectory ? ((await pickLaunchFile(path, target.system)) ?? path) : path,
            sizeBytes: isDirectory
              ? await directorySize(path).catch(() => 0)
              : ((await stat(path).catch(() => null))?.size ?? 0),
            isDirectory
          })
        )
      }

      /**
       * A game installed loose, for an emulator that reads its library flat.
       *
       * There is no one path to stat: the game is several files sharing the
       * system folder with every other game, under the names they have on the
       * server rather than anything derived from `fs_name`. Every one of them
       * has to be there before this counts as the game — a half-copied set
       * adopted as complete is a Play button that fails at load.
       */
      if (target.flat && rom.files.length > 1) {
        const present = await listing(target.dir)
        const wanted = rom.files.map((file) => file.file_name)
        const found = wanted.filter((name) => present.byName.has(name.toLowerCase()))

        if (found.length === wanted.length) {
          const sized = await Promise.all(
            found.map(async (name) => ({
              name,
              sizeBytes: (await stat(join(target.dir, name)).catch(() => null))?.size ?? 0
            }))
          )
          const launch = join(target.dir, chooseLaunchFile(sized, target.system) ?? found[0])
          adopted.push(
            await this.recordInstalled(rom, target.system, target.emulatorId, {
              path: launch,
              launchPath: launch,
              sizeBytes: sized.reduce((sum, file) => sum + file.sizeBytes, 0),
              isDirectory: false,
              files: found
            })
          )
          continue
        }
      }

      // The shapes an install can take, matching what `plan` and `unpack`
      // produce. Both names are tried for a file: `installName` is what a fresh
      // download is called, `fs_name` what one from before that rule was.
      const asFile = join(target.dir, installName(rom))
      const asNamedOnServer = join(target.dir, rom.fs_name)
      const asDirectory = join(target.dir, rom.fs_name_no_ext)

      const fileInfo = await stat(asFile).catch(() => null)
      if (fileInfo?.isFile()) {
        await record(asFile, false)
        continue
      }

      if (asNamedOnServer !== asFile) {
        const legacy = await stat(asNamedOnServer).catch(() => null)
        if (legacy?.isFile()) {
          await record(asNamedOnServer, false)
          continue
        }
      }

      const dirInfo = await stat(asDirectory).catch(() => null)
      if (dirInfo?.isDirectory()) {
        await record(asDirectory, true)
        continue
      }

      /**
       * Last resort: the same game under a different extension.
       *
       * A ROM the server holds zipped is installed unpacked, so what is on disk
       * is the name from inside the archive and never `fs_name` — which would
       * make every zipped ROM in the library invisible here, and adoption is
       * exactly what has to work for those. The same lookup covers a file the
       * user renamed by hand, which on Sega hardware is routine: a cartridge
       * dumped as `.bin` has to become `.md` before an emulator will take it.
       *
       * Matched on the name with the extension dropped, which is the part RomM
       * and the disk still agree on, and only after both exact answers have
       * failed — so a folder holding both `Game.bin` and `Game.md` as separate
       * library entries still resolves each to its own file.
       */
      const sibling = (await listing(target.dir)).byStem.get(rom.fs_name_no_ext.toLowerCase())
      if (sibling) await record(join(target.dir, sibling.name), sibling.isDirectory())
    }

    // Announced as a group: a library page can adopt dozens at once, and one
    // notification per game would bury the screen.
    if (adopted.length > 0) {
      log.info('library', 'adopted ROMs already on disk', {
        count: adopted.length,
        romIds: adopted.map((entry) => entry.romId)
      })
      this.emit('adopted', adopted)
    }
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
    log.info('library', 'checking the whole library against the disk', { removed })

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
   * again to become playable. The same for one whose recorded file is not a
   * thing this system can be handed at all: the index keeps whatever the rule
   * said on the day of the download, and a Switch game installed before the
   * playlist stopped winning has an `.m3u` written into it that Eden cannot
   * load. Choosing again from disk fixes those without a reinstall.
   */
  async launchTarget(entry: InstalledRom): Promise<string> {
    if (existsSync(entry.launchPath) && isLaunchable(entry.launchPath, entry.system)) {
      return entry.launchPath
    }
    if (entry.isDirectory) return (await pickLaunchFile(entry.path, entry.system)) ?? entry.path

    // Loose in the system folder: the game is the files the entry lists, not
    // the directory it shares with every other game on the platform.
    const dir = dirname(entry.path)
    const sized = await Promise.all(
      entry.files.map(async (name) => ({
        name,
        sizeBytes: (await stat(join(dir, name)).catch(() => null))?.size ?? 0
      }))
    )
    const chosen = chooseLaunchFile(sized, entry.system)
    return chosen ? join(dir, chosen) : entry.path
  }

  /**
   * What each of an installed game's files weighs on this disk.
   *
   * Measured on demand rather than recorded at install time: the index keeps
   * one total for the game, and the files themselves outlive it — an emulator
   * converts a disc image in place, a missing track is copied in by hand. A
   * file the index names and the disk no longer has is left out, so the game
   * screen shows nothing for it rather than nothing at all.
   */
  async localFiles(romId: number): Promise<GameFile[]> {
    const entry = this.store.getInstalled(romId)
    if (!entry) return []

    // Loose in the system folder: the entry's names are siblings of `path`,
    // not children of it.
    const dir = entry.isDirectory ? entry.path : dirname(entry.path)
    const sized = await Promise.all(
      entry.files.map(async (name) => {
        const found = await stat(join(dir, name)).catch(() => null)
        if (!found) return null
        // A directory install lists whatever sits at its top level, which for
        // a game that arrived with its own subfolders includes directories.
        const sizeBytes = found.isDirectory()
          ? await directorySize(join(dir, name)).catch(() => 0)
          : found.size
        return { name, sizeBytes }
      })
    )
    return sized.filter((file) => file !== null)
  }

  /**
   * Delete a ROM from disk and drop it from the index.
   *
   * A game installed loose — several files in the system folder, for an
   * emulator that reads its library flat — is every one of those files, not
   * just the one that launches it. Removing only `path` would leave the rest
   * behind as unattributable clutter in a folder shared with every other game.
   */
  async uninstall(romId: number): Promise<void> {
    const entry = this.store.getInstalled(romId)
    if (!entry) {
      log.warn('library', 'uninstall asked for a ROM that is not in the index', { romId })
      return
    }

    // Before the deletion rather than after: what was removed is the whole
    // point of the line, and a failure part-way through leaves it recorded.
    log.info('library', 'uninstalling', {
      romId,
      name: entry.name,
      path: entry.path,
      files: entry.isDirectory ? 'whole directory' : entry.files,
      sizeBytes: entry.sizeBytes
    })

    if (!entry.isDirectory && entry.files.length > 1) {
      const dir = dirname(entry.path)
      for (const file of entry.files) await rm(join(dir, file), { force: true })
    } else {
      await rm(entry.path, { recursive: true, force: true })
    }
    this.store.removeInstalled(romId)
  }
}
