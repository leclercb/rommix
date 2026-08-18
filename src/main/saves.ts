import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { SAVE_CONVENTIONS } from '@config/emulators'
import type { EmulatorState, RemoteAsset, RommRom, SaveSyncResult } from '@shared/types'
import type { RommClient } from './romm'
import type { Store } from './store'

/**
 * Two-way save and save-state sync between RomM and the local emulator tree.
 *
 * The tree walked is the one belonging to whichever emulator ran the game, and
 * both where it starts and how it is shaped come from that emulator's
 * descriptor: `paths.saves`/`paths.states` for the roots, and `saveTree` for
 * whether they are nested per ES-DE system — a frontend's convention, where
 * standalone emulators sit one directory deeper again — or flat, which is what
 * RetroArch does. Below that, RomMix walks a couple of levels and matches on
 * the ROM's file stem rather than encoding every emulator's own arrangement.
 *
 * RomM records which emulator produced each save, and RomMix sends the
 * descriptor id — so a RetroArch `.srm` is not pulled down into an emulator
 * that would not understand it.
 *
 * That only works for emulators that name saves after the ROM, which is what
 * the descriptor's `saveLayout` records. An emulator whose games share one
 * memory card has no per-game save to sync at all, so it is skipped rather
 * than uploading another game's card under this game's id.
 *
 * Conflict policy is deliberately conservative: a remote save only overwrites
 * a local one when it is strictly newer, and the local file is copied aside
 * first. Losing a save file is far worse than an extra sync round-trip.
 */

const SAVE_EXTENSIONS = new Set(SAVE_CONVENTIONS.saveExtensions)
const { statePattern: STATE_PATTERN, maxDepth: MAX_DEPTH } = SAVE_CONVENTIONS

interface LocalAsset {
  path: string
  fileName: string
  mtimeMs: number
  /** Directory name under the system folder, when the emulator nests its saves. */
  emulator: string | null
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
 * Does this emulator produce saves that belong to one game, and are named
 * after it? `shared-device` emulators keep one memory card for every game, so
 * there is nothing here that can honestly be attributed to a single ROM.
 */
function canSyncPerGame(emulator: EmulatorState): boolean {
  return emulator.saveLayout === 'per-game-file' || emulator.saveLayout === 'delegated'
}

/**
 * The directory this emulator's saves for one system actually live in.
 *
 * A frontend files them under the ES-DE system; a standalone emulator writes
 * into its save directory itself. Getting this wrong is not merely a failed
 * search: a pull would create `saves/snes/` beside the flat `saves/` the
 * emulator reads, and the game would start with the save it had before.
 */
function saveDirFor(emulator: EmulatorState, root: string, system: string): string {
  return emulator.saveTree === 'system-nested' ? join(root, system) : root
}

export class SaveSync {
  constructor(
    private readonly store: Store,
    private readonly client: RommClient
  ) {}

  /**
   * Find local save/state files belonging to a ROM.
   *
   * `since` restricts the result to files modified after a timestamp, which is
   * how we detect "what did this play session actually write".
   */
  private async findLocal(
    emulator: EmulatorState,
    root: string | null,
    system: string,
    rom: RommRom,
    kind: 'save' | 'state',
    since = 0
  ): Promise<LocalAsset[]> {
    if (!root) return []
    const systemDir = saveDirFor(emulator, root, system)
    const stem = normaliseStem(rom.fs_name_no_ext)
    const results: LocalAsset[] = []

    for (const path of await walk(systemDir)) {
      const name = basename(path)
      const ext = extname(name).toLowerCase()

      const matchesKind =
        kind === 'state' ? STATE_PATTERN.test(name) : SAVE_EXTENSIONS.has(ext)
      if (!matchesKind) continue

      // Emulators name the save after the ROM file, sometimes with a suffix.
      const fileStem = normaliseStem(name.replace(STATE_PATTERN, '').replace(/\.[^.]+$/, ''))
      if (!fileStem.startsWith(stem) && !stem.startsWith(fileStem)) continue

      let info
      try {
        info = await stat(path)
      } catch {
        continue
      }
      if (info.mtimeMs <= since) continue

      // A file in a subdirectory of the system folder is named for the
      // emulator that wrote it, which is how a frontend separates the
      // standalone emulators it dispatches to.
      const relative = path.slice(systemDir.length + 1)
      const parts = relative.split('/')
      const emulator = parts.length > 1 ? parts[0] : null

      results.push({ path, fileName: name, mtimeMs: info.mtimeMs, emulator })
    }
    return results
  }

  /**
   * Pull newer saves and states from RomM before the game starts.
   * Returns how many files were written locally.
   */
  async pull(rom: RommRom, emulator: EmulatorState, system: string): Promise<number> {
    if (!this.store.settings.syncSavesDown) return 0
    if (!canSyncPerGame(emulator)) return 0

    let written = 0
    written += await this.pullKind(rom, emulator, system, 'save')
    written += await this.pullKind(rom, emulator, system, 'state')
    return written
  }

