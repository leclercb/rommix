import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EmulatorState } from '@config/emulators'
import { SHARED_LIBRARY, type DownloadItem, type InstalledRom, type RommRom } from '@shared/types'
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

/**
 * A client that answers with the ROM it is handed and writes the bytes asked
 * for.
 *
 * `breakAfter` writes that many bytes into the `.part` and then fails, which is
 * what an interrupted transfer leaves behind — the real client keeps the file
 * for the queue to decide about, and so does this.
 */
function fakeClient(
  options: {
    contents?: string
    roms?: Record<number, RommRom>
    breakAfter?: number
    /** What the server says about fetching this ROM in pieces. */
    ranges?: boolean
    /** Whether the server can serve the game's files one at a time. */
    perFile?: boolean
  } = {}
): {
  client: RommClient
  resumed: boolean[]
} {
  const resumed: boolean[] = []
  const client = {
    async supportsRange() {
      return options.ranges !== false
    },
    async fileTransfers() {
      return { available: options.perFile === true, resumable: options.ranges !== false }
    },
    async downloadRomFile(
      file: { file_name: string; file_size_bytes: number },
      destination: string,
      onProgress: (progress: { received: number; total: number }) => void,
      _signal: AbortSignal,
      opts: { resume?: boolean } = {}
    ) {
      resumed.push(opts.resume === true)
      // The break happens on the first file only, for the same reason the whole
      // -ROM fake breaks once: what is under test is what RomMix does next.
      if (options.breakAfter !== undefined && resumed.length === 1) {
        await writeFile(`${destination}.part`, '0'.repeat(options.breakAfter))
        throw new RommError('the transfer from RomM kept breaking off')
      }
      const contents = '0'.repeat(file.file_size_bytes)
      await rm(`${destination}.part`, { force: true })
      await writeFile(destination, contents)
      onProgress({ received: contents.length, total: contents.length })
    },
    async rom(id: number) {
      const found = options.roms?.[id]
      if (!found) throw new RommError(`no ROM ${id}`)
      return found
    },
    async roms() {
      const items = Object.values(options.roms ?? {})
      return { items, total: items.length, limit: 200, offset: 0 }
    },
    async downloadRom(
      _rom: RommRom,
      destination: string,
      onProgress: (progress: { received: number; total: number }) => void,
      _signal: AbortSignal,
      opts: { resume?: boolean } = {}
    ) {
      resumed.push(opts.resume === true)
      const contents = options.contents ?? 'rom bytes'
      // The break happens once, on the first attempt: what is being tested is
      // what RomMix does next, and a transfer that never succeeds could never
      // reach it.
      if (options.breakAfter !== undefined && resumed.length === 1) {
        await writeFile(`${destination}.part`, contents.slice(0, options.breakAfter))
        throw new RommError('the transfer from RomM kept breaking off')
      }
      // The real client renames the partial onto the ROM, so it is gone either
      // way once the transfer finishes.
      await rm(`${destination}.part`, { force: true })
      await writeFile(destination, contents)
      onProgress({ received: contents.length, total: contents.length })
    }
  } as unknown as RommClient
  return { client, resumed }
}

/** A manager over a fresh root, with whichever emulator the test wants. */
function manager(
  options: {
    emulator?: EmulatorState | null
    shared?: boolean
    contents?: string
    breakAfter?: number
    ranges?: boolean
    perFile?: boolean
    roms?: Record<number, RommRom>
  } = {}
): {
  downloads: DownloadManager
  store: Store
  root: string
  client: RommClient
  resumed: boolean[]
} {
  const root = scratch()
  process.env.ROMMIX_HOME = root
  const store = new Store(join(root, 'config'))
  store.updateSettings({ romStorage: options.shared === false ? 'emulator' : 'rommix' })
  const { client, resumed } = fakeClient(options)
  const downloads = new DownloadManager(store, client, () => options.emulator ?? null)
  return { downloads, store, root, client, resumed }
}

