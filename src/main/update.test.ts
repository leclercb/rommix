import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareVersions, pickImage, type UpdateAsset } from './update.ts'

/**
 * The two decisions that turn a release page into an update: is that version
 * newer than this one, and which of its files can this machine run.
 *
 * Both fail quietly when they are wrong. A comparison that reads `0.10.0` as
 * older than `0.9.9` leaves every installation stuck on the version it was
 * downloaded at, with a check running every six hours and reporting nothing. A
 * picker that hands an arm64 handheld the x86_64 image replaces a working RomMix
 * with a file that dies on exec, and the machine that did it is not the one
 * running these tests.
 */

// -- compareVersions --------------------------------------------------------

test('a newer patch release wins', () => {
  assert.ok(compareVersions('0.5.2', '0.5.1') > 0)
})

test('the parts are numbers, not text', () => {
  // The whole reason this is not `a < b`: as strings, '0.10.0' sorts first.
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0)
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0)
})

test("the tag's leading v is not part of the version", () => {
  // Releases are tagged `v0.5.1`; package.json says `0.5.1`. They are the same
  // version, and reading them as different is an update to what is running.
  assert.equal(compareVersions('v0.5.1', '0.5.1'), 0)
})

test('a release candidate is older than the release it is for', () => {
  assert.ok(compareVersions('1.0.0-rc1', '1.0.0') < 0)
  // And so nobody on 1.0.0 is ever offered the candidate for it.
  assert.ok(compareVersions('1.0.0', '1.0.0-rc1') > 0)
})

test('numeric pre-release identifiers count up, not across', () => {
  assert.ok(compareVersions('1.0.0-rc.10', '1.0.0-rc.2') > 0)
})

test('a longer pre-release is the newer one when the prefix matches', () => {
  assert.ok(compareVersions('1.0.0-rc.1.1', '1.0.0-rc.1') > 0)
})

test('build metadata does not decide anything', () => {
  assert.equal(compareVersions('1.0.0+build7', '1.0.0'), 0)
})

test('a missing part reads as zero', () => {
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
})

// -- pickImage --------------------------------------------------------------

/** The architecture token this machine is not. */
const foreign = process.arch === 'arm64' ? 'x86_64' : 'arm64'
const mine = process.arch === 'arm64' ? 'arm64' : 'x86_64'

function asset(name: string): UpdateAsset {
  return { name, url: `https://example.invalid/${name}`, sizeBytes: 1024 }
}

test('the image built for this machine is the one chosen', () => {
  const picked = pickImage([asset(`RomMix-${foreign}.AppImage`), asset(`RomMix-${mine}.AppImage`)])
  assert.equal(picked?.name, `RomMix-${mine}.AppImage`)
})

test('the launcher script is never mistaken for the application', () => {
  // Every release carries `rommix-steam.sh` beside the images. It is a shell
  // script that starts RomMix, and installing it as RomMix would replace the
  // program with three lines of sh.
  assert.equal(pickImage([asset('rommix-steam.sh')]), null)
})

test('a release with only another architecture offers nothing', () => {
  assert.equal(pickImage([asset(`RomMix-${foreign}.AppImage`)]), null)
})
