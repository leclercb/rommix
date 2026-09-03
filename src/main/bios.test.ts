import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EmulatorState } from '@config/emulators'
import type { RommFirmware, RommPlatform } from '@shared/types'
import { BiosManager } from './bios.ts'
import { OfflineCache } from './offline.ts'
import { RommError, UnreachableError, type RommClient } from './romm/index.ts'
import { rootPaths } from './root.ts'
import { Store } from './store.ts'

/**
 * What each platform still needs before its games will start, and where each
 * file goes.
 *
 * A missing BIOS is the most common reason an emulator refuses a game, and it
 * refuses in its own words — a black screen, or a message about a core that
 * failed to load, neither of which mentions firmware. So this screen has to be
 * right about two things: whether a file is already in place, which depends on
 * looking in the folder that file actually goes to, and whether RomMix can put
 * it there at all.
 */

const scratches: string[] = []
const realHome = process.env.ROMMIX_HOME

afterEach(() => {
  if (realHome === undefined) delete process.env.ROMMIX_HOME
  else process.env.ROMMIX_HOME = realHome
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-bios-test-'))
  scratches.push(dir)
  return dir
}

const playstation: RommPlatform = {
  id: 3,
  slug: 'ps',
  fs_slug: 'ps',
  display_name: 'PlayStation',
  name: 'PlayStation',
  rom_count: 10
} as RommPlatform

/** A console needing a file nobody has: the top of the order. */
const atari7800: RommPlatform = {
  id: 4,
  slug: 'atari-7800',
  fs_slug: 'atari7800',
  display_name: 'Atari 7800',
  name: 'Atari 7800',
  rom_count: 2
} as RommPlatform

/** One whose only file is optional, and present. */
const atarilynx: RommPlatform = {
  id: 5,
  slug: 'atari-lynx',
  fs_slug: 'atarilynx',
  display_name: 'Atari Lynx',
  name: 'Atari Lynx',
  rom_count: 2
} as RommPlatform

/** One that needs no BIOS at all, and belongs at the bottom. */
const megadrive: RommPlatform = {
  id: 6,
  slug: 'genesis',
  fs_slug: 'genesis',
  display_name: 'Sega Mega Drive',
  name: 'Sega Mega Drive',
  rom_count: 2
} as RommPlatform

function firmware(fields: Partial<RommFirmware> = {}): RommFirmware {
  return {
    id: 1,
    file_name: 'scph5501.bin',
    file_size_bytes: 512,
    is_verified: true,
    ...fields
  } as RommFirmware
}

/** A manager over a fresh root, with the emulator and server answers a test wants. */
function manager(options: {
  emulator?: EmulatorState | null
  platforms?: RommPlatform[]
  firmware?: RommFirmware[]
  /** Thrown instead of answering, for the tests about a server that will not. */
  refuse?: { platforms?: unknown; firmware?: unknown }
  onDownload?: (item: RommFirmware, destination: string) => Promise<void>
  /**
   * An existing root to open, so a second manager can read what the first one
   * saved. A fresh one otherwise.
   */
  root?: string
}): { bios: BiosManager; root: string; downloaded: string[] } {
  const root = options.root ?? scratch()
  process.env.ROMMIX_HOME = root
  const store = new Store(join(root, 'config'))
  const downloaded: string[] = []
  const client = {
    platforms: async () => {
      if (options.refuse?.platforms) throw options.refuse.platforms
      return options.platforms ?? [playstation]
    },
    firmware: async () => {
      if (options.refuse?.firmware) throw options.refuse.firmware
      return options.firmware ?? []
    },
    downloadFirmware: async (item: RommFirmware, destination: string) => {
      downloaded.push(destination)
      await (options.onDownload?.(item, destination) ?? writeFile(destination, 'bios bytes'))
    }
  } as unknown as RommClient
  // Real rather than stubbed: it writes into the throwaway root, and what the
  // screen falls back to when the server is gone is worth exercising here
  // rather than being the one path nothing runs.
  const offline = new OfflineCache(rootPaths().offline, client)
  const bios = new BiosManager(store, client, offline, () => options.emulator ?? null)
  return { bios, root, downloaded }
}

/** An emulator with a BIOS folder of its own, on disk. */
function withBiosFolder(files: string[] = []): EmulatorState {
  const dir = scratch()
  for (const name of files) writeFileSync(join(dir, name), 'x')
  return {
    id: 'retroarch',
    name: 'RetroArch',
    available: true,
    install: null,
    configDir: null,
    dataDir: null,
    unavailableReason: null,
    paths: { home: dir, roms: dir, saves: dir, states: dir, bios: dir }
  } as EmulatorState
}

describe('reporting on one platform', () => {
  test('a file the system needs is named even when the server does not hold it', async () => {
    const { bios } = manager({ emulator: withBiosFolder() })

    const row = await bios.platformReport(3)

    assert.ok(row)
    assert.equal(row.system, 'psx')
    const required = row.items.find((item) => item.fileName === 'scph5501.bin')
    assert.ok(required, 'PlayStation is known to need scph5501.bin')
    assert.equal(required.required, true)
    assert.equal(required.installed, false)
    // Nothing to fetch: the file is named because the system needs it, not
    // because the server has it.
    assert.equal(required.firmwareId, null)
  })

  test('a file already in the emulator folder is reported as installed', async () => {
    const { bios } = manager({
      emulator: withBiosFolder(['scph5501.bin']),
      firmware: [firmware()]
    })

    const row = await bios.platformReport(3)

    const item = row?.items.find((entry) => entry.fileName === 'scph5501.bin')
    assert.equal(item?.installed, true)
    assert.equal(item?.firmwareId, 1)
    assert.equal(item?.verified, true)
  })

  test('a file in a per-emulator subfolder is not installed a second time', async () => {
    const emulator = withBiosFolder()
    mkdirSync(join(emulator.paths.bios ?? '', 'dc'), { recursive: true })
    writeFileSync(join(emulator.paths.bios ?? '', 'dc', 'scph5501.bin'), 'x')
    const { bios } = manager({ emulator, firmware: [firmware()] })

    const row = await bios.platformReport(3)

    assert.equal(row?.items.find((item) => item.fileName === 'scph5501.bin')?.installed, true)
  })

  test('with no emulator for the platform the row says why, rather than looking fine', async () => {
    const { bios } = manager({ emulator: null, firmware: [firmware()] })

    const row = await bios.platformReport(3)

    assert.ok(row?.blockedReason)
    assert.equal(row?.emulatorId, null)
    assert.equal(
      row?.items.every((item) => item.dir === null),
      true
    )
  })

  test('a platform the server does not have is nothing to report, not a failure', async () => {
    const { bios } = manager({ emulator: withBiosFolder() })

    assert.equal(await bios.platformReport(999), null)
  })
})

describe('the whole report', () => {
  test('platforms that need something come before the ones that do not', async () => {
    const { bios } = manager({ emulator: withBiosFolder(), firmware: [firmware()] })

    const report = await bios.report()

    assert.equal(report.platforms[0].platformId, 3)
  })

  test('the whole order, because a server with forty platforms buries the point', async () => {
    // Missing something required, then missing something optional, then
    // complete, then consoles that need no BIOS at all.
    const emulator = withBiosFolder(['7800 BIOS (U).rom', 'lynxboot.img'])
    const { bios } = manager({
      emulator,
      platforms: [megadrive, atari7800, atarilynx, playstation]
    })

    const report = await bios.report()

    assert.deepEqual(
      report.platforms.map((platform) => platform.platformSlug),
      ['ps', 'atari-7800', 'atari-lynx', 'genesis']
    )
  })
})

describe('installing a file', () => {
  test('it is fetched into the folder the emulator reads firmware from', async () => {
    const emulator = withBiosFolder()
    const { bios, downloaded } = manager({ emulator, firmware: [firmware()] })

    const path = await bios.install(1)

    assert.equal(path, join(emulator.paths.bios ?? '', 'scph5501.bin'))
    assert.deepEqual(downloaded, [path])
    assert.equal(existsSync(path), true)
  })

  test('installing everything a platform needs reports what it managed', async () => {
    const emulator = withBiosFolder()
    const { bios } = manager({
      emulator,
      firmware: [firmware({ id: 1 }), firmware({ id: 2, file_name: 'scph1001.bin' })]
    })

    const result = await bios.syncAll(3)

    assert.equal(result.installed, 2)
    assert.equal(result.failed, 0)
    assert.equal(existsSync(join(emulator.paths.bios ?? '', 'scph1001.bin')), true)
  })

  test('one file that will not download does not stop the rest', async () => {
    const emulator = withBiosFolder()
    const { bios } = manager({
      emulator,
      firmware: [firmware({ id: 1 }), firmware({ id: 2, file_name: 'scph1001.bin' })],
      onDownload: async (item, destination) => {
        if (item.id === 1) throw new Error('the server gave up')
        await writeFile(destination, 'bios bytes')
      }
    })

    const result = await bios.syncAll(3)

    assert.equal(result.installed, 1)
    assert.equal(result.failed, 1)
  })

  test('a firmware id the server never listed cannot be installed', async () => {
    const { bios } = manager({ emulator: withBiosFolder(), firmware: [firmware()] })

    await assert.rejects(() => bios.install(404))
  })

  test("a file with nowhere to go fails with the row's own reason", async () => {
    // "Cannot install" explains nothing. The row already says why — no
    // emulator runs this platform — and that is the sentence worth repeating.
    const { bios } = manager({ emulator: null, firmware: [firmware()] })

    await assert.rejects(() => bios.install(1), /PlayStation/)
  })
})

/** Eden, whose keys folder takes `.keys` files and nothing else. */
function eden(): EmulatorState {
  const dir = scratch()
  return {
    id: 'eden',
    name: 'Eden',
    available: true,
    install: null,
    configDir: null,
    dataDir: null,
    unavailableReason: null,
    paths: { home: dir, roms: dir, saves: dir, states: dir, bios: dir }
  } as EmulatorState
}

const nintendoSwitch: RommPlatform = {
  id: 9,
  slug: 'switch',
  fs_slug: 'switch',
  display_name: 'Nintendo Switch',
  name: 'Nintendo Switch',
  rom_count: 4
} as RommPlatform

describe('a server that will not answer', () => {
  test('the last live answer stands in, so the screen still says what is missing', async () => {
    // The report is the only place a person finds out a console needs a file
    // it has not got, and being out of range is when they are most likely to
    // be looking — the game would not start a moment ago.
    const online = manager({ emulator: withBiosFolder(), firmware: [firmware()] })
    await online.bios.report()
    const root = online.root

    const offline = manager({
      emulator: withBiosFolder(),
      root,
      refuse: { platforms: new UnreachableError('the network went away') }
    })
    const report = await offline.bios.report()

    const row = report.platforms.find((platform) => platform.platformId === 3)
    assert.equal(row?.items.find((item) => item.fileName === 'scph5501.bin')?.firmwareId, 1)
  })

  test('nothing saved and nothing answering is the failure it is', async () => {
    const { bios } = manager({
      emulator: withBiosFolder(),
      refuse: { platforms: new UnreachableError('the network went away') }
    })

    await assert.rejects(() => bios.report())
  })

  test('a refusal is never papered over with last week', async () => {
    // A token missing `platforms.read` would otherwise draw a screen from the
    // saved copy with nothing to say why — and the only thing that fixes those
    // credentials is being told about them.
    const online = manager({ emulator: withBiosFolder(), firmware: [firmware()] })
    await online.bios.report()
    const root = online.root

    const refused = manager({
      emulator: withBiosFolder(),
      root,
      refuse: { platforms: new RommError('no', 403) }
    })

    await assert.rejects(() => refused.bios.report(), /no/)
  })

  test('a firmware list refused for one platform fails the whole scan', async () => {
    // The misleading alternative is every file drawn as missing and absent
    // from the server, when the server was simply never asked successfully.
    const { bios } = manager({
      emulator: withBiosFolder(),
      refuse: { firmware: new RommError('no firmware.read scope', 403) }
    })

    await assert.rejects(() => bios.report())
  })

  test('one game page falls back the same way, and reports a refusal the same way', async () => {
    const online = manager({ emulator: withBiosFolder(), firmware: [firmware()] })
    await online.bios.report()
    const root = online.root

    const offline = manager({
      emulator: withBiosFolder(),
      root,
      refuse: { platforms: new UnreachableError('the network went away') }
    })
    const row = await offline.bios.platformReport(3)
    assert.equal(
      row?.items.some((item) => item.fileName === 'scph5501.bin'),
      true
    )

    const refused = manager({
      emulator: withBiosFolder(),
      root,
      refuse: { platforms: new RommError('no', 401) }
    })
    await assert.rejects(() => refused.bios.platformReport(3))
  })

  test('with nothing saved, one game page says nothing rather than failing a launch', async () => {
    const { bios } = manager({
      emulator: withBiosFolder(),
      refuse: { platforms: new UnreachableError('the network went away') }
    })

    assert.equal(await bios.platformReport(3), null)
  })
})

describe("taking the server's half in the background", () => {
  test('capture saves what a later outage will be described from', async () => {
    // The device that has never opened this screen is the one it fails on: the
    // first time anybody notices is the first time RomM is out of range.
    const online = manager({ emulator: withBiosFolder(), firmware: [firmware()] })
    await online.bios.capture()
    const root = online.root

    const offline = manager({
      emulator: withBiosFolder(),
      root,
      refuse: { platforms: new UnreachableError('the network went away') }
    })
    const report = await offline.bios.report()

    assert.equal(
      report.platforms.some((platform) => platform.platformId === 3),
      true
    )
  })
})

describe('a file the emulator cannot be given', () => {
  test("it is staged in RomMix's own folder, and the row says so", async () => {
    // Eden takes `.keys` into its keys folder and nothing else — its firmware
    // is installed through its own interface. A row that pointed the download
    // at the keys folder anyway would write a file Eden never reads.
    const { bios, root } = manager({
      emulator: eden(),
      platforms: [nintendoSwitch],
      firmware: [firmware({ id: 7, file_name: 'firmware.zip' })]
    })

    const row = await bios.platformReport(9)

    const keys = row?.items.find((item) => item.fileName === 'prod.keys')
    const staged = row?.items.find((item) => item.fileName === 'firmware.zip')
    assert.equal(keys?.staged, false)
    assert.equal(staged?.staged, true)
    assert.equal(staged?.dir, join(root, 'bios', 'switch'))
    // Said once for the row rather than per file: what to do about a staged
    // file is the same answer whichever one it is.
    assert.notEqual(row?.stagingNote, null)
  })

  test('installing a staged file writes it where the row said it would', async () => {
    const { bios, root } = manager({
      emulator: eden(),
      platforms: [nintendoSwitch],
      firmware: [firmware({ id: 7, file_name: 'firmware.zip' })]
    })

    const path = await bios.install(7)

    assert.equal(path, join(root, 'bios', 'switch', 'firmware.zip'))
    assert.equal(existsSync(path), true)
  })
})

describe('a name from the server that is not a name', () => {
  test('one that climbs out of its folder is refused rather than followed', async () => {
    const { bios, downloaded } = manager({
      emulator: withBiosFolder(),
      firmware: [firmware({ id: 5, file_name: '../../../etc/rommix-owned' })]
    })

    await assert.rejects(() => bios.install(5))
    assert.deepEqual(downloaded, [])
  })
})
