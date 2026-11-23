import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ps2Serial } from './ps2-saves.ts'
import { iso, SECTOR } from './test/discs.ts'
import type { SaveEnvironment } from './savepaths.ts'

/**
 * Reading the serial a PS2 disc declares, which a PCSX2 folder card names each
 * game's save folders after. A wrong serial is another game's folders sent up
 * under this one, so a line that is not what it should be reads as none.
 */

function reading(bytes: string): SaveEnvironment {
  const env: Pick<SaveEnvironment, 'read' | 'inflateRaw'> = {
    read: (_path, offset, length) => bytes.slice(offset, offset + length),
    inflateRaw: () => null
  }
  return env as SaveEnvironment
}

const serial = (cnf: string): string | null =>
  ps2Serial(reading(iso({ 'SYSTEM.CNF': cnf })), '/roms/ps2/game.iso')

test('the serial is the executable BOOT2 names, spelt as save folders spell it', () => {
  assert.equal(serial('BOOT2 = cdrom0:\\SLUS_203.12;1\r\nVER = 1.00\r\n'), 'SLUS-20312')
  // Spacing and case vary between discs.
  assert.equal(serial('VMODE = PAL\nBOOT2=cdrom0:\\sles_503.66;1\n'), 'SLES-50366')
})

test('and none from a disc with no BOOT2 line, or one naming no serial', () => {
  // A PS1 disc boots through BOOT, which PCSX2 does not save for.
  assert.equal(serial('BOOT = cdrom:\\SLUS_000.67;1\r\n'), null)
  assert.equal(serial('BOOT2 = cdrom0:\\MAIN.ELF;1\r\n'), null)
})

test('and none from an image that is not an ISO', () => {
  assert.equal(ps2Serial(reading('MComprHD'.padEnd(40 * SECTOR, '\0')), '/roms/ps2/game.chd'), null)
})
