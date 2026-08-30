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
import { partialPathOf, RommClient, RommError } from './romm.ts'
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

/**
 * What a transfer in progress is holding on disk.
 *
 * One file, or a directory and the names inside it — the same two shapes
 * `PendingDownload` records, kept here so the failure path can find every
 * partial without knowing which strategy fetched it.
 */
interface Holding {
  targetPath: string
  files: string[]
  ownsFolder: boolean
}

/**
 * Every path a transfer has bytes in: the finished files and the one still
 * arriving. Deleting a download means deleting all of them, and measuring one
 * means adding them up.
 */
function pathsHeld(holding: Holding): string[] {
  if (holding.files.length === 0) return [holding.targetPath, partialPathOf(holding.targetPath)]
  return holding.files.flatMap((name) => {
    const path = join(holding.targetPath, name)
    return [path, partialPathOf(path)]
  })
}

async function bytesHeld(holding: Holding): Promise<number> {
  let total = 0
  for (const path of pathsHeld(holding)) {
    total += (await stat(path).catch(() => null))?.size ?? 0
  }
  return total
}

/**
 * Remove every trace of a transfer: the files, and the folder made to hold
 * them.
 *
 * The folder matters as much as the files. An empty directory named after a
 * game is what `adopt` reads as a multi-file game already on disk, so a
 * cancelled download that left one behind came back after a restart as a game
 * RomMix believed it had — installed, unplayable, and refusing to download.
 */
async function discardHeld(holding: Holding): Promise<void> {
  for (const path of pathsHeld(holding)) {
    await rm(path, { force: true }).catch(() => undefined)
  }
  if (holding.ownsFolder) {
    await rm(holding.targetPath, { recursive: true, force: true }).catch(() => undefined)
  }
}

export class DownloadManager extends EventEmitter {
  private readonly queue: DownloadItem[] = []
  private readonly controllers = new Map<number, AbortController>()
  private running = false
  /** When the renderer was last told anything. See `throttledUpdate`. */
  private lastEmit = 0
  /** Whether the interrupted transfers have been read back. See `restorePending`. */
  private restored = false
  /**
   * ROMs whose transfer is being stopped on purpose.
   *
   * Pausing and cancelling both abort the same controller, and by the time the
   * failure reaches `runOne` the two are indistinguishable — one keeps what has
   * arrived, the other throws it away, so the difference has to be recorded
   * where it is decided.
   */
  private readonly pausing = new Set<number>()

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

    // Multi-file games (CD images with cue+bin, multi-disc sets) get a directory
    // of their own — unless the emulator reads its library flat, in which case
    // a folder is a place its game list will never look and the files go loose
    // into the system folder instead. With no emulator at all there is nothing
    // making that demand, and a directory is the shape that keeps a disc set
    // together for whichever one arrives later.
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

