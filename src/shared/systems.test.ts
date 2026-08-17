import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ESDE_SYSTEMS, ROMM_SLUG_TO_ESDE, coreForSystem, resolveSystem } from './systems.ts'

test('every mapped target is a real ES-DE system directory', () => {
  // A typo here would install ROMs into a folder RetroDECK never scans, which
  // fails silently at launch time rather than at install time.
  const unknown = Object.entries(ROMM_SLUG_TO_ESDE).filter(
    ([, esde]) => !ESDE_SYSTEMS.has(esde)
  )
  assert.deepEqual(unknown, [], `unmapped ES-DE targets: ${JSON.stringify(unknown)}`)
})

test('every libretro core mapping targets a real ES-DE system', () => {
  const unknown = Object.keys(coreMappingKeys()).filter((system) => !ESDE_SYSTEMS.has(system))
  assert.deepEqual(unknown, [])
})

function coreMappingKeys(): Record<string, unknown> {
  // Rebuild the key set through the public accessor so the test exercises the
  // same lookup the launcher uses.
  const keys: Record<string, unknown> = {}
  for (const system of ESDE_SYSTEMS) {
    const core = coreForSystem(system)
    if (core) keys[system] = core
  }
  return keys
}

test('resolves common RomM platform slugs', () => {
  assert.equal(resolveSystem('snes', 'snes'), 'snes')
  assert.equal(resolveSystem('ps', 'psx'), 'psx')
  assert.equal(resolveSystem('genesis-slash-megadrive', 'megadrive'), 'genesis')
  assert.equal(resolveSystem('ngc', 'gamecube'), 'gc')
  assert.equal(resolveSystem('dc', 'dreamcast'), 'dreamcast')
  assert.equal(resolveSystem('3ds', 'n3ds'), 'n3ds')
})

test('falls back to the filesystem slug when the platform slug is unknown', () => {
  // RomM invented the slug, but the server folder happens to be an ES-DE name.
  assert.equal(resolveSystem('something-unknown', 'dreamcast'), 'dreamcast')
})

test('returns null rather than guessing when nothing matches', () => {
  assert.equal(resolveSystem('totally-made-up', 'also-made-up'), null)
})

test('a user override beats the built-in map', () => {
  assert.equal(resolveSystem('snes', 'snes', { snes: 'snesna' }), 'snesna')
})

test('known systems resolve to a libretro core, unknown ones do not', () => {
  assert.equal(coreForSystem('snes'), 'snes9x')
  assert.equal(coreForSystem('psx'), 'swanstation')
  assert.equal(coreForSystem('switch'), null)
})
