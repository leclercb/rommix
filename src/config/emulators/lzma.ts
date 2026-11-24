/**
 * A raw LZMA stream, decoded: no header, the properties and the size given.
 *
 * Here because CHD compresses most hunks of a disc this way and nothing in this
 * module may import a native decoder — nor does Node ship one. A port of the
 * reference decoder in the LZMA SDK (`LzmaSpec.cpp`), kept to what CHD needs:
 * the whole output fits in memory, so the output is the dictionary, and the
 * stream ends where `size` bytes have come out, an end marker or not.
 *
 * Null for a stream that is not one, rather than whatever bytes came out of it.
 */

/** The literal, position and length bits CHD encodes with. */
export interface LzmaProperties {
  lc: number
  lp: number
  pb: number
}

const PROBABILITY_BITS = 11
const PROBABILITY_INIT = 1 << (PROBABILITY_BITS - 1)
const MOVE_BITS = 5
const TOP = 2 ** 24

const STATES = 12
const POS_STATES_MAX = 16
const LEN_TO_POS_STATES = 4
const END_POS_MODEL_INDEX = 14
const FULL_DISTANCES = 128
const ALIGN_BITS = 4
const MATCH_MIN_LEN = 2
const END_MARKER = 0xffffffff

class Corrupt extends Error {}

class RangeDecoder {
  private range = 0xffffffff
  private code = 0
  private at = 0

  constructor(private readonly input: Uint8Array) {
    if (this.next() !== 0) throw new Corrupt()
    for (let index = 0; index < 4; index += 1) this.code = this.code * 256 + this.next()
    if (this.code === this.range) throw new Corrupt()
  }

  private next(): number {
    if (this.at >= this.input.length) throw new Corrupt()
    return this.input[this.at++]
  }

  private normalize(): void {
    if (this.range < TOP) {
      this.range *= 256
      this.code = this.code * 256 + this.next()
    }
  }

  bit(probs: Uint16Array, index: number): number {
    const probability = probs[index]
    const bound = (this.range >>> PROBABILITY_BITS) * probability
    let bit: number
    if (this.code < bound) {
      probs[index] = probability + (((1 << PROBABILITY_BITS) - probability) >>> MOVE_BITS)
      this.range = bound
      bit = 0
    } else {
      probs[index] = probability - (probability >>> MOVE_BITS)
      this.code -= bound
      this.range -= bound
      bit = 1
    }
    this.normalize()
    return bit
  }

  direct(count: number): number {
    let result = 0
    for (let index = 0; index < count; index += 1) {
      this.range = Math.floor(this.range / 2)
      let bit = 0
      if (this.code >= this.range) {
        this.code -= this.range
        bit = 1
      }
      if (this.code === this.range) throw new Corrupt()
      this.normalize()
      result = result * 2 + bit
    }
    return result
  }

  /** A tree of `bits` levels, most significant bit first. */
  tree(probs: Uint16Array, base: number, bits: number): number {
    let symbol = 1
    for (let index = 0; index < bits; index += 1)
      symbol = (symbol << 1) | this.bit(probs, base + symbol)
    return symbol - (1 << bits)
  }

  /** The same tree read least significant bit first. */
  reverse(probs: Uint16Array, base: number, bits: number): number {
    let node = 1
    let symbol = 0
    for (let index = 0; index < bits; index += 1) {
      const bit = this.bit(probs, base + node)
      node = (node << 1) | bit
      symbol |= bit << index
    }
    return symbol
  }
}

/** A match length: two choices, then a tree for each of three ranges. */
class LengthDecoder {
  private readonly choice = new Uint16Array(2).fill(PROBABILITY_INIT)
  private readonly low = new Uint16Array(POS_STATES_MAX << 3).fill(PROBABILITY_INIT)
  private readonly mid = new Uint16Array(POS_STATES_MAX << 3).fill(PROBABILITY_INIT)
  private readonly high = new Uint16Array(256).fill(PROBABILITY_INIT)

  decode(range: RangeDecoder, posState: number): number {
    if (range.bit(this.choice, 0) === 0) return range.tree(this.low, posState << 3, 3)
    if (range.bit(this.choice, 1) === 0) return 8 + range.tree(this.mid, posState << 3, 3)
    return 16 + range.tree(this.high, 0, 8)
  }
}

