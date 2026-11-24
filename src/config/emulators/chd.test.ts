import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, test } from 'node:test'
import { deflateRawSync, inflateRawSync, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { ps2Serial } from './ps2-saves.ts'
import { ps2Disc, SECTOR } from './test/discs.ts'
import type { SaveEnvironment } from './savepaths.ts'

/**
 * Reading a PS2 serial out of a CHD, which PCSX2 names a game's save folders
 * after.
 *
 * Each image is the disc from `ps2Disc` written into a CHD here, field by field
 * as `chdman` lays one out: the header, the metadata, the hunks, and the map
 * last. A wrong serial is another game's saves sent up under this one, so
 * anything the reader cannot vouch for has to read as no serial at all.
 */

const DISC = ps2Disc('SLUS_203.12')
const SERIAL = 'SLUS-20312'

const CD_SECTOR = 2352
const CD_FRAME = CD_SECTOR + 96

/** How one hunk is kept: compressed with a codec, as it is, or as a copy of an earlier one. */
type Coding = string | 'stored' | { self: number }

interface ChdOptions {
  hunkBytes: number
  unitBytes: number
  /** The codec tags the header names, by slot. */
  codecs: string[]
  coding: (hunk: number) => Coding
  metadata?: [tag: string, text: string][]
  /** Hunks whose checksum is written wrong. */
  badCrc?: number[]
  parent?: boolean
}

function chd(units: Buffer, options: ChdOptions): string {
  const { hunkBytes, unitBytes, codecs, coding, metadata = [], badCrc = [] } = options
  const hunks = Math.ceil(units.length / hunkBytes)
  const header = Buffer.alloc(124)
  header.write('MComprHD', 0, 'latin1')
  header.writeUInt32BE(124, 8)
  header.writeUInt32BE(5, 12)
  codecs.forEach((tag, slot) => header.write(tag, 16 + slot * 4, 'latin1'))
  header.writeBigUInt64BE(BigInt(units.length), 32)
  header.writeUInt32BE(hunkBytes, 56)
  header.writeUInt32BE(unitBytes, 60)
  if (options.parent) header.fill(0xab, 104, 124)

  const parts: Buffer[] = [header]
  let at = 124
  if (metadata.length > 0) header.writeBigUInt64BE(BigInt(at), 48)
  metadata.forEach(([tag, text], index) => {
    const entry = Buffer.alloc(16 + text.length + 1)
    entry.write(tag, 0, 'latin1')
    entry.writeUIntBE(text.length + 1, 5, 3)
    const next = index + 1 < metadata.length ? at + entry.length : 0
    entry.writeBigUInt64BE(BigInt(next), 8)
    entry.write(text, 16, 'latin1')
    parts.push(entry)
    at += entry.length
  })

  const first = at
  const entries = []
  for (let index = 0; index < hunks; index += 1) {
    const raw = Buffer.alloc(hunkBytes)
    units.copy(raw, 0, index * hunkBytes, (index + 1) * hunkBytes)
    const way = coding(index)
    const crc = crc16(raw) ^ (badCrc.includes(index) ? 1 : 0)
    if (typeof way === 'object') {
      entries.push({ type: 5, length: 0, value: way.self, crc: 0 })
    } else if (way === 'stored') {
      parts.push(raw)
      entries.push({ type: 4, length: hunkBytes, value: 0, crc })
      at += hunkBytes
    } else {
      const data = compress(way, raw)
      parts.push(data)
      entries.push({ type: codecs.indexOf(way), length: data.length, value: 0, crc })
      at += data.length
    }
  }

  // The map: a tree giving every type a four-bit code, the types with runs of
  // the same one cut short, then each hunk's length, checksum or source.
  const lengthBits = Math.max(...entries.map((entry) => entry.length)).toString(2).length
  const selfBits = hunks.toString(2).length
  const bits = new BitWriter()
  for (let code = 0; code < 16; code += 1) bits.write(4, 4)
  for (let index = 0; index < entries.length;) {
    const type = entries[index].type
    bits.write(4, type)
    let run = 0
    while (index + 1 + run < entries.length && entries[index + 1 + run].type === type) run += 1
    index += 1
    if (run >= 3) {
      const taken = Math.min(run, 18)
      bits.write(4, 7)
      bits.write(4, taken - 3)
      index += taken
    }
  }
  const crc = new Crc16()
  let offset = first
  for (const entry of entries) {
    const row = Buffer.alloc(12)
    row[0] = entry.type
    if (entry.type === 5) {
      bits.write(selfBits, entry.value)
      row.writeUIntBE(entry.value, 4, 6)
    } else {
      if (entry.type !== 4) bits.write(lengthBits, entry.length)
      bits.write(16, entry.crc)
      row.writeUIntBE(entry.length, 1, 3)
      row.writeUIntBE(offset, 4, 6)
      row.writeUInt16BE(entry.crc, 10)
      offset += entry.length
    }
    crc.update(row)
  }
  const compressed = bits.bytes()
  const map = Buffer.alloc(16)
  map.writeUInt32BE(compressed.length, 0)
  map.writeUIntBE(first, 4, 6)
  map.writeUInt16BE(crc.value, 10)
  map[12] = lengthBits
  map[13] = selfBits
  header.writeBigUInt64BE(BigInt(at), 40)
  parts.push(map, compressed)
  // chdman records the image's SHA-1, which tells one image from another at the same path.
  createHash('sha1')
    .update(Buffer.concat(parts.slice(1)))
    .digest()
    .copy(header, 84)
  return Buffer.concat(parts).toString('latin1')
}

function compress(codec: string, raw: Buffer): Buffer {
  switch (codec) {
    case 'zlib':
      return deflateRawSync(raw)
    case 'zstd':
      return zstdCompressSync(raw)
    case 'huff':
      return huffman(raw)
    case 'cdzl':
      return cdHunk(raw, deflateRawSync)
    case 'cdzs':
      return cdHunk(raw, zstdCompressSync)
    default:
      // A codec the reader does not know: the bytes are never looked at.
      return Buffer.from(raw.subarray(0, 16))
  }
}

/**
 * Every byte its own eight-bit code. The tree saying so is itself coded with a
 * smaller tree holding two codes: one bit for "8", one for "the same again",
 * and the run filling the other 255 codes.
 */
function huffman(raw: Buffer): Buffer {
  const bits = new BitWriter()
  bits.write(3, 1) // the "same again" code is one bit long
  bits.write(3, 7) // lengths are listed from the eighth code on:
  bits.write(3, 0) // the eighth has none,
  bits.write(3, 1) // the ninth, for "8", is one bit long,
  bits.write(3, 7) // and that is the last.
  bits.write(1, 1) // a length of 8
  bits.write(1, 0) // repeated, for a run of 7 + 2 + 246
  bits.write(3, 7)
  bits.write(8, 246)
  for (const byte of raw) bits.write(8, byte)
  return bits.bytes()
}

/**
 * A CD hunk: the bitmap of frames whose sync and parity are left out, the size
 * of the compressed sectors, the sectors, then the subcode. A frame whose
 * parity is all zero has it left out along with the sync — a mode 2 sector of
 * zeros, whose address the parity does not cover, is one.
 */
function cdHunk(raw: Buffer, pack: (data: Buffer) => Buffer): Buffer {
  const frames = raw.length / CD_FRAME
  const bitmap = Buffer.alloc(Math.ceil(frames / 8))
  const sectors = Buffer.alloc(frames * CD_SECTOR)
  const subcode = Buffer.alloc(frames * 96)
  for (let frame = 0; frame < frames; frame += 1) {
    const sector = Buffer.from(raw.subarray(frame * CD_FRAME, frame * CD_FRAME + CD_SECTOR))
    const zeroParity = sector.subarray(0x81c, 0x930).every((byte) => byte === 0)
    const zeroData = sector.subarray(16).every((byte) => byte === 0)
    if (zeroParity && zeroData && sector[15] === 2) {
      bitmap[frame >>> 3] |= 1 << (frame & 7)
      sector.fill(0, 0, 12)
    }
    sector.copy(sectors, frame * CD_SECTOR)
    raw.copy(subcode, frame * 96, frame * CD_FRAME + CD_SECTOR, (frame + 1) * CD_FRAME)
  }
  const base = pack(sectors)
  const size = Buffer.alloc(2)
  size.writeUInt16BE(base.length)
  return Buffer.concat([bitmap, size, base, pack(subcode)])
}

/** The disc as a mode 2 track: each sector in a frame with its sync, address and subheader. */
function mode2Frames(disc: string, pregap = 0): Buffer {
  const sectors = disc.length / SECTOR
  const frames = Buffer.alloc((pregap + sectors) * CD_FRAME)
  for (let index = 0; index < sectors; index += 1) {
    const frame = frames.subarray((pregap + index) * CD_FRAME)
    Buffer.from([0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0]).copy(frame)
    frame.writeUIntBE(0x000200 + index, 12, 3)
    frame[15] = 2
    Buffer.from(disc.slice(index * SECTOR, (index + 1) * SECTOR), 'latin1').copy(frame, 24)
  }
  return frames
}

class BitWriter {
  private readonly bits: number[] = []

  write(count: number, value: number): void {
    for (let bit = count - 1; bit >= 0; bit -= 1) this.bits.push(Math.floor(value / 2 ** bit) % 2)
  }

  bytes(): Buffer {
    const out = Buffer.alloc(Math.ceil(this.bits.length / 8))
    this.bits.forEach((bit, index) => {
      out[index >>> 3] |= bit << (7 - (index & 7))
    })
    return out
  }
}

class Crc16 {
  value = 0xffff

  update(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.value ^= byte << 8
      for (let bit = 0; bit < 8; bit += 1) {
        this.value = this.value & 0x8000 ? (this.value << 1) ^ 0x1021 : this.value << 1
        this.value &= 0xffff
      }
    }
  }
}

