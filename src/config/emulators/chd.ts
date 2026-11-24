import type { ReadAt } from './disc.ts'
import { BitReader, Huffman } from './huffman.ts'
import { lzmaDecode } from './lzma.ts'
import type { SaveEnvironment } from './savepaths.ts'

/**
 * The disc inside a CHD, as MAME's `chdman` writes it (`src/lib/util/chd.cpp`).
 *
 * A CHD cuts the image into hunks and compresses each one with whichever of up
 * to four codecs the header names did best, or keeps it as it is, or points it
 * at an earlier hunk holding the same bytes. A compressed map says which, and
 * where each hunk is. Read here: the version `chdman` writes (see `VERSION`), and
 * the codecs it picks for a disc — `zlib`, `zstd`, `lzma` and `huff`, and
 * their CD forms `cdzl`, `cdzs` and `cdlz`. FLAC, which is for
 * audio, is not read, and nor is a CHD that names a parent: a hunk coded with
 * either reads as nothing, and so does any read that needs it.
 *
 * Every hunk carries a checksum of what it decompresses to and the map one of
 * itself, so a decoder that goes wrong reads as nothing rather than as another
 * game's serial.
 */

const SECTOR = 2048

const HEADER = 124
const VERSION = 5
/**
 * The largest hunk a CHD is trusted to have, and the most hunks: past these the
 * header is corrupt rather than unusual, and every read sized from it would be
 * that size.
 */
const MAX_HUNK = 0x100000
const MAX_HUNKS = 1 << 23
/** How many metadata entries are walked before the chain is taken to loop. */
const MAX_METADATA = 64
/** How many hunks deep a copy of a copy is followed. */
const MAX_SELF_DEPTH = 8

/**
 * The last CHD's map and layout, by path and the SHA-1 its header records.
 *
 * Decoding the map means reading every entry of it, which for a whole DVD is
 * long enough to notice, and a sync asks for the same disc's serial several
 * times over. The SHA-1 changes with the image, so a file replaced at the same
 * path is decoded afresh.
 */
let decoded: { key: string; map: HunkMap | null; layout: Layout | null } | null = null

/** A map entry's compression: a codec slot, kept as it is, or another hunk's. */
const CODEC_LAST = 3
const STORED = 4
const SELF = 5
const PARENT = 6
/** Codings that exist only in the compressed map, each standing for one of the above. */
const RLE_SMALL = 7
const RLE_LARGE = 8
const SELF_0 = 9
const SELF_1 = 10
const PARENT_SELF = 11
const PARENT_0 = 12
const PARENT_1 = 13

/** A CD frame: the 2352 bytes of a sector, then its 96 of subcode. */
const CD_SECTOR = 2352
const CD_SUBCODE = 96
const CD_FRAME = CD_SECTOR + CD_SUBCODE
const CD_SYNC = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]

/** Where the 2048 bytes of a sector start in a frame, by track type. Audio has none. */
const CD_DATA_OFFSET: Record<string, number> = {
  MODE1: 0,
  MODE2_FORM1: 0,
  MODE1_RAW: 16,
  MODE2_RAW: 24,
  MODE2: 8,
  MODE2_FORM_MIX: 8
}

type Hunk = Uint8Array | null
type Codec = (data: Uint8Array, size: number) => Hunk

interface Header {
  codecs: string[]
  logicalBytes: number
  mapOffset: number
  metaOffset: number
  hunkBytes: number
  unitBytes: number
  hunks: number
  /** What the header records the image's SHA-1 as. */
  sha1: string
}

interface HunkMap {
  types: Uint8Array
  lengths: Uint32Array
  offsets: Float64Array
  crcs: Uint16Array
  /** A map with no codecs stores every hunk as it is, and no checksums. */
  compressed: boolean
}

/** Where the 2048 bytes of each sector are: which unit, at what offset in it. */
interface Layout {
  unitBytes: number
  firstUnit: number
  dataOffset: number
  sectors: number
}