    /**
     * A game asked for again while part of it is already on disk.
     *
     * The same button does both: there is one thing the user wants — this game,
     * downloaded — and whether that means starting or continuing is RomMix's
     * business rather than a second control to find. `runOne` decides whether
     * the bytes can actually be appended to.
     */
    const paused = this.queue.find((item) => item.romId === rom.id && item.state === 'paused')
    if (paused) {
      paused.state = 'queued'
      paused.error = null
      log.info('download', 'resuming', {
        romId: rom.id,
        name: paused.name,
        received: paused.receivedBytes,
        totalBytes: paused.totalBytes
      })
      this.emitUpdate()
      void this.pump(rom)
      return { ...paused }
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

  /**
   * Stop a transfer for now, keeping what has arrived.
   *
   * The counterpart to cancelling, and what makes starting a download a
   * decision rather than a commitment: a game being fetched over a phone's
   * tethering, or one that has to give the network back to whatever else the
   * house is doing, can be stopped and finished later without losing the
   * gigabyte already transferred.
   *
   * A queued transfer pauses too. It holds no bytes, but it stays in the list
   * rather than quietly starting the moment the one ahead of it finishes.
   */
  pause(romId: number): void {
    const item = this.queue.find((entry) => entry.romId === romId)
    if (!item || (item.state !== 'downloading' && item.state !== 'queued')) return

    log.info('download', 'paused by the user', {
      romId,
      name: item.name,
      received: item.receivedBytes,
      was: item.state
    })

    // A transfer that never started has nothing in flight to stop, and no
    // `runOne` to record the pause on its behalf.
    if (item.state === 'queued') {
      item.state = 'paused'
      this.emitUpdate()
      return
    }

    this.pausing.add(romId)
    this.controllers.get(romId)?.abort()
  }

  /**
   * Await the deletion rather than starting it: the same button that cancels a
   * download is one press away from starting it again, and a partial file
   * halfway through being removed is exactly what must not be resumed onto.
   */
  async cancel(romId: number): Promise<void> {
    this.controllers.get(romId)?.abort()
    const item = this.queue.find((i) => i.romId === romId)
    if (!item) return
    if (item.state !== 'queued' && item.state !== 'downloading' && item.state !== 'paused') return

    this.pausing.delete(romId)
    log.info('download', 'cancelled', { romId, name: item.name, was: item.state })
    // Cancelling a paused download is what says the part-downloaded file is not
    // wanted; nothing else ever deletes it.
    if (item.state === 'paused') {
      const recorded = this.store.pending.find((entry) => entry.romId === romId)
      if (recorded) await discardHeld(recorded)
      this.store.removePending(romId)
    }
    item.state = 'cancelled'
    this.emitUpdate()
  }

  /**
   * Clear out what is over. A paused transfer is not: it is waiting to be
   * finished, and the button that clears the list is not the one that throws a
   * part-downloaded game away.
   */
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
    let holding: Holding | null = null
    const took = log.since()

    try {
      const { dir, path, system, emulatorId, asDirectory, flat } = this.plan(rom)

      /**
       * One file at a time, where the server will do it.
       *
       * A game of several files is one RomM builds an archive for on the spot,
       * and an archive built per request can neither be resumed nor is it any
       * smaller — it stores the files rather than compressing them, so it is a
       * few hundred bytes *larger* than the sum of what it holds. Fetched
       * individually they are ordinary files on the server's disk: each one
       * resumes, a break costs one file rather than the game, and nothing has
       * to be unpacked afterwards.
       *
       * The archive stays as the answer for a server too old to serve files
       * individually, and for a game that is one file to begin with.
       */
      const perFile = await this.client.fileTransfers(rom)
      const resumable = perFile.available ? perFile.resumable : await this.client.supportsRange(rom)
      item.resumable = resumable

      // Where the bytes go. File by file that is a directory — the game's own,
      // or the system folder for an emulator that reads its library flat — and
      // otherwise the single file, or an archive beside where it will end up.
      holding = perFile.available
        ? {
            targetPath: asDirectory ? path : dir,
            files: rom.files.map((file) => file.file_name),
            ownsFolder: asDirectory
          }
        : { targetPath: asDirectory ? `${path}.zip` : path, files: [], ownsFolder: false }

      log.info('download', 'started', {
        romId: rom.id,
        name: item.name,
        system,
        emulator: emulatorId,
        totalBytes: item.totalBytes,
        multiFile: rom.has_multiple_files,
        fileByFile: perFile.available,
        resumable,
        asDirectory,
        flat,
        downloadTo: holding.targetPath
      })

      await mkdir(holding.files.length > 0 ? holding.targetPath : dir, { recursive: true })

      /**
       * Whether the bytes already on disk belong to this ROM.
       *
       * The name the server gives the file, and the path it was being written
       * to. A ROM replaced since — a better dump, a different region — is a
       * different file under a different name, and appending to the old bytes
       * would produce a game that looks complete and does not run.
       *
       * Deliberately not the size. RomM derives `fs_size_bytes` rather than
       * storing it, and answers with a slightly different figure for the same
       * untouched game from one call to the next — the detail endpoint sums the
       * files, the download reports the archive built around them — so
       * comparing it threw away perfectly good partials.
       */
      const recorded = this.store.pending.find((entry) => entry.romId === rom.id)
      const resume =
        resumable &&
        recorded !== undefined &&
        recorded.fileName === rom.fs_name &&
        recorded.targetPath === holding.targetPath
      if (recorded && !resume) {
        log.info('download', 'starting this one from the beginning', {
          romId: rom.id,
          was: { fileName: recorded.fileName, targetPath: recorded.targetPath },
          now: { fileName: rom.fs_name, targetPath: holding.targetPath },
          resumable
        })
      }

      /**
       * Written before a single byte arrives, and removed when the ROM lands.
       *
       * Recording it only on the way out — when a transfer breaks or is paused
       * — leaves the two ways RomMix can stop without warning uncovered: killed
       * from a desktop, or the machine losing power. Neither runs any cleanup,
       * and both leave part-downloaded files on disk that nothing accounts for
       * and nothing will ever finish. Written here, they always have a record
       * beside them and a restart can offer to carry on.
       *
       * `totalBytes` is the server's own figure rather than the one observed on
       * the wire: it is what the check above compares against next time, and a
       * content length that disagrees with it would refuse every resume.
       */
      this.store.setPending({
        romId: rom.id,
        name: item.name,
        coverPath: item.coverPath,
        system,
        platformName: item.platformName,
        targetPath: holding.targetPath,
        files: holding.files,
        ownsFolder: holding.ownsFolder,
        fileName: rom.fs_name,
        totalBytes: rom.fs_size_bytes,
        pausedAt: new Date().toISOString()
      })
      this.emitUpdate()

      const transfer = { resume, resumable, controller }
      const installed = perFile.available
        ? await this.fetchFileByFile(
            rom,
            item,
            { dir: holding.targetPath, system, asDirectory },
            transfer
          )
        : await this.fetchWhole(rom, item, { dir, path, system, asDirectory, flat }, transfer)

      // The bytes are in the game now, and nothing is left to pick up.
      this.store.removePending(rom.id)

      const entry = await this.installedEntry(rom, system, emulatorId, installed)
      this.store.addInstalled(entry)
      this.emit('installed', entry)
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
      const asked = this.pausing.delete(rom.id)
      const cancelled = controller.signal.aborted && !asked
      const detail = {
        romId: rom.id,
        name: item.name,
        target: holding?.targetPath ?? null,
        ms: took()
      }

      // What is on disk decides between the two outcomes that are not a
      // cancellation. Bytes that arrived are worth keeping and worth offering
      // to finish; a transfer that never delivered anything has nothing to
      // resume and is simply an error. Nothing can be done with the bytes of a
      // transfer that cannot be resumed either, so those go with it rather than
      // sitting on the disk behind a button that would fetch it all again.
      const disposable = cancelled || item.resumable === false
      const carried = holding ? await this.keepPartial(rom.id, holding, disposable) : 0

      // Nothing is arriving any more, so the row stops naming a file. Left set,
      // a paused game goes on claiming a track is on the wire — and comes back
      // after a restart saying it too, since the row is rebuilt from a record
      // that never knew about it.
      item.currentFile = undefined
      item.state = cancelled ? 'cancelled' : asked || carried > 0 ? 'paused' : 'error'
      item.error = cancelled || asked || carried > 0 ? null : (cause as Error).message
      item.receivedBytes = carried > 0 ? carried : item.receivedBytes

      if (cancelled) log.info('download', 'abandoned after cancellation', detail)
      else if (asked) log.info('download', 'stopped on request', { ...detail, received: carried })
      else if (carried > 0)
        log.warn('download', 'paused part-way', { ...detail, received: carried })
      else log.error('download', 'failed', cause, detail)

      this.emitUpdate()
    } finally {
      this.controllers.delete(rom.id)
    }
  }

