import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ESDE_SYSTEMS } from '../systems.ts'
import {
  EMULATORS,
  RETRODECK_CONFIG,
  SAVE_CONVENTIONS,
  defaultEmulatorFor,
  emulatorById,
  emulatorsForSystem,
  isInstallableAsset,
  resolveEmulator,
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
    dispatch: descriptor.dispatch,
    saveLayout: descriptor.saveLayout,
    saveTree: descriptor.saveTree,
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
    const unknown = emulator.systems.filter((system) => !ESDE_SYSTEMS.has(system))
    assert.deepEqual(unknown, [], `${emulator.id} declares unknown systems`)
  }
})

test('RetroDECK declares Switch unsupported, because it ships no Switch emulator', () => {
  // ES-DE defines a `switch` entry, but its only live command resolves to a
  // RetroDECK component that is not shipped, so a ROM sent there fails at
  // launch.
  assert.equal(supportsSystem(retrodeck, 'switch'), false)
  assert.equal(supportsSystem(retrodeck, 'snes'), true)
  assert.equal(supportsSystem(retrodeck, 'ps2'), true)
})

test('a standalone emulator supports only what it declares', () => {
  assert.equal(supportsSystem(retroarch, 'snes'), true)
  assert.equal(supportsSystem(retroarch, 'switch'), false)
  assert.equal(supportsSystem(eden, 'switch'), true)
  assert.equal(supportsSystem(eden, 'snes'), false)
})

test('emulatorsForSystem narrows to the ones that can run it', () => {
  assert.deepEqual(
    emulatorsForSystem('switch').map((emulator) => emulator.id),
    ['eden']
  )
  assert.deepEqual(
    emulatorsForSystem('snes').map((emulator) => emulator.id),
    ['retrodeck', 'retroarch']
  )
})

test('unknown ids resolve to null rather than throwing', () => {
  assert.equal(emulatorById('not-a-real-emulator'), null)
})

test('defaults follow registry order and do not depend on what is installed', () => {
  assert.equal(defaultEmulatorFor('snes'), 'retrodeck')
  assert.equal(defaultEmulatorFor('switch'), 'eden')
  assert.equal(defaultEmulatorFor('not-a-system'), null)
})

test('with nothing chosen, the first available emulator for the system wins', () => {
  const states = [state('retrodeck', true), state('retroarch', true)]
  assert.equal(resolveEmulator(states, 'snes')?.id, 'retrodeck')
})

test('an uninstalled default degrades to one that is installed', () => {
  const states = [state('retrodeck', false), state('retroarch', true)]
  assert.equal(resolveEmulator(states, 'snes')?.id, 'retroarch')
})

test('a chosen emulator beats the default', () => {
  const states = [state('retrodeck', true), state('retroarch', true)]
  assert.equal(resolveEmulator(states, 'snes', { snes: 'retroarch' })?.id, 'retroarch')
})

test('a chosen emulator that is not installed fails rather than substituting', () => {
  const states = [state('retrodeck', true), state('retroarch', false)]
  assert.equal(resolveEmulator(states, 'snes', { snes: 'retroarch' }), null)
})

test('a choice cannot route a system to an emulator that does not run it', () => {
  const states = [state('retrodeck', true), state('eden', true)]
  assert.equal(resolveEmulator(states, 'snes', { snes: 'eden' }), null)
})

test('a choice for one system does not affect another', () => {
  const states = [state('retrodeck', true), state('retroarch', true), state('eden', true)]
  const chosen = { snes: 'retroarch' }
  assert.equal(resolveEmulator(states, 'snes', chosen)?.id, 'retroarch')
  assert.equal(resolveEmulator(states, 'ps2', chosen)?.id, 'retrodeck')
  assert.equal(resolveEmulator(states, 'switch', chosen)?.id, 'eden')
})