/** A reader over the disc in a CHD, or null where the CHD is not one read here. */
export function chdReader(env: SaveEnvironment, path: string): ReadAt | null {
  const header = readHeader(env, path)
  if (!header) return null
  const key = `${path}\0${header.sha1}`
  if (decoded?.key !== key) {
    const map = readMap(env, path, header)
    decoded = { key, map, layout: map && readLayout(env, path, header) }
  }
  const { map, layout } = decoded
  if (!map || !layout) return null

  const codecs = header.codecs.map((tag) => codecFor(env, tag))
  const cache = new Map<number, Hunk>()

  const hunk = (index: number, depth = 0): Hunk => {
    const cached = cache.get(index)
    if (cached !== undefined) return cached
    const data = readHunk(index, depth)
    // A null at depth is the chain cut short, not the hunk itself unreadable.
    if (data === null && depth > 0) return data
    if (cache.size > 16) cache.clear()
    cache.set(index, data)
    return data
  }

  const readHunk = (index: number, depth: number): Hunk => {
    const { types, lengths, offsets, crcs, compressed } = map
    const type = types[index]
    if (type === SELF) {
      const target = offsets[index]
      if (target >= header.hunks || target === index || depth >= MAX_SELF_DEPTH) return null
      return hunk(target, depth + 1)
    }
    if (type === PARENT) return null

    if (!compressed && offsets[index] === 0) return new Uint8Array(header.hunkBytes)
    const length = type === STORED ? header.hunkBytes : lengths[index]
    const stored = env.read(path, offsets[index], length)
    if (stored === null || stored.length < length) return null
    const bytes = toBytes(stored)
    const data = type === STORED ? bytes : (codecs[type]?.(bytes, header.hunkBytes) ?? null)
    if (!data || data.length !== header.hunkBytes) return null
    if (compressed && crc16(data) !== crcs[index]) return null
    return data
  }

  const sector = (index: number): Uint8Array | null => {
    if (index >= layout.sectors) return null
    const at = (layout.firstUnit + index) * layout.unitBytes + layout.dataOffset
    const first = Math.floor(at / header.hunkBytes)
    const from = at - first * header.hunkBytes
    if (first >= header.hunks) return null
    // A unit never spans two hunks, the hunk being a whole number of them.
    const data = hunk(first)
    return data ? data.subarray(from, from + SECTOR) : null
  }

  return (offset, length) => {
    if (length <= 0) return ''
    const first = Math.floor(offset / SECTOR)
    const last = Math.floor((offset + length - 1) / SECTOR)
    let bytes = ''
    for (let index = first; index <= last; index += 1) {
      const data = sector(index)
      if (!data) return null
      bytes += toText(data)
    }
    const from = offset - first * SECTOR
    return bytes.slice(from, from + length)
  }
}

// ---------------------------------------------------------------------------
// Header and map
// ---------------------------------------------------------------------------

function readHeader(env: SaveEnvironment, path: string): Header | null {
  const text = env.read(path, 0, HEADER)
  if (!text || text.length < HEADER || !text.startsWith('MComprHD')) return null
  const bytes = toBytes(text)
  if (be(bytes, 8, 4) < HEADER || be(bytes, 12, 4) !== VERSION) return null
  // A parent's SHA-1 is where a CHD names the image its hunks may point into.
  if (bytes.subarray(104, 124).some((byte) => byte !== 0)) return null

  const codecs = [0, 1, 2, 3].map((slot) => text.slice(16 + slot * 4, 20 + slot * 4))
  const logicalBytes = be(bytes, 32, 8)
  const hunkBytes = be(bytes, 56, 4)
  const unitBytes = be(bytes, 60, 4)
  if (hunkBytes === 0 || hunkBytes > MAX_HUNK || unitBytes === 0) return null
  if (hunkBytes % unitBytes !== 0) return null
  const hunks = Math.ceil(logicalBytes / hunkBytes)
  if (hunks > MAX_HUNKS) return null
  return {
    codecs,
    logicalBytes,
    mapOffset: be(bytes, 40, 8),
    metaOffset: be(bytes, 48, 8),
    hunkBytes,
    unitBytes,
    hunks,
    sha1: text.slice(84, 104)
  }
}

