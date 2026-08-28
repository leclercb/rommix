import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EmulatorState } from '@config/emulators'
import { SHARED_LIBRARY, type InstalledRom, type RommRom } from '@shared/types'
import { DownloadManager } from './downloads.ts'
import { RommError, type RommClient } from './romm.ts'
import { Store } from './store.ts'

/**
 * Where a downloaded game goes, and what RomMix believes about the ones already
 * there.
 *
 * The two questions this file exists for are the ones that cannot be seen by
 * reading a screen. A game planned into the wrong folder is invisible to the
 * emulator's own scanner while looking perfectly downloaded in RomMix; a game
 * on disk that adoption fails to recognise is a full re-download of something
 * the user already has. Both are silent, and both are decided here.
 *
 * Downloads are driven with a client that writes bytes to the path it is given
 * rather than a real server — the transfer itself is `romm.test.ts`'s subject.
 * The root is redirected with `ROMMIX_HOME`, so nothing here touches the
 * RomMix folder of whoever is running the tests.
 */

const scratches: string[] = []
const realHome = process.env.ROMMIX_HOME

afterEach(() => {
  if (realHome === undefined) delete process.env.ROMMIX_HOME
  else process.env.ROMMIX_HOME = realHome
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-downloads-test-'))
  scratches.push(dir)
  return dir
}

function rom(fields: Partial<RommRom> = {}): RommRom {
  return {
    id: 1,
    name: 'Sonic the Hedgehog',
    fs_name: 'Sonic the Hedgehog (USA).md',
    fs_name_no_ext: 'Sonic the Hedgehog (USA)',
    fs_extension: 'md',
    fs_size_bytes: 512,
    platform_slug: 'genesis-slash-megadrive',
    platform_fs_slug: 'megadrive',
    platform_display_name: 'Sega Mega Drive',
    path_cover_small: null,
    path_cover_large: null,
    has_multiple_files: false,
    files: [{ file_name: 'Sonic the Hedgehog (USA).md' }],
    ...fields
  } as RommRom
}

function emulator(fields: Partial<EmulatorState> & { roms: string }): EmulatorState {
  const { roms, ...rest } = fields
  return {
    id: 'retrodeck',
    name: 'RetroDECK',
    available: true,
    install: null,
    configDir: null,
    dataDir: null,
    unavailableReason: null,
    paths: { home: roms, roms, saves: roms, states: roms, bios: roms },
    ...rest
  } as EmulatorState
}

/** A client that answers with the ROM it is handed and writes the bytes asked for. */
function fakeClient(options: { contents?: string; roms?: Record<number, RommRom> } = {}): {
  client: RommClient
  fetched: number[]
} {
  const fetched: number[] = []
  const client = {
    async rom(id: number) {
      fetched.push(id)
      const found = options.roms?.[id]
      if (!found) throw new RommError(`no ROM ${id}`)
      return found
    },
    async downloadRom(
      _rom: RommRom,
      destination: string,
      onProgress: (progress: { received: number; total: number }) => void
    ) {
      const contents = options.contents ?? 'rom bytes'
      await writeFile(destination, contents)
      onProgress({ received: contents.length, total: contents.length })
    }
  } as unknown as RommClient
  return { client, fetched }
}

/** A manager over a fresh root, with whichever emulator the test wants. */
function manager(options: { emulator?: EmulatorState | null; shared?: boolean } = {}): {
  downloads: DownloadManager
  store: Store
  root: string
  client: RommClient
} {
  const root = scratch()
  process.env.ROMMIX_HOME = root
  const store = new Store(join(root, 'config'))
  store.updateSettings({ romStorage: options.shared === false ? 'emulator' : 'rommix' })
  const { client } = fakeClient()
  const downloads = new DownloadManager(store, client, () => options.emulator ?? null)
  return { downloads, store, root, client }
}

function entry(fields: Partial<InstalledRom>): InstalledRom {
  return {
    romId: 1,
    path: '/roms/megadrive/sonic.md',
    launchPath: '/roms/megadrive/sonic.md',
    name: 'Sonic',
    coverPath: null,
    files: ['sonic.md'],
    system: 'genesis',
    platformName: 'Sega Mega Drive',
    fileName: 'sonic.md',
    sizeBytes: 512,
    installedAt: '2026-08-01T00:00:00.000Z',
    isDirectory: false,
    emulatorId: SHARED_LIBRARY,
    ...fields
  } as InstalledRom
}

describe('which copies still count', () => {
  test('with one shared folder, a copy installed for an emulator is not in it', () => {
    const { downloads, store } = manager()
    store.addInstalled(entry({ romId: 1, emulatorId: SHARED_LIBRARY }))
    store.addInstalled(entry({ romId: 2, emulatorId: 'retrodeck' }))

    assert.deepEqual(
      downloads.installed.map((item) => item.romId),
      [1]
    )
    assert.equal(downloads.installedNow(2), undefined)
  })

  test('with per-emulator folders, a copy for the emulator now in charge counts', () => {
    const { downloads, store } = manager({
      shared: false,
      emulator: emulator({ id: 'retrodeck', roms: '/retrodeck/roms' })
    })
    store.addInstalled(entry({ romId: 1, emulatorId: 'retrodeck' }))
    store.addInstalled(entry({ romId: 2, emulatorId: 'emudeck' }))
    store.addInstalled(entry({ romId: 3, emulatorId: SHARED_LIBRARY }))

    assert.deepEqual(
      downloads.installed.map((item) => item.romId),
      [1]
    )
  })

  test('an emulator that is simply not installed hides nothing', () => {
    const { downloads, store } = manager({ shared: false, emulator: null })
    store.addInstalled(entry({ romId: 2, emulatorId: 'emudeck' }))

    // Nothing runs the platform at the moment, so there is no better answer
    // than the copy that is there — an unplugged Steam Deck must not read as a
    // library that has been lost.
    assert.equal(downloads.isStale(store.installed[0]), false)
  })
})

describe('planning where a download goes', () => {
  test('a shared library is RomMix own tree, under the ES-DE system name', async () => {
    const { downloads, root } = manager()

    const item = downloads.enqueue(rom())

    assert.equal(item.system, 'genesis')
    assert.equal(item.targetPath, join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md'))
  })

  test('a platform RomMix cannot map is refused, and names the platform', () => {
    const { downloads } = manager()

    assert.throws(
      () => downloads.enqueue(rom({ platform_slug: 'invented', platform_fs_slug: 'invented' })),
      (cause: RommError) =>
        cause instanceof RommError && /Sega Mega Drive|invented/.test(cause.message)
    )
  })

  test('per-emulator storage with nothing installed refuses rather than guessing', () => {
    const { downloads } = manager({ shared: false, emulator: null })

    assert.throws(() => downloads.enqueue(rom()), RommError)
  })

  test('a multi-file game is planned as a directory of its own', () => {
    const { downloads, root } = manager()

    const item = downloads.enqueue(
      rom({
        has_multiple_files: true,
        fs_name: 'Final Fantasy VII',
        fs_name_no_ext: 'Final Fantasy VII',
        fs_extension: '',
        platform_slug: 'ps',
        platform_fs_slug: 'ps',
        files: [{ file_name: 'disc1.cue' }, { file_name: 'disc1.bin' }] as RommRom['files']
      })
    )

    assert.equal(item.targetPath, join(root, 'roms', 'psx', 'Final Fantasy VII'))
  })
})

describe('the queue', () => {
  test('asking twice for the same game does not queue it twice', () => {
    const { downloads } = manager()

    downloads.enqueue(rom())
    downloads.enqueue(rom())

    assert.equal(downloads.items.filter((item) => item.romId === 1).length, 1)
  })

  test('cancelling marks the item rather than dropping it off the screen', () => {
    const { downloads } = manager()
    downloads.enqueue(rom())

    downloads.cancel(1)

    assert.equal(downloads.items[0].state, 'cancelled')
  })

  test('clearing finished items leaves whatever is still moving', async () => {
    const { downloads } = manager()
    downloads.enqueue(rom())
    downloads.cancel(1)

    downloads.clearFinished()

    assert.deepEqual(downloads.items, [])
  })

  test('cancelling a game that was never queued does nothing at all', () => {
    const { downloads } = manager()

    downloads.cancel(404)

    assert.deepEqual(downloads.items, [])
  })
})

describe('a download that runs to the end', () => {
  test('the game lands in the index, at the path it was written to', async () => {
    const root = scratch()
    process.env.ROMMIX_HOME = root
    const store = new Store(join(root, 'config'))
    const { client } = fakeClient({ contents: '0123456789' })
    const downloads = new DownloadManager(store, client, () => null)

    const finished = new Promise<void>((resolve) => {
      downloads.on('update', (items: { state: string }[]) => {
        if (items.some((item) => item.state === 'done' || item.state === 'error')) resolve()
      })
    })
    downloads.enqueue(rom())
    await finished

    const installed = store.getInstalled(1)
    assert.ok(installed)
    assert.equal(installed.emulatorId, SHARED_LIBRARY)
    assert.equal(installed.system, 'genesis')
    assert.equal(installed.sizeBytes, 10)
    assert.equal(existsSync(installed.path), true)
  })
})

describe('adopting what is already on disk', () => {
  /** A ROM folder with these files in it, and a manager pointed at it. */
  function withFiles(files: string[], system = 'genesis'): ReturnType<typeof manager> {
    const made = manager()
    const dir = join(made.root, 'roms', system)
    mkdirSync(dir, { recursive: true })
    for (const name of files) writeFileSync(join(dir, name), '0'.repeat(32))
    return made
  }

  test('a file sitting where RomMix would have put it is taken as downloaded', async () => {
    const { downloads, store } = withFiles(['Sonic the Hedgehog (USA).md'])

    const adopted = await downloads.adopt([rom()])

    assert.equal(adopted.length, 1)
    assert.equal(store.getInstalled(1)?.sizeBytes, 32)
  })

  test('the same game under another extension is still the same game', async () => {
    // A Mega Drive dump renamed from .bin to .md by hand, which is routine.
    const { downloads, store } = withFiles(['Sonic the Hedgehog (USA).bin'])

    await downloads.adopt([rom()])

    assert.equal(store.getInstalled(1)?.fileName, 'Sonic the Hedgehog (USA).bin')
  })

  test('a directory named after the game is adopted as a multi-file game', async () => {
    const made = manager()
    const dir = join(made.root, 'roms', 'psx', 'Final Fantasy VII')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'disc1.cue'), 'FILE "disc1.bin" BINARY')
    writeFileSync(join(dir, 'disc1.bin'), '0'.repeat(64))

    await made.downloads.adopt([
      rom({
        id: 2,
        has_multiple_files: true,
        fs_name: 'Final Fantasy VII',
        fs_name_no_ext: 'Final Fantasy VII',
        fs_extension: '',
        platform_slug: 'ps',
        platform_fs_slug: 'ps',
        files: [{ file_name: 'disc1.cue' }, { file_name: 'disc1.bin' }] as RommRom['files']
      })
    ])

    const installed = made.store.getInstalled(2)
    assert.equal(installed?.isDirectory, true)
    // The descriptor, not the larger track beside it.
    assert.equal(installed?.launchPath, join(dir, 'disc1.cue'))
  })

  test('nothing on disk is adopted, and nothing is recorded', async () => {
    const { downloads, store } = manager()

    assert.deepEqual(await downloads.adopt([rom()]), [])
    assert.deepEqual(store.installed, [])
  })

  test('a platform with no folder mapping is passed over rather than throwing', async () => {
    const { downloads } = manager()

    assert.deepEqual(
      await downloads.adopt([rom({ platform_slug: 'invented', platform_fs_slug: 'invented' })]),
      []
    )
  })

  test('a game already known is not looked for again', async () => {
    const { downloads, store } = withFiles(['Sonic the Hedgehog (USA).md'])
    store.addInstalled(entry({ romId: 1 }))

    assert.deepEqual(await downloads.adopt([rom()]), [])
  })
})

