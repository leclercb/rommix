/**
 * What RomMix believes is on this disk, and whether the disk agrees.
 *
 * Every one of these is a question that has no error to report when it is
 * answered wrongly. A game adopted that is not really there is a Play button
 * over nothing; a game missed is one the user is asked to download again; an
 * entry left standing for an emulator that no longer runs the platform is a
 * launch against a ROM outside the library it is being launched from.
 *
 * The transfer queue is `downloads.test.ts`. The two share a fixture and
 * nothing else.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { EmulatorState } from '@config/emulators'
import { SHARED_LIBRARY, type InstalledRom, type RommRom } from '@shared/types'
import { DownloadManager } from './downloads.ts'
import { Library } from './library.ts'
import { OfflineCache } from './offline.ts'
import { CorruptDownloadError, RommError, type RommClient } from './romm.ts'
import { rootPaths } from './root.ts'
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
    /**
     * The file, counted from one, that fails its hash check.
     *
     * What `RommClient.verify` does: the part-file is deleted and the transfer
     * throws, leaving whatever landed before it in place.
     */
    corruptFile?: number
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
      if (options.corruptFile === resumed.length) {
        await rm(`${destination}.part`, { force: true })
        throw new CorruptDownloadError('what arrived is not what RomM holds')
      }
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
    // No artwork on this server, which is a 404 rather than a failure: what
    // the cache does with one is skip it and record the game anyway.
    async asset() {
      return new Response(null, { status: 404 })
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

/**
 * An offline cache under whatever scratch root the test has set.
 *
 * The real one rather than a stub: it writes into a throwaway folder and asks
 * the fake client for artwork, which is the same shape as a real install
 * against a server holding no covers.
 */
function cache(client: RommClient): OfflineCache {
  return new OfflineCache(rootPaths().offline, client)
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
    corruptFile?: number
    roms?: Record<number, RommRom>
  } = {}
): {
  downloads: DownloadManager
  library: Library
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
  const library = new Library(store, client, cache(client), () => options.emulator ?? null)
  const downloads = new DownloadManager(store, client, library)
  return { downloads, library, store, root, client, resumed }
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
    const { library, store } = manager()
    store.addInstalled(entry({ romId: 1, emulatorId: SHARED_LIBRARY }))
    store.addInstalled(entry({ romId: 2, emulatorId: 'retrodeck' }))

    assert.deepEqual(
      library.installed.map((item) => item.romId),
      [1]
    )
    assert.equal(library.installedNow(2), undefined)
  })

  test('with per-emulator folders, a copy for the emulator now in charge counts', () => {
    const { library, store } = manager({
      shared: false,
      emulator: emulator({ id: 'retrodeck', roms: '/retrodeck/roms' })
    })
    store.addInstalled(entry({ romId: 1, emulatorId: 'retrodeck' }))
    store.addInstalled(entry({ romId: 2, emulatorId: 'emudeck' }))
    store.addInstalled(entry({ romId: 3, emulatorId: SHARED_LIBRARY }))

    assert.deepEqual(
      library.installed.map((item) => item.romId),
      [1]
    )
  })

  test('an emulator that is simply not installed hides nothing', () => {
    const { library, store } = manager({ shared: false, emulator: null })
    store.addInstalled(entry({ romId: 2, emulatorId: 'emudeck' }))

    // Nothing runs the platform at the moment, so there is no better answer
    // than the copy that is there — an unplugged Steam Deck must not read as a
    // library that has been lost.
    assert.equal(library.isStale(store.installed[0]), false)
  })
})