function readMap(env: SaveEnvironment, path: string, header: Header): HunkMap | null {
  const { hunks, hunkBytes } = header
  const map: HunkMap = {
    types: new Uint8Array(hunks),
    lengths: new Uint32Array(hunks),
    offsets: new Float64Array(hunks),
    crcs: new Uint16Array(hunks),
    compressed: header.codecs[0] !== '\0\0\0\0'
  }

  if (!map.compressed) {
    const text = env.read(path, header.mapOffset, hunks * 4)
    if (!text || text.length < hunks * 4) return null
    const bytes = toBytes(text)
    map.types.fill(STORED)
    for (let index = 0; index < hunks; index += 1) {
      map.offsets[index] = be(bytes, index * 4, 4) * hunkBytes
    }
    return map
  }

  const top = env.read(path, header.mapOffset, 16)
  if (!top || top.length < 16) return null
  const head = toBytes(top)
  const size = be(head, 0, 4)
  // Each entry codes to a handful of bytes at worst; this bound is for a corrupt header.
  if (size > hunks * 16 + 1024) return null
  const text = env.read(path, header.mapOffset + 16, size)
  if (!text || text.length < size) return null
  const bits = new BitReader(toBytes(text))
  const lengthBits = head[12]
  const selfBits = head[13]
  const parentBits = head[14]

  const tree = new Huffman(16, 8)
  if (!tree.importRle(bits)) return null

  let last = 0
  let repeat = 0
  for (let index = 0; index < hunks; index += 1) {
    if (repeat > 0) {
      map.types[index] = last
      repeat -= 1
      continue
    }
    const value = tree.decode(bits)
    if (value === RLE_SMALL) {
      map.types[index] = last
      repeat = 2 + tree.decode(bits)
    } else if (value === RLE_LARGE) {
      map.types[index] = last
      repeat = 2 + 16 + (tree.decode(bits) << 4)
      repeat += tree.decode(bits)
    } else {
      map.types[index] = last = value
    }
  }

  const crc = new Crc16()
  const entry = new Uint8Array(12)
  let offset = be(head, 4, 6)
  let lastSelf = 0
  let lastParent = 0
  for (let index = 0; index < hunks; index += 1) {
    let type = map.types[index]
    let length = 0
    let at = offset
    let check = 0
    if (type <= CODEC_LAST) {
      length = bits.read(lengthBits)
      offset += length
      check = bits.read(16)
    } else if (type === STORED) {
      length = hunkBytes
      offset += length
      check = bits.read(16)
    } else if (type === SELF) {
      at = lastSelf = bits.read(selfBits)
    } else if (type === PARENT) {
      at = lastParent = bits.read(parentBits)
    } else if (type === SELF_0 || type === SELF_1) {
      if (type === SELF_1) lastSelf += 1
      type = SELF
      at = lastSelf
    } else if (type === PARENT_SELF) {
      type = PARENT
      at = lastParent = Math.floor((index * hunkBytes) / header.unitBytes)
    } else if (type === PARENT_0 || type === PARENT_1) {
      if (type === PARENT_1) lastParent += hunkBytes / header.unitBytes
      type = PARENT
      at = lastParent
    } else {
      return null
    }
    map.types[index] = type
    map.lengths[index] = length
    map.offsets[index] = at
    map.crcs[index] = check

    // The map's checksum is of each entry as MAME keeps it in memory.
    entry[0] = type
    putBe(entry, 1, 3, length)
    putBe(entry, 4, 6, at)
    putBe(entry, 10, 2, check)
    crc.update(entry)
  }
  if (bits.overflowed || crc.value !== be(head, 10, 2)) return null
  return map
}

/**
 * Where the sectors of the disc's filesystem are.
 *
 * A DVD is stored as its sectors. A CD is stored as frames, track after track,
 * and its filesystem is on the first track, whose metadata says how much of a
 * frame comes before the sector's data and whether the pregap is stored ahead
 * of it. A GD-ROM keeps its filesystem on a later track, and is not read.
 */
