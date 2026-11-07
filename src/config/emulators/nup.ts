import { titleIdPrefix } from '../systems.ts'
import type { SaveEnvironment } from './savepaths.ts'

/**
 * The title id a Switch 2 `.nup` container declares.
 *
 * A `.nup` (NX Package) holds a base game, its updates and its DLC as loose
 * trees in one file. Its table of contents lists one record per package, each
 * carrying the package's title id, and Eglantine names a game's save folder
 * after the id of the package it boots. So the id is read out of those records
 * and chosen by the same rule Eglantine boots by — see `programPackage` — or
 * the folder named would not be the one Eglantine writes.
 *
 * Layout, from Eglantine's `nup_container.cpp`, all integers little-endian:
 *
 *     0x00  superblock  "NUP\x01", toc_offset (u64) at 0x08,
 *                        package_count (u32) at 0x48
 *     toc   TOC header  "TOC\x01", package_count (u32) at +0x04,
 *                        dir_count (u64) at +0x08
 *     +0x30 records     one per package, title_id (u64) at +0x00,
 *                        root_dir (u32) at +0x08, exefs_dir (u32) at +0x0C,
 *                        version (u32) at +0x14,
 *                        kind (u8) at +0x18
 *
 * Eglantine also checks a SHA-256 of the TOC. That is not done here: this
 * module may not import `node:crypto`, and the guard that matters is agreeing
 * with Eglantine's choice and refusing an id under another system's prefix.
 * Anything that does not parse is no title id rather than a guessed one.
 */

const MAGIC = 'NUP\x01'
const TOC_MAGIC = 'TOC\x01'
/** The superblock's size, and so the lowest place a TOC can start. */
const SUPERBLOCK_BYTES = 0x80
const TOC_HEADER_BYTES = 0x30
const RECORD_BYTES = 0x40
/** An `exefs_dir` naming no directory: the package carries no program. */
const NO_DIR = 0xffffffff

/**
 * The most package records read.
 *
 * The count is the file's own claim, and the only bound on the one read made
 * of the TOC. A base, its updates and every DLC a game has fit with room to
 * spare; a count past this is a corrupt container, not a large one.
 */
const MAX_PACKAGES = 4096

/** What a package is, as its record's `kind` byte says. */
const BASE = 0
const UPDATE = 1
const ADDON = 2

interface PackageRecord {
  titleId: string
  version: number
  kind: number
  hasProgram: boolean
}

/**
 * The id the container's booted package carries, as is, or null.
 *
 * As is: Eglantine names the folder after the full id, so the trailing digits
 * an update carries are not cleared the way a Switch id's are. It must be
 * non-zero and carry the prefix `system` declares.
 */
export function nupTitleId(env: SaveEnvironment, system: string, path: string): string | null {
  const prefix = titleIdPrefix(system)
  if (!prefix) return null

  const records = packageRecords(env, path)
  const program = records ? programPackage(records) : null
  if (!program) return null

  const { titleId } = program
  if (/^0+$/.test(titleId) || !titleId.startsWith(prefix)) return null
  return titleId
}

/** Every package record the TOC lists, or null where the container does not parse. */
function packageRecords(env: SaveEnvironment, path: string): PackageRecord[] | null {
  const superblock = env.read(path, 0, SUPERBLOCK_BYTES)
  if (superblock?.length !== SUPERBLOCK_BYTES || !superblock.startsWith(MAGIC)) return null

  const tocOffset = u64(superblock, 0x08)
  const count = u32(superblock, 0x48)
  if (tocOffset === null || tocOffset < SUPERBLOCK_BYTES) return null
  if (count === 0 || count > MAX_PACKAGES) return null

  const length = TOC_HEADER_BYTES + count * RECORD_BYTES
  const toc = env.read(path, tocOffset, length)
  if (toc?.length !== length || !toc.startsWith(TOC_MAGIC) || u32(toc, 0x04) !== count) {
    return null
  }

  // Records naming a directory the TOC does not have are refused, as Eglantine
  // refuses the whole container for one.
  const dirCount = u64(toc, 0x08)
  if (dirCount === null) return null

  const records: PackageRecord[] = []
  for (let index = 0; index < count; index += 1) {
    const at = TOC_HEADER_BYTES + index * RECORD_BYTES
    const kind = toc.charCodeAt(at + 0x18)
    const exefs = u32(toc, at + 0x0c)
    if (kind > ADDON || u32(toc, at + 0x08) >= dirCount) return null
    if (exefs !== NO_DIR && exefs >= dirCount) return null
    records.push({
      titleId: hex64(toc, at),
      version: u32(toc, at + 0x14),
      kind,
      hasProgram: exefs !== NO_DIR
    })
  }
  return records
}

/**
 * The package Eglantine boots, by `AppLoader_NUP`'s rule.
 *
 * The first base, if it carries a program; otherwise the update of highest
 * version — the first of them on a tie — if that one does. A container that is
 * only an update boots on its own and keeps its own id. The choice is made
 * before the program is looked for, as Eglantine makes it: a base without one
 * is not skipped for a later base.
 */
function programPackage(records: readonly PackageRecord[]): PackageRecord | null {
  const base = records.find((record) => record.kind === BASE)
  if (base?.hasProgram) return base

  let update: PackageRecord | null = null
  for (const record of records) {
    if (record.kind !== UPDATE) continue
    if (!update || record.version > update.version) update = record
  }
  return update?.hasProgram ? update : null
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

/** A u64 that fits a safe integer, or null: an offset past that is no real file's. */
function u64(bytes: string, at: number): number | null {
  const value = u32(bytes, at + 4) * 2 ** 32 + u32(bytes, at)
  return Number.isSafeInteger(value) ? value : null
}

/** A u64 as a title id is written: upper-case hex, zero-padded. */
function hex64(bytes: string, at: number): string {
  const half = (offset: number): string => u32(bytes, offset).toString(16).padStart(8, '0')
  return `${half(at + 4)}${half(at)}`.toUpperCase()
}