export function lzmaDecode(
  input: Uint8Array,
  size: number,
  { lc, lp, pb }: LzmaProperties
): Uint8Array | null {
  try {
    return decode(input, size, lc, lp, pb)
  } catch (error) {
    if (error instanceof Corrupt) return null
    throw error
  }
}

function decode(input: Uint8Array, size: number, lc: number, lp: number, pb: number): Uint8Array {
  const output = new Uint8Array(size)
  const range = new RangeDecoder(input)
  const probs = (length: number): Uint16Array => new Uint16Array(length).fill(PROBABILITY_INIT)

  const literals = probs(0x300 << (lc + lp))
  const isMatch = probs(STATES << 4)
  const isRep = probs(STATES)
  const isRepG0 = probs(STATES)
  const isRepG1 = probs(STATES)
  const isRepG2 = probs(STATES)
  const isRep0Long = probs(STATES << 4)
  const posSlots = probs(LEN_TO_POS_STATES << 6)
  const positions = probs(1 + FULL_DISTANCES - END_POS_MODEL_INDEX)
  const align = probs(1 << ALIGN_BITS)
  const lengths = new LengthDecoder()
  const repLengths = new LengthDecoder()

  const posMask = (1 << pb) - 1
  const literalPosMask = (1 << lp) - 1
  let state = 0
  let rep0 = 0
  let rep1 = 0
  let rep2 = 0
  let rep3 = 0
  let at = 0

  const distance = (length: number): number => {
    const lenState = Math.min(length, LEN_TO_POS_STATES - 1)
    const slot = range.tree(posSlots, lenState << 6, 6)
    if (slot < 4) return slot
    const directBits = (slot >>> 1) - 1
    let dist = (2 | (slot & 1)) * 2 ** directBits
    if (slot < END_POS_MODEL_INDEX) {
      return dist + range.reverse(positions, dist - slot, directBits)
    }
    dist += range.direct(directBits - ALIGN_BITS) * 2 ** ALIGN_BITS
    return dist + range.reverse(align, 0, ALIGN_BITS)
  }

  while (at < size) {
    const posState = at & posMask
    if (range.bit(isMatch, (state << 4) + posState) === 0) {
      const previous = at > 0 ? output[at - 1] : 0
      const base = 0x300 * (((at & literalPosMask) << lc) + (previous >>> (8 - lc)))
      let symbol = 1
      if (state >= 7) {
        let matchByte = output[at - rep0 - 1]
        while (symbol < 0x100) {
          const matchBit = (matchByte >>> 7) & 1
          matchByte <<= 1
          const bit = range.bit(literals, base + ((1 + matchBit) << 8) + symbol)
          symbol = (symbol << 1) | bit
          if (matchBit !== bit) break
        }
      }
      while (symbol < 0x100) symbol = (symbol << 1) | range.bit(literals, base + symbol)
      output[at++] = symbol - 0x100
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
      continue
    }

    let length: number
    if (range.bit(isRep, state) !== 0) {
      if (at === 0) throw new Corrupt()
      if (range.bit(isRepG0, state) === 0) {
        if (range.bit(isRep0Long, (state << 4) + posState) === 0) {
          state = state < 7 ? 9 : 11
          output[at] = output[at - rep0 - 1]
          at += 1
          continue
        }
      } else {
        let dist: number
        if (range.bit(isRepG1, state) === 0) {
          dist = rep1
        } else {
          if (range.bit(isRepG2, state) === 0) {
            dist = rep2
          } else {
            dist = rep3
            rep3 = rep2
          }
          rep2 = rep1
        }
        rep1 = rep0
        rep0 = dist
      }
      length = repLengths.decode(range, posState)
      state = state < 7 ? 8 : 11
    } else {
      rep3 = rep2
      rep2 = rep1
      rep1 = rep0
      length = lengths.decode(range, posState)
      state = state < 7 ? 7 : 10
      rep0 = distance(length)
      // The marker ends the stream, which is only right where it is the end.
      if (rep0 === END_MARKER) break
      if (rep0 >= at) throw new Corrupt()
    }

    length += MATCH_MIN_LEN
    if (length > size - at) throw new Corrupt()
    for (let index = 0; index < length; index += 1) {
      output[at] = output[at - rep0 - 1]
      at += 1
    }
  }

  if (at !== size) throw new Corrupt()
  return output
}
