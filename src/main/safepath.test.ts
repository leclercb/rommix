import assert from 'node:assert/strict'
import { test } from 'node:test'
import { safeJoin } from './safepath.ts'

/**
 * Keeping a name that came from somewhere else inside the folder it is for.
 *
 * RomM decides what a ROM and a firmware file are called, and a zip decides
 * what is inside it. The server is the user's own, so this is not a stranger's
 * input — but it is not RomMix's either, and where a file is written should be
 * decided by RomMix rather than by the string it was handed.
 */

const ROOT = '/home/player/roms/genesis'

test('an ordinary name lands where it belongs', () => {
  assert.equal(safeJoin(ROOT, 'Sonic (USA).md'), `${ROOT}/Sonic (USA).md`)
  assert.equal(safeJoin(ROOT, 'Final Fantasy VII/disc1.bin'), `${ROOT}/Final Fantasy VII/disc1.bin`)
})

test('a name that climbs out of the folder is refused, not corrected', () => {
  // Refused rather than trimmed to its basename: a name that does not belong
  // here is one to reject, and rewriting it installs a file under something
  // other than what it is called.
  assert.equal(safeJoin(ROOT, '../../../.bashrc'), null)
  assert.equal(safeJoin(ROOT, '..'), null)
  assert.equal(safeJoin(ROOT, '../genesis-elsewhere/x.md'), null)
})

test('the string form is not the question — where it lands is', () => {
  // `a/../../b` and `../b` reach the same place and only one of them looks it.
  assert.equal(safeJoin(ROOT, 'a/../../b'), null)
  assert.equal(safeJoin(ROOT, './Sonic.md'), `${ROOT}/Sonic.md`)
  assert.equal(safeJoin(ROOT, 'sub/../Sonic.md'), `${ROOT}/Sonic.md`)
})

test('an absolute name is not a name in this folder', () => {
  assert.equal(safeJoin(ROOT, '/etc/passwd'), null)
})

test('a backslash is an ordinary character in a filename here', () => {
  // Linux allows it, so a game really can be called this. Only an archive's
  // own entry names need it read as a separator — see `entryTarget` in zip.ts.
  assert.equal(safeJoin(ROOT, 'AC\\DC.md'), `${ROOT}/AC\\DC.md`)
})

test('the folder itself is not a file in it', () => {
  assert.equal(safeJoin(ROOT, ''), null)
  assert.equal(safeJoin(ROOT, '.'), null)
})
