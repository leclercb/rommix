import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eden } from './eden/index.ts'
import { emudeck, EMUDECK_LAUNCHERS } from './emudeck/index.ts'
import { retroarch } from './retroarch/index.ts'
import { retrodeck } from './retrodeck/index.ts'
import { shadps4 } from './shadps4/index.ts'
import { EMULATORS } from './index.ts'
import type { EmulatorDescriptor } from './types.ts'
import type { SaveContext, SaveEnvironment, SavePaths } from './savepaths.ts'
import { createI18n, localize } from '@shared/i18n'

/**
 * Save resolution, against a described machine rather than a real one.
 *
 * Every path here was verified against the emulator's own configuration —
 * RetroDECK's `component_prepare.sh`, EmuDeck's `linkToSaveFolder` calls,
 * RetroArch's `runloop_path_set_redirect()` — and a live `~/retrodeck`. The
 * point of the fake environment is that those facts can be asserted without an
 * emulator installed, which is the only way a table this size stays honest.
 */

/**
 * The language the phrases below are asserted in.
 *
 * A descriptor names a catalogue key rather than a sentence, so a test that
 * wants to read one has to pick a language to read it in. English, because that
 * is the catalogue the others are written from.
 */
const ENGLISH = createI18n('en')

const HOME = '/home/deck'

/** A machine described as a set of files and directories. */
interface FakeMachine {
  /** Absolute path -> contents, for files that get read. */
  files?: Record<string, string>
  /** Directories that exist, with the entries directly inside them. */
  dirs?: Record<string, string[]>
  /** Absolute path -> newest mtime beneath it. */
  mtimes?: Record<string, number>
  /** Absolute path -> the bytes `head` should return. */
  heads?: Record<string, string>
}

function machine(spec: FakeMachine): SaveEnvironment {
  const files = spec.files ?? {}
  const dirs = spec.dirs ?? {}
  return {
    exists: (path) => path in files || path in dirs,
    dirs: (path) => dirs[path] ?? [],
    files: (path) => (dirs[path] ?? []).filter((name) => `${path}/${name}` in files),
    text: (path) => files[path] ?? null,
    head: (path, bytes) => (spec.heads?.[path] ?? files[path] ?? null)?.slice(0, bytes) ?? null,
    newest: (path) => spec.mtimes?.[path] ?? 0
  }
}

interface ContextOptions {
  romPath: string
  system: string
  paths?: Partial<SaveContext['paths']>
  configDir?: string | null
  dataDir?: string | null
  installDir?: string | null
  variant?: string
  env?: SaveEnvironment
}

function context(options: ContextOptions): SaveContext {
  const romPath = options.romPath
  return {
    paths: {
      home: null,
      roms: null,
      saves: null,
      states: null,
      bios: null,
      ...options.paths
    },
    system: options.system,
    romPath,
    romDir: romPath.slice(0, romPath.lastIndexOf('/')),
    romStem: romPath.slice(romPath.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''),
    home: HOME,
    configDir: options.configDir ?? null,
    dataDir: options.dataDir ?? null,
    installDir: options.installDir ?? null,
    variant: options.variant,
    env: options.env ?? machine({})
  }
}

function resolve(descriptor: EmulatorDescriptor, options: ContextOptions): SavePaths {
  return descriptor.saves(context(options))
}

