import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emulatorById } from '@config/emulators'
import type { EmulatorDescriptor, EmulatorState, ResolvedInstall } from '@config/emulators'
import type { Settings } from '@shared/types'
import { detectEmulators, expandShell, prepareRomFolders, usableVariants } from './emulators.ts'

/**
 * Probing the machine for the emulators in the registry.
 *
 * Everything here is driven from a scratch home and a settings object, which is
 * all the probe actually reads: an emulator is "installed" because a file is in
 * a directory, and its folders are wherever its own configuration says. The one
 * thing not exercised is the install kinds that ask another program — a flatpak
 * or a binary on PATH — which answer "not installed" out here and are the same
 * two lines either way.
 *
 * What makes this worth testing is that every wrong answer is silent. A layout
 * misread puts a ROM in a folder the emulator never scans; a variant offered
 * for a launcher that is not installed is a Play button that fails with nothing
 * on screen; and a value the shell reader gives up on halfway is a path with a
 * quote in the middle of it, reported as the library root of an install that is
 * sitting right there.
 */

const roots: string[] = []
const env = { ...process.env }

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  process.env = { ...env }
})

/** A home directory of its own, with RomMix's own root inside it. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-emulators-test-'))
  roots.push(dir)
  process.env.HOME = dir
  process.env.XDG_CONFIG_HOME = join(dir, '.config')
  process.env.XDG_DATA_HOME = join(dir, '.local', 'share')
  process.env.ROMMIX_HOME = join(dir, '.rommix')
  return dir
}

function settings(fields: Partial<Settings> = {}): Settings {
  return {
    systemEmulators: {},
    emulatorPaths: {},
    systemLaunchers: {},
    emulatorRoots: {},
    systemOverrides: {},
    emulatorPriority: [],
    romStorage: 'rommix',
    setupComplete: true,
    syncSavesDown: true,
    syncSavesUp: true,
    navigationSounds: true,
    confirmUninstall: true,
    confirmSavePush: true,
    dismissedNotices: [],
    uiScale: 0,
    language: 'auto',
    updates: 'manual',
    deviceId: 'test-device',
    deviceName: 'RomMix @ test',
    ...fields
  } as Settings
}

function write(path: string, contents: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}

/** The state the probe reached for one emulator. */
async function probeOne(id: string, config: Settings): Promise<EmulatorState> {
  const states = await detectEmulators(config)
  const found = states.find((entry) => entry.id === id)
  assert.ok(found, `no state for ${id}`)
  return found
}

describe('reading a value the way the shell would', () => {
  const known = new Map<string, string>()

  test('a bare value, and one wrapped in quotes', () => {
    assert.equal(expandShell('/opt/games', known), '/opt/games')
    assert.equal(expandShell('"/opt/games"', known), '/opt/games')
    assert.equal(expandShell("'/opt/games'", known), '/opt/games')
  })

  test('a variable expands from what was assigned above it', () => {
    const above = new Map([['emulationPath', '/run/media/sd/Emulation']])
    assert.equal(expandShell('"$emulationPath/roms"', above), '/run/media/sd/Emulation/roms')
    assert.equal(expandShell('${emulationPath}/roms', above), '/run/media/sd/Emulation/roms')
  })

  test('quotes delimit rather than belong, so a value quoted in the middle survives whole', () => {
    // EmuDeck writes `emulationPath="$HOME"/Emulation`. Stripping the outer
    // pair leaves a quote inside the path, and the directory cannot exist.
    process.env.HOME = '/home/player'
    assert.equal(expandShell('"$HOME"/Emulation', known), '/home/player/Emulation')
  })

  test('a single-quoted variable is not a variable', () => {
    const above = new Map([['emulationPath', '/sd/Emulation']])
    assert.equal(expandShell("'$emulationPath'", above), '$emulationPath')
  })

  test('a tilde is home only at the very front, and only unquoted', () => {
    process.env.HOME = '/home/player'
    assert.equal(expandShell('~/Emulation', known), '/home/player/Emulation')
    assert.equal(expandShell('"~/Emulation"', known), '~/Emulation')
    assert.equal(expandShell('/opt/~/games', known), '/opt/~/games')
  })

  test('an unquoted space ends the value, where the next word begins', () => {
    assert.equal(expandShell('/opt/games # the library', known), '/opt/games')
  })

  test('a name nothing has assigned makes the whole value nothing', () => {
    // Rather than a path with a `$` in it: a ROM folder called `$emulationPath`
    // is worse than none, because the second is reported and the first is
    // silently created.
    assert.equal(expandShell('"$emulationPath/roms"', known), null)
    assert.equal(expandShell('${nope}', known), null)
  })
})

