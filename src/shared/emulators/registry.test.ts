import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ESDE_SYSTEMS } from '../systems.ts'
import {
  EMULATORS,
  chooseEmulator,
  emulatorById,
  emulatorsForSystem,
  normalisePriority,
  supportsSystem
} from './index.ts'
import { eden } from './eden.ts'
import { retroarch } from './retroarch.ts'
import { retrodeck } from './retrodeck.ts'
import type { EmulatorState } from './types.ts'

/** A state as the main-process probe would report it, for selection tests. */
function state(id: string, available: boolean): EmulatorState {
  const descriptor = emulatorById(id)
  assert.ok(descriptor, `no descriptor for ${id}`)
  return {
    id: descriptor.id,
    name: descriptor.name,
    role: descriptor.role,
    saveLayout: descriptor.saveLayout,
    available,
    install: available ? { kind: 'flatpak', ref: 'test.app.Id' } : null,
    paths: { home: null, roms: '/roms', saves: null, states: null, bios: null },
    unavailableReason: available ? null : 'not installed'
  }
}

test('every descriptor id is unique', () => {
  const ids = EMULATORS.map((emulator) => emulator.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every declared system is a real ES-DE system directory', () => {
  // Same reasoning as the platform map: a typo here would quietly make an
  // emulator look incapable of running a system it handles fine.
  for (const emulator of EMULATORS) {
    if (emulator.systems === 'delegated') continue
    const unknown = emulator.systems.filter((system) => !ESDE_SYSTEMS.has(system))
    assert.deepEqual(unknown, [], `${emulator.id} declares unknown systems`)
  }
})

test('a frontend supports every system, a standalone only what it declares', () => {
  assert.equal(supportsSystem(retrodeck, 'switch'), true)
  assert.equal(supportsSystem(retroarch, 'snes'), true)
  assert.equal(supportsSystem(retroarch, 'switch'), false)
})

test('emulatorsForSystem narrows to the ones that can run it', () => {
  assert.deepEqual(
    emulatorsForSystem('switch').map((emulator) => emulator.id),
    ['retrodeck', 'eden']
  )
  assert.deepEqual(
    emulatorsForSystem('snes').map((emulator) => emulator.id),
    ['retrodeck', 'retroarch']
  )
})

test('unknown ids resolve to null rather than throwing', () => {
  assert.equal(emulatorById('not-a-real-emulator'), null)
})

const DEFAULT_ORDER = ['retrodeck', 'retroarch', 'eden']

test('the highest emulator in the order wins when several are available', () => {
  const states = [state('retrodeck', true), state('retroarch', true)]
  assert.equal(chooseEmulator(states, { priority: ['retroarch', 'retrodeck'] })?.id, 'retroarch')
})

test('an uninstalled entry is skipped for the next one down', () => {
  const states = [state('retrodeck', false), state('retroarch', true)]
  assert.equal(chooseEmulator(states, { priority: DEFAULT_ORDER })?.id, 'retroarch')
})

test('an entry that cannot run the system is skipped, not treated as a failure', () => {
  // The question a single global preference cannot answer. Eden sits at the
  // top, yet an SNES ROM still reaches RetroArch, because position only
  // matters among emulators that actually run the system.
  const states = [state('retroarch', true), state('eden', true)]
  const priority = ['eden', 'retroarch']
  assert.equal(chooseEmulator(states, { priority, system: 'snes' })?.id, 'retroarch')
  assert.equal(chooseEmulator(states, { priority, system: 'switch' })?.id, 'eden')
})

test('the order decides between two emulators that both run a system', () => {
  // The "two Switch emulators" case: both cover it, so the answer is whichever
  // the user put higher — a single "preferred emulator" value could not say.
  const states = [state('retrodeck', true), state('eden', true)]
  assert.equal(
    chooseEmulator(states, { priority: ['eden', 'retrodeck'], system: 'switch' })?.id,
    'eden'
  )
  assert.equal(
    chooseEmulator(states, { priority: ['retrodeck', 'eden'], system: 'switch' })?.id,
    'retrodeck'
  )
})

test('an emulator absent from the order is still usable, in registry order', () => {
  const states = [state('retrodeck', true), state('eden', true)]
  assert.equal(chooseEmulator(states, { priority: [], system: 'switch' })?.id, 'retrodeck')
})

test('no installed emulator runs the system resolves to null', () => {
  const states = [state('retrodeck', false), state('retroarch', true)]
  assert.equal(chooseEmulator(states, { priority: DEFAULT_ORDER, system: 'switch' }), null)
})

test('nothing available resolves to null', () => {
  const states = [state('retrodeck', false), state('retroarch', false)]
  assert.equal(chooseEmulator(states, { priority: DEFAULT_ORDER }), null)
})

test('a pin beats an order that would otherwise send the system elsewhere', () => {
  const states = [state('retrodeck', true), state('eden', true)]
  assert.equal(chooseEmulator(states, { priority: DEFAULT_ORDER, system: 'switch' })?.id, 'retrodeck')
  assert.equal(
    chooseEmulator(states, { priority: DEFAULT_ORDER, pinned: 'eden', system: 'switch' })?.id,
    'eden'
  )
})

test('a pin to an unavailable emulator fails rather than silently substituting', () => {
  const states = [state('retrodeck', true), state('eden', false)]
  assert.equal(
    chooseEmulator(states, { priority: DEFAULT_ORDER, pinned: 'eden', system: 'switch' }),
    null
  )
})

test('a pin cannot route a system to an emulator that does not run it', () => {
  const states = [state('retrodeck', true), state('eden', true)]
  assert.equal(
    chooseEmulator(states, { priority: DEFAULT_ORDER, pinned: 'eden', system: 'snes' }),
    null
  )
})

test('a stored order gains emulators added since it was written', () => {
  assert.deepEqual(normalisePriority(['retroarch']), ['retroarch', 'retrodeck', 'eden'])
})

test('a stored order drops emulators that no longer exist', () => {
  assert.deepEqual(normalisePriority(['yuzu', 'eden']), ['eden', 'retrodeck', 'retroarch'])
})

test('RetroDECK is launched by system so it resolves the emulator itself', () => {
  const argv = retrodeck.launch({
    exec: ['flatpak', 'run', 'net.retrodeck.retrodeck'],
    system: 'snes',
    romPath: '/roms/snes/game.sfc'
  })
  assert.deepEqual(argv, [
    'flatpak',
    'run',
    'net.retrodeck.retrodeck',
    '-s',
    'snes',
    '/roms/snes/game.sfc'
  ])
})

test('RetroArch is launched with the core mapped for the system', () => {
  const argv = retroarch.launch({
    exec: ['/usr/bin/retroarch'],
    system: 'snes',
    romPath: '/roms/snes/game.sfc'
  })
  assert.deepEqual(argv, [
    '/usr/bin/retroarch',
    '-L',
    'snes9x_libretro.so',
    '/roms/snes/game.sfc'
  ])
})

test('Eden takes the ROM path positionally, behind its AppImage wrapper', () => {
  // The wrapper is what `execPrefix` produces on a host where an AppImage
  // cannot execute itself; the descriptor only appends the ROM.
  const argv = eden.launch({
    exec: ['appimage-run', '/home/u/Applications/Eden-x86_64.AppImage'],
    system: 'switch',
    romPath: '/roms/switch/game.nsp'
  })
  assert.deepEqual(argv, [
    'appimage-run',
    '/home/u/Applications/Eden-x86_64.AppImage',
    '/roms/switch/game.nsp'
  ])
})

test('Eden declines the systems it does not run', () => {
  assert.equal(supportsSystem(eden, 'switch'), true)
  assert.equal(supportsSystem(eden, 'snes'), false)
})

test('an emulator returns null rather than argv for a system it cannot run', () => {
  const argv = retroarch.launch({
    exec: ['/usr/bin/retroarch'],
    system: 'switch',
    romPath: '/roms/switch/game.nsp'
  })
  assert.equal(argv, null)
})