function readLayout(env: SaveEnvironment, path: string, header: Header): Layout | null {
  let at = header.metaOffset
  for (let count = 0; at !== 0 && count < MAX_METADATA; count += 1) {
    const top = env.read(path, at, 16)
    if (!top || top.length < 16) return null
    const bytes = toBytes(top)
    const tag = top.slice(0, 4)
    const length = be(bytes, 5, 3)

    if (tag === 'CHGD') return null
    if (tag === 'CHT2' || tag === 'CHTR') {
      const text = env.read(path, at + 16, length)
      if (!text) return null
      const fields = Object.fromEntries(
        Array.from(text.matchAll(/([A-Z]+):(\S*)/g), (match) => [
          match[1],
          match[2].replace(/\0+$/, '')
        ])
      )
      if (fields.TRACK === '1') return cdLayout(header, fields)
    }
    at = be(bytes, 8, 8)
  }

  if (header.unitBytes !== SECTOR) return null
  return {
    unitBytes: SECTOR,
    firstUnit: 0,
    dataOffset: 0,
    sectors: Math.floor(header.logicalBytes / SECTOR)
  }
}

function cdLayout(header: Header, fields: Record<string, string>): Layout | null {
  const dataOffset = CD_DATA_OFFSET[fields.TYPE]
  if (dataOffset === undefined || header.unitBytes !== CD_FRAME) return null
  const frames = Number(fields.FRAMES)
  // A pregap is stored ahead of the track only where its type is marked `V`.
  const pregap = fields.PGTYPE?.startsWith('V') ? Number(fields.PREGAP) : 0
  if (!Number.isInteger(frames) || !Number.isInteger(pregap) || pregap > frames) return null
  return { unitBytes: CD_FRAME, firstUnit: pregap, dataOffset, sectors: frames - pregap }
}

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

/** What CHD's `lzma` codec encodes with: the SDK's defaults. */
const LZMA = { lc: 3, lp: 0, pb: 2 }

function codecFor(env: SaveEnvironment, tag: string): Codec | null {
  const zlib: Codec = (data, size) => fromText(env.inflateRaw(toText(data), size))
  const zstd: Codec = (data, size) => fromText(env.zstd(toText(data), size))
  const lzma: Codec = (data, size) => lzmaDecode(data, size, LZMA)
  switch (tag) {
    case 'zlib':
      return zlib
    case 'zstd':
      return zstd
    case 'lzma':
      return lzma
    case 'huff':
      return huff
    case 'cdzl':
      return cd(zlib, zlib)
    case 'cdlz':
      return cd(lzma, zlib)
    case 'cdzs':
      return cd(zstd, zstd)
    default:
      return null
  }
}

/** Each byte a Huffman code, after the tree. */
function huff(data: Uint8Array, size: number): Hunk {
  const bits = new BitReader(data)
  const tree = new Huffman(256, 16)
  if (!tree.importHuffman(bits)) return null
  const output = new Uint8Array(size)
  for (let index = 0; index < size; index += 1) output[index] = tree.decode(bits)
  return bits.overflowed ? null : output
}

/**
 * A CD hunk: the sectors of its frames compressed together, then their subcode.
 *
 * A bitmap ahead of them marks each frame whose sync header and error
 * correction were dropped for being exactly what the rest of the sector
 * implies, and they are put back.
 */