/** A `retroarch.cfg` with the flags a caller cares about. */
function retroArchCfg(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key} = "${value}"`)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Every descriptor
// ---------------------------------------------------------------------------

test('every emulator can be asked where a game keeps its saves', () => {
  // The question replaced two enums that were never allowed to be absent. A
  // descriptor that cannot answer would fail as "nothing to sync", long after
  // the session that wrote the save.
  for (const emulator of EMULATORS) {
    const paths = resolve(emulator, {
      romPath: '/roms/snes/game.sfc',
      system: 'snes',
      paths: { home: '/lib', saves: '/lib/saves', states: '/lib/states' }
    })
    assert.ok(paths, `${emulator.id} answered nothing`)
    assert.ok('saves' in paths && 'states' in paths, `${emulator.id}: incomplete answer`)
  }
})

test('a resolved location is never a bare root that would swallow the tree', () => {
  for (const emulator of EMULATORS) {
    const paths = resolve(emulator, {
      romPath: '/roms/gc/game.rvz',
      system: 'gc',
      paths: { home: '/lib', saves: '/lib/saves', states: '/lib/states' }
    })
    for (const location of [paths.saves, paths.states]) {
      if (!location) continue
      assert.notEqual(location.dir, '/', `${emulator.id} resolved to the filesystem root`)
      assert.ok(location.dir.length > 1, `${emulator.id} resolved to "${location.dir}"`)
    }
  }
})

// ---------------------------------------------------------------------------
// RetroArch
// ---------------------------------------------------------------------------

test('RetroArch with no config falls back to its declared directories', () => {
  const paths = resolve(retroarch, {
    romPath: '/roms/snes/game.sfc',
    system: 'snes',
    paths: { saves: '/ra/saves', states: '/ra/states' }
  })
  assert.equal(paths.saves?.dir, '/ra/saves')
  assert.equal(paths.states?.dir, '/ra/states')
  assert.equal(paths.saves?.match, 'rom-stem')
})

test('RetroArch follows savefile_directory out of its own config', () => {
  const env = machine({
    files: {
      '/cfg/retroarch/retroarch.cfg': retroArchCfg({
        savefile_directory: '/elsewhere/saves',
        savestate_directory: '/elsewhere/states'
      })
    }
  })
  const paths = resolve(retroarch, {
    romPath: '/roms/snes/game.sfc',
    system: 'snes',
    configDir: '/cfg',
    paths: { saves: '/ra/saves', states: '/ra/states' },
    env
  })
  assert.equal(paths.saves?.dir, '/elsewhere/saves')
  assert.equal(paths.states?.dir, '/elsewhere/states')
})

test('a ~ in the config expands to the home directory', () => {
  const env = machine({
    files: {
      '/cfg/retroarch/retroarch.cfg': retroArchCfg({ savefile_directory: '~/saves' })
    }
  })
  const paths = resolve(retroarch, {
    romPath: '/roms/snes/game.sfc',
    system: 'snes',
    configDir: '/cfg',
    env
  })
  assert.equal(paths.saves?.dir, `${HOME}/saves`)
})

test("sorting by content directory names the folder after the ROM's parent", () => {
  // RetroArch's `content_dir_name` is `fill_pathname_parent_dir_name`, so it is
  // the directory the ROM sits in — which equals the system only because ROMs
  // normally live at `roms/<system>/game.ext`.
  const env = machine({
    files: {
      '/cfg/retroarch/retroarch.cfg': retroArchCfg({
        savefile_directory: '/lib/saves',
        savestate_directory: '/lib/states',
        sort_savefiles_by_content_enable: 'true',
        sort_savestates_by_content_enable: 'true'
      })
    }
  })
  const paths = resolve(retroarch, {
    romPath: '/lib/roms/genesis/QuackShot (World).md',
    system: 'genesis',
    configDir: '/cfg',
    env
  })
  assert.equal(paths.saves?.dir, '/lib/saves/genesis')
  assert.equal(paths.states?.dir, '/lib/states/genesis')
})

test('a multi-file game in its own folder sorts under that folder, not the system', () => {
  // The failure this exists to catch: a game installed to
  // `roms/psx/Final Fantasy VII/` has RetroArch write to `saves/Final Fantasy
  // VII/`, and assuming `saves/psx/` would create an empty directory beside the
  // real save and report nothing to sync.
  const env = machine({
    files: {
      '/cfg/retroarch/retroarch.cfg': retroArchCfg({
        savefile_directory: '/lib/saves',
        sort_savefiles_by_content_enable: 'true'
      })
    }
  })
  const paths = resolve(retroarch, {
    romPath: '/lib/roms/psx/Final Fantasy VII/disc1.cue',
    system: 'psx',
    configDir: '/cfg',
    env
  })
  assert.equal(paths.saves?.dir, '/lib/saves/Final Fantasy VII')
})

test('sorting by core names the folder after the core, not the core file', () => {
  const env = machine({
    files: {
      '/cfg/retroarch/retroarch.cfg': retroArchCfg({
        savefile_directory: '/lib/saves',
        sort_savefiles_enable: 'true'
      })
    }
  })
  const paths = resolve(retroarch, {
    romPath: '/lib/roms/genesis/game.md',
    system: 'genesis',
    configDir: '/cfg',
    env
  })
  // `genesis_plus_gx_libretro.so` reports itself as "Genesis Plus GX".
  assert.equal(paths.saves?.dir, '/lib/saves/Genesis Plus GX')
  // The unsorted root stays searchable, so a save filed under a differently
  // named folder is still found on push.
  assert.deepEqual(paths.saves?.search, ['/lib/saves'])
})

test('both sort flags stack, content directory first', () => {
  const env = machine({
    files: {
      '/cfg/retroarch/retroarch.cfg': retroArchCfg({
        savefile_directory: '/lib/saves',
        sort_savefiles_enable: 'true',
        sort_savefiles_by_content_enable: 'true'
      })
    }
  })
  const paths = resolve(retroarch, {
    romPath: '/lib/roms/snes/game.sfc',
    system: 'snes',
    configDir: '/cfg',
    env
  })
  assert.equal(paths.saves?.dir, '/lib/saves/snes/Snes9x')
})

test('an unknown core writes to the unsorted directory rather than a guessed folder', () => {
  // Writing a pulled save into a folder named by a guess is how a game starts
  // without it. The sorted folder is still searched.
  const env = machine({
    files: {
      '/cfg/retroarch/retroarch.cfg': retroArchCfg({
        savefile_directory: '/lib/saves',
        sort_savefiles_enable: 'true'
      })
    }
  })
  const paths = resolve(retroarch, {
    // `scummvm` has a core mapping but no known library name in the table.
    romPath: '/lib/roms/pc98/game.d88',
    system: 'pc98',
    configDir: '/cfg',
    env
  })
  assert.equal(paths.saves?.dir, '/lib/saves')
})