describe('planning where a download goes', () => {
  test('a shared library is RomMix own tree, under the ES-DE system name', () => {
    const { library, root } = manager()

    const planned = library.plan(rom())

    assert.equal(planned.system, 'genesis')
    assert.equal(planned.path, join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md'))
  })

  test('a platform RomMix cannot map is refused, and names the platform', () => {
    const { library } = manager()

    assert.throws(
      () => library.plan(rom({ platform_slug: 'invented', platform_fs_slug: 'invented' })),
      (cause: RommError) =>
        cause instanceof RommError && /Sega Mega Drive|invented/.test(cause.message)
    )
  })

  test('per-emulator storage with nothing installed refuses rather than guessing', () => {
    const { library } = manager({ shared: false, emulator: null })

    assert.throws(() => library.plan(rom()), RommError)
  })

  test('a multi-file game is planned as a directory of its own', () => {
    const { library, root } = manager()

    const planned = library.plan(
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

    assert.equal(planned.path, join(root, 'roms', 'psx', 'Final Fantasy VII'))
    assert.equal(planned.asDirectory, true)
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
    const { library, store } = withFiles(['Sonic the Hedgehog (USA).md'])

    const adopted = await library.adopt([rom()])

    assert.equal(adopted.length, 1)
    assert.equal(store.getInstalled(1)?.sizeBytes, 32)
  })

  test('the same game under another extension is still the same game', async () => {
    // A Mega Drive dump renamed from .bin to .md by hand, which is routine.
    const { library, store } = withFiles(['Sonic the Hedgehog (USA).bin'])

    await library.adopt([rom()])

    assert.equal(basename(store.getInstalled(1)?.path ?? ''), 'Sonic the Hedgehog (USA).bin')
  })

  test('a directory named after the game is adopted as a multi-file game', async () => {
    const made = manager()
    const dir = join(made.root, 'roms', 'psx', 'Final Fantasy VII')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'disc1.cue'), 'FILE "disc1.bin" BINARY')
    writeFileSync(join(dir, 'disc1.bin'), '0'.repeat(64))

    await made.library.adopt([
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
    const { library, store } = manager()

    assert.deepEqual(await library.adopt([rom()]), [])
    assert.deepEqual(store.installed, [])
  })

  test('a platform with no folder mapping is passed over rather than throwing', async () => {
    const { library } = manager()

    assert.deepEqual(
      await library.adopt([rom({ platform_slug: 'invented', platform_fs_slug: 'invented' })]),
      []
    )
  })

  test('a page of games is written and announced once, not once per game', async () => {
    const { library, store } = withFiles([
      'Sonic the Hedgehog (USA).md',
      'Streets of Rage (USA).md'
    ])
    // Every listener on `installed` is handed the whole index, and the index is
    // rewritten whole on every save. One of each for a page is the difference
    // between reconciling a restored library and rewriting it a thousand times.
    let announcements = 0
    library.on('installed', () => (announcements += 1))

    const adopted = await library.adopt([
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
    assert.deepEqual(await made.library.adopt([streets]), [])

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
    assert.equal((await made.library.adopt([streets])).length, 1)
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

    assert.equal((await made.library.adopt([rom()])).length, 1)
  })

  test('a game already known is not looked for again', async () => {
    const { library, store } = withFiles(['Sonic the Hedgehog (USA).md'])
    store.addInstalled(entry({ romId: 1 }))

    assert.deepEqual(await library.adopt([rom()]), [])
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

    assert.deepEqual(await made.library.localFiles(3), [{ name: 'disc1.cue', sizeBytes: 5 }])
  })

  test('a game that is not installed has no files', async () => {
    const { library } = manager()

    assert.deepEqual(await library.localFiles(99), [])
  })
})

describe('where a game would go', () => {
  test('an emulator whose ROM folder is not known refuses the download', async () => {
    /**
     * Found but never probed, which is a real state: an emulator can be
     * installed and still have nothing RomMix can read a library path out of.
     * Planning a download into nowhere writes the game to a path built from an
     * empty string, so this has to be the error the screen reports.
     */
    const made = manager({ emulator: emulator({ roms: '' }), shared: false })

    assert.throws(() => made.library.plan(rom()), /does not know where/i)
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

    await made.library.uninstall(4)

    assert.equal(existsSync(join(dir, 'game.nsp')), false)
    assert.equal(existsSync(join(dir, 'update.nsp')), false)
    // Another game's file shares the folder and is none of this game's business.
    assert.equal(existsSync(join(dir, 'other-game.nsp')), true)
    assert.equal(made.store.getInstalled(4), undefined)
  })

  test('a game with a directory takes the whole of it, and nothing beside it', async () => {
    // The other half of the pair: a disc set keeps a folder, and uninstalling
    // it is the folder rather than a list of names inside it.
    const made = manager()
    const dir = join(made.root, 'roms', 'psx')
    const game = join(dir, 'Final Fantasy VII')
    mkdirSync(join(game, 'Disc 1'), { recursive: true })
    writeFileSync(join(game, 'Disc 1', 'track01.bin'), 'x')
    writeFileSync(join(game, 'disc.cue'), 'x')
    writeFileSync(join(dir, 'Another Game.iso'), 'x')
    made.store.addInstalled(
      entry({
        romId: 5,
        path: game,
        files: ['Disc 1/track01.bin', 'disc.cue'],
        system: 'psx',
        isDirectory: true
      })
    )

    await made.library.uninstall(5)

    assert.equal(existsSync(game), false)
    assert.equal(existsSync(join(dir, 'Another Game.iso')), true)
  })

  test('uninstalling something that is not in the index is not an error', async () => {
    const { library } = manager()

    await library.uninstall(404)
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
      await made.library.launchTarget(made.store.getInstalled(5)!),
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

    assert.equal(await made.library.launchTarget(installed), join(dir, 'sonic.md'))
  })
})

describe('a name from the server that would leave the system folder', () => {
  /**
   * RomM decides what a ROM is called, and that name is what decides where the
   * file lands. The server is the user's own, so this is not a stranger's
   * input — but a zip's entry names get the same check, and these arrive by the
   * same route and are used the same way.
   */
  const climbing = (fields: Partial<RommRom> = {}): RommRom =>
    rom({
      fs_name: '../../../.bashrc',
      fs_name_no_ext: '../../../.bashrc',
      // Carried, so `installName` answers with `fs_name` rather than falling
      // through to the file list — which is the name that decides the path.
      fs_extension: 'bashrc',
      files: [{ file_name: '../../../.bashrc' }] as RommRom['files'],
      ...fields
    })

  test('a download of it is refused rather than planned', () => {
    const { library } = manager()

    assert.throws(() => library.plan(climbing()), RommError)
  })

  test('a multi-file game with such a name is refused too', () => {
    const { library } = manager()

    assert.throws(() => library.plan(climbing({ has_multiple_files: true })), RommError)
  })

  test('adoption passes over it rather than recording something outside', async () => {
    // Recorded, it would be a library entry pointing at a file RomMix does not
    // own — and `uninstall` deletes what the index points at.
    const { library, store } = manager()

    assert.deepEqual(await library.adopt([climbing()]), [])
    assert.equal(store.getInstalled(1), undefined)
  })

  test('an ordinary name is unaffected', () => {
    const { library, root } = manager()

    assert.equal(
      library.plan(rom()).path,
      join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md')
    )
  })
})

describe('the shapes an install can take that a plain name does not describe', () => {
  /**
   * Eden, the one emulator that reads its library flat.
   *
   * Built after the manager, because its ROM folder has to be the one the
   * manager made — `plan` resolves against the emulator's own paths under
   * per-emulator storage.
   */
  function flatManager(): ReturnType<typeof manager> {
    const made = manager({ shared: false })
    const roms = join(made.root, 'roms')
    return {
      ...made,
      library: new Library(made.store, made.client, cache(made.client), () =>
        emulator({ id: 'eden', name: 'Eden', roms })
      )
    }
  }

  /** A Switch game of several files, which a flat library keeps loose. */
  function multi(fields: Partial<RommRom> = {}): RommRom {
    return rom({
      id: 2,
      name: 'A Switch game',
      fs_name: 'game.nsp',
      fs_name_no_ext: 'game',
      fs_extension: 'nsp',
      platform_slug: 'switch',
      platform_fs_slug: 'switch',
      has_multiple_files: true,
      files: [{ file_name: 'game.nsp' }, { file_name: 'update.nsp' }] as RommRom['files'],
      ...fields
    })
  }

  test('a game loose in the system folder is adopted as one game, not passed over', async () => {
    // A flat emulator gets the files side by side with every other game's,
    // under the names the server has for them — so there is no one path to
    // stat, and missing this is a game the user is asked to download again.
    const made = flatManager()
    const dir = join(made.root, 'roms', 'switch')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'game.nsp'), '0'.repeat(64))
    writeFileSync(join(dir, 'update.nsp'), '0'.repeat(32))

    const adopted = await made.library.adopt([multi()])

    assert.equal(adopted.length, 1)
    assert.equal(adopted[0].isDirectory, false)
    assert.deepEqual(adopted[0].files.sort(), ['game.nsp', 'update.nsp'])
    assert.equal(adopted[0].sizeBytes, 96)
  })

  test('half of a loose game is adopted as the file that is there', async () => {
    /**
     * Not as the whole game: the loose-set branch refuses an incomplete set,
     * and what adopts this is the ordinary single-file check below it, which
     * finds `game.nsp` under the name a download would give it.
     *
     * So the entry names one file rather than two — which is what `uninstall`
     * removes and what Play is handed. Worth pinning because the two branches
     * pull against each other: the first says a partial set is not the game,
     * and the second says this file is.
     */
    const made = flatManager()
    const dir = join(made.root, 'roms', 'switch')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'game.nsp'), '0'.repeat(64))

    const adopted = await made.library.adopt([multi()])

    assert.equal(adopted.length, 1)
    assert.deepEqual(adopted[0].files, ['game.nsp'])
  })

  test('a game installed under the name the server gave it is still found', async () => {
    // What a download from before `installName` existed is called on disk. The
    // two names differ only for a ROM whose extension RomM does not carry.
    const { library, store, root } = manager()
    const dir = join(root, 'roms', 'genesis')
    mkdirSync(dir, { recursive: true })
    const legacy = rom({
      fs_name: 'Sonic the Hedgehog (USA)',
      fs_name_no_ext: 'Sonic the Hedgehog (USA)',
      fs_extension: '',
      files: [{ file_name: 'Sonic the Hedgehog (USA).md' }] as RommRom['files']
    })
    // `installName` answers with the file's own name; the older install used
    // `fs_name`, and that is the one on disk.
    writeFileSync(join(dir, 'Sonic the Hedgehog (USA)'), '0'.repeat(16))

    const adopted = await library.adopt([legacy])

    assert.equal(adopted.length, 1)
    assert.equal(basename(store.getInstalled(1)?.path ?? ''), 'Sonic the Hedgehog (USA)')
  })
})

describe('the file handed to an emulator for a loose install', () => {
  test('it is chosen from the files the entry lists, not the folder it shares', async () => {
    // Loose in the system folder, the entry's siblings are every other game on
    // the platform. Picking from the directory would hand over one of those.
    const { library, root } = manager()
    const dir = join(root, 'roms', 'psx')
    mkdirSync(dir, { recursive: true })
    for (const name of ['disc.cue', 'disc.bin', 'someone-elses.cue']) {
      writeFileSync(join(dir, name), '0'.repeat(8))
    }

    const target = await library.launchTarget(
      entry({
        romId: 3,
        system: 'psx',
        isDirectory: false,
        // The recorded launch file has gone — an emulator converted it, or it
        // was never the right one.
        path: join(dir, 'disc.bin'),
        launchPath: join(dir, 'gone.cue'),
        files: ['disc.cue', 'disc.bin']
      })
    )

    // The descriptor, and one of this game's own files.
    assert.equal(target, join(dir, 'disc.cue'))
  })
})
