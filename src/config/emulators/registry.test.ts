import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { coreForSystem, isKnownSystem, systemsWithCore } from '../systems.ts'
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
import { eden } from './eden/index.ts'
import { emudeck, emuDeckCore, ROM_PLACEHOLDER } from './emudeck/index.ts'
import { retroarch } from './retroarch/index.ts'
import { retrodeck } from './retrodeck/index.ts'
import { shadps4 } from './shadps4/index.ts'
import { xenia } from './xenia/index.ts'
import { example } from './example/index.ts'
import type { EmulatorDescriptor, EmulatorState } from './types.ts'
import type { SaveEnvironment } from './savepaths.ts'

/**
 * Every field of `EmulatorDescriptor`, in the order the interface declares
 * them. Descriptors list their fields in this order too, so one can be read
 * against another — and against the interface — without hunting.
 */
const FIELD_ORDER = [
  'id',
  'name',
  'dispatch',
  'install',
  'homepage',
  'systems',
  'variants',
  'ownsLibrary',
  'dirs',
  'layout',
  'flatLibrary',
  'needsRomFolders',
  'saves',
  'bios',
  'biosStagingNote',
  'core',
  'setupNotes',
  'env',
  'open',
  'launch'
] as const

/**
 * Every descriptor there is, the example among them.
 *
 * `EMULATORS` is what RomMix offers, and the example is deliberately not in it
 * — but it is what somebody copies to add an emulator, so a rule it quietly
 * breaks is a rule the next descriptor starts out breaking too.
 */
const ALL_DESCRIPTORS: readonly EmulatorDescriptor[] = [...EMULATORS, example]

/** A disk holding `files` and nothing else, for a descriptor that reads one. */
function disk(files: Record<string, string> = {}): SaveEnvironment {
  return {
    exists: (path) => path in files,
    dirs: () => [],
    files: () => [],
    text: (path) => files[path] ?? null,
    head: () => null,
    read: () => null,
    inflateRaw: () => null,
    newest: () => 0
  }
}

