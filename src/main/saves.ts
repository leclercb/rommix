import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { EmulatorState, RommRom } from '@shared/types'
import type { RommClient } from './romm'
import type { Store } from './store'

/**
 * Two-way save and save-state sync between RomM and the local emulator tree.
 *
 * RetroDECK keeps saves at `<saves_path>/<system>/…` and states at
 * `<states_path>/<system>/…`. Libretro cores write `<rom name>.srm` next to
 * that; standalone emulators nest one directory deeper under their own name.
 * Rather than encode every emulator's convention, RomMix walks a couple of
 * levels down and matches on the ROM's file stem.
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

/** Extensions we treat as battery saves. */
const SAVE_EXTENSIONS = new Set([
  '.srm', '.sav', '.rtc', '.eep', '.fla', '.mcr', '.mcd', '.gme', '.dsv', '.ss0', '.bsv'
])

/** Save-state extensions; RetroArch numbers them .state1, .state2, … */
const STATE_PATTERN = /\.(state|auto)\d*$/i

const MAX_DEPTH = 3

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
    root: string | null,
    system: string,
    rom: RommRom,
    kind: 'save' | 'state',
    since = 0
  ): Promise<LocalAsset[]> {
    if (!root) return []
    const systemDir = join(root, system)
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

      // If the file sits in a subdirectory of the system folder, that folder is
      // the emulator name (RetroDECK's convention for standalone emulators).
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

    const local = await this.findLocal(root, system, rom, kind)
    const targetDir = join(root, system)
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

    const saves = await this.findLocal(emulator.paths.saves, system, rom, 'save', since)
    const states = await this.findLocal(emulator.paths.states, system, rom, 'state', since)

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