describe('an emulator whose folders are fixed', () => {
  test('an explicit path in settings wins, and decides the install kind', async () => {
    const dir = home()
    const appimage = join(dir, 'Downloads', 'Eden-v1.AppImage')
    write(appimage, '')

    const found = await probeOne('eden', settings({ emulatorPaths: { eden: appimage } }))

    assert.equal(found.available, true)
    assert.deepEqual(found.install, { kind: 'appimage', ref: appimage })
    // Declared against the XDG data root, which is inside the scratch home.
    assert.equal(found.paths.saves, join(dir, '.local', 'share', 'eden/nand/user/save'))
    assert.equal(found.paths.bios, join(dir, '.local', 'share', 'eden/keys'))
    // ROMs go to RomMix's own tree, whatever the emulator is.
    assert.equal(found.paths.roms, join(dir, '.rommix', 'roms'))
  })

  test('a configured path that is not a .appimage is taken as a plain binary', async () => {
    const dir = home()
    const binary = join(dir, 'opt', 'eden', 'eden')
    write(binary, '')

    const found = await probeOne('eden', settings({ emulatorPaths: { eden: binary } }))

    assert.deepEqual(found.install, { kind: 'binary', ref: binary })
  })

  test('a configured path that has gone is not believed', async () => {
    const dir = home()
    const found = await probeOne(
      'eden',
      settings({ emulatorPaths: { eden: join(dir, 'gone.AppImage') } })
    )

    // Nothing else to find on this machine, so it reports itself missing rather
    // than reporting a path that is not there.
    assert.equal(found.available, false)
    assert.equal(found.install, null)
    assert.deepEqual(found.paths, {
      home: null,
      roms: null,
      saves: null,
      states: null,
      bios: null
    })
  })

  test('an AppImage RomMix installed itself is preferred to a stray copy', async () => {
    const dir = home()
    // What a search would otherwise turn up first.
    write(join(dir, 'Downloads', 'Eden-stray.AppImage'), '')
    const managed = join(dir, '.rommix', 'emulators', 'eden', 'Eden-managed.AppImage')
    write(managed, '')

    const found = await probeOne('eden', settings())

    assert.equal(found.install?.ref, managed)
  })

  test('an AppImage is found where people actually keep them', async () => {
    const dir = home()
    write(join(dir, 'Applications', 'Eden-v1.AppImage'), '')

    const found = await probeOne('eden', settings())

    assert.equal(found.install?.kind, 'appimage')
    assert.equal(found.install?.ref, join(dir, 'Applications', 'Eden-v1.AppImage'))
  })

  test('an emulator nothing can find reports why, in a sentence', async () => {
    home()
    const found = await probeOne('eden', settings())

    assert.equal(found.available, false)
    assert.match(found.unavailableReason ?? '', /Eden/)
  })
})