/** What a launch is told about the disk when nothing on it matters. */
const NOTHING_ON_DISK = {
  paths: { home: null, roms: null, saves: null, states: null, bios: null },
  installDir: null,
  env: disk()
}

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
  for (const emulator of ALL_DESCRIPTORS) {
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
    ...NOTHING_ON_DISK,
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

/** A RetroDECK install whose ES-DE system list holds the PS3 entry it ships. */
const RETRODECK_DIR = '/var/lib/flatpak/app/net.retrodeck.retrodeck/current/active'
const RETRODECK_HOME = '/home/deck/retrodeck'
const ES_SYSTEMS = `${RETRODECK_DIR}/files/retrodeck/components/es-de/share/es-de/resources/systems/linux/es_systems.xml`
const PS3_SYSTEM = `<systemList>
  <system>
    <name>ps3</name>
    <command label="RPCS3 Shortcut (Standalone)">%ENABLESHORTCUTS% %EMULATOR_OS-SHELL% %ROM%</command>
    <command label="RPCS3 Game Serial (Standalone)">%EMULATOR_RPCS3% --no-gui %RPCS3_GAMEID%:%INJECT%=%BASENAME%.ps3</command>
    <command label="RPCS3 Directory (Standalone)">%EMULATOR_RPCS3% --no-gui %ROM%</command>
    <command label="RPCS3 ISO (Standalone)">%EMULATOR_RPCS3% --no-gui %ROM%</command>
  </system>
</systemList>`

function launchPs3(romPath: string, files: Record<string, string> = {}): string[] | null {
  return retrodeck.launch({
    exec: ['flatpak', 'run', 'net.retrodeck.retrodeck'],
    installRef: 'net.retrodeck.retrodeck',
    system: 'ps3',
    romPath,
    paths: { home: RETRODECK_HOME, roms: null, saves: null, states: null, bios: null },
    installDir: RETRODECK_DIR,
    env: disk({ [ES_SYSTEMS]: PS3_SYSTEM, ...files })
  })
}

test('RetroDECK is told to run a PS3 disc image directly rather than as a shortcut', () => {
  // Its default PS3 command passes the ROM to /bin/sh, which cannot run an ISO.
  assert.deepEqual(launchPs3('/roms/ps3/Game/Game.iso'), [
    'flatpak',
    'run',
    'net.retrodeck.retrodeck',
    '-e',
    '%EMULATOR_RPCS3% --no-gui %ROM%',
    '-s',
    'ps3',
    '/roms/ps3/Game/Game.iso'
  ])
})

test('RetroDECK still runs a PS3 shortcut with its default command', () => {
  assert.deepEqual(launchPs3('/roms/ps3/Game.desktop'), [
    'flatpak',
    'run',
    'net.retrodeck.retrodeck',
    '-s',
    'ps3',
    '/roms/ps3/Game.desktop'
  ])
})

test('RetroDECK keeps a PS3 command the user chose in ES-DE', () => {
  const gamelist = `<alternativeEmulator><label>RPCS3 Game Serial (Standalone)</label></alternativeEmulator>`
  const argv = launchPs3('/roms/ps3/Game/Game.iso', {
    [`${RETRODECK_HOME}/ES-DE/gamelists/ps3/gamelist.xml`]: gamelist
  })
  assert.equal(argv?.includes('-e'), false)
})

test('RetroArch is launched with the core mapped for the system', () => {
  const argv = retroarch.launch({
    ...NOTHING_ON_DISK,
    exec: ['/usr/bin/retroarch'],
    installRef: '/usr/bin/retroarch',
    system: 'snes',
    romPath: '/roms/snes/game.sfc'
  })
  assert.deepEqual(argv, [
    '/usr/bin/retroarch',
    '-f',
    '-L',
    'snes9x_libretro.so',
    '/roms/snes/game.sfc'
  ])
})

test('Eden is started fullscreen, with the ROM named by -g', () => {
  const argv = eden.launch({
    ...NOTHING_ON_DISK,
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
    ...NOTHING_ON_DISK,
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
  for (const emulator of ALL_DESCRIPTORS) {
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
  // Narrowed rather than read straight off: `section` is part of the JSON
  // shape alone, which is what makes it unwritable beside `format: 'shell'`.
  assert.equal(sources[0].format, 'json')
  assert.equal(sources[0].format === 'json' ? sources[0].section : null, 'paths')
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
  for (const emulator of ALL_DESCRIPTORS) {
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
  for (const emulator of ALL_DESCRIPTORS) {
    const hasTemplates = Object.keys(emulator.dirs).length > 0
    const hasLayout = emulator.layout != null
    assert.ok(
      hasTemplates !== hasLayout,
      `${emulator.id} declares ${hasTemplates ? 'both' : 'neither'}`
    )
  }
})

test('a variant names a file it needs only where something resolves one', () => {
  // `requires` is checked against the install directory, and only a `scripts`
  // install has one — its ref is a folder of launchers rather than a program.
  // Declared anywhere else the file is never looked for, so the variant is
  // always offered and the claim reads as a check that is not being made.
  for (const emulator of ALL_DESCRIPTORS) {
    const needs = emulator.systems
      .flatMap((system) => emulator.variants?.(system) ?? [])
      .filter((variant) => variant.requires !== undefined)
    if (needs.length === 0) continue
    // Every route, not merely one of them: the probe takes the first install
    // that resolves, so an emulator offering a flatpak beside its launchers
    // has its variants filtered or not depending on which one was found.
    assert.ok(
      emulator.install.every((spec) => spec.kind === 'scripts'),
      `${emulator.id}: ${needs[0].id} names a file it needs, which nothing here looks for`
    )
  }
})

test('a scripts install names a directory the layout actually discovers', () => {
  for (const emulator of ALL_DESCRIPTORS) {
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
    ...NOTHING_ON_DISK,
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
    ...NOTHING_ON_DISK,
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
      ...NOTHING_ON_DISK,
      exec: [],
      installRef: '/e/tools/launchers',
      system: 'xbox360',
      romPath: '/e/roms/xbox360/game.iso'
    }),
    ['/e/tools/launchers/xenia.sh', 'Z:/e/roms/xbox360/game.iso']
  )
  assert.deepEqual(
    emudeck.launch({
      ...NOTHING_ON_DISK,
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
  for (const system of ['snes', 'ps2']) assert.equal(launchVariants(retrodeck, system).length, 0)
  // One core RetroArch runs it with: a single entry, which is nothing to ask.
  assert.deepEqual(
    launchVariants(retroarch, 'dos').map((core) => core.id),
    [coreForSystem('dos')]
  )
})

test('RetroArch offers its cores with the built-in one first, run without asking', () => {
  const cores = launchVariants(retroarch, 'gba')
  assert.equal(cores[0]?.id, coreForSystem('gba'))
  assert.equal(cores[0]?.default, true)
  assert.ok(cores.some((core) => core.id === 'gpsp'))
  assert.ok(cores.slice(1).every((core) => !core.default))
})

test('every core RetroArch offers is one it can be told to load', () => {
  // Each id becomes `<id>_libretro.so` on the command line and in the cores
  // directory, so a typo in the table is a launch that dies before a window.
  for (const system of systemsWithCore()) {
    const ids = launchVariants(retroarch, system).map((core) => core.id)
    assert.equal(new Set(ids).size, ids.length, `${system} offers a core twice`)
    for (const id of ids) assert.match(id, /^[a-z0-9_-]+$/, `${system}: ${id}`)
  }
})

test('the core chosen for RetroArch is the one launched, installed and synced', () => {
  const ctx = {
    ...NOTHING_ON_DISK,
    exec: ['/usr/bin/retroarch'],
    installRef: '/usr/bin/retroarch',
    system: 'gba',
    romPath: '/roms/gba/game.gba',
    variant: 'gpsp'
  }
  const argv = retroarch.launch(ctx)
  assert.equal(argv?.[argv.indexOf('-L') + 1], 'gpsp_libretro.so')
  const core = retroarch.core?.({
    system: 'gba',
    variant: 'gpsp',
    home: '/home/deck',
    configDir: '/home/deck/.config',
    env: disk()
  })
  assert.equal(core?.fileName, 'gpsp_libretro.so')
})

test('a RetroArch core that is not offered for the system runs the built-in one', () => {
  // A choice recorded for another system, or for a core since dropped from the
  // table, is never handed to RetroArch as a file name.
  const argv = retroarch.launch({
    ...NOTHING_ON_DISK,
    exec: ['/usr/bin/retroarch'],
    installRef: '/usr/bin/retroarch',
    system: 'gba',
    romPath: '/roms/gba/game.gba',
    variant: '../../outside'
  })
  assert.equal(argv?.[argv.indexOf('-L') + 1], `${coreForSystem('gba')}_libretro.so`)
})

test('a chosen EmuDeck variant is the one that runs', () => {
  const argv = emudeck.launch({
    ...NOTHING_ON_DISK,
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
    ...NOTHING_ON_DISK,
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
      ...NOTHING_ON_DISK,
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

/**
 * The libretro cores EmuDeck downloads, transcribed from `RAcores` in
 * `RetroArch_installCores` (functions/EmuScripts/emuDeckRetroArch.sh).
 *
 * A row loading a core outside this list launches into an error, and a core
 * in it with no row leaves its systems to standalone RetroArch — whose game
 * folder is RomMix's own, so per-emulator storage stops meaning anything.
 */
const EMUDECK_CORES = new Set([
  '81',
  'a5200',
  'arduous',
  'atari800',
  'blastem',
  'bluemsx',
  'bsnes_hd_beta',
  'bsnes',
  'cap32',
  'chailove',
  'citra',
  'desmume',
  'dosbox_core',
  'dosbox_pure',
  'easyrpg',
  'fbalpha2012',
  'fbneo',
  'flycast',
  'freechaf',
  'freeintv',
  'fuse',
  'gambatte',
  'gearboy',
  'gearsystem',
  'genesis_plus_gx',
  'genesis_plus_gx_wide',
  'gw',
  'handy',
  'hatari',
  'kronos',
  'lutro',
  'mame2003_plus',
  'mame',
  'mednafen_lynx',
  'mednafen_ngp',
  'mednafen_pce_fast',
  'mednafen_pce',
  'mednafen_pcfx',
  'mednafen_psx_hw',
  'mednafen_saturn',
  'mednafen_supergrafx',
  'mednafen_vb',
  'mednafen_wswan',
  'melonds',
  'melondsds',
  'mesen',
  'mesen-s',
  'mgba',
  'minivmac',
  'mu',
  'mupen64plus_next',
  'neocd',
  'nestopia',
  'np2kai',
  'nxengine',
  'o2em',
  'opera',
  'picodrive',
  'pokemini',
  'potator',
  'ppsspp',
  'prboom',
  'prosystem',
  'puae',
  'px68k',
  'quasi88',
  'retro8',
  'same_cdi',
  'sameboy',
  'sameduck',
  'scummvm',
  'snes9x',
  'squirreljme',
  'stella',
  'swanstation',
  'theodore',
  'tic80',
  'tyrquake',
  'uzem',
  'vbam',
  'vecx',
  'vice_x128',
  'vice_x64sc',
  'vice_xscpu64',
  'vice_xvic',
  'virtualjaguar',
  'vitaquake2',
  'vitaquake2-rogue',
  'vitaquake2-xatrix',
  'vitaquake2-zaero',
  'vitaquake3',
  'wasm4',
  'x1'
])

test('every core an EmuDeck row loads is one EmuDeck installs', () => {
  for (const [system, options] of Object.entries(EMUDECK_LAUNCHERS)) {
    for (const option of options) {
      const core = emuDeckCore(option)
      if (core) assert.ok(EMUDECK_CORES.has(core), `${system}: EmuDeck does not install ${core}`)
    }
  }
})

test('every system whose core EmuDeck installs has an EmuDeck row', () => {
  const missing = systemsWithCore().filter(
    (system) => EMUDECK_CORES.has(coreForSystem(system) ?? '') && !EMUDECK_LAUNCHERS[system]
  )
  assert.deepEqual(missing, [])
})

test('a scripts install builds its launcher path from the install ref', () => {
  // `exec` is empty for a `scripts` install — there is no one program to start,
  // so the descriptor names the script and it is the whole command.
  const argv = emudeck.launch({
    ...NOTHING_ON_DISK,
    exec: [],
    installRef: '/e/tools/launchers',
    system: 'psx',
    romPath: '/e/roms/psx/game.chd'
  })
  assert.equal(argv?.[0], '/e/tools/launchers/duckstation.sh')
  assert.ok(argv?.includes('/e/roms/psx/game.chd'), 'the ROM path is never passed')
})

test('EmuDeck opens its own configurator for the Run button', () => {
  // Not ES-DE: the button is for what only EmuDeck can do, and installing the
  // emulator behind a missing launcher is the first of those. `--no-sandbox`
  // is what EmuDeck's own desktop entry passes, and without it the Electron
  // app exits at startup wherever unprivileged user namespaces are restricted.
  assert.deepEqual(
    emudeck.open?.({ exec: [], installRef: '/e/tools/launchers', home: '/home/u' }),
    ['/home/u/Applications/EmuDeck.AppImage', '--no-sandbox']
  )
})

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test('the field list matches what the interface declares', () => {
  // The order below is copied from `types.ts`, so this catches a field added
  // to the interface that nobody added here — which would let the ordering
  // test below pass while ignoring the new field entirely.
  const source = readFileSync(new URL('./types.ts', import.meta.url), 'utf8')
  const from = source.indexOf('interface EmulatorFields')
  // Stop at the interface's own closing brace, which is the first `}` in
  // column zero — otherwise this reads on into what follows and asserts
  // against a union of the two.
  const body = source.slice(from, source.indexOf('\n}\n', from))
  const declared = [...body.matchAll(/^  (?:readonly )?([a-zA-Z]+)[?]?[:(]/gm)].map((m) => m[1])

  // `dirs` and `layout` are declared on `PathSource` instead, being one choice
  // between two shapes rather than two fields — so they are checked there and
  // left out of the list the interface itself carries.
  const pathSource = source.slice(source.indexOf('export type PathSource'))
  for (const field of ['dirs', 'layout']) {
    assert.ok(pathSource.includes(`${field}:`), `PathSource no longer declares ${field}`)
  }
  assert.deepEqual(
    declared,
    FIELD_ORDER.filter((field) => field !== 'dirs' && field !== 'layout')
  )
})

test("every emulator spells out every field, in the interface's order", () => {
  // Not style for its own sake. An absent optional field makes the reader of
  // one emulator guess what the default does, and a differing order makes two
  // emulators impossible to read side by side.
  for (const emulator of ALL_DESCRIPTORS) {
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
    ...NOTHING_ON_DISK,
    exec: ['flatpak', 'run', 'net.shadps4.shadPS4'],
    installRef: 'net.shadps4.shadPS4',
    system: 'ps4',
    romPath: '/roms/ps4/CUSA12345/data.psarc'
  })
  assert.deepEqual(argv, [
    'flatpak',
    'run',
    'net.shadps4.shadPS4',
    '-f',
    'true',
    '/roms/ps4/CUSA12345/eboot.bin'
  ])
})

test('shadPS4 passes an eboot and a package through as they are', () => {
  const run = (romPath: string): string[] | null =>
    shadps4.launch({
      ...NOTHING_ON_DISK,
      exec: ['/usr/bin/shadps4'],
      installRef: '/usr/bin/shadps4',
      system: 'ps4',
      romPath
    })

  assert.deepEqual(run('/roms/ps4/CUSA12345/eboot.bin'), [
    '/usr/bin/shadps4',
    '-f',
    'true',
    '/roms/ps4/CUSA12345/eboot.bin'
  ])
  // A package is shadPS4's to install; rewriting it to an eboot that does not
  // exist yet would turn "install this" into "file not found".
  assert.deepEqual(run('/roms/ps4/game.pkg'), [
    '/usr/bin/shadps4',
    '-f',
    'true',
    '/roms/ps4/game.pkg'
  ])
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

test('Xenia is started fullscreen on the ROM it is given', () => {
  const argv = xenia.launch({
    ...NOTHING_ON_DISK,
    exec: ['/home/u/Applications/xenia_canary_linux.AppImage'],
    installRef: '/home/u/Applications/xenia_canary_linux.AppImage',
    system: 'xbox360',
    romPath: '/roms/xbox360/game.iso'
  })
  assert.deepEqual(argv, [
    '/home/u/Applications/xenia_canary_linux.AppImage',
    '--fullscreen',
    '/roms/xbox360/game.iso'
  ])
})

test('Xenia opens a Games on Demand package by its header, not by a data part', () => {
  // The largest file of a GoD package is a part inside `<header>.data/`; the
  // header beside that folder is what Xenia loads.
  const argv = xenia.launch({
    ...NOTHING_ON_DISK,
    exec: ['/usr/bin/xenia_canary'],
    installRef: '/usr/bin/xenia_canary',
    system: 'xbox360',
    romPath: '/roms/xbox360/Game/4D5307E6/00007000/0123ABCD.data/Data0000'
  })
  assert.deepEqual(argv, [
    '/usr/bin/xenia_canary',
    '--fullscreen',
    '/roms/xbox360/Game/4D5307E6/00007000/0123ABCD'
  ])
})

test('Xenia runs the Xbox 360 and offers its builds as an AppImage', () => {
  assert.equal(supportsSystem(xenia, 'xbox360'), true)
  assert.equal(supportsSystem(xenia, 'xbox'), false)
  const source = releaseSource(xenia)
  assert.ok(source)
  // Real asset names from the main repository's release feed.
  assert.equal(isInstallableAsset('xenia_canary_linux.AppImage', source), true)
  assert.equal(isInstallableAsset('xenia_canary_windows.7z', source), false)
})

test('nothing under src/config imports a node builtin', () => {
  /**
   * The rule CONTRIBUTING states twice, held where `npm test` can see it.
   *
   * The registry is loaded by the renderer as well as by the main process, so a
   * `node:` import here is a bundle that fails — and anything that has to look at
   * the machine is meant to ask through the `SaveEnvironment` handed to `saves()`
   * instead. It holds today; this is what fails the moment it stops.
   */
  const root = join(import.meta.dirname, '..')
  const offenders: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
      } else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
        // The specifier, not the word: `node:` appears in prose in these files.
        if (/from\s+['"]node:|require\(['"]node:/.test(readFileSync(path, 'utf8'))) {
          offenders.push(relative(root, path))
        }
      }
    }
  }
  walk(root)
  assert.deepEqual(offenders, [])
})