  /**
   * Fetch a game one file at a time, into the folder it will be played from.
   *
   * There is nothing to unpack afterwards: the files land under the names the
   * server has for them, which is the layout an emulator expects and the one
   * `adopt` looks for. A file already there in full is left alone, so a resumed
   * game does not re-fetch the discs it already has.
   */
  private async fetchFileByFile(
    rom: RommRom,
    item: DownloadItem,
    where: { dir: string; system: string; asDirectory: boolean },
    transfer: { resume: boolean; resumable: boolean; controller: AbortController }
  ): Promise<InstallResult> {
    item.totalBytes = rom.files.reduce((sum, file) => sum + file.file_size_bytes, 0)
    let done = 0
    const sized: { name: string; sizeBytes: number }[] = []

    for (const file of rom.files) {
      const destination = join(where.dir, file.file_name)
      await mkdir(dirname(destination), { recursive: true })
      item.currentFile = file.file_name
      this.emitUpdate()

      const already = (await stat(destination).catch(() => null))?.size ?? 0
      if (transfer.resume && already === file.file_size_bytes) {
        log.debug('download', 'this file is already here in full', {
          romId: rom.id,
          fileName: file.file_name
        })
      } else {
        await this.client.downloadRomFile(
          file,
          destination,
          (progress) => {
            item.receivedBytes = done + progress.received
            this.throttledUpdate()
          },
          transfer.controller.signal,
          { resume: transfer.resume, resumable: transfer.resumable }
        )
      }

      const size = (await stat(destination).catch(() => null))?.size ?? file.file_size_bytes
      done += size
      sized.push({ name: file.file_name, sizeBytes: size })
      item.receivedBytes = done
      this.emitUpdate()
    }

    // Nothing is arriving any more, so the row stops naming a file.
    item.currentFile = undefined

    const chosen = chooseLaunchFile(sized, where.system) ?? sized[0]?.name
    const launchPath = chosen ? join(where.dir, chosen) : where.dir
    return where.asDirectory
      ? { path: where.dir, launchPath, sizeBytes: done, isDirectory: true }
      : {
          path: launchPath,
          launchPath,
          sizeBytes: done,
          isDirectory: false,
          files: sized.map((file) => file.name)
        }
  }