test('savefiles_in_content_dir puts saves beside the ROM', () => {
  const env = machine({
    files: {
      '/cfg/retroarch/retroarch.cfg': retroArchCfg({
        savefile_directory: '/lib/saves',
        savefiles_in_content_dir: 'true'
      })
    }
  })
  const paths = resolve(retroarch, {
    romPath: '/lib/roms/snes/game.sfc',
    system: 'snes',
    configDir: '/cfg',
    env
  })
  assert.equal(paths.saves?.dir, '/lib/roms/snes')
})

// ---------------------------------------------------------------------------
// RetroDECK
// ---------------------------------------------------------------------------

/** RetroDECK's shipped RetroArch config: sort by content, not by core. */
const RETRODECK_CFG = retroArchCfg({
  savefile_directory: '/home/deck/retrodeck/saves',
  savestate_directory: '/home/deck/retrodeck/states',
  sort_savefiles_enable: 'false',
  sort_savefiles_by_content_enable: 'true',
  sort_savestates_enable: 'false',
  sort_savestates_by_content_enable: 'true'
})

function retroDeck(options: { romPath: string; system: string; gamelist?: string }): SavePaths {
  const files: Record<string, string> = {
    '/var/rd/config/retroarch/retroarch.cfg': RETRODECK_CFG
  }
  if (options.gamelist) {
    files[`/home/deck/retrodeck/ES-DE/gamelists/${options.system}/gamelist.xml`] = options.gamelist
  }
  return resolve(retrodeck, {
    romPath: options.romPath,
    system: options.system,
    configDir: '/var/rd/config',
    paths: {
      home: '/home/deck/retrodeck',
      roms: '/home/deck/retrodeck/roms',
      saves: '/home/deck/retrodeck/saves',
      states: '/home/deck/retrodeck/states'
    },
    env: machine({ files })
  })
}

test('a RetroDECK libretro system follows its own sort-by-content config', () => {
  const paths = retroDeck({
    romPath: '/home/deck/retrodeck/roms/n64/Snowboard Kids 2 (USA).z64',
    system: 'n64'
  })
  assert.equal(paths.saves?.dir, '/home/deck/retrodeck/saves/n64')
  assert.equal(paths.states?.dir, '/home/deck/retrodeck/states/n64')
  assert.equal(paths.emulator, 'retroarch')
})

test('RetroDECK standalone components each get their own arrangement', () => {
  // Verified against RetroDECK's `component_prepare.sh` and a live install.
  const ps2 = retroDeck({ romPath: '/home/deck/retrodeck/roms/ps2/game.chd', system: 'ps2' })
  assert.equal(ps2.saves?.dir, '/home/deck/retrodeck/saves/ps2/pcsx2/memcards')
  assert.equal(ps2.states?.dir, '/home/deck/retrodeck/states/ps2/pcsx2')
  assert.equal(ps2.emulator, 'pcsx2')

  const psp = retroDeck({ romPath: '/home/deck/retrodeck/roms/psp/game.iso', system: 'psp' })
  // Capital PSP, and the component folder is `PPSSPP-SA`, neither of which any
  // "nest under the system name" rule would produce.
  assert.equal(psp.saves?.dir, '/home/deck/retrodeck/saves/PSP/PPSSPP-SA')

  const n3ds = retroDeck({ romPath: '/home/deck/retrodeck/roms/n3ds/game.3ds', system: 'n3ds' })
  assert.equal(n3ds.saves?.dir, '/home/deck/retrodeck/saves/n3ds/azahar/sdmc')
})

test('Dolphin states sit outside the system tree entirely', () => {
  // The exception that a single `system-nested` flag could not express.
  const gc = retroDeck({ romPath: '/home/deck/retrodeck/roms/gc/game.rvz', system: 'gc' })
  assert.equal(gc.saves?.dir, '/home/deck/retrodeck/saves/gc/dolphin')
  assert.equal(gc.states?.dir, '/home/deck/retrodeck/states/dolphin')
  assert.equal(gc.emulator, 'dolphin')
})

test('a shared memory card is not offered for per-game sync, but its states are', () => {
  const ps2 = retroDeck({ romPath: '/home/deck/retrodeck/roms/ps2/game.chd', system: 'ps2' })
  assert.equal(ps2.saves?.match, 'shared')
  assert.equal(ps2.states?.match, 'rom-stem')
  assert.match(localize(ps2.unsyncableReason, ENGLISH) ?? '', /memory card/i)
})

test('a per-game altemulator in the ES-DE gamelist changes where saves are looked for', () => {
  // RetroDECK resolves the emulator from ES-DE's own configuration, so RomMix
  // reads the same file rather than assuming the default.
  const gamelist = `<?xml version="1.0"?>
<gameList>
  <game>
    <path>./game.chd</path>
    <name>A Game</name>
    <altemulator>LRPS2</altemulator>
  </game>
</gameList>`
  const paths = retroDeck({
    romPath: '/home/deck/retrodeck/roms/ps2/game.chd',
    system: 'ps2',
    gamelist
  })
  // LRPS2 is the libretro core, so this is RetroArch's tree — not pcsx2's.
  assert.equal(paths.emulator, 'retroarch')
  assert.equal(paths.saves?.dir, '/home/deck/retrodeck/saves/ps2')
})

