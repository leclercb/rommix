import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isKnownSystem } from '../systems.ts'
import {
  EMULATORS,
  EMUDECK_LAUNCHERS,
  SAVE_CONVENTIONS,
  defaultEmulatorFor,
  emulatorById,
  emulatorsForSystem,
  installMethods,
  isInstallableAsset,
  releaseSource,
  launchVariants,
  resolveEmulator,
  supportsSystem
} from './index.ts'
import { readFileSync } from 'node:fs'
import { eden } from './eden/index.ts'
import { emudeck, ROM_PLACEHOLDER } from './emudeck/index.ts'
import { retroarch } from './retroarch/index.ts'
import { retrodeck } from './retrodeck/index.ts'
import { shadps4 } from './shadps4/index.ts'
import { example } from './example/index.ts'
import type { EmulatorDescriptor, EmulatorState } from './types.ts'

/**
 * Every field of `EmulatorDescriptor`, in the order the interface declares
 * them. Descriptors list their fields in this order too, so one can be read
 * against another — and against the interface — without hunting.
 */
const FIELD_ORDER = [
  'id',
  'name',
  'dispatch',
  'frontend',
  'install',
  'homepage',
  'systems',
  'variants',
  'ownsLibrary',
  'dirs',
  'layout',
  'flatLibrary',
  'saves',
  'bios',
  'biosStagingNote',
  'core',
  'setupNotes',
  'env',
  'open',
  'launch'
] as const

/** A state as the main-process probe would report it, for selection tests. */
function state(id: string, available: boolean): EmulatorState {
  const descriptor = emulatorById(id)
  assert.ok(descriptor, `no descriptor for ${id}`)
  return {
    id: descriptor.id,
    name: descriptor.name,
    dispatch: descriptor.dispatch,
    available,
    install: available ? { kind: 'flatpak', ref: 'test.app.Id' } : null,
    paths: { home: null, roms: '/roms', saves: null, states: null, bios: null },
    configDir: null,
    dataDir: null,
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
    const unknown = emulator.systems.filter((system) => !isKnownSystem(system))
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
    ['emudeck', 'eden']
  )
  assert.deepEqual(
    emulatorsForSystem('snes').map((emulator) => emulator.id),
    ['retrodeck', 'emudeck', 'retroarch']
  )
})

test('unknown ids resolve to null rather than throwing', () => {
  assert.equal(emulatorById('not-a-real-emulator'), null)
})

test('defaults follow registry order and do not depend on what is installed', () => {
  assert.equal(defaultEmulatorFor('snes'), 'retrodeck')
  // EmuDeck comes before Eden: it manages a whole setup, so where it covers a
  // system it already encodes how the user wants that system run.
  assert.equal(defaultEmulatorFor('switch'), 'emudeck')
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
    installRef: 'net.retrodeck.retrodeck',
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
    installRef: '/usr/bin/retroarch',
    system: 'snes',
    romPath: '/roms/snes/game.sfc'
  })
  assert.deepEqual(argv, ['/usr/bin/retroarch', '-L', 'snes9x_libretro.so', '/roms/snes/game.sfc'])
})

test('Eden is started fullscreen, with the ROM named by -g', () => {
  const argv = eden.launch({
    exec: ['/home/u/rommix/emulators/eden/Eden.AppImage'],
    installRef: '/home/u/rommix/emulators/eden/Eden.AppImage',
    system: 'switch',
    romPath: '/roms/switch/game.nsp'
  })
  assert.deepEqual(argv, [
    '/home/u/rommix/emulators/eden/Eden.AppImage',
    '-f',
    '-g',
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
    installRef: '/usr/bin/retroarch',
    system: 'switch',
    romPath: '/roms/switch/game.nsp'
  })
  assert.equal(argv, null)
})

/** A release source of the ordinary shape: one extension, one platform. */
const APPIMAGE = { api: 'https://example.test/releases', asset: /\.AppImage$/i }