describe('an emulator that records where it put its own folders', () => {
  /** EmuDeck as it looks once its installer has run. */
  function emuDeck(dir: string, library: string): void {
    write(
      join(dir, 'emudeck', 'settings.sh'),
      [
        '#!/bin/bash',
        `emulationPath="${library}"`,
        'romsPath="$emulationPath/roms"',
        'savesPath="$emulationPath/saves"',
        'biosPath="$emulationPath/bios"',
        'toolsPath="$emulationPath/tools"',
        ''
      ].join('\n')
    )
    mkdirSync(join(library, 'tools', 'launchers'), { recursive: true })
  }

  test('the library is read from its settings, wherever the user put it', async () => {
    const dir = home()
    // An SD card, which is the usual reason any of this is configurable.
    const library = join(dir, 'run', 'media', 'sd', 'Emulation')
    emuDeck(dir, library)

    const found = await probeOne('emudeck', settings())

    assert.equal(found.available, true)
    assert.deepEqual(found.install, { kind: 'scripts', ref: join(library, 'tools', 'launchers') })
    assert.equal(found.paths.roms, join(library, 'roms'))
    assert.equal(found.paths.saves, join(library, 'saves'))
    assert.equal(found.paths.bios, join(library, 'bios'))
  })

  test('what the file leaves out hangs off the home it gave, not off the user home', async () => {
    const dir = home()
    const library = join(dir, 'run', 'media', 'sd', 'Emulation')
    // Only the root, which is the one key the source requires.
    write(join(dir, 'emudeck', 'settings.sh'), `emulationPath="${library}"\n`)
    mkdirSync(join(library, 'tools', 'launchers'), { recursive: true })

    const found = await probeOne('emudeck', settings())

    assert.equal(found.paths.roms, join(library, 'roms'))
    assert.equal(found.paths.saves, join(library, 'saves'))
  })

  test('a file without the key that matters lets the next source answer', async () => {
    const dir = home()
    const library = join(dir, 'Emulation')
    // Half-written, or from a version that named things differently.
    write(join(dir, 'emudeck', 'settings.sh'), 'somethingElse="/tmp"\n')
    write(
      join(dir, '.config', 'EmuDeck', 'settings.sh'),
      `emulationPath="${library}"\ntoolsPath="$emulationPath/tools"\n`
    )
    mkdirSync(join(library, 'tools', 'launchers'), { recursive: true })

    const found = await probeOne('emudeck', settings())

    assert.equal(found.paths.home, library)
    assert.equal(found.available, true)
  })

  test('a folder the user pointed us at wins over the emulator’s own settings', async () => {
    const dir = home()
    const theirs = join(dir, 'Emulation')
    const corrected = join(dir, 'elsewhere', 'Emulation')
    emuDeck(dir, theirs)
    mkdirSync(join(corrected, 'tools', 'launchers'), { recursive: true })

    const found = await probeOne('emudeck', settings({ emulatorRoots: { emudeck: corrected } }))

    // The correction is the newer fact, and the two cannot both be believed.
    assert.equal(found.paths.roms, join(corrected, 'roms'))
    assert.equal(found.install?.ref, join(corrected, 'tools', 'launchers'))
  })

  test('a guessed location is used only where it exists', async () => {
    const dir = home()
    // No settings file at all: the fallback is the conventional folder, and it
    // counts only because it is really there.
    const library = join(dir, 'Emulation')
    mkdirSync(join(library, 'roms'), { recursive: true })
    mkdirSync(join(library, 'tools', 'launchers'), { recursive: true })

    const found = await probeOne('emudeck', settings())

    assert.equal(found.paths.roms, join(library, 'roms'))
    // Never created, so never claimed.
    assert.equal(found.paths.saves, null)
  })

  test('an emulator that owns its library is unavailable until the library is there', async () => {
    const dir = home()
    // The launchers exist, so it is installed — but nothing has been set up, so
    // there is nowhere to put a ROM.
    mkdirSync(join(dir, 'Emulation', 'tools', 'launchers'), { recursive: true })

    const found = await probeOne('emudeck', settings())

    assert.equal(found.install?.kind, 'scripts')
    assert.equal(found.available, false)
    assert.match(found.unavailableReason ?? '', /EmuDeck/)
  })

  test('a settings file that cannot be read is treated as absent', async () => {
    const dir = home()
    // A directory where the file should be: reading it throws, and the probe
    // has to fall through rather than come apart.
    mkdirSync(join(dir, 'emudeck', 'settings.sh'), { recursive: true })
    const library = join(dir, 'Emulation')
    mkdirSync(join(library, 'roms'), { recursive: true })
    mkdirSync(join(library, 'tools', 'launchers'), { recursive: true })

    const found = await probeOne('emudeck', settings())

    assert.equal(found.paths.roms, join(library, 'roms'))
  })

  test('a value naming something unresolved is dropped rather than used', async () => {
    const dir = home()
    write(
      join(dir, 'emudeck', 'settings.sh'),
      // `$somethingElse` was never assigned, so `romsPath` is nothing at all.
      [
        `emulationPath="${join(dir, 'Emulation')}"`,
        'romsPath="$somethingElse/roms"',
        'toolsPath="$emulationPath/tools"',
        ''
      ].join('\n')
    )
    mkdirSync(join(dir, 'Emulation', 'tools', 'launchers'), { recursive: true })

    const found = await probeOne('emudeck', settings())

    // Falls back to the default below the home it did give, not to `$somethingElse/roms`.
    assert.equal(found.paths.roms, join(dir, 'Emulation', 'roms'))
  })
})

