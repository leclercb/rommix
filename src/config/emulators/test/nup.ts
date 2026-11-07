import { le32 } from './discs.ts'

/**
 * Switch 2 containers for the tests, built byte by byte.
 *
 * Shared because more than one suite needs one: the one reading the title id,
 * and the one placing Eglantine's saves by it. The layout is Eglantine's own
 * (`nup_container.cpp`), written field by field and holding no file data, since
 * the offsets are the whole of what is being tested. No `node:` import, so it
 * stays loadable wherever `src/config/` is.
 */

/** No directory: a package record's way of saying it carries no ExeFS. */
const NO_DIR = 0xffffffff

export const BASE = 0
export const UPDATE = 1
export const ADDON = 2

export interface Package {
  titleId: bigint
  kind: number
  version?: number
  /** Whether the package carries a program. Present by default. */
  exefs?: boolean
}

export interface NupOptions {
  magic?: string
  tocMagic?: string
  tocOffset?: number
  /** The count the TOC states, when it should disagree with the records. */
  tocCount?: number
  /** The directory count the TOC states. */
  dirCount?: number
}

function le16(value: number): string {
  return String.fromCharCode(value & 0xff, (value >>> 8) & 0xff)
}

function le64(value: bigint): string {
  return le32(Number(value & 0xffffffffn)) + le32(Number(value >> 32n))
}

/** A container holding `packages`, in the order given, with no file data. */
export function nup(packages: readonly Package[], options: NupOptions = {}): string {
  const { magic = 'NUP\x01', tocMagic = 'TOC\x01', tocOffset = 0x80 } = options
  const records = packages.map(
    ({ titleId, kind, version = 0, exefs = true }, index) =>
      le64(titleId) +
      le32(0) + // root_dir
      le32(exefs ? index : NO_DIR) +
      le32(NO_DIR) + // romfs_dir
      le32(version) +
      String.fromCharCode(kind) +
      '\0'.repeat(0x40 - 0x19)
  )
  const toc =
    tocMagic +
    le32(options.tocCount ?? packages.length) +
    le64(BigInt(options.dirCount ?? packages.length + 1)) +
    '\0'.repeat(0x30 - 0x10) +
    records.join('')
  const blob = tocOffset + toc.length
  const superblock = (
    magic +
    le16(0x80) +
    le16(1) +
    le64(BigInt(tocOffset)) +
    le64(BigInt(toc.length)) +
    '\0'.repeat(0x20) + // toc_sha256, which RomMix does not check
    le64(BigInt(blob)) +
    le64(BigInt(blob)) +
    le32(packages.length)
  ).padEnd(0x80, '\0')
  // A TOC placed below 0x80 is written over the superblock's tail, as a
  // container claiming one would have it.
  return superblock.padEnd(tocOffset, '\0').slice(0, tocOffset) + toc
}