function crc16(bytes: Uint8Array): number {
  const crc = new Crc16()
  crc.update(bytes)
  return crc.value
}

let reads = 0

function reading(bytes: string): SaveEnvironment {
  const latin1 = (run: (data: Buffer) => Buffer) => (data: string) => {
    try {
      return run(Buffer.from(data, 'latin1')).toString('latin1')
    } catch {
      return null
    }
  }
  return {
    read: (_path, offset, length) => {
      reads += 1
      return bytes.slice(offset, offset + length)
    },
    inflateRaw: (data, maxBytes) =>
      latin1((buffer) => inflateRawSync(buffer, { maxOutputLength: maxBytes }))(data),
    zstd: (data, maxBytes) =>
      latin1((buffer) => zstdDecompressSync(buffer, { maxOutputLength: maxBytes }))(data)
  } as SaveEnvironment
}

const serial = (image: string): string | null => ps2Serial(reading(image), '/roms/ps2/game.chd')

const dvd = (options: Partial<ChdOptions> = {}): string =>
  chd(Buffer.from(DISC, 'latin1'), {
    hunkBytes: 2 * SECTOR,
    unitBytes: SECTOR,
    codecs: ['zlib', 'zstd', 'huff', '\0\0\0\0'],
    coding: (hunk) => ['zlib', 'zstd', 'huff', 'stored'][hunk % 4],
    metadata: [['DVD ', '']],
    ...options
  })

