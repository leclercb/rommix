import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lzmaDecode } from './lzma.ts'

/**
 * Decoding the raw LZMA streams CHD keeps most hunks in. The stream below is
 * what Python's `lzma` module, which is liblzma, writes for `TEXT` in the
 * raw format with CHD's properties: text repetitive enough that literals,
 * matches and repeated matches all occur, and an end marker after it.
 */

const TEXT = Array.from(
  { length: 200 },
  (_, index) => `SLUS_${(index * 37) % 1000}.${index % 7};`
).join('')
const PROPERTIES = { lc: 3, lp: 0, pb: 2 }

const STREAM = Buffer.from(
  [
    '00299306f0cd1e3e8d1801cf5d07aff4c455899553ce1e483162d2af7366bdbb3d99c03c20b014f8',
    'dc824633bf5ad53b9a66dfb319424e432c325a9267cba8e745d748ca856a726c4e5aac7fe25f5f85',
    '8fef7d70b49a6b2ebd6cc4e5e512e94fa8d0c044647d7be6e42c43c95daa67a379faff27328711ed',
    'be4858c2c5f265d9504cd8c32bdc92e0a324e7eb4cd429189186ea30a4a7c4d3e2b4f76e6499a462',
    'f6221630f7ad5b67541001e031b57096fb822fe4f5e8a2dc389c5711d0e8aadb6a0e0c7d08602ab8',
    '1d585027f07bb69878a6d71f7beb759ea89224c79c27f5aaadf3b5fba60951898d4f53b94fb5b357',
    '4eaa3689690c14ec293fe886d19e99f2a554390df4eb331628dca47f5bc8d2f0a48181bfa9d916cc',
    '44dd121258c4e7722676bbd85ff81e1c2c6ed204e6e9cf7aaad23a7a2286ebcab5d92a620f253b40',
    'a5ee58638be2c1a5494db8143b8bc388442d96ec153169ec3690801f0854802df601b77c7a9211ad',
    '20d012bb6252e9eac4ae715d2ed50142d66c967c6f5617e64ee72d516109e6994d01385e557131de',
    '5a430c4853280f7500595f8dc82471f67d5c70e4f2ab0d91cb6b18c85793bfe5ca40bcb9a8050037',
    '364b803c85f3165d0ddc05ffffe88e8000'
  ].join(''),
  'hex'
)

const text = (bytes: Uint8Array | null): string | null =>
  bytes && Buffer.from(bytes).toString('latin1')

test('a raw stream decodes to what was encoded', () => {
  assert.equal(text(lzmaDecode(STREAM, TEXT.length, PROPERTIES)), TEXT)
})

test('and stops where the size says, whatever follows', () => {
  assert.equal(text(lzmaDecode(STREAM, 100, PROPERTIES)), TEXT.slice(0, 100))
})

test('a stream cut short, or longer than it decodes to, is nothing', () => {
  assert.equal(lzmaDecode(STREAM.subarray(0, 200), TEXT.length, PROPERTIES), null)
  // The end marker comes before the size is reached.
  assert.equal(lzmaDecode(STREAM, TEXT.length + 1, PROPERTIES), null)
})

test('and so is one that does not start as a range coder does', () => {
  assert.equal(lzmaDecode(Buffer.from('not lzma'), 16, PROPERTIES), null)
})