  /** Everything RomM holds for a ROM, saves and states together. */
  async remoteAssets(romId: number): Promise<RemoteAsset[]> {
    const [saves, states] = await Promise.all([
      this.client.saves(romId),
      this.client.states(romId)
    ])

    const assets: RemoteAsset[] = [
      ...saves.map((save): RemoteAsset => ({
        id: save.id,
        kind: 'save',
        fileName: save.file_name,
        sizeBytes: save.file_size_bytes,
        emulator: save.emulator,
        updatedAt: save.updated_at
      })),
      ...states.map((state): RemoteAsset => ({
        id: state.id,
        kind: 'state',
        fileName: state.file_name,
        sizeBytes: state.file_size_bytes,
        emulator: state.emulator,
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
  async pullNow(rom: RommRom, emulator: EmulatorState, system: string): Promise<SaveSyncResult> {
    const skippedReason = this.unsyncableReason(emulator)
    if (skippedReason) return { saves: 0, states: 0, skippedReason }

    return {
      saves: await this.pullKind(rom, emulator, system, 'save'),
      states: await this.pullKind(rom, emulator, system, 'state'),
      skippedReason: null
    }
  }

  /**
   * Push on demand.
   *
   * `since` is 0 rather than a launch time: an explicit push means "send what
   * is on this machine", including saves written before RomMix was installed,
   * which the post-session push deliberately excludes.
   */
  async pushNow(rom: RommRom, emulator: EmulatorState, system: string): Promise<SaveSyncResult> {
    const skippedReason = this.unsyncableReason(emulator)
    if (skippedReason) return { saves: 0, states: 0, skippedReason }

    const pushed = await this.upload(rom, emulator, system, 0)
    return { ...pushed, skippedReason: null }
  }

  /** Why this emulator's saves cannot be attributed to one game, if they cannot. */
  private unsyncableReason(emulator: EmulatorState): string | null {
    if (canSyncPerGame(emulator)) return null
    if (emulator.saveLayout === 'shared-device') {
      return `${emulator.name} keeps one memory card for every game, so there is no save file ` +
        'that belongs to this one.'
    }
    return `${emulator.name} stores saves by title id rather than by filename, which RomMix ` +
      'cannot match to a ROM.'
  }

  private async pullKind(
    rom: RommRom,
    emulator: EmulatorState,
    system: string,
    kind: 'save' | 'state'
  ): Promise<number> {
    const root = kind === 'save' ? emulator.paths.saves : emulator.paths.states
    if (!root) return 0

    const remote =
      kind === 'save' ? await this.client.saves(rom.id) : await this.client.states(rom.id)
    if (remote.length === 0) return 0

    const local = await this.findLocal(emulator, root, system, rom, kind)
    const targetDir = saveDirFor(emulator, root, system)
    let written = 0

    for (const item of remote) {
      const remoteTime = Date.parse(item.updated_at)
      const match = local.find((l) => l.fileName === item.file_name)

      if (match && match.mtimeMs >= remoteTime) continue

      const destination = match?.path ?? join(targetDir, item.file_name)
      await mkdir(join(destination, '..'), { recursive: true })

      // Never clobber a local save without keeping a copy.
      if (match) {
        await copyFile(match.path, `${match.path}.rommix-bak`).catch(() => undefined)
      }

      try {
        if (kind === 'save') await this.client.downloadSave(item.id, destination)
        else await this.client.downloadState(item.id, destination)
        written += 1
      } catch {
        // A single failed asset should not block the launch.
      }
    }
    return written
  }

  /**
   * Push saves and states written during the session back to RomM.
   * `since` is the launch timestamp, so untouched files are left alone.
   */
  async push(
    rom: RommRom,
    emulator: EmulatorState,
    system: string,
    since: number
  ): Promise<{ saves: number; states: number }> {
    if (!this.store.settings.syncSavesUp) return { saves: 0, states: 0 }
    if (!canSyncPerGame(emulator)) return { saves: 0, states: 0 }
    return this.upload(rom, emulator, system, since)
  }

  /** The upload itself, with the "should we" decisions already made. */
  private async upload(
    rom: RommRom,
    emulator: EmulatorState,
    system: string,
    since: number
  ): Promise<{ saves: number; states: number }> {
    const saves = await this.findLocal(emulator, emulator.paths.saves, system, rom, 'save', since)
    const states = await this.findLocal(emulator, emulator.paths.states, system, rom, 'state', since)

    let uploadedSaves = 0
    for (const asset of saves) {
      try {
        await this.client.uploadSave(
          rom.id,
          asset.path,
          asset.fileName,
          asset.emulator ?? emulator.id
        )
        uploadedSaves += 1
      } catch {
        // Keep going; a partial sync beats aborting on the first failure.
      }
    }

    let uploadedStates = 0
    for (const asset of states) {
      try {
        await this.client.uploadState(
          rom.id,
          asset.path,
          asset.fileName,
          asset.emulator ?? emulator.id
        )
        uploadedStates += 1
      } catch {
        // as above
      }
    }

    return { saves: uploadedSaves, states: uploadedStates }
  }
}
