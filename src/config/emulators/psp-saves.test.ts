import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { pspGameId } from './psp-saves.ts'
import { iso, le32, SECTOR } from './test/discs.ts'
import type { SaveEnvironment } from './savepaths.ts'

/**
 * Reading the disc id a PSP image declares, which PPSSPP names its save
 * folders after.
 *
 * A wrong id is another game's save folders archived and sent up under this
 * one, so every image here is built byte by byte: an ISO 9660 filesystem with
 * `UMD_DATA.BIN` in its root (see `iso`), and the same filesystem cut into CSO
 * blocks below.
 */

interface CsoOptions {
  blockSize?: number
  /** Positions in the index are stored shifted right by this. */
  align?: number
  /** Blocks stored as they are rather than deflated. */
  stored?: readonly number[]
}

/**
 * An image cut into CSO blocks, as maxcso writes one.
 *
 * Each index entry is a block's position shifted right by `align`, with the top
 * bit marking a block kept uncompressed; one more entry closes the last block.
 * Every block is padded to the alignment, so a deflated one has bytes after the
 * end of its stream — which a real image has too.
 */
function cso(image: string, options: CsoOptions = {}): string {
  const { blockSize = SECTOR, align = 0, stored = [] } = options
  const unit = 2 ** align
  const blocks = Math.ceil(image.length / blockSize)
  const aligned = (offset: number): number => Math.ceil(offset / unit) * unit

  let position = aligned(0x18 + (blocks + 1) * 4)
  const index: number[] = []
  const body: string[] = []
  for (let block = 0; block < blocks; block += 1) {
    const raw = image.slice(block * blockSize, (block + 1) * blockSize).padEnd(blockSize, '\0')
    const keep = stored.includes(block)
    const bytes = keep ? raw : deflateRawSync(Buffer.from(raw, 'latin1')).toString('latin1')
    const flag = keep ? 0x80000000 : 0
    index.push(((position / unit) | flag) >>> 0)
    const padded = bytes.padEnd(aligned(bytes.length), '\0')
    body.push(padded)
    position += padded.length
  }
  index.push(position / unit)

  // The header size is written as zero, which is what real images in the wild
  // carry there — so nothing may lean on it for where the index starts.
  const header =
    'CISO' +
    le32(0) +
    le32(image.length) +
    le32(0) +
    le32(blockSize) +
    String.fromCharCode(1, align) +
    '\0\0'
  const table = header + index.map(le32).join('')
  return table.padEnd(aligned(table.length), '\0') + body.join('')
}

/** The largest read asked of `reading`, so a test can say nothing was asked for wholesale. */
let largestRead = 0

/** A machine holding one file, read the way a descriptor reads it. */
function reading(bytes: string): SaveEnvironment {
  return {
    read: (_path, offset, length) => {
      largestRead = Math.max(largestRead, length)
      return bytes.slice(offset, offset + length)
    },
    head: (_path, length) => bytes.slice(0, length),
    inflateRaw: (data, maxBytes) => {
      try {
        return inflateRawSync(Buffer.from(data, 'latin1'), { maxOutputLength: maxBytes }).toString(
          'latin1'
        )
      } catch {
        return null
      }
    }
  } as SaveEnvironment
}

const id = (bytes: string): string | null => pspGameId(reading(bytes), '/roms/psp/game')

const UMD = 'ULUS-10064|0123456789ABCDEF|0001|G'

describe('the disc id of a PSP image', () => {
  test('from a plain ISO, out of UMD_DATA.BIN, with the dash dropped as PPSSPP does', () => {
    assert.equal(id(iso({ 'UMD_DATA.BIN': UMD })), 'ULUS10064')
    assert.equal(id(iso({ 'UMD_DATA.BIN': 'NPJH50001|0000000000000000|0001|G' })), 'NPJH50001')
  })

  test('wherever on the disc the file sits', () => {
    const image = iso({ 'BIG.BIN': 'x'.repeat(40 * SECTOR), 'UMD_DATA.BIN': UMD })
    assert.equal(id(image), 'ULUS10064')
  })

  test('from CSO, block by block', () => {
    assert.equal(id(cso(iso({ 'UMD_DATA.BIN': UMD }))), 'ULUS10064')
  })

  test('from CSO with aligned positions and blocks kept uncompressed', () => {
    const image = iso({ 'UMD_DATA.BIN': UMD })
    assert.equal(id(cso(image, { align: 2, stored: [16, 19] })), 'ULUS10064')
  })

  test('from CSO with blocks larger than a sector', () => {
    const image = iso({ 'BIG.BIN': 'x'.repeat(9 * SECTOR), 'UMD_DATA.BIN': UMD })
    assert.equal(id(cso(image, { blockSize: 4 * SECTOR })), 'ULUS10064')
  })

  test('and none from a CSO header naming a block size no image has, without reading it', () => {
    // The header and the index are the image's own claims, and the only bound
    // on what a read asks for. A corrupt pair must not become a read of most of
    // a gigabyte from a file a few dozen bytes long.
    for (const blockSize of [2 ** 30, 3000, 512]) {
      largestRead = 0
      const header = 'CISO' + le32(0) + le32(0) + le32(1) + le32(blockSize) + '\x01\0\0\0' + le32(0)
      assert.equal(id(header + le32(0x30000000)), null, `block size ${blockSize}`)
      assert.ok(largestRead <= 4 * SECTOR, `asked for ${largestRead} bytes`)
    }
  })

  test('and none from a CSO block that inflates to more than a block', () => {
    // Every block but the last holds exactly one block of the image; one that
    // comes out longer is not what the index says it is.
    const env = reading(cso(iso({ 'UMD_DATA.BIN': UMD })))
    const long = {
      ...env,
      inflateRaw: (data: string) => {
        const inflated = env.inflateRaw(data, SECTOR)
        return inflated === null ? null : inflated + '\0'
      }
    }
    assert.equal(pspGameId(long, '/roms/psp/game.cso'), null)
  })

  test('and none from a disc with no UMD_DATA.BIN', () => {
    assert.equal(id(iso({ 'EBOOT.BIN': 'code' })), null)
  })

  test('and none from a UMD_DATA.BIN that names no disc id', () => {
    assert.equal(id(iso({ 'UMD_DATA.BIN': 'not an id|0000|G' })), null)
    assert.equal(id(iso({ 'UMD_DATA.BIN': 'no separator at all' })), null)
  })

  test('and none from a file that is not a disc image, or cannot be read', () => {
    // ZSO among them: its blocks are LZ4, and its header is not one read here.
    assert.equal(id('ZISO'.padEnd(40 * SECTOR, '\0')), null)
    assert.equal(id('PK\x03\x04'.padEnd(40 * SECTOR, '\0')), null)
    assert.equal(id(''), null)
    const missing = { read: () => null, head: () => null } as unknown as SaveEnvironment
    assert.equal(pspGameId(missing, '/roms/psp/game.iso'), null)
  })
})