test('a core label is not mistaken for the standalone program of the same name', () => {
  // ES-DE's default for `arcade` is "MAME - Current", which is
  // `mame_libretro.so` inside RetroArch. Matching it on the word "MAME" would
  // send save sync to the standalone's `saves/mame-sa/nvram`, which the core
  // never writes to. The "(Standalone)" suffix is the only thing separating
  // the two.
  const gamelist = `<?xml version="1.0"?>
<gameList>
  <alternativeEmulator><label>MAME - Current</label></alternativeEmulator>
  <game><path>./game.zip</path></game>
</gameList>`
  const paths = retroDeck({
    romPath: '/home/deck/retrodeck/roms/arcade/game.zip',
    system: 'arcade',
    gamelist
  })
  assert.equal(paths.emulator, 'retroarch')

  const standalone = retroDeck({
    romPath: '/home/deck/retrodeck/roms/arcade/game.zip',
    system: 'arcade',
    gamelist: gamelist.replace('MAME - Current', 'MAME (Standalone)')
  })
  assert.equal(standalone.emulator, 'mame')
  assert.equal(standalone.saves?.dir, '/home/deck/retrodeck/saves/mame-sa/nvram')
})

test('a system-wide alternativeEmulator applies to a game with no override', () => {
  const gamelist = `<?xml version="1.0"?>
<gameList>
  <alternativeEmulator>
    <label>PCSX2 (Standalone)</label>
  </alternativeEmulator>
  <game>
    <path>./game.chd</path>
  </game>
</gameList>`
  const paths = retroDeck({
    romPath: '/home/deck/retrodeck/roms/ps2/game.chd',
    system: 'ps2',
    gamelist
  })
  assert.equal(paths.emulator, 'pcsx2')
})

// ---------------------------------------------------------------------------
// EmuDeck
// ---------------------------------------------------------------------------

function emuDeck(options: { romPath: string; system: string; variant?: string }): SavePaths {
  return resolve(emudeck, {
    romPath: options.romPath,
    system: options.system,
    variant: options.variant,
    paths: {
      home: `${HOME}/Emulation`,
      roms: `${HOME}/Emulation/roms`,
      saves: `${HOME}/Emulation/saves`
    },
    env: machine({
      dirs: {
        [`${HOME}/Emulation/saves/eden/saves/0000000000000000`]: [
          '00000000000000000000000000000001'
        ]
      },
      heads: {
        [`${HOME}/Emulation/roms/switch/game.nsp`]: 'junk 010012300ABCD000.cnmt more'
      }
    })
  })
}

test('EmuDeck builds both saves and states out of its one saves root', () => {
  // EmuDeck has no states root: states live under `savesPath` beside the saves.
  // The descriptor discovering no `states` path is why this used to sync none.
  const paths = emuDeck({ romPath: `${HOME}/Emulation/roms/nds/game.nds`, system: 'nds' })
  assert.equal(paths.saves?.dir, `${HOME}/Emulation/saves/retroarch/saves`)
  assert.equal(paths.states?.dir, `${HOME}/Emulation/saves/retroarch/states`)
})

test('the chosen EmuDeck variant decides which emulator folder is used', () => {
  const core = emuDeck({ romPath: `${HOME}/Emulation/roms/nds/game.nds`, system: 'nds' })
  assert.equal(core.emulator, 'retroarch')

  const standalone = emuDeck({
    romPath: `${HOME}/Emulation/roms/nds/game.nds`,
    system: 'nds',
    variant: 'melonds'
  })
  assert.equal(standalone.saves?.dir, `${HOME}/Emulation/saves/melonds/saves`)
  assert.equal(standalone.states?.dir, `${HOME}/Emulation/saves/melonds/states`)
  assert.equal(standalone.emulator, 'melonds')
})

test('a launcher script whose name is not the save folder is mapped, not guessed', () => {
  // `pcsx2-qt.sh` writes into `saves/pcsx2`, and `dolphin-emu.sh` into
  // `saves/dolphin`.
  const ps2 = emuDeck({ romPath: `${HOME}/Emulation/roms/ps2/game.chd`, system: 'ps2' })
  assert.equal(ps2.saves?.dir, `${HOME}/Emulation/saves/pcsx2/saves`)

  const gc = emuDeck({ romPath: `${HOME}/Emulation/roms/gc/game.rvz`, system: 'gc' })
  assert.equal(gc.states?.dir, `${HOME}/Emulation/saves/dolphin/StateSaves`)
})

test('EmuDeck resolves a Switch game to its title-id folder', () => {
  const paths = emuDeck({
    romPath: `${HOME}/Emulation/roms/switch/game.nsp`,
    system: 'switch',
    variant: 'eden'
  })
  assert.equal(
    paths.saves?.dir,
    `${HOME}/Emulation/saves/eden/saves/0000000000000000/` +
      '00000000000000000000000000000001/010012300ABCD000'
  )
  assert.equal(paths.saves?.match, 'directory')
  assert.equal(paths.saves?.archive, true)
})

// ---------------------------------------------------------------------------
// Eden
// ---------------------------------------------------------------------------

/** The single profile a fresh Switch emulator creates. */
const ONE_PROFILE = '00000000000000000000000000000000'

