import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stemMatches, syncStateOf } from './saves.ts'

/**
 * The two judgements save sync makes that nothing else checks.
 *
 * `stemMatches` decides whether a file on disk belongs to this game. Too strict
 * and a real save is never uploaded; too loose and one game's memory card is
 * attributed to another, which is the worse of the two by a distance — RomM
 * would then hand it back under the wrong id on another device.
 *
 * `syncStateOf` decides which end is ahead, and therefore which badge the detail
 * screen shows and whether a pull would overwrite something. Its awkward case is
 * that a server copy is *always* stamped later than the local file it came from,
 * because `updated_at` is the upload time — so "newer on the server" cannot mean
 * "changed elsewhere" without knowing where it came from.
 */

test('an exact stem matches', () => {
  assert.equal(stemMatches('Sonic The Hedgehog', 'Sonic The Hedgehog'), true)
})

test('punctuation and case are ignored, as emulators vary on both', () => {
  assert.equal(stemMatches('sonic_the_hedgehog', 'Sonic The Hedgehog'), true)
  assert.equal(stemMatches('Sonic-The-Hedgehog', 'Sonic The Hedgehog'), true)
})

test('a suffix the emulator added still matches', () => {
  // DuckStation writes `Suikoden II_1.mcd`; the ROM is `Suikoden II`.
  assert.equal(stemMatches('Suikoden II_1', 'Suikoden II'), true)
})

test('a region tag on the ROM but not on the save still matches', () => {
  // RomM exposes the game as `Final Fantasy VII (USA)`, and the card written for
  // it carries none of that. This is what the looser second key exists for.
  assert.equal(stemMatches('Final Fantasy VII_1', 'Final Fantasy VII (USA)'), true)
  assert.equal(stemMatches('Final Fantasy VII', 'Final Fantasy VII (USA) [!]'), true)
})

test('a different game does not match', () => {
  assert.equal(stemMatches('Sonic 2', 'Streets of Rage'), false)
  assert.equal(stemMatches('Suikoden', 'Wild Arms'), false)
})

test('a name that loosens to nothing matches nothing', () => {
  // `(USA)` reduces to an empty key, and an empty key is a prefix of every
  // string — which for a folder of memory cards means uploading the wrong one.
  assert.equal(stemMatches('(USA)', 'Final Fantasy VII'), false)
  assert.equal(stemMatches('Final Fantasy VII', '(USA)'), false)
  assert.equal(stemMatches('', 'Sonic'), false)
})

test('a save only this device has is local-only', () => {
  assert.equal(syncStateOf(null, '2026-01-01T00:00:00Z', null), 'remote-only')
})

test('a local file written after the upload is local-newer', () => {
  const remote = '2026-01-01T00:00:00Z'
  assert.equal(syncStateOf(Date.parse(remote) + 60_000, remote, true), 'local-newer')
})

test('a server copy this device uploaded is in sync, not newer', () => {
  // The upload stamps `updated_at` later than the file's own mtime, every time.
  // Without the origin check this row would always read `remote-newer` and
  // invite a pull that overwrites the file with itself.
  const local = Date.parse('2026-01-01T00:00:00Z')
  assert.equal(syncStateOf(local, '2026-01-01T00:05:00Z', true), 'synced')
})

test('a server copy from another device is remote-newer', () => {
  const local = Date.parse('2026-01-01T00:00:00Z')
  assert.equal(syncStateOf(local, '2026-01-01T00:05:00Z', false), 'remote-newer')
})

test('a server copy with no recorded origin is treated as remote-newer', () => {
  // Every state, and anything uploaded through RomM's web UI. The honest answer
  // with what the server says, and the same thing a pull would do with it.
  const local = Date.parse('2026-01-01T00:00:00Z')
  assert.equal(syncStateOf(local, '2026-01-01T00:05:00Z', null), 'remote-newer')
})

test('identical timestamps are in sync', () => {
  const at = '2026-01-01T00:00:00Z'
  assert.equal(syncStateOf(Date.parse(at), at, null), 'synced')
})

test('a file just pulled is in sync, not newer here', () => {
  // The pull stamps what it writes with the server's `updated_at`, and a card
  // formatted FAT32 rounds that to the nearest two seconds. Both directions of
  // that rounding are the same file, and neither is a reason to offer a push.
  const at = '2026-01-01T00:00:00Z'
  assert.equal(syncStateOf(Date.parse(at) + 1000, at, null), 'synced')
  assert.equal(syncStateOf(Date.parse(at) - 1000, at, null), 'synced')
})

test('a local file past the rounding tolerance is still local-newer', () => {
  // The tolerance absorbs a filesystem's timestamp granularity, nothing more:
  // a session played after the pull must still read as a push candidate.
  const at = '2026-01-01T00:00:00Z'
  assert.equal(syncStateOf(Date.parse(at) + 3000, at, null), 'local-newer')
})

test('an unparseable server timestamp does not invent a conflict', () => {
  assert.equal(syncStateOf(Date.now(), 'not a date', null), 'synced')
})
