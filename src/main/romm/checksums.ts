/**
 * Which hash, if any, the bytes arriving for a game are held to.
 *
 * Four answers to almost the same question, and the difference between them is
 * what stops a good download being thrown away: RomM hashes what it can *read*,
 * which for an archive is the ROM inside it and not the archive the endpoint
 * serves, and for a game of several files is nothing that describes any one
 * transfer. Getting this wrong in either direction is silent — a game refused
 * as corrupt, or a corrupt game accepted.
 */

import { ARCHIVE_EXTENSIONS } from '@config/romfiles'
import type { RommRom } from '@shared/types'

/**
 * A digest RomM holds for what is being fetched, and what produced it.
 *
 * `crc` is absent on purpose: RomM records one, and it is not a digest node's
 * crypto can compute. A game with nothing but a CRC goes unchecked rather than
 * carrying a second implementation of a checksum into this file.
 */
export interface Checksum {
  algorithm: 'md5' | 'sha1'
  expected: string
}

/** md5 first, sha1 beside it, or nothing. See `Checksum`. */
export function digestOf(source: {
  md5_hash: string | null
  sha1_hash: string | null
}): Checksum | null {
  if (source.md5_hash) return { algorithm: 'md5', expected: source.md5_hash }
  if (source.sha1_hash) return { algorithm: 'sha1', expected: source.sha1_hash }
  return null
}

/**
 * The hash RomM holds for a game it keeps as one file.
 *
 * Nothing for a game of several. What the content endpoint serves for one of
 * those is an archive built for the request, and the hash on the ROM describes
 * neither that archive nor any one file inside it — those are checked as they
 * arrive instead. See `RommClient.downloadRomFile`.
 */
function fileDigestOf(rom: RommRom): Checksum | null {
  const digest = digestOf(rom)
  if (!digest) return null
  return rom.has_multiple_files || rom.files.length > 1 ? null : digest
}

/** Is this a name RomM would have opened rather than hashed? */
function isArchive(fsName: string): boolean {
  const name = fsName.toLowerCase()
  return ARCHIVE_EXTENSIONS.some((extension) => name.endsWith(extension))
}

/**
 * The hash to hold the bytes on the wire to, if any.
 *
 * Not an archive's. RomM opens the ones it recognises and hashes what it finds
 * inside, so the digest on a zipped game describes the ROM in the zip while the
 * endpoint serves the zip: every such game arrived whole, failed a check it
 * could never pass, and was thrown away as corrupt. What comes out of the
 * archive is what that digest is for. See `unpackedChecksumOf`.
 */
export function checksumOf(rom: RommRom): Checksum | null {
  return isArchive(rom.fs_name) ? null : fileDigestOf(rom)
}

/**
 * The hash to hold the game that came out of an archive to.
 *
 * The same digest, against the file it actually describes — so an archived game
 * is checked after it is unpacked rather than not at all. It is the file RomMix
 * keeps and launches, which makes this the better of the two checks: the one
 * before only ever spoke for bytes that were about to be thrown away.
 *
 * Only where the archive held one game. RomM hashes a multi-entry archive by
 * running its members through one digest in path order, minus the files it
 * excludes — reproducing that means carrying a copy of RomM's exclusion rules
 * here and re-deriving an ordering from a tree RomMix has already rearranged,
 * and being wrong about either is a good game refused.
 */
export function unpackedChecksumOf(rom: RommRom): Checksum | null {
  return isArchive(rom.fs_name) ? fileDigestOf(rom) : null
}