/** A NAND with the given profiles, and the title folders each already holds. */
function edenMachine(profiles: Record<string, string[]>, mtimes: Record<string, number> = {}) {
  const base = '/data/eden/nand/user/save'
  const dirs: Record<string, string[]> = {
    [`${base}/0000000000000000`]: Object.keys(profiles)
  }
  const files: Record<string, string> = {}
  for (const [profile, titles] of Object.entries(profiles)) {
    dirs[`${base}/0000000000000000/${profile}`] = titles
    for (const title of titles) {
      dirs[`${base}/0000000000000000/${profile}/${title}`] = []
    }
  }
  return machine({
    dirs,
    files,
    mtimes: Object.fromEntries(
      Object.entries(mtimes).map(([profile, time]) => [`${base}/0000000000000000/${profile}`, time])
    ),
    heads: {
      '/roms/switch/game.nsp': 'HEAD 01007EF00011E000.cnmt tail'
    }
  })
}

function edenPaths(env: SaveEnvironment, romPath = '/roms/switch/game.nsp'): SavePaths {
  return resolve(eden, {
    romPath,
    system: 'switch',
    paths: { saves: '/data/eden/nand/user/save' },
    env
  })
}

test('Eden reads the title id out of the ROM header', () => {
  // Every NSP and XCI carries its content-metadata entry as `<title id>.cnmt`,
  // near the front of the file — which is why 256 KB is enough of a
  // multi-gigabyte ROM.
  const paths = edenPaths(edenMachine({ [ONE_PROFILE]: [] }))
  assert.equal(
    paths.saves?.dir,
    `/data/eden/nand/user/save/0000000000000000/${ONE_PROFILE}/01007EF00011E000`
  )
})

test("an update's title id resolves to the base game's save folder", () => {
  // Updates end `800` and DLC counts upwards; saves belong to the base game.
  const env = machine({
    dirs: { '/data/eden/nand/user/save/0000000000000000': [ONE_PROFILE] },
    heads: { '/roms/switch/update.nsp': 'x 01007EF00011E800.cnmt' }
  })
  const paths = edenPaths(env, '/roms/switch/update.nsp')
  assert.match(paths.saves?.dir ?? '', /01007EF00011E000$/)
})

test('an m3u playlist resolves through to the game it lists', () => {
  // RomM exposes a game shipped as a base plus an update as a playlist, and
  // that is what gets launched. The playlist is text and declares nothing
  // itself; the entries do. Both entries here belong to one game, and the
  // update's id normalises to the base folder the game itself uses.
  const env = machine({
    dirs: { '/data/eden/nand/user/save/0000000000000000': [ONE_PROFILE] },
    files: {
      '/roms/switch/Game.m3u':
        'Game [01007EF00011E800][USA][v786432].nsp\nGame [01007EF00011E000][USA][v0].nsp\n'
    }
  })
  const paths = edenPaths(env, '/roms/switch/Game.m3u')
  assert.match(paths.saves?.dir ?? '', /01007EF00011E000$/)
})

test('a comment line in a playlist is not mistaken for an entry', () => {
  const env = machine({
    dirs: { '/data/eden/nand/user/save/0000000000000000': [ONE_PROFILE] },
    files: {
      '/roms/switch/Game.m3u': '#EXTM3U 0100DEADBEEF0000\nGame [01007EF00011E000].nsp\n'
    }
  })
  const paths = edenPaths(env, '/roms/switch/Game.m3u')
  assert.match(paths.saves?.dir ?? '', /01007EF00011E000$/)
})

test('a title id in the file name is used when the header carries none', () => {
  const env = machine({
    dirs: { '/data/eden/nand/user/save/0000000000000000': [ONE_PROFILE] }
  })
  const paths = edenPaths(env, '/roms/switch/Game [01007EF00011E000].nsp')
  assert.match(paths.saves?.dir ?? '', /01007EF00011E000$/)
})

test('a profile that already holds this title beats the most recent one', () => {
  // A user whose other profile happens to have been played more recently would
  // otherwise have this game resolved against a profile that never held it.
  const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const env = edenMachine(
    { [owner]: ['01007EF00011E000'], [other]: ['0100AAAA00000000'] },
    { [owner]: 1000, [other]: 9999 }
  )
  const paths = edenPaths(env)
  assert.ok(paths.saves?.dir.includes(owner), `resolved to ${paths.saves?.dir}`)
})

test('with no title id, nothing is synced rather than something wrong', () => {
  // Writing a pulled save under a guessed title id would put another game's
  // data where this game looks for its own.
  const env = machine({
    dirs: { '/data/eden/nand/user/save/0000000000000000': [ONE_PROFILE] }
  })
  const paths = edenPaths(env, '/roms/switch/Some Game.nsp')
  assert.equal(paths.saves, null)
  assert.match(localize(paths.unsyncableReason, ENGLISH) ?? '', /title id/i)
})

test('with no profile yet, Eden says so rather than inventing one', () => {
  // The title id resolves; it is the NAND that is empty, because Eden has never
  // been started. Saying which of the two is missing is the difference between
  // a fixable message and "nothing to sync".
  const paths = edenPaths(
    machine({ heads: { '/roms/switch/game.nsp': 'HEAD 01007EF00011E000.cnmt tail' } })
  )
  assert.equal(paths.saves, null)
  assert.match(localize(paths.unsyncableReason, ENGLISH) ?? '', /profile/i)
})