describe('an emulator packaged as a flatpak, which keeps its files in its own tree', () => {
  const APP_ID = 'net.retrodeck.retrodeck'

  /**
   * A `flatpak` on PATH that answers for one installed application.
   *
   * The alternative is not testing any of this: `resolveInstall` asks flatpak
   * rather than constructing the path, deliberately — that is what covers a
   * system or a user installation, either architecture and any branch — so
   * there is nothing to point at instead. Answering the one question the probe
   * asks is enough, and the script is small enough to read.
   */
  function fakeFlatpak(dir: string, location: string): void {
    const bin = join(dir, 'fake-bin')
    mkdirSync(bin, { recursive: true })
    const script = join(bin, 'flatpak')
    writeFileSync(
      script,
      [
        '#!/bin/sh',
        'if [ "$1" = "info" ] && [ "$3" = "' + APP_ID + '" ]; then',
        `  echo "${location}"`,
        '  exit 0',
        'fi',
        'exit 1',
        ''
      ].join('\n'),
      { mode: 0o755 }
    )
    process.env.PATH = `${bin}:${process.env.PATH ?? ''}`
  }

  test('its configuration is read from inside its own per-app tree', async () => {
    const dir = home()
    fakeFlatpak(dir, join(dir, 'flatpak-deploy'))
    const library = join(dir, 'run', 'media', 'sd', 'retrodeck')
    // A flatpak keeps config and data inside `~/.var/app/<id>`, which is the
    // whole reason the base a `DirSpec` resolves against depends on the install.
    write(
      join(dir, '.var', 'app', APP_ID, 'config', 'retrodeck', 'retrodeck.json'),
      JSON.stringify({
        paths: {
          rd_home_path: library,
          roms_path: join(library, 'roms'),
          saves_path: join(library, 'saves'),
          states_path: join(library, 'states'),
          bios_path: join(library, 'bios')
        }
      })
    )

    const found = await probeOne('retrodeck', settings())

    assert.equal(found.available, true)
    assert.deepEqual(found.install, {
      kind: 'flatpak',
      ref: APP_ID,
      location: join(dir, 'flatpak-deploy')
    })
    assert.equal(found.paths.roms, join(library, 'roms'))
    assert.equal(found.paths.states, join(library, 'states'))
    assert.equal(found.configDir, join(dir, '.var', 'app', APP_ID, 'config'))
    assert.equal(found.dataDir, join(dir, '.var', 'app', APP_ID, 'data'))
  })

  test('a malformed configuration is treated as absent rather than crashing the probe', async () => {
    const dir = home()
    fakeFlatpak(dir, join(dir, 'flatpak-deploy'))
    write(join(dir, '.var', 'app', APP_ID, 'config', 'retrodeck', 'retrodeck.json'), '{ not json')
    // The conventional folder, which is what answers once the file does not.
    const library = join(dir, 'retrodeck')
    mkdirSync(join(library, 'roms'), { recursive: true })

    const found = await probeOne('retrodeck', settings())

    assert.equal(found.paths.roms, join(library, 'roms'))
  })

  test('a section the file does not have leaves every path to the fallback', async () => {
    const dir = home()
    fakeFlatpak(dir, join(dir, 'flatpak-deploy'))
    // Valid JSON, but nothing under `paths` — an older or half-written file.
    write(
      join(dir, '.var', 'app', APP_ID, 'config', 'retrodeck', 'retrodeck.json'),
      JSON.stringify({ version: '1.0' })
    )

    const found = await probeOne('retrodeck', settings())

    // Installed, but nothing set up: no library, so nowhere to put a ROM.
    assert.equal(found.install?.kind, 'flatpak')
    assert.equal(found.available, false)
  })

  test('non-string values in the configuration are ignored', async () => {
    const dir = home()
    fakeFlatpak(dir, join(dir, 'flatpak-deploy'))
    const library = join(dir, 'retrodeck')
    write(
      join(dir, '.var', 'app', APP_ID, 'config', 'retrodeck', 'retrodeck.json'),
      JSON.stringify({
        paths: { roms_path: join(library, 'roms'), saves_path: 42, bios_path: '' }
      })
    )

    const found = await probeOne('retrodeck', settings())

    assert.equal(found.paths.roms, join(library, 'roms'))
    // Neither a number nor an empty string is a path.
    assert.equal(found.paths.saves, null)
    assert.equal(found.paths.bios, null)
  })
})

