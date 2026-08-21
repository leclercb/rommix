import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { SAVE_CONVENTIONS, emulatorById } from '@config/emulators'
import type { SaveContext, SaveLocation, SavePaths } from '@config/emulators'
import type {
  EmulatorState,
  PendingSave,
  RommRom,
  SaveAsset,
  SavePushPreview,
  SaveSyncResult,
  SaveSyncState
} from '@shared/types'
import type { RommClient } from './romm'
import type { Store } from './store'
import { realHome } from './host'
import { log } from './log'
import { fileSystemEnvironment } from './saveenv'
import { extractZip, zipDirectory } from './zip'

/**
 * Two-way save and save-state sync between RomM and the local emulator tree.
 *
 * Where those files are is not decided here. The emulator's descriptor answers
 * that per game — see `src/config/emulators/savepaths.ts` — because the answer
 * depends on which core RetroArch loaded, which of RetroDECK's bundled
 * emulators ES-DE chose, and which Switch profile owns a title. This file's job
 * is everything that is the same whatever the answer turned out to be: deciding
 * which files belong to the game, which end is newer, and moving them.
 *
 * Three shapes of save exist and each is handled differently:
 *
 *  - `rom-stem`   files named after the ROM. Matched on the stem, uploaded
 *                 individually, which is what keeps a libretro `.srm` readable
 *                 by RomM's own web player.
 *  - `directory`  a folder keyed by title id — Eden and the other Switch
 *                 emulators. Carried as one zip, because the files inside carry
 *                 no name that ties them to a game.
 *  - `shared`     a memory card or NAND every game writes to. Skipped, with a
 *                 reason the buttons can show, rather than uploading one game's
 *                 card under another game's id.
 *
 * RomM records which emulator produced each save and RomMix sends the
 * descriptor id, so a RetroArch `.srm` is not pulled down into an emulator that
 * would not understand it.
 *
 * Conflict policy is deliberately conservative: a remote asset only overwrites
 * a local one when it is strictly newer, and the local file is copied aside
 * first. Losing a save file is far worse than an extra sync round-trip.
 */

const SAVE_EXTENSIONS = new Set(SAVE_CONVENTIONS.saveExtensions)
const { statePattern: STATE_PATTERN, maxDepth: MAX_DEPTH } = SAVE_CONVENTIONS

/**
 * How many save states one pull brings down.
 *
 * Battery saves are one small file per game and all of them are worth having.
 * States are neither: libretro alone keeps ten numbered slots plus an auto
 * slot, each a full machine snapshot with a screenshot attached, and a game
 * played across three devices can have thirty of them on the server. Pulling
 * the lot before a launch spends minutes moving snapshots of moments nobody
 * asked to return to.
 *
 * The newest few are what "carry on where I left off" actually means; the rest
 * stay on the server and are still listed on the detail screen.
 */
const STATE_PULL_LIMIT = 5

/** Suffix marking a directory save carried as one archive. */
const ARCHIVE_SUFFIX = '.rommix-save.zip'

/** Everything needed to ask a descriptor where this game's saves are. */
export interface SaveTarget {
  rom: RommRom
  emulator: EmulatorState
  system: string
  /** The file handed to the emulator, not the game directory. */
  romPath: string
  /** The launch variant in force, where the emulator offers several. */
  variant?: string
}

interface LocalAsset {
  path: string
  fileName: string
  mtimeMs: number
  /** True when `path` is a directory to be archived rather than a file. */
  isDirectory?: boolean
}

/** Walk a directory tree collecting files, bounded so a huge library stays fast. */
async function walk(dir: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const entry of entries) {
    const child = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await walk(child, depth + 1)))
    else found.push(child)
  }
  return found
}