test('Eden has no save states, so none are claimed', () => {
  // This lineage keeps states inside the profile data rather than in a tree of
  // its own; naming a directory would only invent one.
  const paths = edenPaths(edenMachine({ [ONE_PROFILE]: [] }))
  assert.equal(paths.states, null)
})

/**
 * shadPS4 keys its saves by the game's CUSA serial, which is stated in the
 * game's own `sce_sys/param.sfo` and conventionally repeated in the folder
 * name. `param.sfo` is binary, so the fake machine serves it through `heads`
 * exactly as the real one reads it.
 */
const SERIAL = 'CUSA12345'
const SAVEDATA = '/data/shadps4/savedata'

function shadPaths(env: SaveEnvironment, romPath = `/roms/ps4/${SERIAL}/eboot.bin`): SavePaths {
  return shadps4.saves(
    context({ romPath, system: 'ps4', paths: { saves: SAVEDATA }, env, dataDir: '/data' })
  )
}

test('shadPS4 resolves a save folder from the serial in the game metadata', () => {
  const env = machine({
    dirs: { [SAVEDATA]: ['1'], [`${SAVEDATA}/1`]: [SERIAL] },
    heads: { [`/roms/ps4/Game/sce_sys/param.sfo`]: `\x00PSF TITLE_ID ${SERIAL} APP_VER` }
  })
  const paths = shadPaths(env, '/roms/ps4/Game/eboot.bin')
  assert.equal(paths.saves?.dir, `${SAVEDATA}/1/${SERIAL}`)
  // The folder is the unit of save data, so it is synced whole.
  assert.equal(paths.saves?.match, 'directory')
  assert.equal(paths.states, null)
})

test('the user directory already holding this game wins over the first one', () => {
  const env = machine({
    dirs: { [SAVEDATA]: ['1', '2'], [`${SAVEDATA}/2`]: [SERIAL] },
    files: { [`${SAVEDATA}/2/${SERIAL}`]: '' }
  })
  assert.equal(shadPaths(env).saves?.dir, `${SAVEDATA}/2/${SERIAL}`)
})

test('a game never played resolves to the only user there is', () => {
  const env = machine({ dirs: { [SAVEDATA]: ['7'] } })
  assert.equal(shadPaths(env).saves?.dir, `${SAVEDATA}/7/${SERIAL}`)
})

test('a savedata directory the emulator spelled differently is still found', () => {
  // The folder is shadPS4's to create, so the one on disk wins over the one
  // the descriptor names — a difference of case would otherwise cost every
  // save on the system.
  const env = machine({ dirs: { '/data': ['shadPS4'], '/data/shadPS4/savedata': ['1'] } })
  assert.equal(shadPaths(env).saves?.dir, `/data/shadPS4/savedata/1/${SERIAL}`)
})

test('with no serial, nothing is synced rather than something wrong', () => {
  const env = machine({ dirs: { [SAVEDATA]: ['1'] } })
  const paths = shadPaths(env, '/roms/ps4/Some Game/eboot.bin')
  assert.equal(paths.saves, null)
  assert.match(localize(paths.unsyncableReason, ENGLISH) ?? '', /serial/i)
})

// ---------------------------------------------------------------------------
// Cores
// ---------------------------------------------------------------------------

/**
 * Which core a launch needs, and where it has to be put.
 *
 * The stakes are the same as for save paths and the failure is louder: a core
 * installed into a directory RetroArch does not search leaves `-L` resolving to
 * nothing, and RetroArch treats that as fatal before it opens a window — which
 * is indistinguishable from a crash from the outside.
 */

const RA_CONFIG = `${HOME}/.var/app/org.libretro.RetroArch/config`

function coreFor(
  system: string,
  cfg?: Record<string, string>
): ReturnType<NonNullable<EmulatorDescriptor['core']>> {
  const env = machine(
    cfg ? { files: { [`${RA_CONFIG}/retroarch/retroarch.cfg`]: retroArchCfg(cfg) } } : {}
  )
  return retroarch.core!(
    context({ romPath: '/roms/n64/game.z64', system, configDir: RA_CONFIG, env })
  )
}

test('the core a system needs is named from the system table', () => {
  const core = coreFor('n64')
  assert.equal(core?.id, 'mupen64plus_next')
  assert.equal(core?.fileName, 'mupen64plus_next_libretro.so')
  // The name the core reports for itself, which is what its Online Updater
  // entry and its save folder are both called.
  assert.equal(core?.name, 'Mupen64Plus-Next')
})

test('a system with no core mapped asks for nothing', () => {
  // The same condition `launch` returns null for. Promising an install here
  // would download nothing and then fail at the spawn anyway.
  assert.equal(coreFor('n64dd'), null)
})

test('the core goes where the config says cores are read from', () => {
  // `libretro_directory` is the directory RetroArch actually searches when it
  // is handed a bare core file name; anywhere else is an install that resolves
  // to nothing.
  const core = coreFor('n64', { libretro_directory: '/mnt/sd/cores' })
  assert.equal(core?.dir, '/mnt/sd/cores')
})

