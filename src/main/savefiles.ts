import { copyFile, mkdir, readdir, stat, utimes } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { SAVE_CONVENTIONS } from '@config/emulators'
import type { RommRom, SaveSyncState } from '@shared/types'

/**
 * The judgements save sync makes about files, without any of the moving.
 *
 * Two of them decide whether a save is handled correctly at all: whether a file
 * on disk belongs to this game, and which end of a pair is ahead. Both are
 * about names and timestamps rather than about RomM or an emulator, so they are
 * here — testable on their own, which `saves.test.ts` is — and the rest is the
 * filesystem work they imply.
 */

const { maxDepth: MAX_DEPTH } = SAVE_CONVENTIONS

/**
 * How far apart two timestamps may be and still count as the same file.
 *
 * A pulled file is stamped with the server's `updated_at` so that the copy and
 * its original read as one thing, but the stamp does not always survive the
 * disk: FAT32 and exFAT — what a handheld's SD card is formatted as — record
 * mtimes to the nearest two seconds. Without a tolerance, every save pulled
 * onto a card would come back rounded up and read as "newer here" the moment
 * it landed.
 */
export const SYNC_TOLERANCE_MS = 2000

/** Walk a directory tree collecting files, bounded so a huge library stays fast. */
export async function walk(dir: string, depth = 0): Promise<string[]> {
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
export function stemMatches(fileStem: string, romStem: string): boolean {
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
export function romStemOf(rom: RommRom, romPath: string): string {
  return rom.fs_name_no_ext || basename(romPath).replace(/\.[^.]+$/, '')
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
 *
 * The other direction is settled by the pull itself, which stamps what it
 * writes with the server's `updated_at` rather than leaving it at the download
 * time — a file is not "newer here" for having just arrived from there. The
 * comparison is within `SYNC_TOLERANCE_MS` because that stamp is rounded by
 * some filesystems.
 */
export function syncStateOf(
  localMtimeMs: number | null,
  remoteUpdatedAt: string,
  fromThisDevice: boolean | null
): SaveSyncState {
  if (localMtimeMs === null) return 'remote-only'

  const remote = Date.parse(remoteUpdatedAt)
  if (!Number.isFinite(remote)) return 'synced'
  if (Math.abs(localMtimeMs - remote) <= SYNC_TOLERANCE_MS) return 'synced'
  if (localMtimeMs > remote) return 'local-newer'
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
export async function sizeOf(path: string, isDirectory: boolean): Promise<number> {
  if (!isDirectory) return (await stat(path).catch(() => null))?.size ?? 0

  let total = 0
  for (const file of await walk(path)) {
    total += (await stat(file).catch(() => null))?.size ?? 0
  }
  return total
}

/**
 * Date a pulled file as of the server copy it is, not the moment it arrived.
 *
 * Without this every download reads as `local-newer` the instant it lands —
 * the file's mtime is the download time, which is by definition later than the
 * `updated_at` it was compared against — and the game screen invites a push
 * of the file RomM just handed over. Failure is ignored: a save that is on disk
 * with the wrong date is still the save, and refusing the pull over a timestamp
 * would be the worse trade.
 */
export async function stampMtime(path: string, mtimeMs: number): Promise<void> {
  const when = new Date(mtimeMs)
  await utimes(path, when, when).catch(() => undefined)
}

/** Recursive copy, for the backup taken before a directory save is overwritten. */
export async function cpDirectory(from: string, to: string): Promise<void> {
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