describe('the ways an emulator can really run a system', () => {
  const descriptor = emulatorById('emudeck') as EmulatorDescriptor
  const system = descriptor.systems[0]

  test('a scripts install offers only the launchers that are on disk', () => {
    const dir = home()
    const launchers = join(dir, 'launchers')
    mkdirSync(launchers, { recursive: true })

    const install: ResolvedInstall = { kind: 'scripts', ref: launchers }
    const declared = usableVariants(descriptor, system, null)
    assert.ok(declared.length > 0, 'this system needs declared variants to be worth testing')

    // Nothing installed: a row naming a script that is not there describes an
    // emulator this user does not have, and offering it is a launch that fails
    // with nothing on screen explaining why.
    assert.deepEqual(usableVariants(descriptor, system, install), [])

    // Now put the first one's script where it belongs.
    const wanted = declared[0].requires
    assert.ok(wanted, 'a scripts variant has to name what it needs')
    write(join(launchers, wanted), '')
    const usable = usableVariants(descriptor, system, install)
    assert.deepEqual(
      usable.map((variant) => variant.id),
      [declared[0].id]
    )
  })

  test('every other install kind passes through untouched', () => {
    // A flatpak or an AppImage is one program, and its variants are facts about
    // it rather than about the folder it was found in.
    const declared = usableVariants(descriptor, system, null)
    for (const install of [
      { kind: 'appimage', ref: '/nowhere/x.AppImage' },
      { kind: 'flatpak', ref: 'org.example.App', location: '/nowhere' },
      { kind: 'binary', ref: '/usr/bin/x' }
    ] as ResolvedInstall[]) {
      assert.deepEqual(usableVariants(descriptor, system, install), declared)
    }
  })

  test('a system this emulator does not run has no variants at all', () => {
    assert.deepEqual(usableVariants(descriptor, 'not-a-system', null), [])
  })
})

describe('probing the whole registry', () => {
  test('every registered emulator is reported, in the order asked for', async () => {
    home()
    const ordered = await detectEmulators(settings({ emulatorPriority: ['shadps4', 'eden'] }))

    // The order *is* the answer to "which emulator runs this": the first
    // available one covering a system is the one that will run it.
    assert.equal(ordered[0].id, 'shadps4')
    assert.equal(ordered[1].id, 'eden')
    // And the rest are still there, each with a reason it is not usable.
    assert.ok(ordered.length > 2)
    for (const state of ordered) {
      assert.equal(state.available, state.unavailableReason === null)
    }
  })

  test('a probe answers for where an install keeps its own configuration', async () => {
    const dir = home()
    const appimage = join(dir, 'Downloads', 'Eden.AppImage')
    write(appimage, '')

    const found = await probeOne('eden', settings({ emulatorPaths: { eden: appimage } }))

    // A native install reads the XDG roots; a flatpak would read its own tree.
    assert.equal(found.configDir, join(dir, '.config'))
    assert.equal(found.dataDir, join(dir, '.local', 'share'))
  })

  test('an emulator that was never found has no configuration directory either', async () => {
    home()
    const found = await probeOne('eden', settings())

    assert.equal(found.configDir, null)
    assert.equal(found.dataDir, null)
  })
})

describe('the game folders an emulator is pointed at', () => {
  test('installing one that reads only the folders it is given makes them', async () => {
    const dir = home()
    const appimage = join(dir, 'Downloads', 'Eden.AppImage')
    write(appimage, '')

    const found = await probeOne('eden', settings({ emulatorPaths: { eden: appimage } }))
    const made = await prepareRomFolders(found)

    // Eden opens on an empty game list and a prompt to add a directory, and
    // the folder the setup note names has to exist to be chosen there.
    assert.deepEqual(made, [join(dir, '.rommix', 'roms', 'switch')])
    assert.ok(existsSync(made[0]))
  })

  test('an emulator that opens a game from anywhere gets no folders', async () => {
    const dir = home()
    const appimage = join(dir, 'Downloads', 'RetroArch.AppImage')
    write(appimage, '')

    const found = await probeOne('retroarch', settings({ emulatorPaths: { retroarch: appimage } }))

    // It runs a hundred systems, and a folder for each of them is a hundred
    // empty directories against one game.
    assert.deepEqual(await prepareRomFolders(found), [])
    assert.equal(existsSync(join(dir, '.rommix', 'roms', 'snes')), false)
  })

  test('nothing is made for an emulator that was never found', async () => {
    home()
    const found = await probeOne('shadps4', settings())

    // No install means no folders were resolved, so there is nowhere to make
    // anything under.
    assert.deepEqual(await prepareRomFolders(found), [])
  })
})
