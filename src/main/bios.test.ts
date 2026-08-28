import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EmulatorState } from '@config/emulators'
import type { RommFirmware, RommPlatform } from '@shared/types'
import { BiosManager } from './bios.ts'
import type { RommClient } from './romm.ts'
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
  firmware?: RommFirmware[]
  onDownload?: (item: RommFirmware, destination: string) => Promise<void>
}): { bios: BiosManager; root: string; downloaded: string[] } {
  const root = scratch()
  process.env.ROMMIX_HOME = root
  const store = new Store(join(root, 'config'))
  const downloaded: string[] = []
  const client = {
    platforms: async () => [playstation],
    firmware: async () => options.firmware ?? [],
    downloadFirmware: async (item: RommFirmware, destination: string) => {
      downloaded.push(destination)
      await (options.onDownload?.(item, destination) ?? writeFile(destination, 'bios bytes'))
    }
  } as unknown as RommClient
  const bios = new BiosManager(store, client, () => options.emulator ?? null)
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
})