  /**
   * Fetch the game as the server sends it: one file, or one archive.
   *
   * The answer for a single-file ROM, where there is no archive involved at
   * all, and for a server too old to serve a game's files individually. An
   * archive still has to be unpacked afterwards, which is the other half of why
   * it is not the way a multi-file game is fetched where there is a choice.
   */
  private async fetchWhole(
    rom: RommRom,
    item: DownloadItem,
    where: { dir: string; path: string; system: string; asDirectory: boolean; flat: boolean },
    transfer: { resume: boolean; resumable: boolean; controller: AbortController }
  ): Promise<InstallResult> {
    const downloadTo = where.asDirectory ? `${where.path}.zip` : where.path

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
      transfer.controller.signal,
      { resume: transfer.resume, resumable: transfer.resumable }
    )
    // The last chunk is almost never on a throttle boundary, so the final byte
    // count has to be sent explicitly — otherwise a finished transfer can sit
    // at 98% until the state change redraws it.
    this.emitUpdate()

    if (where.asDirectory || (await isZip(downloadTo))) {
      item.state = 'extracting'
      this.emitUpdate()
      log.info('download', 'extracting the archive', { romId: rom.id, from: downloadTo })
      return unpack(
        rom,
        downloadTo,
        where.dir,
        where.system,
        where.path,
        where.asDirectory,
        where.flat
      )
    }
    return {
      path: where.path,
      launchPath: where.path,
      sizeBytes: (await stat(where.path)).size,
      isDirectory: false
    }
  }

  /**
   * Keep — or throw away — what an interrupted transfer left behind.
   *
   * Returns how many bytes are being kept, which is zero for a cancellation and
   * for a transfer that never delivered anything. The record is already on disk
   * — see `runOne` — so this only settles whether the pair survives; the file
   * and its record are always removed together.
   */
  private async keepPartial(romId: number, holding: Holding, cancelled: boolean): Promise<number> {
    const onDisk = await bytesHeld(holding)

    if (cancelled || onDisk === 0) {
      await discardHeld(holding)
      this.store.removePending(romId)
      return 0
    }

    return onDisk
  }

  /**
   * The transfers that were interrupted, back in the list they were in.
   *
   * Called once, as the first download list is asked for. A `.part` the user
   * deleted by hand is forgotten rather than offered: the row would promise a
   * resume that has nothing to resume from.
   */
  async restorePending(): Promise<void> {
    if (this.restored) return
    this.restored = true

    let found = false
    for (const entry of this.store.pending) {
      // A game that is installed after all: the transfer finished and RomMix
      // stopped between the last byte and the record being cleared. Nothing to
      // offer, and offering it would re-fetch a game that is already here.
      if (this.store.getInstalled(entry.romId)) {
        this.store.removePending(entry.romId)
        continue
      }

      // How far it got is measured, never remembered: the files are the truth,
      // and a record written before the transfer started knows nothing about
      // what arrived after it.
      const onDisk = await bytesHeld(entry)
      if (onDisk === 0) {
        this.store.removePending(entry.romId)
        continue
      }
      found = true
      this.queue.push({
        romId: entry.romId,
        name: entry.name,
        coverPath: entry.coverPath,
        system: entry.system,
        platformName: entry.platformName,
        state: 'paused',
        receivedBytes: onDisk,
        totalBytes: entry.totalBytes,
        error: null,
        targetPath: entry.targetPath
      })
      log.info('download', 'an interrupted download is waiting to be resumed', {
        romId: entry.romId,
        name: entry.name,
        received: onDisk,
        total: entry.totalBytes
      })
    }
    if (found) this.emitUpdate()
  }

  /**
   * The index entry for a game that is now on disk, built but not recorded.
   *
   * Recording is the caller's, because the two callers record differently: a
   * finished download is one game and is written and announced as it lands,
   * while adoption recognises a whole library page and writes the lot once.
   * See `Store.addInstalledMany`.
   */
  private async installedEntry(
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

    const unfinished = new Set(this.store.pending.map((entry) => entry.romId))

    for (const rom of roms) {
      // A stale entry — the platform now runs on a different emulator — is
      // treated as unknown, so the new emulator's own library is searched. If
      // a copy is there it is adopted; if not, the old entry stays put and
      // comes back the moment the platform is pointed back.
      const known = this.store.getInstalled(rom.id)
      if (known && !this.isStale(known)) continue

      // A game part-way through being fetched has real files in the real place
      // — that is what fetching it file by file means — and every one of the
      // checks below would take them for a finished install. It is not one
      // until the transfer says so.
      if (unfinished.has(rom.id)) continue

      let target: { dir: string; system: string; emulatorId: string; flat: boolean }
      try {
        target = this.plan(rom)
      } catch {
        // Unmapped platform, or no emulator can run it: nothing to look for.
        continue
      }

      const record = async (path: string, isDirectory: boolean): Promise<void> => {
        // A directory with nothing in it is not a game. It is what a cancelled
        // transfer or a copy that never finished leaves behind, and recording
        // it puts a download of nothing in the index — which then reads as
        // installed everywhere and refuses to be downloaded.
        if (isDirectory && (await readdir(path).catch(() => [])).length === 0) return

        adopted.push(
          await this.installedEntry(rom, target.system, target.emulatorId, {
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
            await this.installedEntry(rom, target.system, target.emulatorId, {
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

    // Recorded and announced as a group: a library page can adopt dozens at
    // once, one notification per game would bury the screen, and every listener
    // on `installed` is handed the whole index — so an entry at a time is a
    // rewrite of the index and a redraw of every screen, per game.
    if (adopted.length > 0) {
      this.store.addInstalledMany(adopted)
      log.info('library', 'adopted ROMs already on disk', {
        count: adopted.length,
        romIds: adopted.map((entry) => entry.romId)
      })
      // Before the news of what was adopted, so the screen that shows it is
      // reading a library the new games are already in.
      this.emit('installed', null)
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
