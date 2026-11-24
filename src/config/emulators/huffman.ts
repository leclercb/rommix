/**
 * The bit reader and Huffman decoder CHD codes its map and its `huff` hunks
 * with, as MAME writes them (`src/lib/util/huffman.cpp`).
 *
 * Codes are canonical, but counted down from the longest rather than up from
 * the shortest the way deflate counts, so no general decoder reads them: the
 * same lengths give other codes.
 */

/** Bits most significant first, as MAME's `bitstream_in` reads them; past the end reads as zero. */
export class BitReader {
  private at = 0

  constructor(private readonly bytes: Uint8Array) {}

  read(count: number): number {
    let value = 0
    let left = count
    while (left > 0) {
      const index = Math.floor(this.at / 8)
      const offset = this.at % 8
      const take = Math.min(8 - offset, left)
      const byte = index < this.bytes.length ? this.bytes[index] : 0
      value = value * 2 ** take + ((byte >>> (8 - offset - take)) & ((1 << take) - 1))
      this.at += take
      left -= take
    }
    return value
  }

  peek(count: number): number {
    const at = this.at
    const value = this.read(count)
    this.at = at
    return value
  }

  skip(count: number): void {
    this.at += count
  }

  /** Whether more was read than there is, which means the stream was not what it claimed. */
  get overflowed(): boolean {
    return this.at > this.bytes.length * 8
  }
}

/** A decoder for `codes` symbols, none of whose codes is longer than `maxBits`. */
export class Huffman {
  private readonly lengths: Uint8Array
  private lookup: Uint32Array | null = null

  constructor(
    private readonly codes: number,
    private readonly maxBits: number
  ) {
    this.lengths = new Uint8Array(codes)
  }

  /**
   * Lengths written one after another, a `1` escaping either a literal 1 or a
   * run of the length after it. False where they do not make a tree.
   */
  importRle(bits: BitReader): boolean {
    const width = this.maxBits >= 16 ? 5 : this.maxBits >= 8 ? 4 : 3
    let node = 0
    while (node < this.codes) {
      const length = bits.read(width)
      if (length !== 1) {
        this.lengths[node++] = length
        continue
      }
      const escaped = bits.read(width)
      if (escaped === 1) {
        this.lengths[node++] = 1
        continue
      }
      const repeat = bits.read(width) + 3
      if (node + repeat > this.codes) return false
      this.lengths.fill(escaped, node, node + repeat)
      node += repeat
    }
    return this.build() && !bits.overflowed
  }

  /**
   * Lengths coded with a smaller Huffman tree: that tree's lengths first, then
   * each length or a run of the one before it.
   */
  importHuffman(bits: BitReader): boolean {
    const small = new Huffman(24, 6)
    small.lengths[0] = bits.read(3)
    const start = bits.read(3) + 1
    let count = 0
    for (let index = 1; index < 24; index += 1) {
      if (index < start || count === 7) {
        small.lengths[index] = 0
      } else {
        count = bits.read(3)
        small.lengths[index] = count === 7 ? 0 : count
      }
    }
    if (!small.build()) return false

    let runBits = 0
    for (let left = this.codes - 9; left !== 0; left >>>= 1) runBits += 1

    let last = 0
    let node = 0
    while (node < this.codes) {
      const value = small.decode(bits)
      if (value !== 0) {
        last = value - 1
        this.lengths[node++] = last
        continue
      }
      let repeat = bits.read(3) + 2
      if (repeat === 9) repeat += bits.read(runBits)
      for (; repeat !== 0 && node < this.codes; repeat -= 1) this.lengths[node++] = last
    }
    return this.build() && !bits.overflowed
  }

  decode(bits: BitReader): number {
    const entry = this.lookup?.[bits.peek(this.maxBits)] ?? 0
    bits.skip(entry & 0x1f)
    return entry >>> 5
  }

  /** Codes for the lengths, and the table mapping every `maxBits` prefix to one. */
  private build(): boolean {
    const histogram = new Uint32Array(33)
    for (const length of this.lengths) {
      if (length > this.maxBits) return false
      histogram[length] += 1
    }
    let start = 0
    for (let length = 32; length > 0; length -= 1) {
      const next = (start + histogram[length]) >>> 1
      if (length !== 1 && next * 2 !== start + histogram[length]) return false
      histogram[length] = start
      start = next
    }

    const lookup = new Uint32Array(1 << this.maxBits)
    for (let symbol = 0; symbol < this.codes; symbol += 1) {
      const length = this.lengths[symbol]
      if (length === 0) continue
      const code = histogram[length]++
      if (code >= 1 << length) return false
      const shift = this.maxBits - length
      lookup.fill((symbol << 5) | length, code << shift, (code + 1) << shift)
    }
    this.lookup = lookup
    return true
  }
}
