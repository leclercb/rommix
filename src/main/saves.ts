import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { SAVE_CONVENTIONS, emulatorById } from '@config/emulators'
import type { SaveContext, SaveLocation, SavePaths } from '@config/emulators'
import type { EmulatorState, RemoteAsset, RommRom, SaveSyncResult } from '@shared/types'
import type { RommClient } from './romm'
import type { Store } from './store'
import { realHome } from './host'
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

/**
 * The programs that run games through *other* emulators.
 *
 * They accept a save tagged with any of those, because the emulator underneath
 * is what will read it. A standalone emulator accepts only its own.
 */
const FRONTENDS = new Set(['retrodeck', 'emudeck'])

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
      return descriptor.saves(context)
    } catch {
      // A descriptor that fails to resolve a path is a bug, but not one worth
      // turning into a failed launch: the game still runs, unsynced.
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

        const matchesKind =
          kind === 'state' ? STATE_PATTERN.test(name) : SAVE_EXTENSIONS.has(ext)
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
    if (!this.store.settings.syncSavesDown) return 0
    const paths = this.locate(target)

    let written = 0
    written += await this.pullKind(target, paths, 'save')
    written += await this.pullKind(target, paths, 'state')
    return written
  }

  /**
   * Everything RomM holds for a ROM, saves and states together, each marked
   * with the local file it corresponds to.
   *
   * `local` is absent for a game that is not downloaded — there is no save tree
   * to look in — and every asset is then simply not on this device.
   */
  async remoteAssets(romId: number, local?: SaveTarget): Promise<RemoteAsset[]> {
    const [saves, states] = await Promise.all([
      this.client.saves(romId),
      this.client.states(romId)
    ])

    /**
     * The file on this device that a remote asset is a copy of, by name.
     *
     * `findLocal` matches on the ROM's stem, which is how a save is recognised
     * as belonging to this game at all; the exact file name then picks out
     * which of them the server is talking about.
     */
    const localByName = new Map<string, string>()
    if (local) {
      const paths = this.locate(local)
      for (const kind of ['save', 'state'] as const) {
        const location = this.locationFor(paths, kind)
        if (!location) continue
        const found = await this.findLocal(location, local.rom, local.romPath, kind)
        for (const file of found) {
          localByName.set(`${kind}:${file.fileName.toLowerCase()}`, file.path)
        }
      }
    }
    const localFor = (kind: 'save' | 'state', fileName: string): string | null =>
      localByName.get(`${kind}:${fileName.toLowerCase()}`) ?? null

    // What this device calls itself on the server, so a save can say where it
    // came from. RomM's own id where the device was paired, the local one
    // otherwise — the same pair `uploadSave` sends.
    const thisDevice = this.store.credentials.deviceId ?? this.store.settings.deviceId

    const assets: RemoteAsset[] = [
      ...saves.map((save): RemoteAsset => ({
        id: save.id,
        kind: 'save',
        fileName: save.file_name,
        sizeBytes: save.file_size_bytes,
        emulator: save.emulator,
        localPath: localFor('save', save.file_name),
        fromThisDevice: save.origin_device_id ? save.origin_device_id === thisDevice : null,
        updatedAt: save.updated_at
      })),
      ...states.map((state): RemoteAsset => ({
        id: state.id,
        kind: 'state',
        fileName: state.file_name,
        sizeBytes: state.file_size_bytes,
        emulator: state.emulator,
        localPath: localFor('state', state.file_name),
        // States carry no origin on the server, so there is nothing to claim.
        fromThisDevice: null,
        updatedAt: state.updated_at
      }))
    ]

    // Newest first: the reason to look at this list is almost always "did my
    // last session get uploaded".
    return assets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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
    return { saves, states, skippedReason: this.reasonFor(paths, saves + states) }
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
    return { ...pushed, skippedReason: this.reasonFor(paths, pushed.saves + pushed.states) }
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
   * Delete one asset from the server, and the copy on this device with it.
   *
   * Both, or neither is worth doing. RomMix pushes what a session wrote back to
   * RomM, so a save deleted only on the server is uploaded again the next time
   * the game is played — the delete would appear to work and then quietly undo
   * itself. The local file goes first: if the server then refuses, the asset is
   * still there to pull back, whereas the reverse order can lose both.
   */
  async deleteAsset(
    romId: number,
    kind: 'save' | 'state',
    id: number,
    local?: SaveTarget
  ): Promise<void> {
    const assets = await this.remoteAssets(romId, local)
    const asset = assets.find((item) => item.kind === kind && item.id === id)

    if (asset?.localPath) await rm(asset.localPath, { force: true, recursive: true })
    if (kind === 'save') await this.client.deleteSaves([id])
    else await this.client.deleteStates([id])
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
   * - the tag is the emulator this frontend dispatched to, which is what
   *   RomMix itself sends for a save written under RetroDECK or EmuDeck.
   */
  private accepts(target: SaveTarget, tag: string | null): boolean {
    if (!tag) return true
    if (tag.toLowerCase() === target.emulator.id.toLowerCase()) return true
    // A frontend hands games to standalone emulators, and a save tagged with
    // one of those is exactly what the emulator underneath will look for. What
    // makes a frontend a frontend is that it offers a choice of them.
    return FRONTENDS.has(target.emulator.id)
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

      const download = kind === 'save'
        ? (to: string): Promise<void> => this.client.downloadSave(item.id, to)
        : (to: string): Promise<void> => this.client.downloadState(item.id, to)

      try {
        if (item.file_name.endsWith(ARCHIVE_SUFFIX)) {
          await this.restoreArchive(location.dir, download)
        } else {
          await this.restoreFile(location, item.file_name, match?.path, download)
        }
        written += 1
      } catch {
        // A single failed asset should not block the launch.
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
    let uploaded = 0

    for (const asset of assets) {
      // A directory save is zipped first; the archive is what the server holds.
      let payload = asset.path
      let staged: string | null = null
      try {
        if (asset.isDirectory) {
          staged = join(tmpdir(), `rommix-save-${target.rom.id}-${Date.now()}.zip`)
          const count = await zipDirectory(asset.path, staged)
          if (count === 0) continue
          payload = staged
        }

        const tag = paths.emulator ?? target.emulator.id
        if (kind === 'save') {
          await this.client.uploadSave(target.rom.id, payload, asset.fileName, tag)
        } else {
          await this.client.uploadState(target.rom.id, payload, asset.fileName, tag)
        }
        uploaded += 1
      } catch {
        // Keep going; a partial sync beats aborting on the first failure.
      } finally {
        if (staged) await rm(staged, { force: true }).catch(() => undefined)
      }
    }
    return uploaded
  }
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