function cd(base: Codec, subcode: Codec): Codec {
  return (data, size) => {
    const frames = Math.floor(size / CD_FRAME)
    if (frames * CD_FRAME !== size) return null
    const eccBytes = Math.ceil(frames / 8)
    const lengthBytes = size < 65536 ? 2 : 3
    const headerBytes = eccBytes + lengthBytes
    if (data.length < headerBytes) return null
    const baseLength = be(data, eccBytes, lengthBytes)
    if (headerBytes + baseLength > data.length) return null

    const sectors = base(data.subarray(headerBytes, headerBytes + baseLength), frames * CD_SECTOR)
    const subcodes = subcode(data.subarray(headerBytes + baseLength), frames * CD_SUBCODE)
    if (!sectors || sectors.length !== frames * CD_SECTOR) return null
    if (!subcodes || subcodes.length !== frames * CD_SUBCODE) return null

    const output = new Uint8Array(size)
    for (let frame = 0; frame < frames; frame += 1) {
      const sector = output.subarray(frame * CD_FRAME, frame * CD_FRAME + CD_SECTOR)
      sector.set(sectors.subarray(frame * CD_SECTOR, (frame + 1) * CD_SECTOR))
      output.set(
        subcodes.subarray(frame * CD_SUBCODE, (frame + 1) * CD_SUBCODE),
        frame * CD_FRAME + CD_SECTOR
      )
      if ((data[frame >>> 3] & (1 << (frame & 7))) !== 0) {
        sector.set(CD_SYNC)
        eccGenerate(sector)
      }
    }
    return output
  }
}

// ---------------------------------------------------------------------------
// CD error correction
// ---------------------------------------------------------------------------

const ECC_F = new Uint8Array(256)
const ECC_B = new Uint8Array(256)
for (let index = 0; index < 256; index += 1) {
  const doubled = ((index << 1) ^ (index & 0x80 ? 0x11d : 0)) & 0xff
  ECC_F[index] = doubled
  ECC_B[index ^ doubled] = index
}

/**
 * The P and Q parity of a sector, written where they belong, computed over the
 * header onwards. A mode 2 sector leaves its address out of the parity, so it
 * counts as zero while the parity is computed.
 */
function eccGenerate(sector: Uint8Array): void {
  const address = sector.slice(12, 16)
  if (sector[15] === 2) sector.fill(0, 12, 16)
  eccBlock(sector, 86, 24, 2, 86, 0x81c)
  eccBlock(sector, 52, 43, 86, 88, 0x8c8)
  sector.set(address, 12)
}

function eccBlock(
  sector: Uint8Array,
  majorCount: number,
  minorCount: number,
  majorMult: number,
  minorInc: number,
  dest: number
): void {
  const source = 0x0c
  const size = majorCount * minorCount
  for (let major = 0; major < majorCount; major += 1) {
    let index = (major >>> 1) * majorMult + (major & 1)
    let a = 0
    let b = 0
    for (let minor = 0; minor < minorCount; minor += 1) {
      const value = sector[source + index]
      index += minorInc
      if (index >= size) index -= size
      a ^= value
      b ^= value
      a = ECC_F[a]
    }
    a = ECC_B[ECC_F[a] ^ b]
    sector[dest + major] = a
    sector[dest + major + majorCount] = a ^ b
  }
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint16Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index << 8
  for (let bit = 0; bit < 8; bit += 1) value = value & 0x8000 ? (value << 1) ^ 0x1021 : value << 1
  CRC_TABLE[index] = value & 0xffff
}

/** CRC-16/CCITT, which MAME checks hunks and the map with. */
class Crc16 {
  value = 0xffff

  update(bytes: Uint8Array): void {
    let value = this.value
    for (const byte of bytes) value = ((value << 8) ^ CRC_TABLE[(value >>> 8) ^ byte]) & 0xffff
    this.value = value
  }
}

function crc16(bytes: Uint8Array): number {
  const crc = new Crc16()
  crc.update(bytes)
  return crc.value
}

function be(bytes: Uint8Array, at: number, count: number): number {
  let value = 0
  for (let index = 0; index < count; index += 1) value = value * 256 + bytes[at + index]
  return value
}

function putBe(bytes: Uint8Array, at: number, count: number, value: number): void {
  let left = value
  for (let index = count - 1; index >= 0; index -= 1) {
    bytes[at + index] = left % 256
    left = Math.floor(left / 256)
  }
}

function toBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index)
  return bytes
}

function fromText(text: string | null): Uint8Array | null {
  return text === null ? null : toBytes(text)
}

function toText(bytes: Uint8Array): string {
  let text = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return text
}