/** Run the queue until the item for this ROM stops moving. */
async function settled(downloads: DownloadManager, romId: number): Promise<DownloadItem> {
  for (let tick = 0; tick < 200; tick += 1) {
    const item = downloads.items.find((row) => row.romId === romId)
    if (item && item.state !== 'queued' && item.state !== 'downloading') return item
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`the download of ${romId} never settled`)
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

  test('a page of games is written and announced once, not once per game', async () => {
    const { downloads, store } = withFiles([
      'Sonic the Hedgehog (USA).md',
      'Streets of Rage (USA).md'
    ])
    // Every listener on `installed` is handed the whole index, and the index is
    // rewritten whole on every save. One of each for a page is the difference
    // between reconciling a restored library and rewriting it a thousand times.
    let announcements = 0
    downloads.on('installed', () => (announcements += 1))

    const adopted = await downloads.adopt([
      rom(),
      rom({
        id: 2,
        name: 'Streets of Rage',
        fs_name: 'Streets of Rage (USA).md',
        fs_name_no_ext: 'Streets of Rage (USA)',
        files: [{ file_name: 'Streets of Rage (USA).md' }] as RommRom['files']
      })
    ])

    assert.equal(adopted.length, 2)
    assert.equal(announcements, 1)
    assert.ok(store.getInstalled(1))
    assert.ok(store.getInstalled(2))
  })

  test('a folder read a moment ago is read again once RomMix has written to it', async () => {
    const made = manager({ contents: '0123456789' })
    const dir = join(made.root, 'roms', 'genesis')
    const streets = rom({
      id: 2,
      name: 'Streets of Rage',
      fs_name: 'Streets of Rage (USA).md',
      fs_name_no_ext: 'Streets of Rage (USA)',
      files: [{ file_name: 'Streets of Rage (USA).md' }] as RommRom['files']
    })

    // Nothing there yet, which is the answer that gets remembered.
    assert.deepEqual(await made.downloads.adopt([streets]), [])

    const finished = new Promise<void>((resolve) => {
      made.downloads.on('update', (items: { state: string }[]) => {
        if (items.some((item) => item.state === 'done' || item.state === 'error')) resolve()
      })
    })
    made.downloads.enqueue(rom())
    await finished
    writeFileSync(join(dir, 'Streets of Rage (USA).md'), '0'.repeat(32))

    // The download changed the folder, so the reading taken before it is not
    // the one this is answered from.
    assert.equal((await made.downloads.adopt([streets])).length, 1)
  })

  test('a ROM linked in from another library is the game it points at', async () => {
    const made = manager()
    const dir = join(made.root, 'roms', 'genesis')
    mkdirSync(dir, { recursive: true })
    // A library kept on another drive and linked into the emulator's folder,
    // which is how a shared collection is usually arranged.
    const elsewhere = join(made.root, 'elsewhere.md')
    writeFileSync(elsewhere, '0'.repeat(32))
    symlinkSync(elsewhere, join(dir, 'Sonic the Hedgehog (USA).md'))

    assert.equal((await made.downloads.adopt([rom()])).length, 1)
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

describe('a download that is interrupted', () => {
  test('what arrived is kept, and the row waits to be finished rather than failing', async () => {
    const { downloads, store, root } = manager({ contents: '0123456789', breakAfter: 4 })

    downloads.enqueue(rom())
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'paused')
    assert.equal(item.error, null)
    assert.equal(item.receivedBytes, 4)
    const partial = join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md.part')
    assert.equal(readFileSync(partial, 'utf8'), '0123')
    // Recorded, so a restart still knows whose bytes those are.
    assert.deepEqual(
      store.pending.map((row) => row.romId),
      [1]
    )
  })

  test('a transfer that never delivered anything is an error, not something to resume', async () => {
    const { downloads, store } = manager({ contents: '0123456789', breakAfter: 0 })

    downloads.enqueue(rom())
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'error')
    assert.ok(item.error)
    assert.deepEqual(store.pending, [])
  })

  test('asking for the game again continues it rather than starting over', async () => {
    const { downloads, store, resumed } = manager({ contents: '0123456789', breakAfter: 4 })
    downloads.enqueue(rom())
    await settled(downloads, 1)

    downloads.enqueue(rom())
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'done')
    assert.deepEqual(resumed, [false, true])
    // Finished, so there is nothing left to pick up.
    assert.deepEqual(store.pending, [])
    assert.ok(store.getInstalled(1))
  })

  test('a ROM the server has replaced since is fetched again, not appended to', async () => {
    const { downloads, store, resumed } = manager({ contents: '0123456789', breakAfter: 4 })
    downloads.enqueue(rom())
    await settled(downloads, 1)

    // A better dump, uploaded under the same id: a different file name, so the
    // bytes on disk are not this ROM's.
    downloads.enqueue(rom({ fs_name: 'Sonic the Hedgehog (USA) (Rev 1).md' }))
    await settled(downloads, 1)

    assert.deepEqual(resumed, [false, false])
    assert.deepEqual(store.pending, [])
  })

  test('the same ROM reported at a slightly different size is still the same ROM', async () => {
    const { downloads, resumed } = manager({ contents: '0123456789', breakAfter: 4 })
    downloads.enqueue(rom())
    await settled(downloads, 1)

    // RomM derives `fs_size_bytes` rather than storing it, and answers with a
    // figure a few hundred bytes different from one call to the next. Treating
    // that as a different file threw the partial away every time.
    downloads.enqueue(rom({ fs_size_bytes: 511 }))
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'done')
    assert.deepEqual(resumed, [false, true])
  })

  test('cancelling is what throws the part-downloaded file away', async () => {
    const { downloads, store, root } = manager({ contents: '0123456789', breakAfter: 4 })
    downloads.enqueue(rom())
    await settled(downloads, 1)

    await downloads.cancel(1)

    const partial = join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md.part')
    assert.equal(existsSync(partial), false)
    assert.deepEqual(store.pending, [])
    assert.equal(downloads.items[0].state, 'cancelled')
  })

  test('clearing the finished ones leaves it alone: it has not finished', async () => {
    const { downloads } = manager({ contents: '0123456789', breakAfter: 4 })
    downloads.enqueue(rom())
    await settled(downloads, 1)

    downloads.clearFinished()

    assert.deepEqual(
      downloads.items.map((item) => item.state),
      ['paused']
    )
  })
})

