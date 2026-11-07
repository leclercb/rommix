import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { nupTitleId } from './nup.ts'
import { le32 } from './test/discs.ts'
import { ADDON, BASE, nup, UPDATE } from './test/nup.ts'
import type { SaveEnvironment } from './savepaths.ts'

/**
 * Reading the title id a Switch 2 `.nup` declares, which Eglantine names the
 * game's save folder after.
 *
 * A wrong id is another game's save folder archived and sent up under this
 * one, so every container here is built byte by byte from Eglantine's own
 * layout (`nup_container.cpp`, `loader/nup.cpp`) rather than taken from a game.
 */

/** Every read asked of `reading`, so a test can say nothing was asked for wholesale. */
let reads: { offset: number; length: number }[] = []

/** A machine holding one file, read the way a descriptor reads it. */
function reading(bytes: string): SaveEnvironment {
  return {
    read: (_path, offset, length) => {
      reads.push({ offset, length })
      return bytes.slice(offset, offset + length)
    },
    head: (_path, length) => {
      reads.push({ offset: 0, length })
      return bytes.slice(0, length)
    }
  } as SaveEnvironment
}

const id = (bytes: string, system = 'switch2'): string | null =>
  nupTitleId(reading(bytes), system, '/roms/switch2/game.nup')

describe('the title id of a Switch 2 container', () => {
  test('is the base package’s', () => {
    assert.equal(id(nup([{ titleId: 0x0400_1234_5678_9000n, kind: BASE }])), '0400123456789000')
  })

  test('is the base’s when updates come with it, whatever their versions', () => {
    const container = nup([
      { titleId: 0x0400_1234_5678_9800n, kind: UPDATE, version: 0x20000 },
      { titleId: 0x0400_1234_5678_9000n, kind: BASE },
      { titleId: 0x0400_1234_5678_9001n, kind: ADDON },
      { titleId: 0x0400_1234_5678_9800n, kind: UPDATE, version: 0x40000 }
    ])
    assert.equal(id(container), '0400123456789000')
  })

  test('is the highest update’s, unmasked, when the container is only updates', () => {
    // A standalone update boots on its own, and Eglantine keeps the id as it is:
    // the trailing `800` is not cleared the way a Switch update's is.
    const container = nup([
      { titleId: 0x0400_1234_5678_9801n, kind: UPDATE, version: 0x10000 },
      { titleId: 0x0400_1234_5678_9802n, kind: UPDATE, version: 0x30000 },
      { titleId: 0x0400_1234_5678_9803n, kind: UPDATE, version: 0x20000 }
    ])
    assert.equal(id(container), '0400123456789802')
  })

  test('is the first of the highest updates when two share a version', () => {
    const container = nup([
      { titleId: 0x0400_1234_5678_9801n, kind: UPDATE, version: 0x30000 },
      { titleId: 0x0400_1234_5678_9802n, kind: UPDATE, version: 0x30000 }
    ])
    assert.equal(id(container), '0400123456789801')
  })

  test('is the highest update’s when the base carries no program', () => {
    const container = nup([
      { titleId: 0x0400_1234_5678_9000n, kind: BASE, exefs: false },
      { titleId: 0x0400_1234_5678_9800n, kind: UPDATE, version: 0x10000 }
    ])
    assert.equal(id(container), '0400123456789800')
  })

  test('is none when the package Eglantine would boot carries no program', () => {
    // Eglantine picks the highest update before it looks for a program, so a
    // lower one that has one is not a fallback it takes — nor is a later base.
    const container = nup([
      { titleId: 0x0400_1234_5678_9000n, kind: BASE, exefs: false },
      { titleId: 0x0400_1234_5678_a000n, kind: BASE },
      { titleId: 0x0400_1234_5678_9800n, kind: UPDATE, version: 0x10000 },
      { titleId: 0x0400_1234_5678_9800n, kind: UPDATE, version: 0x20000, exefs: false }
    ])
    assert.equal(id(container), null)
  })

  test('is none when a package names a directory the TOC does not have', () => {
    // Eglantine refuses such a container outright rather than booting from it.
    const base = [{ titleId: 0x0400_1234_5678_9000n, kind: BASE }]
    assert.equal(id(nup(base, { dirCount: 0 })), null)
  })

  test('is none from a file that is not a container', () => {
    const base = [{ titleId: 0x0400_1234_5678_9000n, kind: BASE }]
    assert.equal(id(nup(base, { magic: 'NUP\x02' })), null)
    assert.equal(id(nup(base, { tocMagic: 'TOC\x02' })), null)
    assert.equal(id(nup(base, { tocCount: 2 })), null)
    assert.equal(id(nup([{ titleId: 0x0400_1234_5678_9000n, kind: 3 }])), null)
    assert.equal(id(nup([])), null)
    assert.equal(id('NUP\x01'), null)
  })

  test('is none when the TOC claims to start inside the superblock', () => {
    // The superblock takes the first 0x80 bytes; a TOC below that overlaps it.
    // The directory count here lands where the superblock keeps its package
    // count, so everything else about this container agrees with itself.
    const base = [{ titleId: 0x0400_1234_5678_9000n, kind: BASE }]
    assert.equal(id(nup(base, { tocOffset: 0x40, dirCount: 1 })), null)
  })

  test('is none when the id is zero', () => {
    assert.equal(id(nup([{ titleId: 0n, kind: BASE }]), 'switch2'), null)
  })

  test('is none under another system’s prefix', () => {
    // A Switch id in a Switch 2 container would name another game's folder.
    assert.equal(id(nup([{ titleId: 0x0100_7ef0_0011_e000n, kind: BASE }])), null)
    // And the prefix is the system's, not the format's.
    assert.equal(id(nup([{ titleId: 0x0400_1234_5678_9000n, kind: BASE }]), 'switch'), null)
    assert.equal(id(nup([{ titleId: 0x0400_1234_5678_9000n, kind: BASE }]), 'snes'), null)
  })

  test('is read from a short slice at the front, never the whole file', () => {
    const packages = Array.from({ length: 64 }, (_, index) => ({
      titleId: 0x0400_1234_5678_9001n + BigInt(index),
      kind: ADDON
    }))
    const container = nup([...packages, { titleId: 0x0400_1234_5678_9000n, kind: BASE }])
    reads = []
    assert.equal(id(container + 'x'.repeat(1 << 20)), '0400123456789000')
    for (const { offset, length } of reads) {
      assert.ok(offset + length <= container.length, `read ${length} bytes at ${offset}`)
    }
  })

  test('is not read past the superblock when the package count is absurd', () => {
    const container = nup([{ titleId: 0x0400_1234_5678_9000n, kind: BASE }])
    const absurd = container.slice(0, 0x48) + le32(0xffffffff) + container.slice(0x4c)
    reads = []
    assert.equal(id(absurd), null)
    assert.ok(Math.max(...reads.map((read) => read.length)) <= 0x80, 'read past the superblock')
  })
})