describe('the serial in a CHD of a DVD', () => {
  test('is read through every codec a disc is compressed with', () => {
    assert.equal(serial(dvd()), SERIAL)
    for (const codec of ['zlib', 'zstd', 'huff']) {
      assert.equal(serial(dvd({ coding: () => codec })), SERIAL, codec)
    }
  })

  test('through hunks that copy an earlier one, and runs of the same coding', () => {
    // The system area is zeros, and chdman keeps a repeat as a pointer back.
    const image = dvd({ coding: (hunk) => (hunk > 0 && hunk < 8 ? { self: 0 } : 'zlib') })
    assert.equal(serial(image), SERIAL)
  })

  test('and from one whose hunks are all kept as they are, with no map to decode', () => {
    // Each map entry counts hunks from the start of the file, so the header is
    // padded out to one and the disc follows it.
    const units = Buffer.from(DISC, 'latin1')
    const hunks = units.length / SECTOR
    const header = Buffer.alloc(SECTOR)
    header.write('MComprHD', 0, 'latin1')
    header.writeUInt32BE(124, 8)
    header.writeUInt32BE(5, 12)
    header.writeBigUInt64BE(BigInt(units.length), 32)
    header.writeBigUInt64BE(BigInt(SECTOR + units.length), 40)
    header.writeUInt32BE(SECTOR, 56)
    header.writeUInt32BE(SECTOR, 60)
    const map = Buffer.alloc(hunks * 4)
    for (let index = 0; index < hunks; index += 1) map.writeUInt32BE(index + 1, index * 4)
    assert.equal(serial(Buffer.concat([header, units, map]).toString('latin1')), SERIAL)
  })
})