describe('after a restart', () => {
  test('an interrupted download is back in the list, at the size on disk', async () => {
    const { downloads, store, root } = manager({ contents: '0123456789', breakAfter: 4 })
    downloads.enqueue(rom())
    await settled(downloads, 1)

    // A second manager over the same root is what a restart looks like from
    // here: same files, same store, nothing in memory.
    const { client } = fakeClient()
    const next = new DownloadManager(store, client, () => null)
    await next.restorePending()

    const [item] = next.items
    assert.equal(item.state, 'paused')
    assert.equal(item.receivedBytes, 4)
    assert.equal(item.targetPath, join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md'))
  })

  test('a partial the user deleted by hand is forgotten rather than offered', async () => {
    const { downloads, store, root } = manager({ contents: '0123456789', breakAfter: 4 })
    downloads.enqueue(rom())
    await settled(downloads, 1)
    rmSync(join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md.part'))

    const { client } = fakeClient()
    const next = new DownloadManager(store, client, () => null)
    await next.restorePending()

    assert.deepEqual(next.items, [])
    assert.deepEqual(store.pending, [])
  })

  test('resuming after a restart continues the file rather than starting over', async () => {
    const { downloads, store } = manager({ contents: '0123456789', breakAfter: 4 })
    downloads.enqueue(rom())
    await settled(downloads, 1)

    // The restart: a new manager over the same root, told to pick up what was
    // left, then asked for the same game again.
    const { client, resumed } = fakeClient({ contents: '0123456789', roms: { 1: rom() } })
    const next = new DownloadManager(store, client, () => null)
    await next.restorePending()
    next.enqueue(rom())
    const item = await settled(next, 1)

    assert.equal(item.state, 'done')
    assert.deepEqual(resumed, [true])
  })

  test('a transfer RomMix was killed during is offered again, not lost', async () => {
    // No pause, no failure, no cleanup: the process simply stops, which is what
    // a desktop closing it or a machine losing power looks like. The bytes and
    // the record both have to be on disk already for this to survive.
    const root = scratch()
    process.env.ROMMIX_HOME = root
    const store = new Store(join(root, 'config'))
    const client = {
      async supportsRange() {
        return true
      },
      async fileTransfers() {
        return { available: false, resumable: true }
      },
      async rom() {
        return rom()
      },
      async downloadRom(_rom: RommRom, destination: string) {
        await writeFile(`${destination}.part`, '0123')
        await new Promise(() => undefined)
      }
    } as unknown as RommClient
    const killed = new DownloadManager(store, client, () => null)
    killed.enqueue(rom())
    await new Promise((resolve) => setTimeout(resolve, 20))

    const { client: next, resumed } = fakeClient({ contents: '0123456789', roms: { 1: rom() } })
    const restarted = new DownloadManager(store, next, () => null)
    await restarted.restorePending()

    const [restored] = restarted.items
    assert.equal(restored.state, 'paused')
    assert.equal(restored.receivedBytes, 4)

    restarted.enqueue(rom())
    assert.equal((await settled(restarted, 1)).state, 'done')
    assert.deepEqual(resumed, [true])
  })

  test('a game that finished after all is forgotten rather than offered again', async () => {
    // RomMix stopped between the last byte landing and the record being
    // cleared: the game is installed, and the record is the only thing left.
    const { downloads, store } = manager({ contents: '0123456789' })
    downloads.enqueue(rom())
    await settled(downloads, 1)
    store.setPending({
      romId: 1,
      name: 'Sonic the Hedgehog',
      coverPath: null,
      system: 'genesis',
      platformName: 'Sega Mega Drive',
      targetPath: store.getInstalled(1)!.path,
      files: [],
      ownsFolder: false,
      fileName: 'Sonic the Hedgehog (USA).md',
      totalBytes: 10,
      pausedAt: '2026-08-28T00:00:00.000Z'
    })

    const { client } = fakeClient()
    const next = new DownloadManager(store, client, () => null)
    await next.restorePending()

    assert.deepEqual(next.items, [])
    assert.deepEqual(store.pending, [])
  })

  test('restoring twice does not put the same transfer in the list twice', async () => {
    const { downloads, store } = manager({ contents: '0123456789', breakAfter: 4 })
    downloads.enqueue(rom())
    await settled(downloads, 1)

    const { client } = fakeClient()
    const next = new DownloadManager(store, client, () => null)
    await next.restorePending()
    await next.restorePending()

    assert.equal(next.items.length, 1)
  })
})

describe('pausing on purpose', () => {
  test('a transfer stopped by the user keeps what it had, and is not an error', async () => {
    // The client waits to be aborted rather than finishing, which is what a
    // transfer in progress looks like at the moment the button is pressed.
    const root = scratch()
    process.env.ROMMIX_HOME = root
    const store = new Store(join(root, 'config'))
    const client = {
      async supportsRange() {
        return true
      },
      async fileTransfers() {
        return { available: false, resumable: true }
      },
      async rom(id: number) {
        throw new RommError(`no ROM ${id}`)
      },
      async downloadRom(
        _rom: RommRom,
        destination: string,
        onProgress: (progress: { received: number; total: number }) => void,
        signal: AbortSignal
      ) {
        await writeFile(`${destination}.part`, '0123')
        onProgress({ received: 4, total: 10 })
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new RommError('aborted')), { once: true })
        })
      }
    } as unknown as RommClient
    const downloads = new DownloadManager(store, client, () => null)

    downloads.enqueue(rom())
    await new Promise((resolve) => setTimeout(resolve, 20))
    downloads.pause(1)
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'paused')
    assert.equal(item.error, null)
    assert.equal(item.receivedBytes, 4)
    assert.equal(
      readFileSync(join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md.part'), 'utf8'),
      '0123'
    )
    assert.deepEqual(
      store.pending.map((row) => row.romId),
      [1]
    )
  })

  test('a transfer still waiting its turn pauses without ever starting', async () => {
    const root = scratch()
    process.env.ROMMIX_HOME = root
    const store = new Store(join(root, 'config'))
    const second = rom({ id: 2, fs_name: 'Streets of Rage (USA).md' })
    // The first transfer never finishes, so the second stays queued behind it —
    // which is the state this is about.
    const client = {
      async supportsRange() {
        return true
      },
      async fileTransfers() {
        return { available: false, resumable: true }
      },
      async rom() {
        return second
      },
      async downloadRom() {
        await new Promise(() => undefined)
      }
    } as unknown as RommClient
    const downloads = new DownloadManager(store, client, () => null)
    downloads.enqueue(rom())
    downloads.enqueue(second)

    downloads.pause(2)

    const queuedItem = downloads.items.find((item) => item.romId === 2)
    assert.equal(queuedItem?.state, 'paused')
    assert.equal(queuedItem?.receivedBytes, 0)
    // Nothing arrived, so there is nothing to remember between runs.
    assert.deepEqual(store.pending, [])
  })

  test('pausing something that is not moving does nothing at all', async () => {
    const { downloads } = manager({ contents: '0123456789' })
    downloads.enqueue(rom())
    await settled(downloads, 1)

    downloads.pause(1)
    downloads.pause(404)

    assert.equal(downloads.items[0].state, 'done')
  })
})

