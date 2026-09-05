import { mkdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { localize } from '@shared/i18n'
import { changedAt, mayBeSentUnasked } from '@shared/saveassets'
import { SAVE_CONVENTIONS, emulatorById } from '@config/emulators'
import type { SaveContext, SaveLocation, SavePaths } from '@config/emulators'
import type {
  EmulatorState,
  PendingSave,
  RommDevice,
  RommRom,
  RommSave,
  RommState,
  SaveAsset,
  SaveDeleteScope,
  SavePushPreview,
  SaveSyncResult
} from '@shared/types'
import { refusedUs } from './romm/index.ts'
import type { RommClient } from './romm/index.ts'
import type { Store } from './store.ts'
import { i18n, t } from './i18n.ts'
import { realHome } from './xdg.ts'
import { log } from './log.ts'
import { fileSystemEnvironment } from './saveenv.ts'
import {
  acceptsTag,
  keepBackup,
  localTag,
  romStemOf,
  sizeOf,
  stampMtime,
  stemMatches,
  syncStateOf,
  walk,
  SYNC_TOLERANCE_MS
} from './savefiles.ts'
import { extractZip, zipDirectory } from './zip.ts'

/**
 * Two-way save and save-state sync between RomM and the local emulator tree.
 *
 * Where those files are is not decided here. The emulator's descriptor answers
 * that per game — see `src/config/emulators/savepaths.ts` — because the answer
 * depends on which core RetroArch loaded, which of RetroDECK's bundled
 * emulators ES-DE chose, and which Switch profile owns a title. This file's job
 * is everything that is the same whatever the answer turned out to be: what to
 * upload, what to bring down, and in which order. Which files belong to the
 * game, which end of a pair is ahead, and whose emulator's files they are, are
 * decided in `savefiles.ts`.
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
 * RomM records which emulator produced each save, and both directions use the
 * same answer for what this device is — `localTag` — so a RetroArch `.srm` is
 * not pulled down into an emulator that would not understand it, and a save a
 * frontend wrote is not rejected by the frontend that wrote it.
 *
 * Conflict policy is deliberately conservative: a remote asset only overwrites
 * a local one when it is strictly newer, and the local file is copied aside
 * first — into the RomMix folder, a few deep, see `keepBackup`. Losing a save
 * file is far worse than an extra sync round-trip.
 */

const SAVE_EXTENSIONS = new Set(SAVE_CONVENTIONS.saveExtensions)
const { statePattern: STATE_PATTERN } = SAVE_CONVENTIONS

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
 * stay on the server and are still listed on the game screen.
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

/**
 * The device a copy on the server came from, where it records one.
 *
 * Saves alone: RomM's `StateSchema` has no origin field, so a state's answer is
 * that there is nothing to answer with.
 */
function originIdOf(item: RommSave | RommState): string | null {
  return 'origin_device_id' in item && typeof item.origin_device_id === 'string'
    ? item.origin_device_id
    : null
}

/**
 * A save's `origin_device_id` turned into the name of the machine it came from.
 *
 * Matched against both identifiers a device carries, because either can be the
 * one a save was uploaded under — see `RommDevice`. Falls back to `hostname`
 * where the device was never named: RomM leaves `name` null for a client that
 * sent none, and the machine's own name still beats "another device".
 */
function deviceNamer(devices: readonly RommDevice[]): (id: string | null) => string | null {
  return (id) => {
    if (!id) return null
    const device = devices.find(
      (candidate) => candidate.id === id || candidate.client_device_identifier === id
    )
    return device?.name ?? device?.hostname ?? null
  }
}

export class SaveSync {
  private readonly env = fileSystemEnvironment()

  constructor(
    private readonly store: Store,
    private readonly client: RommClient,
    /** Where the saves a pull displaces are kept, one folder per game. */
    private readonly backups: string
  ) {}

  /**
   * The folder holding the copies of one game's saves.
   *
   * Keyed by the RomM id rather than the game's name, which is what identifies
   * a game everywhere else RomMix writes something down — see `OfflineCache` —
   * and is the only key two systems cannot collide on.
   */
  private backupDir(romId: number): string {
    return join(this.backups, String(romId))
  }

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
        unsyncableReason: localize(paths.unsyncableReason, i18n())
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

  /** The tag this device uploads under — see `localTag` in `savefiles.ts`. */
  private tagFor(paths: SavePaths, target: SaveTarget): string {
    return localTag(paths, target.emulator.id)
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
    const remote = await this.remoteEnds(romId)
    const saves = remote?.saves ?? []
    const states = remote?.states ?? []
    const nameOf = deviceNamer(remote?.devices ?? [])

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
      tag = this.tagFor(paths, local)
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

        const originId = originIdOf(item)
        const fromThisDevice = originId ? originId === thisDevice : null

        assets.push({
          id: item.id,
          kind,
          fileName: item.file_name,
          sizeBytes: item.file_size_bytes,
          emulator: item.emulator,
          localPath: localFile?.path ?? null,
          localModifiedAt: localFile ? new Date(localFile.mtimeMs).toISOString() : null,
          fromThisDevice,
          originName: nameOf(originId),
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
        originName: null,
        updatedAt: null,
        // What is known, and no more. With the server unasked, "only on this
        // device" is a claim about a end nobody looked at — see `unchecked`.
        sync: remote ? 'local-only' : 'unchecked'
      })
    }

    // Newest first, by the end that is ahead: the reason to look at this list
    // is almost always "did my last session get uploaded".
    //
    // Parsed rather than compared as text, because the two ends are stamped by
    // different clocks and need not write an instant the same way: RomM sends
    // `updated_at` in whatever offset it keeps, and this device writes `Z`, so
    // as text `14:00+02:00` sorts after the `13:00Z` that came after it. A
    // stamp that will not parse sorts last rather than anywhere.
    const at = (asset: SaveAsset): number => Date.parse(changedAt(asset) ?? '') || 0
    return assets.sort((a, b) => at(b) - at(a))
  }

  /**
   * Both of RomM's lists for this game, and the devices that named them — or
   * null when the server could not be asked at all.
   *
   * Null rather than empty, because the two mean opposite things to the list
   * above: an empty answer is "RomM has none of this game's saves", which makes
   * every local file a push candidate, and no answer is "nobody knows", which
   * makes none of them anything yet. Conflating them is what would put a Push
   * badge on a row whose server copy might be newer than the one here.
   *
   * A refusal is still a failure. RomM turning this request down — a token
   * without `assets.read`, most likely — is the one thing wrong on the screen,
   * and drawing a list of local files with no mention of it hides it.
   */
  private async remoteEnds(
    romId: number
  ): Promise<{ saves: RommSave[]; states: RommState[]; devices: RommDevice[] } | null> {
    try {
      const [saves, states, devices] = await Promise.all([
        this.client.saves(romId),
        this.client.states(romId),
        // Alongside, not before: it is cached and usually free, and a row would
        // rather be a moment late than named nothing at all.
        this.client.devices()
      ])
      return { saves, states, devices }
    } catch (cause) {
      if (refusedUs(cause)) throw cause
      log.info('saves', 'the server could not be asked, listing what is on this device', {
        romId,
        reason: (cause as Error).message
      })
      return null
    }
  }

  /**
   * Pull on demand, from the button on the game screen.
   *
   * The `syncSavesDown` preference is deliberately ignored: it governs what
   * happens automatically around a launch, and someone who has just pressed
   * "Pull saves" has said what they want more plainly than a setting can. The
   * newer-wins rule and the copy `keepBackup` puts aside still apply, so this
   * can never lose a local save.
   */
  async pullNow(target: SaveTarget): Promise<SaveSyncResult> {
    const paths = this.locate(target)
    const saves = await this.pullKind(target, paths, 'save')
    const states = await this.pullKind(target, paths, 'state')
    const result = {
      saves,
      states,
      failed: 0,
      skippedReason: this.reasonFor(paths, saves + states)
    }
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
   * A file RomM already holds the same copy of is left out and counted in
   * `inSync` instead: sending it would upload it over itself, so it is not a
   * decision worth putting in front of anyone, and the count is what lets
   * "everything here is already up there" be told apart from "there is nothing
   * here".
   *
   * One case can still differ: a save folder that turns out to hold no files is
   * listed here and skipped by the upload, because knowing that means zipping
   * it. It costs an over-count of one on a folder the emulator created and
   * never wrote to, which is not worth a redundant archive to rule out.
   */
  async previewPush(target: SaveTarget, since = 0): Promise<SavePushPreview> {
    const paths = this.locate(target)
    const tag = this.tagFor(paths, target)
    const files: PendingSave[] = []
    let inSync = 0

    for (const kind of ['save', 'state'] as const) {
      const location = this.locationFor(paths, kind)
      if (!location) continue

      const local = await this.findLocal(location, target.rom, target.romPath, kind, since)
      if (local.length === 0) continue

      // Only asked for once there is something to compare it against: a game
      // with no local saves should not cost a round-trip to the server.
      //
      // Not caught. A refused listing read as an empty one puts "New on RomM"
      // against every file in the dialog, when what the push would actually do
      // is overwrite. Failing the preview is the honest answer.
      const remote =
        kind === 'save'
          ? await this.client.saves(target.rom.id)
          : await this.client.states(target.rom.id)
      const thisDevice = this.store.credentials.deviceId ?? this.store.settings.deviceId
      const nameOf = deviceNamer(await this.client.devices())

      for (const asset of local) {
        const existing = remote.find((item) => item.file_name === asset.fileName)
        const originId = existing ? originIdOf(existing) : null
        const fromThisDevice = originId ? originId === thisDevice : null
        const state = existing
          ? syncStateOf(asset.mtimeMs, existing.updated_at, fromThisDevice)
          : null

        if (state === 'synced') {
          inSync += 1
          continue
        }

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
                fromThisDevice,
                originName: nameOf(originId),
                isNewer: state === 'remote-newer'
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
      inSync,
      // Counted with the files: an emulator whose saves cannot be synced per
      // game has none of either, so a game whose copies are all up there is not
      // one to report a sync layout problem against.
      skippedReason: this.reasonFor(paths, files.length + inSync),
      deviceName: this.store.settings.deviceName
    }
  }

  /**
   * Send what a session written out of range can be sent without asking.
   *
   * The whole point of the pass, and the reason it re-decides rather than
   * replays: what would have been safe to send a fortnight ago says nothing
   * about what is on the server now. So the preview is taken *again*, against
   * RomM as it is this minute, and every file is put to `mayBeSentUnasked` —
   * which sends only where the copy up there is this device's own, or where
   * there is none at all.
   *
   * Whatever is left is neither sent nor thrown away. It stays a question, on
   * the game's own screen, with both copies in front of whoever answers it.
   *
   * Reports what is still waiting so the caller can say so once, rather than a
   * notification per file for a game nobody has looked at yet.
   */
  async drain(
    target: SaveTarget,
    since: number,
    options: { sendUnasked: boolean }
  ): Promise<{ sent: number; conflicts: number; ready: number }> {
    const preview = await this.previewPush(target, since)
    const unasked = preview.files.filter((file) => mayBeSentUnasked(file))
    const conflicts = preview.files.length - unasked.length

    // Nothing to send, or a user who has asked to be asked. Either way this
    // pass moves no bytes, and the files stay where they are with the record
    // still pointing at them.
    if (!options.sendUnasked || unasked.length === 0) {
      if (preview.files.length > 0) {
        log.info('saves', 'saves written away from the server are waiting', {
          romId: target.rom.id,
          ready: unasked.length,
          conflicts,
          asked: !options.sendUnasked
        })
      }
      return { sent: 0, conflicts, ready: unasked.length }
    }

    const result = await this.pushSelected(
      target,
      unasked.map((file) => file.path)
    )
    const sent = result.saves + result.states
    /**
     * What was meant to go, did not, and is still here.
     *
     * The server's refusals, rather than everything that did not arrive:
     * uploading passes over a save folder that turns out to be empty without
     * either sending or failing it, and counted as still waiting that game
     * would never clear — a permanent notice about a folder an emulator made
     * and never wrote to.
     */
    const ready = result.failed
    log.info('saves', 'sent what was written away from the server', {
      romId: target.rom.id,
      sent,
      ready,
      conflicts
    })
    return { sent, conflicts, ready }
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
    const tag = this.tagFor(paths, target)
    const moved = { saves: 0, states: 0, failed: 0 }
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
      if (kind === 'save') moved.saves += count.sent
      else moved.states += count.sent
      moved.failed += count.failed
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
    // The descriptor names the phrase; only here is there a language to say it
    // in. See `Text` in `@shared/i18n`.
    return localize(paths.unsyncableReason, i18n())
  }

  /**
   * Delete one asset from one end of the sync.
   *
   * One end, because the two ends are two copies and the reason to remove one
   * is almost always that the other is the one worth keeping: a local file that
   * a crash left corrupt is deleted here so the next pull brings RomM's copy
   * down, and a stale server copy is deleted there so the next push replaces
   * it. Clearing both at once serves neither, and is two presses away.
   *
   * What it does not do is stay deleted on its own. Sync runs in both
   * directions around a launch, so the surviving copy comes back over the
   * deleted one — that is the point of deleting one end.
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
    scope: SaveDeleteScope,
    local?: SaveTarget
  ): Promise<void> {
    const assets = await this.listAssets(romId, local)
    const asset = assets.find(
      (item) =>
        item.kind === kind &&
        (id === null ? item.id === null && item.fileName === fileName : item.id === id)
    )
    if (!asset) throw new Error(t('error.assetGone', { file: fileName }))

    log.info('saves', `deleting a ${kind}`, {
      romId,
      scope,
      id: asset.id,
      fileName: asset.fileName,
      localPath: asset.localPath
    })

    if (scope === 'local') {
      if (!asset.localPath) throw new Error(t('error.assetNotLocal', { file: fileName }))
      await rm(asset.localPath, { force: true, recursive: true })
      return
    }

    if (asset.id === null) throw new Error(t('error.assetNotRemote', { file: fileName }))
    if (kind === 'save') await this.client.deleteSaves([asset.id])
    else await this.client.deleteStates([asset.id])
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

    /**
     * Whether the tag on the server decides what may come down.
     *
     * For a battery save it does not. The file is named after the ROM and holds
     * whatever format the *system* settled on — a raw memory card, a raw SRAM
     * dump — which every emulator for that system reads, so the tag says who
     * wrote it and not who can load it. RomM keeps one file per name per game
     * and records the emulator beside it rather than filing under it, so
     * refusing the only copy there is means sitting down to a game with no save
     * at all. That is the worse of the two mistakes, and it is the one this made
     * on every save RomM's own browser player wrote. The newer-wins rule still
     * applies and `keepBackup` still keeps what was displaced, so the other
     * mistake is recoverable.
     *
     * A state is the opposite, and takes the strictest reading there is: only a
     * tag that matches. It is a snapshot of one core's memory under a name every
     * core uses — `game.state1` — so the wrong one is not ignored on load, it is
     * loaded, and the emulator crashes or corrupts the session. An untagged one
     * is refused with the rest, silence being no evidence that this core wrote
     * it.
     *
     * Only the permissive case is named below, so everything else keeps the
     * filter by default — which is what covers the third shape, a directory
     * save carried as one archive. That is an emulator's own tree and unpacks
     * over another's exactly as a state loads over one, and it is `directory()`
     * in `savepaths.ts` that sets `archive`, always beside `match: 'directory'`
     * and never beside `rom-stem`. A shape added later is filtered until
     * somebody decides otherwise here, which is the right way round.
     */
    const anyEmulator = kind === 'save' && location.match === 'rom-stem'
    const tag = this.tagFor(paths, target)
    const usable = anyEmulator
      ? remote
      : remote.filter((item) => acceptsTag(tag, item.emulator, paths.alsoAccepts))
    // What was left, and why. A pull that brings nothing down is otherwise a
    // count of zero against a screen that is still listing the file — which is
    // the shape this arrived as a bug report in.
    if (usable.length < remote.length) {
      log.info('saves', `left ${kind}s that another emulator wrote`, {
        romId: target.rom.id,
        loads: tag,
        left: remote
          .filter((item) => !usable.includes(item))
          .map((item) => ({ fileName: item.file_name, emulator: item.emulator }))
      })
    }

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
      // The same tolerance the badge uses, so a copy the screen calls "in sync"
      // is never one this loop downloads again.
      if (match && match.mtimeMs >= remoteTime - SYNC_TOLERANCE_MS) continue

      const download =
        kind === 'save'
          ? (to: string): Promise<void> => this.client.downloadSave(item.id, to)
          : (to: string): Promise<void> => this.client.downloadState(item.id, to)

      try {
        const backups = this.backupDir(target.rom.id)
        if (item.file_name.endsWith(ARCHIVE_SUFFIX)) {
          await this.restoreArchive(location.dir, backups, download, remoteTime)
        } else {
          await this.restoreFile(
            location,
            item.file_name,
            match?.path,
            backups,
            download,
            remoteTime
          )
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
    backups: string,
    download: (to: string) => Promise<void>,
    remoteTime: number
  ): Promise<void> {
    const destination = existing ?? join(location.dir, fileName)
    await mkdir(join(destination, '..'), { recursive: true })

    // Never clobber a local save without keeping a copy.
    if (existing) await keepBackup(existing, backups)
    await download(destination)
    await stampMtime(destination, remoteTime)
  }

  /**
   * Unpack a directory save over the folder the emulator reads.
   *
   * The existing folder is copied aside rather than deleted: a Switch save is a
   * handful of small files, and the archive may not contain every one of them,
   * so overwriting in place and keeping a backup is safer than replacing the
   * directory wholesale.
   */
  private async restoreArchive(
    dir: string,
    backups: string,
    download: (to: string) => Promise<void>,
    remoteTime: number
  ): Promise<void> {
    const staging = join(tmpdir(), `rommix-save-${Date.now()}.zip`)
    try {
      await download(staging)
      await mkdir(dir, { recursive: true })
      await keepBackup(dir, backups, true)
      await extractZip(staging, dir)
      // Every file, not just the extracted ones: `findLocal` reads a directory
      // save's age as the newest mtime anywhere under it, so one file the
      // archive did not carry would keep the whole folder reading as newer.
      for (const file of await walk(dir)) await stampMtime(file, remoteTime)
    } finally {
      await rm(staging, { force: true })
    }
  }

  /**
   * Push saves and states written during the session back to RomM.
   * `since` is the launch timestamp, so untouched files are left alone.
   */
  async push(
    target: SaveTarget,
    since: number
  ): Promise<{ saves: number; states: number; failed: number }> {
    if (!this.store.settings.syncSavesUp) return { saves: 0, states: 0, failed: 0 }
    return this.upload(target, this.locate(target), since)
  }

  /** The upload itself, with the "should we" decisions already made. */
  private async upload(
    target: SaveTarget,
    paths: SavePaths,
    since: number
  ): Promise<{ saves: number; states: number; failed: number }> {
    const saves = await this.uploadKind(target, paths, 'save', since)
    const states = await this.uploadKind(target, paths, 'state', since)
    return { saves: saves.sent, states: states.sent, failed: saves.failed + states.failed }
  }

  private async uploadKind(
    target: SaveTarget,
    paths: SavePaths,
    kind: 'save' | 'state',
    since: number
  ): Promise<{ sent: number; failed: number }> {
    const location = this.locationFor(paths, kind)
    if (!location) return { sent: 0, failed: 0 }

    const assets = await this.findLocal(location, target.rom, target.romPath, kind, since)
    return this.uploadAssets(target, kind, assets, this.tagFor(paths, target))
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
  ): Promise<{ sent: number; failed: number }> {
    let uploaded = 0
    let failed = 0

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

        const sent =
          kind === 'save'
            ? await this.client.uploadSave(target.rom.id, payload, asset.fileName, tag)
            : await this.client.uploadState(target.rom.id, payload, asset.fileName, tag)
        uploaded += 1
        await this.stampUploaded(asset, Date.parse(sent.updated_at))
      } catch (cause) {
        // Keep going; a partial sync beats aborting on the first failure. But
        // it is counted: a caller that cannot tell "sent nothing because there
        // was nothing" from "sent nothing because the server is gone" throws
        // away the record of files that are still only on this disk. The count
        // the interface shows cannot say *which* file was left behind, so this
        // line is the only place that names it.
        log.error('saves', `could not upload a ${kind}`, cause, {
          romId: target.rom.id,
          fileName: asset.fileName,
          path: asset.path,
          emulator: tag
        })
        failed += 1
      } finally {
        if (staged) await rm(staged, { force: true }).catch(() => undefined)
      }
    }
    return { sent: uploaded, failed }
  }

  /**
   * Date a file that has just been sent as the copy the server now holds.
   *
   * The mirror of what a pull does, and for the same reason: `updated_at` is
   * when the upload happened, which is later than the mtime of the very file it
   * was made from. Left alone, a save reads as older than its own copy the
   * moment it is pushed, and the game screen lists it as waiting to be pulled
   * back.
   *
   * A directory is stamped file by file, since `findLocal` reads a folder
   * save's age as the newest mtime anywhere under it. An `updated_at` that does
   * not parse leaves every mtime alone: the file is still the file, and the
   * only cost is a badge that invites a pull of what is already here.
   */
  private async stampUploaded(asset: LocalAsset, remoteTime: number): Promise<void> {
    if (!Number.isFinite(remoteTime)) return
    if (!asset.isDirectory) {
      await stampMtime(asset.path, remoteTime)
      return
    }
    for (const file of await walk(asset.path)) await stampMtime(file, remoteTime)
  }
}
