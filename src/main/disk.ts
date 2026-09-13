import { stat, statfs } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import type { DriveSpace } from '@shared/types'
import { log } from './log.ts'

/**
 * How much room is left where games are written.
 *
 * One question asked in three places — the downloads screen, the pre-flight
 * check, and the transfer that is about to start — so it is answered once here.
 */

/**
 * The nearest folder at or above this one that exists.
 *
 * A ROM folder is created by the first download into it, and an emulator that
 * has never been run has none of its tree yet. The drive such a folder *would*
 * be created on is the answer wanted, and that is the drive its parent is on.
 *
 * Absolute paths only. A relative one would walk up to the working directory
 * and answer for whichever drive *that* is on — a figure about the wrong disk
 * is worse than no figure, and every path RomMix holds is absolute.
 */
async function nearest(path: string): Promise<string | null> {
  if (!isAbsolute(path)) return null
  let at = path
  for (;;) {
    try {
      await stat(at)
      return at
    } catch {
      const up = dirname(at)
      if (up === at) return null
      at = up
    }
  }
}

/**
 * The filesystem holding a folder, or null where it cannot be asked.
 *
 * `bavail` rather than `bfree`: what is free to the user running RomMix, not
 * what is free to root. Every filesystem keeps a reserve between the two, and a
 * download sized against the larger number fails with the disk reporting space
 * left.
 *
 * Never throws. Nothing here is load-bearing — a figure on a screen, and a
 * check that declines to object — so a filesystem that will not answer is one
 * RomMix says nothing about.
 */
export async function spaceOf(path: string): Promise<DriveSpace | null> {
  const at = await nearest(path)
  if (!at) return null
  try {
    const fs = await statfs(at)
    return { path, freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize }
  } catch (cause) {
    log.debug('disk', 'could not be measured', { path: at, reason: (cause as Error).message })
    return null
  }
}

/**
 * Whether a transfer of this size fits in the room left.
 *
 * A size of nothing fits, deliberately: zero is what a server reports for a
 * game it has no size for, and a check that refuses everything it cannot
 * measure would stop those downloading at all. See `RommRom.fs_size_bytes`.
 */
export function fits(needed: number, freeBytes: number): boolean {
  return needed <= 0 || needed <= freeBytes
}

/**
 * One entry per distinct filesystem behind these folders.
 *
 * Downloads go either to one RomMix folder or to each emulator's own, and those
 * are routinely on one drive and occasionally on four — a library on an SD card
 * beside one on the internal disk. Two folders on the same drive are one
 * figure, or the screen says the same gigabytes twice and implies twice the
 * room.
 *
 * Matched on the device id rather than on the mount path, which is what
 * `statfs` cannot distinguish: two mounts of the same filesystem report
 * identical figures and are the same disk.
 */
export async function drivesOf(paths: readonly string[]): Promise<DriveSpace[]> {
  const seen = new Set<number>()
  const drives: DriveSpace[] = []

  for (const path of paths) {
    const at = await nearest(path)
    if (!at) continue
    let device: number
    try {
      device = (await stat(at)).dev
    } catch {
      continue
    }
    if (seen.has(device)) continue
    const space = await spaceOf(path)
    if (!space) continue
    seen.add(device)
    drives.push(space)
  }

  return drives
}