test('a ~ in the cores directory expands to the real home', () => {
  const core = coreFor('n64', { libretro_directory: '~/.config/retroarch/cores' })
  assert.equal(core?.dir, `${HOME}/.config/retroarch/cores`)
})

test('a RetroArch that has never written a config still has somewhere to install', () => {
  // First run of a fresh flatpak: no cfg exists yet, and the packaged default
  // is the only answer there is.
  assert.equal(coreFor('n64')?.dir, `${RA_CONFIG}/retroarch/cores`)
})

test('builds come from the buildbot RetroArch itself would update from', () => {
  // It writes the URL for the platform it is running on, which is the one
  // place the right architecture is already spelled out.
  const core = coreFor('n64', {
    core_updater_buildbot_cores_url: 'http://buildbot.libretro.com/nightly/linux/arm64/latest/'
  })
  assert.equal(core?.buildbotUrl, 'http://buildbot.libretro.com/nightly/linux/arm64/latest/')
})

test('a buildbot url missing its trailing slash is still appendable', () => {
  const core = coreFor('n64', {
    core_updater_buildbot_cores_url: 'https://example.test/cores'
  })
  assert.equal(core?.buildbotUrl, 'https://example.test/cores/')
})

test('no buildbot url in the config leaves the installer to supply one', () => {
  // Null rather than a guess: this module is loaded by the renderer, which has
  // no architecture to build a URL from.
  assert.equal(coreFor('n64')?.buildbotUrl, null)
})

test('the emulators that ship their own cores ask for none', () => {
  // RetroDECK and EmuDeck run libretro cores too, but both install them with
  // the distribution — there is never one missing for RomMix to fetch.
  for (const emulator of EMULATORS) {
    if (emulator.id === 'retroarch') continue
    assert.equal(emulator.core, undefined, `${emulator.id} declares a core to install`)
  }
})

// ---------------------------------------------------------------------------
// Every launcher EmuDeck offers
// ---------------------------------------------------------------------------

/**
 * EmuDeck arranges saves per emulator rather than per system, so its answer is
 * a table with one entry per launcher it can run — and a table is exactly the
 * thing that rots quietly. A launcher added without an entry falls through to
 * the generic shape, which for a memory-card emulator means RomMix uploading
 * one game's card as another game's save.
 *
 * So every launcher of every system is asked, rather than a chosen few.
 */
test('every EmuDeck launcher can say where its emulator keeps saves', () => {
  const library = '/home/deck/Emulation'
  let asked = 0

  for (const system of Object.keys(EMUDECK_LAUNCHERS)) {
    for (const launcher of EMUDECK_LAUNCHERS[system]) {
      const paths = resolve(emudeck, {
        romPath: `/home/deck/Emulation/roms/${system}/game.bin`,
        system,
        variant: launcher.id,
        paths: { home: library, saves: `${library}/saves`, roms: `${library}/roms` }
      })
      asked += 1

      assert.ok(paths, `${system}/${launcher.id} answered nothing`)
      // A save location that is not under the library is a path built from the
      // wrong root, which syncs a folder no emulator reads.
      for (const location of [paths.saves, paths.states]) {
        if (!location) continue
        assert.ok(
          location.dir.startsWith(library),
          `${system}/${launcher.id}: ${location.dir} is outside the library`
        )
      }
      // A location RomMix cannot sync per game has to say why, or the screen
      // reports "nothing to sync" and the user is left guessing.
      if (paths.unsyncableReason) {
        assert.notEqual(
          localize(paths.unsyncableReason, ENGLISH),
          '',
          `${system}/${launcher.id}: an unsyncable reason that reads as nothing`
        )
      }
    }
  }

  assert.ok(asked > 40, `only ${asked} launchers asked — the table has shrunk unexpectedly`)
})

test('a launcher that no longer exists answers nothing, not another emulator’s folders', () => {
  // `variant` is a recorded choice that outlives the launcher it names, and the
  // same rule `launch` follows applies here: a choice that has gone is not
  // quietly downgraded to the default, because answering with a different
  // emulator's folders is how a save ends up in the wrong place.
  const library = '/home/deck/Emulation'
  const where = {
    romPath: `${library}/roms/snes/game.sfc`,
    system: 'snes',
    paths: { home: library, saves: `${library}/saves`, roms: `${library}/roms` }
  }

  const gone = resolve(emudeck, { ...where, variant: 'no-such-launcher' })
  assert.equal(gone.saves, null)
  assert.equal(gone.states, null)

  // Absent is a different thing from unrecognised: nothing was ever chosen, so
  // EmuDeck's own default is the one that would run.
  const unchosen = resolve(emudeck, where)
  assert.deepEqual(unchosen, resolve(emudeck, { ...where, variant: EMUDECK_LAUNCHERS.snes[0].id }))
})

test('a system EmuDeck cannot run at all answers nothing rather than a wrong folder', () => {
  const paths = resolve(emudeck, {
    romPath: '/home/deck/Emulation/roms/nope/game.bin',
    system: 'not-a-system',
    paths: { home: '/home/deck/Emulation', saves: '/home/deck/Emulation/saves' }
  })

  assert.equal(paths.saves, null)
  assert.equal(paths.states, null)
})