describe('a ROM the server cannot send in pieces', () => {
  test('what arrived is thrown away rather than offered as resumable', async () => {
    // RomM zips a multi-file game for each request, so there is no file to
    // seek into and nothing a second attempt could carry on from.
    const { downloads, store, root } = manager({
      contents: '0123456789',
      breakAfter: 4,
      ranges: false
    })

    downloads.enqueue(rom())
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'error')
    assert.equal(item.resumable, false)
    assert.equal(
      existsSync(join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md.part')),
      false
    )
    assert.deepEqual(store.pending, [])
  })

  test('one that arrives whole is recorded like any other', async () => {
    const { downloads, store } = manager({ contents: '0123456789', ranges: false })

    downloads.enqueue(rom())
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'done')
    assert.ok(store.getInstalled(1))
  })
})

describe('a game fetched one file at a time', () => {
  /** A game of three files, as RomM describes one. */
  function multi(): RommRom {
    return rom({
      id: 2,
      name: 'Castlevania: Symphony of the Night',
      fs_name: 'Castlevania - Symphony of the Night (Europe)',
      fs_name_no_ext: 'Castlevania - Symphony of the Night (Europe)',
      fs_extension: '',
      has_multiple_files: true,
      platform_slug: 'ps',
      platform_fs_slug: 'ps',
      files: [
        { id: 1, rom_id: 2, file_name: 'disc (Track 1).bin', file_size_bytes: 64 },
        { id: 2, rom_id: 2, file_name: 'disc (Track 2).bin', file_size_bytes: 32 },
        { id: 3, rom_id: 2, file_name: 'disc.cue', file_size_bytes: 8 }
      ] as RommRom['files']
    })
  }

  test('the files land in the game folder, with nothing to unpack', async () => {
    const { downloads, store, root } = manager({ perFile: true })

    downloads.enqueue(multi())
    const item = await settled(downloads, 2)

    assert.equal(item.state, 'done')
    const dir = join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)')
    assert.deepEqual((await readdir(dir)).sort(), [
      'disc (Track 1).bin',
      'disc (Track 2).bin',
      'disc.cue'
    ])
    const installed = store.getInstalled(2)
    assert.equal(installed?.isDirectory, true)
    // The descriptor, not the largest track.
    assert.equal(installed?.launchPath, join(dir, 'disc.cue'))
    assert.equal(installed?.sizeBytes, 104)
  })

  test('progress counts every file, not each one from zero', async () => {
    const { downloads } = manager({ perFile: true })
    const seen: number[] = []
    downloads.on('update', (items: DownloadItem[]) => {
      const row = items.find((item) => item.romId === 2)
      if (row) seen.push(row.receivedBytes)
    })

    downloads.enqueue(multi())
    await settled(downloads, 2)

    // Never goes backwards, and ends at the sum of the three.
    assert.deepEqual(
      [...seen].sort((a, b) => a - b),
      seen
    )
    assert.equal(seen.at(-1), 104)
  })

  test('the row names the file that is arriving, and stops when none is', async () => {
    const { downloads } = manager({ perFile: true })
    const named: (string | undefined)[] = []
    downloads.on('update', (items: DownloadItem[]) => {
      const row = items.find((item) => item.romId === 2)
      if (row) named.push(row.currentFile)
    })

    downloads.enqueue(multi())
    const item = await settled(downloads, 2)

    assert.deepEqual(
      [...new Set(named.filter(Boolean))],
      ['disc (Track 1).bin', 'disc (Track 2).bin', 'disc.cue']
    )
    // Nothing is arriving once it is installed.
    assert.equal(item.currentFile, undefined)
  })

  test('a transfer that stops naming no file at all', async () => {
    const { downloads } = manager({ perFile: true, breakAfter: 4 })

    downloads.enqueue(multi())
    const item = await settled(downloads, 2)

    assert.equal(item.state, 'paused')
    // The row would otherwise go on claiming a track is arriving, including
    // after a restart, where the record it is rebuilt from never knew of one.
    assert.equal(item.currentFile, undefined)
  })

  test('a file already there in full is not fetched twice', async () => {
    const { downloads, store, root, resumed } = manager({ perFile: true })
    const dir = join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'disc (Track 1).bin'), '0'.repeat(64))
    // The record is what says those bytes are this game's.
    store.setPending({
      romId: 2,
      name: 'Castlevania: Symphony of the Night',
      coverPath: null,
      system: 'psx',
      platformName: 'Sony PlayStation',
      targetPath: dir,
      files: ['disc (Track 1).bin', 'disc (Track 2).bin', 'disc.cue'],
      ownsFolder: true,
      fileName: 'Castlevania - Symphony of the Night (Europe)',
      totalBytes: 104,
      pausedAt: '2026-08-28T00:00:00.000Z'
    })

    downloads.enqueue(multi())
    await settled(downloads, 2)

    // Two fetched, the third left alone.
    assert.equal(resumed.length, 2)
  })

  test('a game part-way through is not adopted as one already installed', async () => {
    const { downloads, store, root } = manager({ perFile: true })
    const dir = join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'disc (Track 1).bin'), '0'.repeat(64))
    store.setPending({
      romId: 2,
      name: 'Castlevania: Symphony of the Night',
      coverPath: null,
      system: 'psx',
      platformName: 'Sony PlayStation',
      targetPath: dir,
      files: ['disc (Track 1).bin'],
      ownsFolder: true,
      fileName: 'Castlevania - Symphony of the Night (Europe)',
      totalBytes: 104,
      pausedAt: '2026-08-28T00:00:00.000Z'
    })

    assert.deepEqual(await downloads.adopt([multi()]), [])
    assert.equal(store.getInstalled(2), undefined)
  })

  test('cancelling takes the folder as well as the files in it', async () => {
    const { downloads, store, root } = manager({ perFile: true, breakAfter: 4 })
    downloads.enqueue(multi())
    await settled(downloads, 2)
    const dir = join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)')
    assert.equal(existsSync(dir), true)

    await downloads.cancel(2)

    // An empty directory named after a game is what `adopt` reads as a
    // multi-file game already on disk.
    assert.equal(existsSync(dir), false)
    assert.deepEqual(store.pending, [])
  })

  test('a folder left empty is noticed by a sync, and not adopted again', async () => {
    // The state a cancelled transfer used to leave behind: an index entry, and
    // a folder with nothing in it. Both halves have to be settled — dropping
    // the entry alone would let the next pass adopt the folder straight back.
    const multiRom = multi()
    const { downloads, store, root } = manager({ perFile: true, roms: { 2: multiRom } })
    const dir = join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)')
    mkdirSync(dir, { recursive: true })
    store.addInstalled({
      romId: 2,
      path: dir,
      launchPath: dir,
      name: 'Castlevania: Symphony of the Night',
      coverPath: null,
      files: [],
      system: 'psx',
      platformName: 'Sony PlayStation',
      fileName: 'Castlevania - Symphony of the Night (Europe)',
      sizeBytes: 0,
      installedAt: '2026-08-28T00:00:00.000Z',
      isDirectory: true,
      emulatorId: SHARED_LIBRARY
    })

    const result = await downloads.sync()

    assert.equal(result.removed, 1)
    assert.equal(result.adopted, 0)
    assert.equal(store.getInstalled(2), undefined)
    // Nothing was deleted: the folder is the user's to keep or clear out.
    assert.equal(existsSync(dir), true)
  })

  test('an empty folder left by something else is not adopted as a game', async () => {
    const { downloads, store, root } = manager({ perFile: true })
    mkdirSync(join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)'), {
      recursive: true
    })

    assert.deepEqual(await downloads.adopt([multi()]), [])
    assert.equal(store.getInstalled(2), undefined)
  })

  test('cancelling a game filed loose takes its files and leaves the folder', async () => {
    // A flat library: the game's files sit in the system folder beside every
    // other game on the platform, so the folder is nobody's to delete.
    const { downloads, store, root } = manager({ perFile: true })
    const dir = join(root, 'roms', 'switch')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'game.nsp'), '0'.repeat(64))
    writeFileSync(join(dir, 'someone-elses.nsp'), 'x')
    store.setPending({
      romId: 2,
      name: 'A Switch game',
      coverPath: null,
      system: 'switch',
      platformName: 'Nintendo Switch',
      targetPath: dir,
      files: ['game.nsp', 'update.nsp'],
      ownsFolder: false,
      fileName: 'A Switch game',
      totalBytes: 104,
      pausedAt: '2026-08-28T00:00:00.000Z'
    })
    await downloads.restorePending()

    await downloads.cancel(2)

    assert.equal(existsSync(join(dir, 'game.nsp')), false)
    assert.equal(existsSync(join(dir, 'someone-elses.nsp')), true)
    assert.equal(existsSync(dir), true)
    assert.deepEqual(store.pending, [])
  })
})