describe('a CHD read again', () => {
  test('keeps its decoded map, the image being the same', () => {
    const image = dvd()
    reads = 0
    serial(image)
    const first = reads
    reads = 0
    assert.equal(serial(image), SERIAL)
    assert.ok(reads < first, `${reads} reads the second time, ${first} the first`)
  })

  test('and decodes the map afresh for another image at the same path', () => {
    assert.equal(serial(dvd()), SERIAL)
    assert.equal(serial(dvd({ badCrc: [9] })), null)
    assert.equal(serial(dvd({ coding: () => 'zstd' })), SERIAL)
  })
})

describe('the serial in a CHD of a CD', () => {
  const cd = (codec: string, pregap = 0): string =>
    chd(mode2Frames(DISC, pregap), {
      hunkBytes: 8 * CD_FRAME,
      unitBytes: CD_FRAME,
      codecs: [codec, '\0\0\0\0', '\0\0\0\0', '\0\0\0\0'],
      coding: () => codec,
      metadata: [
        [
          'CHT2',
          `TRACK:1 TYPE:MODE2_RAW SUBTYPE:NONE FRAMES:${pregap + DISC.length / SECTOR} PREGAP:${pregap} PGTYPE:${pregap ? 'VMODE2_RAW' : 'MODE1'} PGSUB:NONE POSTGAP:0`
        ]
      ]
    })

  test('is read out of the first track, the sync and parity left out put back', () => {
    assert.equal(serial(cd('cdzl')), SERIAL)
    assert.equal(serial(cd('cdzs')), SERIAL)
  })

  test('after a pregap stored ahead of the track', () => {
    assert.equal(serial(cd('cdzl', 150)), SERIAL)
  })
})

describe('no serial', () => {
  test('from a hunk that does not come out as its checksum says', () => {
    // The hunk holding SYSTEM.CNF: sector 19, two to a hunk.
    assert.equal(serial(dvd({ badCrc: [9] })), null)
  })

  test('from a hunk in a codec not read here, FLAC among them', () => {
    assert.equal(serial(dvd({ codecs: ['flac'], coding: () => 'flac' })), null)
  })

  test('from a CHD that needs its parent', () => {
    assert.equal(serial(dvd({ parent: true })), null)
  })

  test('from a GD-ROM, whose filesystem is not on the first track', () => {
    assert.equal(serial(dvd({ metadata: [['CHGD', 'TRACK:1 TYPE:MODE1 FRAMES:20']] })), null)
  })

  test('from a CD whose first track is audio', () => {
    const image = chd(mode2Frames(DISC), {
      hunkBytes: 8 * CD_FRAME,
      unitBytes: CD_FRAME,
      codecs: ['cdzl'],
      coding: () => 'cdzl',
      metadata: [['CHT2', 'TRACK:1 TYPE:AUDIO SUBTYPE:NONE FRAMES:20 PREGAP:0 PGTYPE:MODE1']]
    })
    assert.equal(serial(image), null)
  })
})
