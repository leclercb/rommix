import { prefixed, shared } from './savepaths.ts'
import type { SaveContext, SaveEnvironment, SavePaths } from './savepaths.ts'

/**
 * The disc id a PSP game declares, which PPSSPP names its save folders after.
 *
 * PPSSPP files a game's saves in `PSP/SAVEDATA` under folders that begin with
 * that id — `ULUS10064DATA00` beside `ULUS10064SETTINGS` — and nothing in them
 * is the ROM's name. The id is the first field of `UMD_DATA.BIN`, a small file
 * in the root of the disc's ISO 9660 filesystem, written `ULUS-10064|…`; the
 * folders drop the dash.
 *
 * Unlike a GameCube header, the file can sit anywhere on the disc, so this
 * follows the filesystem rather than reading a fixed offset: the primary volume
 * descriptor names the root directory, and the root directory names the file.
 * Two containers are read:
 *
 *  - a plain `.iso`, which is the filesystem as it is;
 *  - CSO, which cuts the image into blocks and deflates each one on its own, so
 *    a sector is found through the block index and only its block inflated.
 *
 * ZSO and CSO v2 compress blocks with LZ4, and CHD with any of several codecs;
 * none of them is read. An id that cannot be read is null rather than a guess — a
 * wrong one is another game's folders archived and sent up under this one.
 */

const SECTOR = 2048

/** Where the primary volume descriptor sits, right after the system area. */
const PRIMARY_DESCRIPTOR = 16
/** Where the primary volume descriptor keeps the root directory's own record. */
const ROOT_RECORD = 156
/** The smallest directory record there is: the fixed fields and a one-byte name. */
const MIN_RECORD = 34
/**
 * How much of the root directory is read. A UMD's root holds a handful of
 * entries; the bound is for an image whose record claims otherwise.
 */
const MAX_ROOT_BYTES = 16 * SECTOR

const UMD_DATA = 'UMD_DATA.BIN'
/** Four letters, an optional dash, five digits: `ULUS-10064`. */
const DISC_ID = /^([A-Z]{4})-?(\d{5})$/

/** Bytes of the disc at an offset into it, wherever the container keeps them. */
type ReadAt = (offset: number, length: number) => string | null

/** Where one file or directory is on the disc. */
interface Extent {
  lba: number
  length: number
}

export function pspGameId(env: SaveEnvironment, romPath: string): string | null {
  const readAt = discReader(env, romPath)
  if (!readAt) return null
  const root = rootDirectory(readAt)
  if (!root) return null
  const umd = findFile(readAt, root, UMD_DATA)
  if (!umd) return null

  const contents = readAt(umd.lba * SECTOR, Math.min(umd.length, SECTOR))
  if (!contents) return null
  const pipe = contents.indexOf('|')
  if (pipe === -1) return null
  const match = DISC_ID.exec(contents.slice(0, pipe).trim())
  return match ? `${match[1]}${match[2]}` : null
}

/**
 * Where PPSSPP keeps this game's saves, given its `SAVEDATA` folder.
 *
 * The folders whose names begin with the id, never the directory itself: that
 * holds every game's, which an archive of it would carry up under this one and
 * back down over theirs. Without an id the directory stays shared.
 *
 * With one, no reason is given, though the states stay shared: PPSSPP names them
 * after the id and the game's version, which nothing matches on. A reason stands
 * in for what a sync that moved nothing would report, and these saves do sync.
 */
export function ppssppSaves(
  ctx: SaveContext,
  dir: string | null
): Pick<SavePaths, 'saves' | 'unsyncableReason'> {
  if (!dir) return { saves: null }
  const id = pspGameId(ctx.env, ctx.romPath)
  if (!id) return { saves: shared(dir), unsyncableReason: 'saves.ppsspp' }
  return { saves: prefixed(dir, id) }
}

/** A reader for the disc inside the file, or null where the container is not one read here. */
function discReader(env: SaveEnvironment, path: string): ReadAt | null {
  const magic = env.read(path, 0, 4)
  if (magic === null) return null
  if (magic === 'CISO') return csoReader(env, path)
  // Anything else is taken as a plain image and has to prove it by carrying a
  // volume descriptor where one belongs — which a ZSO, a CHD or a zip does not.
  return (offset, length) => env.read(path, offset, length)
}

// ---------------------------------------------------------------------------
// ISO 9660
// ---------------------------------------------------------------------------

function rootDirectory(readAt: ReadAt): Extent | null {
  const sector = readAt(PRIMARY_DESCRIPTOR * SECTOR, SECTOR)
  if (!sector || sector.length < SECTOR) return null
  if (sector.charCodeAt(0) !== 1 || sector.slice(1, 6) !== 'CD001') return null
  return { lba: u32(sector, ROOT_RECORD + 2), length: u32(sector, ROOT_RECORD + 10) }
}