/** Normalise for comparison: lowercase, drop punctuation the emulators vary on. */
function normaliseStem(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * The same, with the tags a ROM file name carries and a save file does not.
 *
 * A multi-disc game is exposed by RomM as `Final Fantasy VII (USA).m3u`, while
 * the memory card DuckStation writes for it is `Final Fantasy VII_1.mcd`. The
 * region and dump markers are what stand between the two, so a second, looser
 * key is derived without them. Used only when the strict comparison has already
 * failed, so an exact match is never displaced by a fuzzy one.
 */
function looseStem(value: string): string {
  return normaliseStem(
    value
      .replace(/\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[\s._-]+$/, '')
  )
}

/** Does a save file's name identify it as this ROM's? */
function stemMatches(fileStem: string, romStem: string): boolean {
  const file = normaliseStem(fileStem)
  const rom = normaliseStem(romStem)
  if (file && rom && (file.startsWith(rom) || rom.startsWith(file))) return true

  const looseFile = looseStem(fileStem)
  const looseRom = looseStem(romStem)
  // Both have to survive the loosening: an empty key would match everything,
  // which for a directory of memory cards means uploading the wrong game's.
  if (!looseFile || !looseRom) return false
  return looseFile.startsWith(looseRom) || looseRom.startsWith(looseFile)
}

/** The ROM's name without its extension, which is what saves are named after. */
function romStemOf(rom: RommRom, romPath: string): string {
  return rom.fs_name_no_ext || basename(romPath).replace(/\.[^.]+$/, '')
}

export class SaveSync {
  private readonly env = fileSystemEnvironment()

  constructor(
    private readonly store: Store,
    private readonly client: RommClient
  ) {}

  /**
   * Ask the emulator's descriptor where this game's saves live.
   *
   * Returns empty locations rather than throwing when the emulator is not
   * installed or its descriptor has gone: a game whose emulator was uninstalled
   * still has assets on the server worth listing.
   */
  private locate(target: SaveTarget): SavePaths {
    const descriptor = emulatorById(target.emulator.id)
    if (!descriptor) return { saves: null, states: null }

    const romPath = target.romPath
    const context: SaveContext = {
      paths: target.emulator.paths,
      system: target.system,
      romPath,
      romDir: join(romPath, '..'),
      romStem: romStemOf(target.rom, romPath),
      home: realHome(),
      configDir: target.emulator.configDir,
      dataDir: target.emulator.dataDir,
      installDir: target.emulator.install?.location ?? null,
      variant: target.variant,
      env: this.env
    }

    try {
      const paths = descriptor.saves(context)
      // Where the descriptor decided this game's files are. Half of every save
      // sync question is "which folder did it look in", and it is a folder
      // nothing else in the log names.
      log.debug('saves', 'located', {
        romId: target.rom.id,
        emulator: target.emulator.id,
        system: target.system,
        variant: target.variant ?? null,
        saves: paths.saves?.dir ?? null,
        savesMatch: paths.saves?.match ?? null,
        states: paths.states?.dir ?? null,
        statesMatch: paths.states?.match ?? null,
        tag: paths.emulator ?? null,
        unsyncableReason: paths.unsyncableReason ?? null
      })
      return paths
    } catch (cause) {
      // A descriptor that fails to resolve a path is a bug, but not one worth
      // turning into a failed launch: the game still runs, unsynced.
      log.error('saves', 'the emulator descriptor could not say where saves live', cause, {
        romId: target.rom.id,
        emulator: target.emulator.id,
        system: target.system
      })
      return { saves: null, states: null }
    }
  }

  private locationFor(paths: SavePaths, kind: 'save' | 'state'): SaveLocation | null {
    const location = kind === 'save' ? paths.saves : paths.states
    return location && location.match !== 'shared' ? location : null
  }

  /**
   * Find local save/state data belonging to a ROM.
   *
   * `since` restricts the result to data modified after a timestamp, which is
   * how we detect "what did this play session actually write".
   */
  private async findLocal(
    location: SaveLocation,
    rom: RommRom,
    romPath: string,
    kind: 'save' | 'state',
    since = 0
  ): Promise<LocalAsset[]> {
    const stem = romStemOf(rom, romPath)

    // A directory save is one asset: the folder itself, named after the game so
    // the server has something readable to show.
    if (location.match === 'directory') {
      const newest = this.env.newest(location.dir)
      if (newest === 0 || newest <= since) return []
      return [
        {
          path: location.dir,
          fileName: `${stem}${ARCHIVE_SUFFIX}`,
          mtimeMs: newest,
          isDirectory: true
        }
      ]
    }

    const roots = [location.dir, ...(location.search ?? [])]
    const results: LocalAsset[] = []
    const seen = new Set<string>()

    for (const root of roots) {
      for (const path of await walk(root)) {
        if (seen.has(path)) continue
        const name = basename(path)
        const ext = extname(name).toLowerCase()

        const matchesKind = kind === 'state' ? STATE_PATTERN.test(name) : SAVE_EXTENSIONS.has(ext)
        if (!matchesKind) continue

        // Emulators name the save after the ROM file, sometimes with a suffix.
        const fileStem = name.replace(STATE_PATTERN, '').replace(/\.[^.]+$/, '')
        if (!stemMatches(fileStem, stem)) continue

        let info
        try {
          info = await stat(path)
        } catch {
          continue
        }
        if (info.mtimeMs <= since) continue

        seen.add(path)
        results.push({ path, fileName: name, mtimeMs: info.mtimeMs })
      }
    }
    return results
  }

  /**
   * Pull newer saves and states from RomM before the game starts.
   * Returns how many assets were written locally.
   */
  async pull(target: SaveTarget): Promise<number> {
    if (!this.store.settings.syncSavesDown) {
      log.debug('saves', 'automatic pull is switched off', { romId: target.rom.id })
      return 0
    }
    const paths = this.locate(target)

    let written = 0
    written += await this.pullKind(target, paths, 'save')
    written += await this.pullKind(target, paths, 'state')
    return written
  }

  /**
   * Every save and state this game has, on the server and on this device, as
   * one list of file names with a sync state each.
   *
   * Both ends, because the interesting rows are the ones only one side has: a
   * save on disk that was never uploaded is invisible in a list of what RomM
   * holds, and it is exactly the row a person is looking for when they open
   * this screen after playing.
   *
   * `local` is absent for a game that is not downloaded — there is no save tree
   * to look in — and every asset is then simply not on this device.
   */
  async listAssets(romId: number, local?: SaveTarget): Promise<SaveAsset[]> {
    const [saves, states] = await Promise.all([this.client.saves(romId), this.client.states(romId)])

    /**
     * What this device has, by kind and name.
     *
     * `findLocal` matches on the ROM's stem, which is how a save is recognised
     * as belonging to this game at all; the exact file name then lines it up
     * with the server's copy, since that is the name it was uploaded under.
     */
    const localAssets = new Map<string, LocalAsset>()
    let tag: string | null = null
    if (local) {
      const paths = this.locate(local)
      tag = paths.emulator ?? local.emulator.id
      for (const kind of ['save', 'state'] as const) {
        const location = this.locationFor(paths, kind)
        if (!location) continue
        const found = await this.findLocal(location, local.rom, local.romPath, kind)
        for (const file of found) {
          localAssets.set(`${kind}:${file.fileName.toLowerCase()}`, file)
        }
      }
    }

    // What this device calls itself on the server, so a save can say where it
    // came from. RomM's own id where the device was paired, the local one
    // otherwise — the same pair `uploadSave` sends.
    const thisDevice = this.store.credentials.deviceId ?? this.store.settings.deviceId

    const assets: SaveAsset[] = []
    const matched = new Set<string>()

    for (const kind of ['save', 'state'] as const) {
      for (const item of kind === 'save' ? saves : states) {
        const key = `${kind}:${item.file_name.toLowerCase()}`
        const localFile = localAssets.get(key)
        if (localFile) matched.add(key)

        // States carry no origin on the server, so there is nothing to claim.
        const fromThisDevice =
          kind === 'save' && 'origin_device_id' in item && item.origin_device_id
            ? item.origin_device_id === thisDevice
            : null

        assets.push({
          id: item.id,
          kind,
          fileName: item.file_name,
          sizeBytes: item.file_size_bytes,
          emulator: item.emulator,
          localPath: localFile?.path ?? null,
          localModifiedAt: localFile ? new Date(localFile.mtimeMs).toISOString() : null,
          fromThisDevice,
          updatedAt: item.updated_at,
          sync: syncStateOf(localFile?.mtimeMs ?? null, item.updated_at, fromThisDevice)
        })
      }
    }

    // Whatever is on disk and was not claimed by a row above: this game's
    // saves that RomM has never been given.
    for (const [key, file] of localAssets) {
      if (matched.has(key)) continue
      assets.push({
        id: null,
        kind: key.startsWith('save:') ? 'save' : 'state',
        fileName: file.fileName,
        sizeBytes: await sizeOf(file.path, file.isDirectory === true),
        // The tag it *would* carry, which is what makes the row readable: the
        // emulator column would otherwise be blank on exactly the rows that
        // have not been anywhere yet.
        emulator: tag,
        localPath: file.path,
        localModifiedAt: new Date(file.mtimeMs).toISOString(),
        fromThisDevice: null,
        updatedAt: null,
        sync: 'local-only'
      })
    }

    // Newest first, by whichever end last saw it change: the reason to look at
    // this list is almost always "did my last session get uploaded".
    const changedAt = (asset: SaveAsset): string =>
      asset.updatedAt && asset.localModifiedAt
        ? asset.updatedAt > asset.localModifiedAt
          ? asset.updatedAt
          : asset.localModifiedAt
        : (asset.updatedAt ?? asset.localModifiedAt ?? '')
    return assets.sort((a, b) => changedAt(b).localeCompare(changedAt(a)))
  }

  /**
   * Pull on demand, from the button on the detail screen.
   *
   * The `syncSavesDown` preference is deliberately ignored: it governs what
   * happens automatically around a launch, and someone who has just pressed
   * "Pull saves" has said what they want more plainly than a setting can. The
   * newer-wins rule and the `.rommix-bak` copy still apply, so this can never
   * lose a local save.
   */
  async pullNow(target: SaveTarget): Promise<SaveSyncResult> {
    const paths = this.locate(target)
    const saves = await this.pullKind(target, paths, 'save')
    const states = await this.pullKind(target, paths, 'state')
    const result = { saves, states, skippedReason: this.reasonFor(paths, saves + states) }
    log.info('saves', 'pulled on request', { romId: target.rom.id, ...result })
    return result
  }

  /**
   * Push on demand.
   *
   * `since` is 0 rather than a launch time: an explicit push means "send what
   * is on this machine", including saves written before RomMix was installed,
   * which the post-session push deliberately excludes.
   */
  async pushNow(target: SaveTarget): Promise<SaveSyncResult> {
    const paths = this.locate(target)
    const pushed = await this.upload(target, paths, 0)
    const result = {
      ...pushed,
      skippedReason: this.reasonFor(paths, pushed.saves + pushed.states)
    }
    log.info('saves', 'pushed on request', { romId: target.rom.id, ...result })
    return result
  }

  /**
   * What a push would send, without sending it.
   *
   * Deliberately the same three calls the upload itself makes — `locate`, then
   * `locationFor` and `findLocal` per kind, with the same `since` — so the list
   * shown cannot describe a different push from the one that follows. What is
   * added is only what the dialog needs and the upload does not: the size of a
   * directory save, which is not stat-able in one call, and the asset already on
   * the server under each name.
   *
   * `since` is what makes this answer for both callers: 0 for the button, which
   * means everything on disk, and the launch time for the automatic push, which
   * means only what the session wrote.
   *
   * One case can still differ: a save folder that turns out to hold no files is
   * listed here and skipped by the upload, because knowing that means zipping
   * it. It costs an over-count of one on a folder the emulator created and
   * never wrote to, which is not worth a redundant archive to rule out.
   */
  async previewPush(target: SaveTarget, since = 0): Promise<SavePushPreview> {
    const paths = this.locate(target)
    const tag = paths.emulator ?? target.emulator.id
    const files: PendingSave[] = []

    for (const kind of ['save', 'state'] as const) {
      const location = this.locationFor(paths, kind)
      if (!location) continue

      const local = await this.findLocal(location, target.rom, target.romPath, kind, since)
      if (local.length === 0) continue

      // Only asked for once there is something to compare it against: a game
      // with no local saves should not cost a round-trip to the server.
      const remote =
        kind === 'save'
          ? await this.client.saves(target.rom.id).catch(() => [])
          : await this.client.states(target.rom.id).catch(() => [])
      const thisDevice = this.store.credentials.deviceId ?? this.store.settings.deviceId

      for (const asset of local) {
        const existing = remote.find((item) => item.file_name === asset.fileName)
        files.push({
          kind,
          fileName: asset.fileName,
          path: asset.path,
          sizeBytes: await sizeOf(asset.path, asset.isDirectory === true),
          modifiedAt: new Date(asset.mtimeMs).toISOString(),
          emulator: tag,
          isDirectory: asset.isDirectory === true,
          replaces: existing
            ? {
                sizeBytes: existing.file_size_bytes,
                updatedAt: existing.updated_at,
                emulator: existing.emulator,
                fromThisDevice:
                  'origin_device_id' in existing && existing.origin_device_id
                    ? existing.origin_device_id === thisDevice
                    : null
              }
            : null
        })
      }
    }

    // Saves before states, then newest first: the file you are about to send on
    // purpose is almost always the one written most recently.
    files.sort((a, b) =>
      a.kind === b.kind ? b.modifiedAt.localeCompare(a.modifiedAt) : a.kind === 'save' ? -1 : 1
    )

    return {
      files,
      skippedReason: this.reasonFor(paths, files.length),
      deviceName: this.store.settings.deviceName
    }
  }

  /**
   * Send exactly the files a person just approved, named by their paths.
   *
   * The paths are not trusted as paths. They are intersected with a fresh scan
   * of this game's save locations, so what is uploaded is always something
   * RomMix independently found for this ROM — a renderer that asked for
   * `~/.ssh/id_rsa` gets nothing, and neither does one that asks for another
   * game's save.
   *
   * The scan is unbounded in time even when the preview that produced the list
   * was not: a file the session wrote is on disk now, and re-deriving "written
   * after the launch" here would only re-litigate a question the dialog has
   * already answered.
   */
  async pushSelected(target: SaveTarget, chosen: readonly string[]): Promise<SaveSyncResult> {
    const paths = this.locate(target)
    const wanted = new Set(chosen)
    const tag = paths.emulator ?? target.emulator.id
    const moved = { saves: 0, states: 0 }
    /** Which of the approved paths this side actually found again. */
    const found = new Set<string>()

    for (const kind of ['save', 'state'] as const) {
      const location = this.locationFor(paths, kind)
      if (!location) continue

      const local = await this.findLocal(location, target.rom, target.romPath, kind, 0)
      const selected = local.filter((asset) => wanted.has(asset.path))
      if (selected.length === 0) continue

      for (const asset of selected) found.add(asset.path)

      const count = await this.uploadAssets(target, kind, selected, tag)
      if (kind === 'save') moved.saves += count
      else moved.states += count
    }

    // A file the dialog offered that the scan no longer finds is how an
    // approved save silently fails to arrive, and nothing else would say so.
    if (found.size < wanted.size) {
      log.warn('saves', 'some approved files were not found on a fresh scan', {
        romId: target.rom.id,
        approved: wanted.size,
        found: found.size,
        missing: [...wanted].filter((path) => !found.has(path))
      })
    }

    const result = { ...moved, skippedReason: this.reasonFor(paths, moved.saves + moved.states) }
    log.info('saves', 'pushed the approved files', { romId: target.rom.id, ...result })
    return result
  }

  /**
   * Why nothing was synced, when nothing was.
   *
   * Only ever shown alongside a zero count: an emulator whose battery saves are
   * a shared memory card still syncs its states, and reporting "cannot sync"
   * beside three uploaded states would be a lie about work that was done.
   */
  private reasonFor(paths: SavePaths, moved: number): string | null {
    if (moved > 0) return null
    return paths.unsyncableReason ?? null
  }

  /**
   * Delete one asset from wherever it exists — the server, this device, or both.
   *
   * Whichever ends hold it, because deleting one end alone does not stay
   * deleted. RomMix pushes what a session wrote back to RomM, so a save removed
   * only from the server is uploaded again the next time the game is played;
   * and a pull brings a server copy back down over a file removed only here.
   * The local file goes first: if the server then refuses, the asset is still
   * there to pull back, whereas the reverse order can lose both.
   *
   * The asset is found by re-scanning rather than by trusting what the caller
   * passed. `id` identifies a row RomM knows about; a row only this device has
   * is identified by name, and the path it turns out to have is this side's to
   * decide — the renderer names a file, never a location to delete.
   */
  async deleteAsset(
    romId: number,
    kind: 'save' | 'state',
    id: number | null,
    fileName: string,
    local?: SaveTarget
  ): Promise<void> {
    const assets = await this.listAssets(romId, local)
    const asset = assets.find(
      (item) =>
        item.kind === kind &&
        (id === null ? item.id === null && item.fileName === fileName : item.id === id)
    )
    if (!asset) throw new Error(`${fileName} is no longer there to delete`)

    log.info('saves', `deleting a ${kind}`, {
      romId,
      id: asset.id,
      fileName: asset.fileName,
      localPath: asset.localPath,
      onServer: asset.id !== null
    })

    if (asset.localPath) await rm(asset.localPath, { force: true, recursive: true })
    if (asset.id === null) return
    if (kind === 'save') await this.client.deleteSaves([asset.id])
    else await this.client.deleteStates([asset.id])
  }

  /**
   * Is a remote asset one this emulator could load?
   *
   * A save is only meaningful to the emulator that wrote it — a RetroArch
   * `.srm` dropped into Eden's folder is at best ignored and at worst loaded as
   * garbage — so the `emulator` tag RomM records is the filter. Three answers
   * count as ours:
   *
   * - no tag at all: provenance unknown, and refusing everything unlabelled
   *   would ignore saves uploaded through RomM's own web UI. The newer-wins
   *   rule and the `.rommix-bak` copy still stand behind it.
   * - the tag is this emulator.
   * - the tag is the emulator a frontend dispatched to, which is what RomMix
   *   itself sends for a save written under one.
   */
  private accepts(target: SaveTarget, tag: string | null): boolean {
    if (!tag) return true
    if (tag.toLowerCase() === target.emulator.id.toLowerCase()) return true
    // A frontend hands games to other emulators, so a save tagged with one of
    // those is exactly what the emulator underneath will look for. Which
    // programs those are is theirs to declare, not this file's to list.
    return emulatorById(target.emulator.id)?.frontend === true
  }

  private async pullKind(
    target: SaveTarget,
    paths: SavePaths,
    kind: 'save' | 'state'
  ): Promise<number> {
    const location = this.locationFor(paths, kind)
    if (!location) return 0

    const remote =
      kind === 'save'
        ? await this.client.saves(target.rom.id)
        : await this.client.states(target.rom.id)
    if (remote.length === 0) return 0

    // Only what this emulator could load, and for states only the newest few.
    const usable = remote.filter((item) => this.accepts(target, item.emulator))
    const wanted =
      kind === 'state'
        ? [...usable]
            .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
            .slice(0, STATE_PULL_LIMIT)
        : usable
    if (wanted.length === 0) return 0

    const local = await this.findLocal(location, target.rom, target.romPath, kind)
    let written = 0

    for (const item of wanted) {
      const remoteTime = Date.parse(item.updated_at)
      const match = local.find((entry) => entry.fileName === item.file_name)
      if (match && match.mtimeMs >= remoteTime) continue

      const download =
        kind === 'save'
          ? (to: string): Promise<void> => this.client.downloadSave(item.id, to)
          : (to: string): Promise<void> => this.client.downloadState(item.id, to)

      try {
        if (item.file_name.endsWith(ARCHIVE_SUFFIX)) {
          await this.restoreArchive(location.dir, download)
        } else {
          await this.restoreFile(location, item.file_name, match?.path, download)
        }
        written += 1
        log.info('saves', `${kind} pulled`, {
          romId: target.rom.id,
          id: item.id,
          fileName: item.file_name,
          emulator: item.emulator,
          into: match?.path ?? location.dir,
          overwrote: Boolean(match)
        })
      } catch (cause) {
        // A single failed asset should not block the launch — but it is the
        // user's save, and until now nothing anywhere recorded that it did not
        // arrive.
        log.error('saves', `could not pull a ${kind}`, cause, {
          romId: target.rom.id,
          id: item.id,
          fileName: item.file_name,
          dir: location.dir
        })
      }
    }
    return written
  }

  /**
   * Write one pulled file into the location the emulator reads.
   *
   * There is no subdirectory to work out: `location.dir` is already the exact
   * folder the emulator opens, which is the whole point of asking the
   * descriptor rather than guessing from a tag. An asset that matched a file
   * already on disk goes back over that file, wherever it was found — including
   * one of the `search` directories, which is how a save sorted into a folder
   * named after the core is updated in place rather than duplicated.
   */
  private async restoreFile(
    location: SaveLocation,
    fileName: string,
    existing: string | undefined,
    download: (to: string) => Promise<void>
  ): Promise<void> {
    const destination = existing ?? join(location.dir, fileName)
    await mkdir(join(destination, '..'), { recursive: true })

    // Never clobber a local save without keeping a copy.
    if (existing) {
      await copyFile(existing, `${existing}.rommix-bak`).catch(() => undefined)
    }
    await download(destination)
  }

  /**
   * Unpack a directory save over the folder the emulator reads.
   *
   * The existing folder is copied aside as a sibling rather than deleted: a
   * Switch save is a handful of small files, and the archive may not contain
   * every one of them, so overwriting in place and keeping a backup is safer
   * than replacing the directory wholesale.
   */
  private async restoreArchive(
    dir: string,
    download: (to: string) => Promise<void>
  ): Promise<void> {
    const staging = join(tmpdir(), `rommix-save-${Date.now()}.zip`)
    try {
      await download(staging)
      await mkdir(dir, { recursive: true })
      const backup = `${dir}.rommix-bak`
      await rm(backup, { recursive: true, force: true })
      await cpDirectory(dir, backup)
      await extractZip(staging, dir)
    } finally {
      await rm(staging, { force: true })
    }
  }

  /**
   * Push saves and states written during the session back to RomM.
   * `since` is the launch timestamp, so untouched files are left alone.
   */
  async push(target: SaveTarget, since: number): Promise<{ saves: number; states: number }> {
    if (!this.store.settings.syncSavesUp) return { saves: 0, states: 0 }
    return this.upload(target, this.locate(target), since)
  }

  /** The upload itself, with the "should we" decisions already made. */
  private async upload(
    target: SaveTarget,
    paths: SavePaths,
    since: number
  ): Promise<{ saves: number; states: number }> {
    return {
      saves: await this.uploadKind(target, paths, 'save', since),
      states: await this.uploadKind(target, paths, 'state', since)
    }
  }

  private async uploadKind(
    target: SaveTarget,
    paths: SavePaths,
    kind: 'save' | 'state',
    since: number
  ): Promise<number> {
    const location = this.locationFor(paths, kind)
    if (!location) return 0

    const assets = await this.findLocal(location, target.rom, target.romPath, kind, since)
    return this.uploadAssets(target, kind, assets, paths.emulator ?? target.emulator.id)
  }

  /**
   * Put a known list of local files on the server.
   *
   * Split from the finding above so that a confirmed push and an automatic one
   * upload through the same code: which files go is a decision made in two
   * different places, but what "uploading" means must not be.
   */
  private async uploadAssets(
    target: SaveTarget,
    kind: 'save' | 'state',
    assets: readonly LocalAsset[],
    tag: string
  ): Promise<number> {
    let uploaded = 0

    for (const asset of assets) {
      // A directory save is zipped first; the archive is what the server holds.
      let payload = asset.path
      let staged: string | null = null
      try {
        if (asset.isDirectory) {
          staged = join(tmpdir(), `rommix-save-${target.rom.id}-${Date.now()}.zip`)
          const count = await zipDirectory(asset.path, staged)
          if (count === 0) {
            log.info('saves', 'save folder is empty, nothing to upload', {
              romId: target.rom.id,
              dir: asset.path
            })
            continue
          }
          log.debug('saves', 'archived a save folder for upload', {
            romId: target.rom.id,
            dir: asset.path,
            files: count
          })
          payload = staged
        }

        if (kind === 'save') {
          await this.client.uploadSave(target.rom.id, payload, asset.fileName, tag)
        } else {
          await this.client.uploadState(target.rom.id, payload, asset.fileName, tag)
        }
        uploaded += 1
      } catch (cause) {
        // Keep going; a partial sync beats aborting on the first failure. The
        // count the interface shows cannot say which file was left behind, so
        // this line is the only place that names it.
        log.error('saves', `could not upload a ${kind}`, cause, {
          romId: target.rom.id,
          fileName: asset.fileName,
          path: asset.path,
          emulator: tag
        })
      } finally {
        if (staged) await rm(staged, { force: true }).catch(() => undefined)
      }
    }
    return uploaded
  }
}

/**
 * How the two copies of one file compare.
 *
 * The local file's mtime is when the emulator last wrote it; the server's
 * `updated_at` is when it was last *uploaded*, which for the same file is
 * always the later of the two. So "the server's is newer" cannot mean "the
 * server has something else" on its own — and that is what `fromThisDevice`
 * settles: a server copy that is newer and came from here is this file after
 * its upload, not a change made somewhere else.
 *
 * Which leaves states, where RomM records no origin: a state uploaded from
 * this device reads as `remote-newer`. That is the honest answer with what the
 * server tells us, and it is also what a pull would do with it, so the badge
 * does not promise something the buttons would contradict.
 */
function syncStateOf(
  localMtimeMs: number | null,
  remoteUpdatedAt: string,
  fromThisDevice: boolean | null
): SaveSyncState {
  if (localMtimeMs === null) return 'remote-only'

  const remote = Date.parse(remoteUpdatedAt)
  if (!Number.isFinite(remote)) return 'synced'
  if (localMtimeMs > remote) return 'local-newer'
  if (localMtimeMs === remote) return 'synced'
  return fromThisDevice === true ? 'synced' : 'remote-newer'
}

/**
 * How big the thing about to be uploaded is.
 *
 * A directory is summed rather than stat-ed: what the server receives is a zip
 * of everything under it, and the folder's own inode size says nothing about
 * that. Unreadable paths count as zero — the size is shown to a person, and a
 * failed stat is not a reason to fail the dialog.
 */
async function sizeOf(path: string, isDirectory: boolean): Promise<number> {
  if (!isDirectory) return (await stat(path).catch(() => null))?.size ?? 0

  let total = 0
  for (const file of await walk(path)) {
    total += (await stat(file).catch(() => null))?.size ?? 0
  }
  return total
}

/** Recursive copy, for the backup taken before a directory save is overwritten. */
async function cpDirectory(from: string, to: string): Promise<void> {
  let entries
  try {
    entries = await readdir(from, { withFileTypes: true })
  } catch {
    return
  }
  await mkdir(to, { recursive: true })
  for (const entry of entries) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) await cpDirectory(source, target)
    else await copyFile(source, target).catch(() => undefined)
  }
}
