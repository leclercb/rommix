import { copyFile, mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { SAVE_CONVENTIONS } from '@config/emulators'
import type { SavePaths } from '@config/emulators'
import type { RommRom, SaveSyncState } from '@shared/types'
import { log } from './log.ts'

/**
 * The judgements save sync makes about files, without any of the moving.
 *
 * Three of them decide whether a save is handled correctly at all: whether a
 * file on disk belongs to this game, which end of a pair is ahead, and which
 * emulator's files these are. None is about RomM or about moving bytes, so they
 * are here — testable on their own, which `saves.test.ts` is — and the rest is
 * the filesystem work they imply.
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
 * What this device tags a save with: the program that actually wrote it.
 *
 * The descriptor's answer where it gave one — a frontend names the emulator it
 * dispatched to, so RetroDECK running PCSX2 says `pcsx2` — and the descriptor
 * id otherwise, which is already right for a standalone.
 *
 * One function because both directions must agree. A push sends this and a pull
 * matches on it, and while those were two separate expressions a frontend's
 * uploads could not match its own downloads.
 */
export function localTag(paths: SavePaths, emulatorId: string): string {
  return paths.emulator ?? emulatorId
}

/**
 * Is a remote asset one this emulator could load?
 *
 * A save is only meaningful to the program that wrote it — a RetroArch `.srm`
 * dropped into Eden's folder is at best ignored and at worst loaded as garbage
 * — so the `emulator` tag RomM records is the filter, matched against the tag
 * this device would upload under.
 *
 * Against `localTag` rather than the descriptor id because for a frontend the
 * two differ: RetroDECK uploads `pcsx2` and its id is `retrodeck`, so comparing
 * ids would reject every save it ever wrote. Comparing tags accepts a PCSX2
 * save from any of the three ways of running PCSX2 and nothing else — where an
 * id comparison, once widened far enough to let frontends through at all, took
 * a Yabause save into mednafen's folder.
 *
 * An untagged asset is not one RomMix wrote, because every upload carries a
 * tag. Nothing else on the asset says which program produced it, so there is no
 * answer to "could this emulator load it" and it is left where it is.
 *
 * `also` is what the same files used to be uploaded under — see `alsoAccepts`
 * in `SavePaths`. Accepted here and never sent, so a tag RomMix has stopped
 * writing stops appearing on the server by attrition rather than by a sweep.
 */
export function acceptsTag(
  local: string,
  tag: string | null,
  also: readonly string[] = []
): boolean {
  if (!tag) return false
  const arriving = tag.toLowerCase()
  return arriving === local.toLowerCase() || also.some((older) => arriving === older.toLowerCase())
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

/**
 * How many copies of a save displaced by a pull are kept.
 *
 * More than one because the copy that matters is rarely the last: a pull that
 * lands the wrong save is noticed after the next launch has already pulled
 * again, and with a single copy the good one is gone by then.
 */
export const BACKUP_COPIES = 3

/**
 * Where one kept copy lives, slot 1 being the one taken most recently.
 *
 * In a folder of RomMix's rather than beside the save. The emulator's save tree
 * is the emulator's: Eden reads its own by walking a directory of title ids,
 * and a stray sibling of one is a folder RomMix has no business asking it to
 * ignore. It also puts every copy in one place a person can be sent to.
 */
export function backupPath(into: string, path: string, slot: number): string {
  return join(into, `${basename(path)}.${slot}`)
}

/**
 * Put a copy of a save aside before a pull writes over it.
 *
 * Numbered rather than dated: the oldest slot is dropped, every other shifts
 * down one, and what is on disk now is copied into the first. A slot is
 * arithmetic, and every path it touches is derived from the save's own —
 * nothing is deleted for having a name that looked like a backup's. Dated names
 * would mean pruning by what a listing sorts to, and the clock is not something
 * to prune by: a handheld that boots before its time is set dates a backup
 * years out, and the copy dropped as oldest is then the one worth keeping.
 *
 * Each copy keeps the mtime of the save it was taken from, so the date beside
 * it in a file manager is the session it belongs to rather than the pull that
 * displaced it. The slot number is then only recency.
 *
 * Nothing ever reads these back — restoring one is the person's own job, with a
 * file manager — so a failure anywhere is swallowed. A save that could not be
 * copied aside is a worse pull, not a failed one. Swallowed, but said: whether
 * a copy was kept is the first thing somebody looking for a save that is not
 * there needs to know, and the log is the only place they can be told.
 */
export async function keepBackup(path: string, into: string, isDirectory = false): Promise<void> {
  await step('create the folder displaced saves are kept in', { into }, () =>
    mkdir(into, { recursive: true })
  )
  await absorbSingleBackup(path, into, isDirectory)
  await rotate(path, into)

  const copy = backupPath(into, path, 1)
  await copyAside(path, copy, isDirectory)
  // Asked rather than assumed. Every step above swallows its own failure, so
  // the only honest thing to report is whether the copy is actually there.
  if (await stat(copy).catch(() => null)) {
    log.info('saves', 'kept a copy of the save about to be overwritten', {
      path,
      copy,
      keeping: BACKUP_COPIES
    })
  } else {
    log.warn('saves', 'the save about to be overwritten could not be copied aside', { path, copy })
  }
}

/**
 * One best-effort step of the backup chain, with what went wrong written down.
 *
 * Each of these swallows its failure — see `keepBackup` — and a chain that half
 * happened used to leave exactly what a chain that went through leaves: nothing.
 *
 * A missing file is not worth a line. Rotation renames slots nothing has
 * written yet on every save backed up fewer times than there are slots, and a
 * warning apiece would bury the one that means something.
 */
async function step(
  what: string,
  detail: Record<string, unknown>,
  run: () => Promise<unknown>
): Promise<void> {
  try {
    await run()
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    log.warn('saves', `could not ${what}`, { ...detail, reason: (cause as Error).message })
  }
}

/** Drop the oldest copy and move every other one slot further back. */
async function rotate(path: string, into: string): Promise<void> {
  const oldest = backupPath(into, path, BACKUP_COPIES)
  // Named before it goes, since a deletion nothing recorded is indistinguishable
  // afterwards from a copy that was never taken.
  if (await stat(oldest).catch(() => null)) {
    log.info('saves', 'dropping the oldest kept copy of a save', { copy: oldest })
  }
  await step('drop the oldest kept copy of a save', { copy: oldest }, () =>
    rm(oldest, { recursive: true, force: true })
  )
  for (let slot = BACKUP_COPIES - 1; slot >= 1; slot -= 1) {
    await step('move a kept copy one slot back', { path, slot }, () =>
      rename(backupPath(into, path, slot), backupPath(into, path, slot + 1))
    )
  }
}

/** Copy a save, file or folder, dating what lands as what it was taken from. */
async function copyAside(from: string, to: string, isDirectory: boolean): Promise<void> {
  if (isDirectory) {
    await cpDirectory(from, to)
    for (const file of await walk(to)) {
      await stampAsSource(file, join(from, file.slice(to.length + 1)))
    }
  } else {
    await step('copy a save aside', { from, to }, () => copyFile(from, to))
  }
  await stampAsSource(to, from)
}

/** Date a copy as the file it was taken from, `copyFile` having dated it now. */
async function stampAsSource(copy: string, source: string): Promise<void> {
  const when = (await stat(source).catch(() => null))?.mtimeMs
  if (when !== undefined) await stampMtime(copy, when)
}

/**
 * MIGRATION(0.11): take in the copy left beside the save by a version that
 * kept one there.
 *
 * It goes onto the chain first, so the pull that follows pushes it back a slot
 * like any other: it is the most recent copy that existed before this one. Then
 * it is gone from the emulator's tree, which is the point — nothing writes that
 * name any more, and a file no rotation can reach would sit there for good.
 *
 * Copied rather than renamed. The RomMix folder and an emulator's saves are
 * routinely on different disks — a handheld keeps one on the card — and a
 * rename across them fails.
 */
async function absorbSingleBackup(path: string, into: string, isDirectory: boolean): Promise<void> {
  const single = `${path}.rommix-bak`
  if (!(await stat(single).catch(() => null))) return
  log.info('saves', 'taking in the copy an older RomMix kept beside the save', {
    copy: single,
    into
  })
  await rotate(path, into)
  await copyAside(single, backupPath(into, path, 1), isDirectory)
  await step('remove the copy an older RomMix kept beside the save', { copy: single }, () =>
    rm(single, { recursive: true, force: true })
  )
}

/** Recursive copy, for the backup taken before a directory save is overwritten. */
export async function cpDirectory(from: string, to: string): Promise<void> {
  let entries
  try {
    entries = await readdir(from, { withFileTypes: true })
  } catch (cause) {
    log.debug('saves', 'nothing to copy aside: the folder could not be read', {
      from,
      reason: (cause as Error).message
    })
    return
  }
  await mkdir(to, { recursive: true })
  for (const entry of entries) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) await cpDirectory(source, target)
    else
      await step('copy a file of a save folder aside', { source, target }, () =>
        copyFile(source, target)
      )
  }
}