/** A file directly inside `directory`, matched on its name without the `;1` version. */
function findFile(readAt: ReadAt, directory: Extent, name: string): Extent | null {
  const listing = readAt(directory.lba * SECTOR, Math.min(directory.length, MAX_ROOT_BYTES))
  if (!listing) return null

  let at = 0
  while (at < listing.length) {
    const size = listing.charCodeAt(at)
    // A record never crosses a sector, and a zero length is the padding that
    // fills out the rest of one.
    if (size === 0) {
      at = (Math.floor(at / SECTOR) + 1) * SECTOR
      continue
    }
    if (size < MIN_RECORD || at + size > listing.length) return null

    const isDirectory = (listing.charCodeAt(at + 25) & 0x02) !== 0
    const nameLength = listing.charCodeAt(at + 32)
    const entry = listing.slice(at + 33, at + 33 + nameLength).replace(/;\d+$/, '')
    if (!isDirectory && entry.toUpperCase() === name) {
      return { lba: u32(listing, at + 2), length: u32(listing, at + 10) }
    }
    at += size
  }
  return null
}

// ---------------------------------------------------------------------------
// CSO
// ---------------------------------------------------------------------------

/** The fixed header before the block index. */
const CSO_HEADER = 0x18
/** The top bit of an index entry, marking a block kept uncompressed. */
const CSO_STORED = 0x80000000
/**
 * The largest block a CSO is trusted to have. Real images use a sector or a
 * few; past this the header is corrupt rather than unusual, and every read it
 * would ask for is that size.
 */
const MAX_CSO_BLOCK = 0x100000

/**
 * A reader over a CSO image.
 *
 * The header gives the size of the image inside, the block size and how far
 * each index entry is shifted; entry `n` is where block `n` starts and entry
 * `n + 1` where it ends. Version 1 only, which is what maxcso writes unless
 * asked otherwise: version 2 reads the top bit as LZ4.
 *
 * The header and the index are all that bounds what a read asks for, so a
 * block size no image has is refused outright, as PPSSPP refuses one, and so
 * is a block that does not come out exactly one block long: every byte after
 * it would be read from the wrong place.
 */
function csoReader(env: SaveEnvironment, path: string): ReadAt | null {
  const header = env.read(path, 0, CSO_HEADER)
  if (!header || header.length < CSO_HEADER) return null
  const total = u32(header, 0x08) + u32(header, 0x0c) * 2 ** 32
  const blockSize = u32(header, 0x10)
  const version = header.charCodeAt(0x14)
  const unit = 2 ** header.charCodeAt(0x15)
  const isPowerOfTwo = (blockSize & (blockSize - 1)) === 0
  if (blockSize < SECTOR || blockSize > MAX_CSO_BLOCK || !isPowerOfTwo) return null
  if (version > 1) return null

  const block = (index: number): string | null => {
    const entries = env.read(path, CSO_HEADER + index * 4, 8)
    if (!entries || entries.length < 8) return null
    const entry = u32(entries, 0)
    const start = (entry & ~CSO_STORED) * unit
    const size = (u32(entries, 4) & ~CSO_STORED) * unit - start
    // A block that would not deflate smaller is stored instead, so a real
    // index never spans much past one block; this bound is for a corrupt one.
    if (size <= 0 || size > 2 * blockSize) return null
    const stored = env.read(path, start, size)
    if (!stored || stored.length < size) return null

    const data =
      (entry & CSO_STORED) !== 0 ? stored.slice(0, blockSize) : env.inflateRaw(stored, blockSize)
    // The last block may hold less than a block, the image not ending on one.
    const expected = Math.min(blockSize, total - index * blockSize)
    if (data === null || data.length > blockSize || data.length < expected) return null
    return data
  }

  return (offset, length) => {
    if (offset + length > total) return null
    const first = Math.floor(offset / blockSize)
    const last = Math.floor((offset + length - 1) / blockSize)
    let bytes = ''
    for (let index = first; index <= last; index += 1) {
      const data = block(index)
      if (data === null) return null
      bytes += data
    }
    const from = offset - first * blockSize
    return bytes.slice(from, from + length)
  }
}

function u32(bytes: string, at: number): number {
  return (
    (bytes.charCodeAt(at) |
      (bytes.charCodeAt(at + 1) << 8) |
      (bytes.charCodeAt(at + 2) << 16) |
      (bytes.charCodeAt(at + 3) << 24)) >>>
    0
  )
}