test('EmuDeck with no save folder yet answers nothing rather than guessing one', () => {
  // Before its installer has run there is no Emulation folder, and a guessed
  // path would be a save sync into a directory nothing reads.
  const paths = resolve(emudeck, {
    romPath: '/roms/snes/game.sfc',
    system: 'snes',
    variant: EMUDECK_LAUNCHERS.snes[0].id,
    paths: { home: null, saves: null }
  })

  assert.equal(paths.saves, null)
  assert.equal(paths.states, null)
})

// ---------------------------------------------------------------------------
// Every component RetroDECK can hand a game to
// ---------------------------------------------------------------------------

/**
 * RetroDECK's answer is "wherever the component I chose puts them", and which
 * component that is comes out of the user's own ES-DE configuration. So the
 * table is indexed by component rather than by system, and the same risk
 * applies as for EmuDeck: a component with no entry falls through to the
 * libretro shape, which for a per-game-id emulator like PPSSPP means syncing a
 * folder that belongs to no game in particular.
 *
 * Each component is reached the way a real machine reaches it — through an
 * `<alternativeEmulator>` in the system's gamelist, which is the file ES-DE
 * writes and RetroDECK reads.
 */
const RETRODECK_COMPONENT_LABELS = [
  'pcsx2',
  'duckstation',
  'dolphin',
  'primehack',
  'ppsspp',
  'rpcs3',
  'vita3k',
  'azahar',
  'cemu',
  'xemu',
  'ruffle',
  'gzdoom',
  'solarus',
  'melonds',
  'mame',
  'xroar'
] as const

test('every RetroDECK component says where it keeps a game’s saves', () => {
  const home = '/home/deck/retrodeck'

  for (const label of RETRODECK_COMPONENT_LABELS) {
    const paths = resolve(retrodeck, {
      romPath: `${home}/roms/ps2/game.iso`,
      system: 'ps2',
      paths: {
        home,
        roms: `${home}/roms`,
        saves: `${home}/saves`,
        states: `${home}/states`
      },
      env: machine({
        files: {
          // ES-DE writes the system-wide override in a header before the
          // entries; `(Standalone)` is the suffix that separates a program
          // from a libretro core.
          [`${home}/ES-DE/gamelists/ps2/gamelist.xml`]:
            `<?xml version="1.0"?>\n<gameList>\n  <alternativeEmulator>` +
            `<label>${label} (Standalone)</label></alternativeEmulator>\n</gameList>`
        }
      })
    })

    assert.ok(paths, `${label} answered nothing`)
    // The component tags the save, not the frontend: a save written by
    // RetroDECK's PCSX2 is a PCSX2 save, and tagging it "retrodeck" would make
    // it unreadable to anyone running PCSX2 any other way.
    assert.equal(paths.emulator, label, `${label}: tagged as ${paths.emulator}`)

    for (const location of [paths.saves, paths.states]) {
      if (!location) continue
      assert.ok(
        location.dir.startsWith(home),
        `${label}: ${location.dir} is outside the RetroDECK tree`
      )
    }
    if (paths.unsyncableReason) {
      assert.notEqual(localize(paths.unsyncableReason, ENGLISH), '', `${label}: an empty reason`)
    }
  }
})

test('a component RetroDECK does not know is still a core, and tagged as one', () => {
  // An unrecognised label still means "a core", which is what the RetroArch
  // fallback already is — so the game stays syncable rather than going dark.
  const home = '/home/deck/retrodeck'
  const paths = resolve(retrodeck, {
    romPath: `${home}/roms/snes/game.sfc`,
    system: 'snes',
    paths: { home, roms: `${home}/roms`, saves: `${home}/saves`, states: `${home}/states` },
    env: machine({
      files: {
        [`${home}/ES-DE/gamelists/snes/gamelist.xml`]:
          '<gameList><alternativeEmulator><label>Something New</label>' +
          '</alternativeEmulator></gameList>'
      }
    })
  })

  assert.equal(paths.emulator, 'retroarch')
  assert.ok(paths.saves)
})

test('a per-game override beats the system-wide one', () => {
  // ES-DE writes the per-game choice inside the `<game>` block whose `<path>`
  // is `./<file name>`, and that is the one that ran the game.
  const home = '/home/deck/retrodeck'
  const gamelist =
    '<gameList>\n' +
    '<alternativeEmulator><label>duckstation (Standalone)</label></alternativeEmulator>\n' +
    '<game><path>./game.iso</path><altemulator>pcsx2 (Standalone)</altemulator></game>\n' +
    '</gameList>'

  const paths = resolve(retrodeck, {
    romPath: `${home}/roms/ps2/game.iso`,
    system: 'ps2',
    paths: { home, roms: `${home}/roms`, saves: `${home}/saves`, states: `${home}/states` },
    env: machine({ files: { [`${home}/ES-DE/gamelists/ps2/gamelist.xml`]: gamelist } })
  })

  assert.equal(paths.emulator, 'pcsx2')
})

test('RetroDECK with no library yet answers nothing rather than guessing', () => {
  const paths = resolve(retrodeck, {
    romPath: '/roms/ps2/game.iso',
    system: 'ps2',
    paths: { home: null, saves: null, states: null }
  })

  assert.equal(paths.saves, null)
})
