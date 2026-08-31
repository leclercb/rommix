import { EventEmitter } from 'node:events'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chooseLaunchFile } from '@shared/gamefiles'
import type { DownloadItem, RommRom } from '@shared/types'
import { unpack, type InstallResult } from './install.ts'
import { log } from './log.ts'
import { Library } from './library.ts'
import { CorruptDownloadError, partialPathOf, RommClient } from './romm.ts'
import { isZip } from './zip.ts'
import type { Store } from './store.ts'

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
  /**
   * ROMs whose transfer is being interrupted to let another one past.
   *
   * The same abort as a pause, and a different outcome: the transfer keeps its
   * bytes and goes back into the queue rather than stopping, so it carries on
   * by itself once the one that overtook it is done. Recorded here for the same
   * reason `pausing` is — by the time `runOne` sees the exception, an abort is
   * an abort.
   */
  private readonly requeueing = new Set<number>()

  constructor(
    private readonly store: Store,
    private readonly client: RommClient,
    private readonly library: Library
  ) {
    super()
  }

  get items(): DownloadItem[] {
    return this.queue.map((item) => ({ ...item }))
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
      // Behind everything else still waiting, rather than back into the place
      // it held before it stopped. See `moveToBack`.
      this.moveToBack(paused)
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

    const { path, system } = this.library.plan(rom)
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
   * Where a row sits in the array is the order it will be run in.
   *
   * `pump` takes the first row still queued, so the two are the same list and
   * a row that changes state has to be moved as well as marked. They drifted
   * apart once — a resumed transfer was marked queued in the place it had been
   * paused in, which could be ahead of whatever was on the wire — and every
   * question asked of the queue after that had two answers: what runs next, and
   * what a promoted transfer has to be put in front of.
   */
  private moveToFront(item: DownloadItem): void {
    this.queue.splice(this.queue.indexOf(item), 1)
    const front = this.queue.findIndex(
      (entry) => entry.state === 'queued' || entry.state === 'downloading'
    )
    this.queue.splice(front < 0 ? 0 : front, 0, item)
  }

  /**
   * The other end of the same list: behind everything still waiting.
   *
   * Where a resumed transfer goes. It gave up its turn when it was paused, and
   * taking it back at the expense of games queued since would be the one thing
   * the user did not ask for — `promote` is the button that says otherwise.
   */
  private moveToBack(item: DownloadItem): void {
    this.queue.splice(this.queue.indexOf(item), 1)
    let last = -1
    for (const [at, entry] of this.queue.entries()) {
      if (entry.state === 'queued' || entry.state === 'downloading') last = at
    }
    this.queue.splice(last + 1, 0, item)
  }

  /**
   * Start a waiting transfer now, and let the one it overtook carry on after.
   *
   * The queue is drained one at a time and in order, so a small game asked for
   * behind a large one waits for all of it — which, on a slow link, is the
   * difference between playing it this evening and not. The order is the
   * user's to change.
   *
   * What is running is interrupted rather than stopped: it keeps every byte,
   * goes back into the queue directly behind the one that overtook it, and
   * resumes by itself when its turn comes round again. Nothing has to be
   * pressed to bring it back. `resume` is read from the record on disk rather
   * than from the row's state, which is what makes that free.
   *
   * A paused transfer can be promoted too, and that is the whole of what the
   * button means: this game, now. Resuming it puts it at the back of the queue,
   * which is the right default and the wrong one for the game the user is
   * waiting on — offering it only to rows that happen to be queued left a list
   * of paused games with no way to say which of them mattered.
   *
   * A transfer that cannot be resumed is left alone: interrupting it would
   * throw away everything it has fetched, so the promoted game takes the next
   * turn instead of this one. See `DownloadItem.resumable`.
   */
  promote(romId: number): void {
    const item = this.queue.find(
      (entry) => entry.romId === romId && (entry.state === 'queued' || entry.state === 'paused')
    )
    if (!item) return

    const running = this.queue.find((entry) => entry.state === 'downloading')
    const next = this.queue.find((entry) => entry.state === 'queued')
    // Nothing to get past: it is already the transfer the queue reaches next,
    // and the wire is free.
    if (running === undefined && next === item) return

    const resumed = item.state === 'paused'
    item.state = 'queued'
    item.error = null
    this.moveToFront(item)

    const interrupt = running !== undefined && running.resumable !== false
    if (interrupt) {
      // Directly behind the one that overtook it, rather than behind everything
      // else waiting as well: it was on the wire, so its turn is the next one.
      this.queue.splice(this.queue.indexOf(running), 1)
      this.queue.splice(this.queue.indexOf(item) + 1, 0, running)
    }

    log.info('download', 'moved to the front of the queue', {
      romId,
      name: item.name,
      resumed,
      interrupted: interrupt ? running.romId : null
    })
    this.emitUpdate()

    if (interrupt) {
      // The abort lands in `runOne`, which reads the intent back out and puts
      // the transfer into the queue rather than into a paused row.
      this.requeueing.add(running.romId)
      this.controllers.get(running.romId)?.abort()
      return
    }
    // Nothing gave way, so nothing is going to reach this row on its own: a
    // promoted transfer that was paused has no `enqueue` behind it, and the
    // pump stops as soon as the queue empties. Harmless while one is running.
    void this.pump()
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
      this.library.forgetListings()
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
  private async pump(seed?: RommRom): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (true) {
        const item = this.queue.find((i) => i.state === 'queued')
        if (!item) break
        try {
          // The seeded ROM is already loaded; anything else needs a fresh fetch
          // so we have the current file list. There is no seed at all when the
          // queue was started by `promote`, which has only an id to hand.
          const rom = seed && item.romId === seed.id ? seed : await this.client.rom(item.romId)
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
      const { dir, path, system, emulatorId, asDirectory, flat } = this.library.plan(rom)

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

      // The library records it and announces it: the index and the folder
      // readings are its, and so is the event every screen listens on.
      this.library.record(await this.library.entryFor(rom, system, emulatorId, installed))
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
      const overtaken = this.requeueing.delete(rom.id)
      const cancelled = controller.signal.aborted && !asked && !overtaken
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
      const disposable = cancelled || (item.resumable === false && !overtaken)
      const carried = holding ? await this.keepPartial(rom.id, holding, disposable) : 0

      // Nothing is arriving any more, so the row stops naming a file. Left set,
      // a paused game goes on claiming a track is on the wire — and comes back
      // after a restart saying it too, since the row is rebuilt from a record
      // that never knew about it.
      item.currentFile = undefined
      item.state = cancelled
        ? 'cancelled'
        : // Back into the queue rather than into a paused row: it was not
          // stopped, it was overtaken, and it goes on when its turn returns.
          overtaken
          ? 'queued'
          : asked || carried > 0
            ? 'paused'
            : 'error'
      // A stop the user asked for has nothing to explain, and neither has a
      // connection that broke with bytes worth keeping: that row is waiting to
      // be finished rather than failing.
      //
      // A file refused for its hash is the exception. It pauses like the
      // others, because a multi-file game keeps every file that did arrive, but
      // nothing about the row would otherwise say that a copy was thrown away —
      // and the one thing that must not happen quietly is bytes being refused.
      const corrupt = cause instanceof CorruptDownloadError
      item.error =
        cancelled || asked || overtaken || (carried > 0 && !corrupt)
          ? null
          : (cause as Error).message
      item.receivedBytes = carried > 0 ? carried : item.receivedBytes

      if (overtaken)
        log.info('download', 'let another transfer past', { ...detail, received: carried })
      else if (cancelled) log.info('download', 'abandoned after cancellation', detail)
      else if (asked) log.info('download', 'stopped on request', { ...detail, received: carried })
      else if (carried > 0)
        log.warn('download', 'paused part-way', { ...detail, received: carried })
      else log.error('download', 'failed', cause, detail)

      this.emitUpdate()
    } finally {
      this.controllers.delete(rom.id)
      /**
       * The intents go whether or not the transfer noticed them.
       *
       * Both are read in the catch above, which only runs if the abort actually
       * landed. A transfer that finished in the moment between the abort being
       * asked for and the socket noticing takes the success path instead and
       * leaves its id behind — and the next failure of that game, whatever the
       * reason, is then read as a pause or an overtake: reported as neither,
       * and quietly retried once.
       */
      this.pausing.delete(rom.id)
      this.requeueing.delete(rom.id)
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
      this.library.forgetListings()
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
}