describe('what an installed game is made of', () => {
  test('the sizes come off the disk, and a file that has gone is left out', async () => {
    const made = manager()
    const dir = join(made.root, 'roms', 'psx', 'Final Fantasy VII')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'disc1.cue'), '12345')
    made.store.addInstalled(
      entry({
        romId: 3,
        path: dir,
        isDirectory: true,
        files: ['disc1.cue', 'disc1.bin'],
        system: 'psx'
      })
    )

    assert.deepEqual(await made.downloads.localFiles(3), [{ name: 'disc1.cue', sizeBytes: 5 }])
  })

  test('a game that is not installed has no files', async () => {
    const { downloads } = manager()

    assert.deepEqual(await downloads.localFiles(99), [])
  })
})

describe('uninstalling', () => {
  test('a game loose in the system folder takes every one of its files with it', async () => {
    const made = manager()
    const dir = join(made.root, 'roms', 'switch')
    mkdirSync(dir, { recursive: true })
    for (const name of ['game.nsp', 'update.nsp', 'other-game.nsp']) {
      writeFileSync(join(dir, name), 'x')
    }
    made.store.addInstalled(
      entry({
        romId: 4,
        path: join(dir, 'game.nsp'),
        files: ['game.nsp', 'update.nsp'],
        system: 'switch'
      })
    )

    await made.downloads.uninstall(4)

    assert.equal(existsSync(join(dir, 'game.nsp')), false)
    assert.equal(existsSync(join(dir, 'update.nsp')), false)
    // Another game's file shares the folder and is none of this game's business.
    assert.equal(existsSync(join(dir, 'other-game.nsp')), true)
    assert.equal(made.store.getInstalled(4), undefined)
  })

  test('uninstalling something that is not in the index is not an error', async () => {
    const { downloads } = manager()

    await downloads.uninstall(404)
  })
})

describe('the file handed to an emulator', () => {
  test('a recorded launch file that has gone is chosen again from the disk', async () => {
    const made = manager()
    const dir = join(made.root, 'roms', 'psx', 'Final Fantasy VII')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'disc1.cue'), 'FILE "disc1.bin" BINARY')
    writeFileSync(join(dir, 'disc1.bin'), '0'.repeat(64))
    made.store.addInstalled(
      entry({
        romId: 5,
        path: dir,
        launchPath: join(dir, 'gone.m3u'),
        isDirectory: true,
        system: 'psx',
        files: ['disc1.cue', 'disc1.bin']
      })
    )

    assert.equal(
      await made.downloads.launchTarget(made.store.getInstalled(5)!),
      join(dir, 'disc1.cue')
    )
  })

  test('a launch file that is there is what is handed over', async () => {
    const made = manager()
    const dir = join(made.root, 'roms', 'genesis')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'sonic.md'), 'rom')
    const installed = entry({
      romId: 6,
      path: join(dir, 'sonic.md'),
      launchPath: join(dir, 'sonic.md')
    })

    assert.equal(await made.downloads.launchTarget(installed), join(dir, 'sonic.md'))
  })
})