test('no installed emulator runs the system resolves to null', () => {
  const states = [state('retrodeck', true), state('eden', false)]
  assert.equal(resolveEmulator(states, 'switch'), null)
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

test('Eden takes the ROM path positionally, after the AppImage itself', () => {
  const argv = eden.launch({
    exec: ['/home/u/rommix/emulators/eden/Eden.AppImage'],
    system: 'switch',
    romPath: '/roms/switch/game.nsp'
  })
  assert.deepEqual(argv, [
    '/home/u/rommix/emulators/eden/Eden.AppImage',
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

test('the zsync manifest beside every AppImage is not offered as a download', () => {
  // Both are real asset names from Eden's release feed. A substring test would
  // offer the second, which is a few kilobytes of update metadata rather than
  // anything that runs.
  assert.equal(isInstallableAsset('Eden-Linux-v0.2.1-amd64-clang-pgo.AppImage', '.AppImage'), true)
  assert.equal(
    isInstallableAsset('Eden-Linux-amd64-clang-pgo.AppImage.zsync', '.AppImage'),
    false
  )
})

test('other platforms\' assets are not offered either', () => {
  for (const name of [
    'Eden-Windows-v0.2.1-amd64-clang-pgo.zip',
    'Eden-macOS-v0.2.1.dmg',
    'Eden-Android-v0.2.1-standard.apk',
    'Eden-v0.2.1.torrent'
  ]) {
    assert.equal(isInstallableAsset(name, '.AppImage'), false, name)
  }
})

test('Eden declares a release source RomMix can install from', () => {
  assert.ok(eden.releases)
  // Not a GitHub mirror: github.com/eden-emulator/Releases answers 451.
  assert.match(eden.releases.api, /^https:\/\/git\.eden-emu\.dev\//)
  assert.equal(eden.releases.assetSuffix, '.AppImage')
})

test('Eden declares the environment it needs to open a window at all', () => {
  // Without this Eden refuses its Wayland backend, falls back to xcb, and dies
  // on a session with no X server — which is every gamescope session.
  assert.equal(eden.env?.I_WANT_A_BROKEN_WAYLAND_UI, '1')
})

test('an emulator with nothing to declare has no environment', () => {
  assert.equal(retrodeck.env, undefined)
  assert.equal(retroarch.env, undefined)
})

test('every emulator declares where its saves live and how they are arranged', () => {
  // Both halves are needed to find a save at all, and a missing one would only
  // show up as "nothing to sync" long after the session that wrote it.
  for (const emulator of EMULATORS) {
    assert.ok(
      emulator.saveTree === 'system-nested' || emulator.saveTree === 'flat',
      `${emulator.id} declares no save tree`
    )
  }
})

test('a frontend nests saves per system and a standalone emulator does not', () => {
  // RetroArch writes `<rom>.srm` straight into its save directory. Walking a
  // system subdirectory would find nothing, and a pull would write the save
  // into a folder RetroArch never reads.
  assert.equal(retrodeck.saveTree, 'system-nested')
  assert.equal(retroarch.saveTree, 'flat')
})

test('RetroDECK declares where its own configuration is, rather than main guessing', () => {
  assert.equal(RETRODECK_CONFIG.json.file, 'retrodeck.json')
  assert.equal(RETRODECK_CONFIG.json.keys.roms, 'roms_path')
  assert.equal(RETRODECK_CONFIG.legacy.file, 'retrodeck.cfg')
  assert.equal(RETRODECK_CONFIG.legacy.homeKey, 'rdhome')
})

test('save conventions cover the extensions emulators actually write', () => {
  assert.ok(SAVE_CONVENTIONS.saveExtensions.includes('.srm'))
  assert.ok(SAVE_CONVENTIONS.statePattern.test('game.state1'))
  assert.ok(SAVE_CONVENTIONS.statePattern.test('game.auto'))
  assert.equal(SAVE_CONVENTIONS.statePattern.test('game.srm'), false)
})

test('an emulator only declares a directory it really has', () => {
  // A path that does not exist is worse than an absent one: the pre-flight
  // check prints it as fact, and save sync reports "nothing found" for a tree
  // that was never there.
  assert.equal(eden.dirs.states, undefined)
  assert.ok(eden.dirs.saves)
  assert.ok(eden.dirs.bios)
})
