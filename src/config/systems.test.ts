import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BIOS_REQUIREMENTS } from './bios.ts'
import {
  ROMM_SLUG_TO_ESDE,
  SYSTEMS,
  allSystems,
  coreForSystem,
  isKnownSystem,
  resolveSystem,
  systemInfo,
  systemsWithCore
} from './systems.ts'

test('every system carries a label, a short code and an icon', () => {
  // The UI has no second source for any of these: a blank here is a blank on
  // screen, and a missing icon is the tag-shaped placeholder this table exists
  // to replace.
  const incomplete = Object.values(SYSTEMS).filter(
    (info) => !info.label || !info.short || !info.icon
  )
  assert.deepEqual(incomplete, [])
})

test('short codes stay short enough for a badge', () => {
  const tooLong = Object.values(SYSTEMS).filter((info) => info.short.length > 5)
  assert.deepEqual(tooLong, [])
})

test('an unknown system degrades to its own name rather than to a blank', () => {
  const info = systemInfo('not-a-system')
  assert.equal(info.label, 'not-a-system')
  assert.equal(info.icon, 'default')
})

test('every system with BIOS requirements is a system RomMix knows', () => {
  const unknown = Object.keys(BIOS_REQUIREMENTS).filter((system) => !isKnownSystem(system))
  assert.deepEqual(unknown, [])
})

test('every mapped target is a real ES-DE system directory', () => {
  // A typo here would install ROMs into a folder RetroDECK never scans, which
  // fails silently at launch time rather than at install time.
  const unknown = Object.entries(ROMM_SLUG_TO_ESDE).filter(
    ([, esde]) => !isKnownSystem(esde)
  )
  assert.deepEqual(unknown, [], `unmapped ES-DE targets: ${JSON.stringify(unknown)}`)
})

test('the systems with a core are exactly the ones that resolve to one', () => {
  // `systemsWithCore` is what RetroArch declares it can run, and
  // `coreForSystem` is what the launcher then asks for. Built from one column,
  // so the only way they can disagree is a mistake in reading it.
  assert.deepEqual(
    systemsWithCore().sort(),
    allSystems()
      .filter((info) => coreForSystem(info.id))
      .map((info) => info.id)
      .sort()
  )
  for (const system of systemsWithCore()) assert.ok(isKnownSystem(system))
})

test('the slug map is the slug column inverted, with nothing else in it', () => {
  // Derived rather than written out, so a system cannot be reachable under a
  // slug the table does not admit to.
  for (const [slug, system] of Object.entries(ROMM_SLUG_TO_ESDE)) {
    assert.ok(SYSTEMS[system].slugs.includes(slug), `${slug} -> ${system} is not on that row`)
  }
  const declared = allSystems().flatMap((info) => info.slugs)
  assert.equal(declared.length, Object.keys(ROMM_SLUG_TO_ESDE).length)
  assert.equal(new Set(declared).size, declared.length, 'a slug means two systems')
})

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