test('the zsync manifest beside every AppImage is not offered as a download', () => {
  // Both are real asset names from Eden's release feed. A substring test would
  // offer the second, which is a few kilobytes of update metadata rather than
  // anything that runs.
  assert.equal(isInstallableAsset('Eden-Linux-v0.2.1-amd64-clang-pgo.AppImage', APPIMAGE), true)
  assert.equal(isInstallableAsset('Eden-Linux-amd64-clang-pgo.AppImage.zsync', APPIMAGE), false)
})

test("other platforms' assets are not offered either", () => {
  for (const name of [
    'Eden-Windows-v0.2.1-amd64-clang-pgo.zip',
    'Eden-macOS-v0.2.1.dmg',
    'Eden-Android-v0.2.1-standard.apk',
    'Eden-v0.2.1.torrent'
  ]) {
    assert.equal(isInstallableAsset(name, APPIMAGE), false, name)
  }
})

test('Eden declares a release source RomMix can install from', () => {
  const source = releaseSource(eden)
  assert.ok(source)
  // Not a GitHub mirror: github.com/eden-emulator/Releases answers 451.
  assert.match(source.api, /^https:\/\/git\.eden-emu\.dev\//)
  assert.ok(source.asset.test('Eden-Linux-v0.2.1-amd64-clang-pgo.AppImage'))
})

test('every AppImage route says where its builds come from', () => {
  // The point of merging the two: a route that can be recognised and not
  // fetched is a `binary` — something the user put there — and one offered as
  // an AppImage would be an Install button with nothing behind it.
  for (const emulator of [...EMULATORS, example]) {
    for (const spec of emulator.install) {
      if (spec.kind === 'appimage') assert.ok(spec.release.api, `${emulator.id} names no release`)
    }
  }
})

test('installable routes are exactly the ones RomMix can act on', () => {
  assert.deepEqual(
    installMethods(retrodeck).map((spec) => spec.kind),
    ['flatpak']
  )
  assert.deepEqual(
    installMethods(eden).map((spec) => spec.kind),
    ['appimage']
  )
  // EmuDeck is a directory of launchers its own installer wrote: nothing here
  // for RomMix to press.
  assert.deepEqual(installMethods(emudeck), [])
})

test('Eden declares the environment it needs to open a window at all', () => {
  // Without this Eden refuses its Wayland backend, falls back to xcb, and dies
  // on a session with no X server — which is every gamescope session.
  assert.equal(eden.env?.I_WANT_A_BROKEN_WAYLAND_UI, '1')
})

test('RetroDECK is told where its own cores are, because it does not tell itself', () => {
  // Its run_game.sh expands %CORE_RETROARCH% to a variable nothing assigns, so
  // without this every libretro game is launched as `-L /<core>.so` and dies.
  assert.equal(retrodeck.env?.ra_cores_path, '/app/retrodeck/components/retroarch/rd_extras/cores')
})

test('an emulator with nothing to declare has no environment', () => {
  assert.equal(retroarch.env, undefined)
  assert.equal(emudeck.env, undefined)
})

test('an emulator whose folders the user chose says where that choice is written', () => {
  // The point of `layout`: the main process reads these files without knowing
  // which emulator it is reading for, so a new one is a config file and
  // nothing else.
  const sources = retrodeck.layout?.sources ?? []
  assert.equal(sources.length, 1)
  assert.equal(sources[0].file.path, 'retrodeck/retrodeck.json')
  assert.equal(sources[0].section, 'paths')
  // Verified against RetroDECK's own default retrodeck.json.
  assert.equal(sources[0].keys.home, 'rd_home_path')
  assert.equal(sources[0].keys.roms, 'roms_path')
  assert.equal(sources[0].keys.saves, 'saves_path')
  assert.equal(sources[0].keys.states, 'states_path')
  assert.equal(sources[0].keys.bios, 'bios_path')

  const emuDeckSource = emudeck.layout?.sources[0]
  assert.equal(emuDeckSource?.file.path, 'emudeck/settings.sh')
  assert.equal(emuDeckSource?.keys.home, 'emulationPath')
  assert.equal(emuDeckSource?.extras?.tools, 'toolsPath')
})

test('every layout source can be acted on without knowing the emulator', () => {
  for (const emulator of EMULATORS) {
    for (const source of emulator.layout?.sources ?? []) {
      assert.ok(source.file.path, `${emulator.id}: a source with no file`)
      assert.ok(
        source.format === 'shell' || source.format === 'json',
        `${emulator.id}: unreadable format`
      )
      // Without this the file cannot be judged usable, and a half-written or
      // superseded one would be believed.
      const names = { ...source.keys, ...source.extras }
      assert.ok(
        source.requires in names,
        `${emulator.id}: requires "${source.requires}", which it never reads`
      )
      // Defaults hang off the home the file carried, so there has to be one.
      if (source.defaults) {
        assert.ok(source.keys.home, `${emulator.id}: defaults with no home to hang them off`)
      }
    }
  }
})

test('an emulator declares either fixed folders or where its own are recorded', () => {
  // Both would be ambiguous, neither leaves the probe nothing to go on.
  for (const emulator of EMULATORS) {
    const hasTemplates = Object.keys(emulator.dirs).length > 0
    const hasLayout = emulator.layout != null
    assert.ok(
      hasTemplates !== hasLayout,
      `${emulator.id} declares ${hasTemplates ? 'both' : 'neither'}`
    )
  }
})

test('a scripts install names a directory the layout actually discovers', () => {
  for (const emulator of EMULATORS) {
    for (const spec of emulator.install) {
      if (spec.kind !== 'scripts') continue
      const names = (emulator.layout?.sources ?? []).flatMap((source) => [
        ...Object.keys(source.keys),
        ...Object.keys(source.extras ?? {})
      ])
      assert.ok(
        names.includes(spec.dir.from),
        `${emulator.id}: install points at "${spec.dir.from}", which nothing discovers`
      )
    }
  }
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

// ---------------------------------------------------------------------------
// EmuDeck
// ---------------------------------------------------------------------------

test('EmuDeck runs a game through the launcher script for that system', () => {
  // The scripts forward their arguments verbatim to the emulator underneath,
  // so RomMix has to supply Dolphin's own flags rather than just a path.
  const argv = emudeck.launch({
    exec: [],
    installRef: '/home/deck/Emulation/tools/launchers',
    system: 'gc',
    romPath: '/home/deck/Emulation/roms/gc/game.rvz'
  })
  assert.deepEqual(argv, [
    '/home/deck/Emulation/tools/launchers/dolphin-emu.sh',
    '-b',
    '-e',
    '/home/deck/Emulation/roms/gc/game.rvz'
  ])
})

test('EmuDeck passes RomMix nothing to guess for a libretro system', () => {
  const argv = emudeck.launch({
    exec: [],
    installRef: '/e/tools/launchers',
    system: 'snes',
    romPath: '/e/roms/snes/game.sfc'
  })
  assert.deepEqual(argv, [
    '/e/tools/launchers/retroarch.sh',
    '-L',
    'snes9x_libretro.so',
    '/e/roms/snes/game.sfc'
  ])
})

test('the ROM placeholder is substituted inside an argument, not only as one', () => {
  // Xenia runs under Proton and has to be handed a Windows path; ScummVM takes
  // its path as part of a --path= argument.
  assert.deepEqual(
    emudeck.launch({
      exec: [],
      installRef: '/e/tools/launchers',
      system: 'xbox360',
      romPath: '/e/roms/xbox360/game.iso'
    }),
    ['/e/tools/launchers/xenia.sh', 'Z:/e/roms/xbox360/game.iso']
  )
  assert.deepEqual(
    emudeck.launch({
      exec: [],
      installRef: '/e/tools/launchers',
      system: 'scummvm',
      romPath: '/e/roms/scummvm/game'
    }),
    ['/e/tools/launchers/scummvm.sh', '--path=/e/roms/scummvm/game', '--auto-detect']
  )
})

test('EmuDeck offers a choice where it ships more than one way to run a system', () => {
  // The point of asking: three Saturn cores of differing accuracy, and four
  // Switch emulators of which only some run any given game.
  assert.ok(launchVariants(emudeck, 'saturn').length > 1)
  assert.ok(launchVariants(emudeck, 'switch').length > 1)
  // Nothing to ask about here, so nothing should be asked.
  assert.equal(launchVariants(emudeck, 'gc').length, 1)
  assert.equal(launchVariants(emudeck, 'not-a-system').length, 0)
})

test('emulators with a single way to run a system offer no choice at all', () => {
  for (const system of ['snes', 'ps2']) {
    assert.equal(launchVariants(retrodeck, system).length, 0)
    assert.equal(launchVariants(retroarch, system).length, 0)
  }
})

test('a chosen EmuDeck variant is the one that runs', () => {
  const argv = emudeck.launch({
    exec: [],
    installRef: '/e/tools/launchers',
    system: 'switch',
    romPath: '/e/roms/switch/game.nsp',
    variant: 'ryujinx'
  })
  assert.deepEqual(argv, [
    '/e/tools/launchers/ryujinx.sh',
    '--fullscreen',
    '/e/roms/switch/game.nsp'
  ])
})

test('a variant that no longer exists refuses rather than substituting', () => {
  // A recorded choice can outlive the entry it named. Falling back to the
  // default would start a different emulator than the one asked for, and write
  // its saves somewhere the first one will not look.
  const argv = emudeck.launch({
    exec: [],
    installRef: '/e/tools/launchers',
    system: 'switch',
    romPath: '/e/roms/switch/game.nsp',
    variant: 'an-emulator-that-was-removed'
  })
  assert.equal(argv, null)
})

test('EmuDeck declines a system it has no launcher for', () => {
  // Rather than sending it to whichever script happens to be first.
  assert.equal(
    emudeck.launch({
      exec: [],
      installRef: '/e/tools/launchers',
      system: 'psvita',
      romPath: '/e/roms/psvita/game'
    }),
    null
  )
})

test('every EmuDeck launcher names a real script and consumes the ROM', () => {
  for (const [system, options] of Object.entries(EMUDECK_LAUNCHERS)) {
    assert.ok(options.length > 0, `${system} has no launcher`)
    const ids = options.map((option) => option.id)
    assert.equal(new Set(ids).size, ids.length, `${system} has duplicate variant ids`)
    for (const option of options) {
      assert.match(option.script, /\.sh$/, `${system}: ${option.id} is not a script`)
      assert.ok(
        option.args.some((arg) => arg.includes(ROM_PLACEHOLDER)),
        `${system}: ${option.id} never uses the ROM path`
      )
    }
  }
})

test('the sandbox wrapping survives when the descriptor names its own program', () => {
  // Inside a flatpak `exec` is the flatpak-spawn prefix with no program in it,
  // and the launcher script has to land after it rather than in front.
  const argv = emudeck.launch({
    exec: ['flatpak-spawn', '--host'],
    installRef: '/e/tools/launchers',
    system: 'psx',
    romPath: '/e/roms/psx/game.chd'
  })
  assert.deepEqual(argv?.slice(0, 3), [
    'flatpak-spawn',
    '--host',
    '/e/tools/launchers/duckstation.sh'
  ])
})

test('EmuDeck opens its own frontend for the Run button', () => {
  assert.deepEqual(emudeck.open?.({ exec: [], installRef: '/e/tools/launchers' }), [
    '/e/tools/launchers/es-de/es-de.sh'
  ])
})

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test('the field list matches what the interface declares', () => {
  // The order below is copied from `types.ts`, so this catches a field added
  // to the interface that nobody added here — which would let the ordering
  // test below pass while ignoring the new field entirely.
  const source = readFileSync(new URL('./types.ts', import.meta.url), 'utf8')
  const from = source.indexOf('export interface EmulatorDescriptor')
  // Stop at the interface's own closing brace, which is the first `}` in
  // column zero — otherwise this reads on into `EmulatorState` and asserts
  // against a union of the two.
  const body = source.slice(from, source.indexOf('\n}\n', from))
  const declared = [...body.matchAll(/^  (?:readonly )?([a-zA-Z]+)[?]?[:(]/gm)].map((m) => m[1])
  assert.deepEqual(declared, [...FIELD_ORDER])
})

test("every emulator spells out every field, in the interface's order", () => {
  // Not style for its own sake. An absent optional field makes the reader of
  // one emulator guess what the default does, and a differing order makes two
  // emulators impossible to read side by side.
  for (const emulator of [...EMULATORS, example] as EmulatorDescriptor[]) {
    assert.deepEqual(
      Object.keys(emulator),
      [...FIELD_ORDER],
      `${emulator.id} declares its fields in the wrong order, or is missing one`
    )
  }
})

test('the example emulator is documentation, not something RomMix will run', () => {
  // It exists to be type-checked and copied. Shipping it in the registry would
  // offer the user an emulator that does not exist.
  assert.equal(
    EMULATORS.some((emulator) => emulator.id === example.id),
    false
  )
  assert.equal(emulatorById('example'), null)
})

test("shadPS4 is launched on the game directory's eboot, not on the largest file", () => {
  // What `chooseLaunchFile` nominates for a PS4 game is one of its data files:
  // the entry point is small and named, so the descriptor names it.
  const argv = shadps4.launch({
    exec: ['flatpak', 'run', 'net.shadps4.shadPS4'],
    installRef: 'net.shadps4.shadPS4',
    system: 'ps4',
    romPath: '/roms/ps4/CUSA12345/data.psarc'
  })
  assert.deepEqual(argv, ['flatpak', 'run', 'net.shadps4.shadPS4', '/roms/ps4/CUSA12345/eboot.bin'])
})

test('shadPS4 passes an eboot and a package through as they are', () => {
  const run = (romPath: string): string[] | null =>
    shadps4.launch({
      exec: ['/usr/bin/shadps4'],
      installRef: '/usr/bin/shadps4',
      system: 'ps4',
      romPath
    })

  assert.deepEqual(run('/roms/ps4/CUSA12345/eboot.bin'), [
    '/usr/bin/shadps4',
    '/roms/ps4/CUSA12345/eboot.bin'
  ])
  // A package is shadPS4's to install; rewriting it to an eboot that does not
  // exist yet would turn "install this" into "file not found".
  assert.deepEqual(run('/roms/ps4/game.pkg'), ['/usr/bin/shadps4', '/roms/ps4/game.pkg'])
})

test('shadPS4 runs the PlayStation 4 and nothing else', () => {
  assert.equal(supportsSystem(shadps4, 'ps4'), true)
  assert.equal(supportsSystem(shadps4, 'ps3'), false)
  // The only emulator in the registry that covers it, so it is the default.
  assert.equal(defaultEmulatorFor('ps4'), 'shadps4')
})

test("a project publishing every platform as a zip offers only this one's", () => {
  // shadPS4's real asset names. No suffix separates them, which is what
  // `assetIncludes` is for.
  const source = {
    api: 'https://api.github.com/repos/shadps4-emu/shadPS4/releases',
    asset: /^shadps4-linux-.*\.zip$/i
  }
  assert.equal(isInstallableAsset('shadps4-linux-sdl-0.18.0.zip', source), true)
  assert.equal(isInstallableAsset('shadps4-macos-sdl-0.18.0.zip', source), false)
  assert.equal(isInstallableAsset('shadps4-win64-sdl-0.18.0.zip', source), false)
})
