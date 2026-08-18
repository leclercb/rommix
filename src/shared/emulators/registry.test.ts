import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ESDE_SYSTEMS } from '../systems.ts'
import {
  EMULATORS,
  chooseEmulator,
  emulatorById,
  emulatorsForSystem,
  supportsSystem
} from './index.ts'
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
    ['retrodeck']
  )
  assert.deepEqual(
    emulatorsForSystem('snes').map((emulator) => emulator.id),
    ['retrodeck', 'retroarch']
  )
})

test('unknown ids resolve to null rather than throwing', () => {
  assert.equal(emulatorById('not-a-real-emulator'), null)
})

test('the preferred emulator wins when it is available', () => {
  const states = [state('retrodeck', true), state('retroarch', true)]
  assert.equal(chooseEmulator(states, 'retroarch')?.id, 'retroarch')
})

test('an unavailable preference falls back to one that is installed', () => {
  const states = [state('retrodeck', false), state('retroarch', true)]
  assert.equal(chooseEmulator(states, 'retrodeck')?.id, 'retroarch')
})

test('the fallback never picks an emulator that cannot run the system', () => {
  // The failure a global "preferred runner" invites: RetroDECK is the
  // preference but is not installed, and the only alternative has no core for
  // this system. Handing it the ROM anyway would fail at launch time instead.
  const states = [state('retrodeck', false), state('retroarch', true)]
  assert.equal(chooseEmulator(states, 'retrodeck', 'switch'), null)
  assert.equal(chooseEmulator(states, 'retrodeck', 'snes')?.id, 'retroarch')
})

test('nothing available resolves to null', () => {
  const states = [state('retrodeck', false), state('retroarch', false)]
  assert.equal(chooseEmulator(states, 'retrodeck'), null)
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

test('an emulator returns null rather than argv for a system it cannot run', () => {
  const argv = retroarch.launch({
    exec: ['/usr/bin/retroarch'],
    system: 'switch',
    romPath: '/roms/switch/game.nsp'
  })
  assert.equal(argv, null)
})
