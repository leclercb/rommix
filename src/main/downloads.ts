import { EventEmitter } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { resolveSystem } from '@shared/systems'
import type { DownloadItem, InstalledRom, RommRom, RunnerInfo } from '@shared/types'
import { RommClient, RommError } from './romm'
import type { Store } from './store'

/**
 * Downloads ROMs from RomM into the runner's ROM tree.
 *
 * Layout is `<roms_path>/<es-de system>/<file>`, which is exactly what
 * RetroDECK's `run_game` expects: it infers the system by matching the
 * `roms/<system>/` path segment, so a correctly placed file needs no further
 * hints at launch time.
 *
 * Transfers run one at a time. Parallel ROM downloads mostly just make each
 * one slower and thrash the disk on a handheld, and a serial queue keeps the
 * progress UI honest.
 */

export interface DownloadEvents {
  update: (items: DownloadItem[]) => void
  installed: (entry: InstalledRom) => void
}

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
  const { readdir } = await import('node:fs/promises')
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    total += entry.isDirectory() ? await directorySize(child) : (await stat(child)).size
  }
  return total
}

export class DownloadManager extends EventEmitter {
  private readonly queue: DownloadItem[] = []
  private readonly controllers = new Map<number, AbortController>()
  private running = false

  constructor(
    private readonly store: Store,
    private readonly client: RommClient,
    private readonly getRunner: () => RunnerInfo | null
  ) {
    super()
  }

  get items(): DownloadItem[] {
    return this.queue.map((item) => ({ ...item }))
  }

  /**
   * Work out where a ROM should land. Returns the target path plus whether it
   * needs to be unpacked into a directory of its own.
   */
  private plan(rom: RommRom): { dir: string; path: string; system: string; asDirectory: boolean } {
    const runner = this.getRunner()
    if (!runner) {
      throw new RommError('No emulator runner available — install RetroDECK or RetroArch')
    }
    if (!runner.paths.roms) {
      throw new RommError(
        'The ROM folder is not configured. Run RetroDECK once, or set the path in Settings.'
      )
    }

    const system = resolveSystem(
      rom.platform_slug,
      rom.platform_fs_slug,
      this.store.settings.systemOverrides
    )
    if (!system) {
      throw new RommError(
        `Rommix does not know which folder "${rom.platform_display_name}" maps to. ` +
          `Set a folder for it in Settings → Platform folders.`
      )
    }

    // Multi-file games (CD images with cue+bin, multi-disc sets) arrive as a
    // zip and are unpacked into their own directory.
    const asDirectory = rom.has_multiple_files
    const dir = join(runner.paths.roms, system)
    const path = asDirectory ? join(dir, rom.fs_name_no_ext) : join(dir, rom.fs_name)
    return { dir, path, system, asDirectory }
  }

  /** Where would this ROM be installed? Used by the UI before downloading. */
  previewTarget(rom: RommRom): { path: string; system: string } {
    const { path, system } = this.plan(rom)
    return { path, system }
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
      system,
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

    const { dir, path, system, asDirectory } = this.plan(rom)
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

      let sizeBytes: number
      if (asDirectory || (await isZip(downloadTo))) {
        item.state = 'extracting'
        this.emitUpdate()

        const targetDir = asDirectory ? path : join(dir, rom.fs_name_no_ext)
        await extractZip(downloadTo, targetDir)
        await rm(downloadTo, { force: true })
        sizeBytes = await directorySize(targetDir)

        this.recordInstalled(rom, targetDir, system, sizeBytes, true)
        item.targetPath = targetDir
      } else {
        sizeBytes = (await stat(path)).size
        this.recordInstalled(rom, path, system, sizeBytes, false)
      }

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

  private recordInstalled(
    rom: RommRom,
    path: string,
    system: string,
    sizeBytes: number,
    isDirectory: boolean
  ): void {
    const entry: InstalledRom = {
      romId: rom.id,
      path,
      system,
      fileName: isDirectory ? rom.fs_name_no_ext : rom.fs_name,
      sizeBytes,
      installedAt: new Date().toISOString(),
      isDirectory
    }
    this.store.addInstalled(entry)
    this.emit('installed', entry)
  }

  /** Delete a ROM from disk and drop it from the index. */
  async uninstall(romId: number): Promise<void> {
    const entry = this.store.getInstalled(romId)
    if (!entry) return
    await rm(entry.path, { recursive: true, force: true })
    this.store.removeInstalled(romId)
  }
}
