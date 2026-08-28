import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EmulatorState } from '@config/emulators'
import type { RommRom, RommSave, RommState } from '@shared/types'
import type { RommClient } from './romm.ts'
import { SaveSync, type SaveTarget } from './saves.ts'
import { Store } from './store.ts'

/**
 * Moving saves between this device and RomM.
 *
 * The one part of RomMix that can destroy something the user cannot get back,
 * so the assertions are mostly about what is *not* lost: a local save is copied
 * aside before a pull writes over it, a pull does not fetch a copy the screen
 * calls in sync, and a save written by another emulator is never dropped into
 * this one's folder.
 *
 * RetroArch is the emulator throughout, with no `retroarch.cfg` written — which
 * is the case where its descriptor falls back to the folders in `paths`, so a
 * test can say where the saves are. The matching rules underneath are covered
 * by `saves.test.ts`, and the disk helpers by `savefiles.test.ts`.
 */

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-savesync-test-'))
  scratches.push(dir)
  return dir
}

const rom = {
  id: 7,
  name: 'Sonic the Hedgehog',
  fs_name: 'Sonic the Hedgehog (USA).md',
  fs_name_no_ext: 'Sonic the Hedgehog (USA)',
  platform_slug: 'genesis-slash-megadrive',
  platform_fs_slug: 'megadrive'
} as RommRom

function save(fields: Partial<RommSave> = {}): RommSave {
  return {
    id: 1,
    rom_id: 7,
    file_name: 'Sonic the Hedgehog (USA).srm',
    file_size_bytes: 8192,
    emulator: 'retroarch',
    updated_at: '2026-08-01T12:00:00.000Z',
    origin_device_id: null,
    ...fields
  } as RommSave
}

/** A device with a save folder, a state folder, and a game installed. */
function setUp(options: { saves?: RommSave[]; states?: RommState[] } = {}): {
  sync: SaveSync
  target: SaveTarget
  saveDir: string
  stateDir: string
  uploaded: { fileName: string; from: string }[]
  deleted: number[]
  store: Store
} {
  const home = scratch()
  const saveDir = join(home, 'saves')
  const stateDir = join(home, 'states')
  const romDir = join(home, 'roms')
  for (const dir of [saveDir, stateDir, romDir]) mkdirSync(dir, { recursive: true })

  const uploaded: { fileName: string; from: string }[] = []
  const deleted: number[] = []
  const client = {
    saves: async () => options.saves ?? [],
    states: async () => options.states ?? [],
    downloadSave: async (_id: number, to: string) => writeFile(to, 'from the server'),
    downloadState: async (_id: number, to: string) => writeFile(to, 'from the server'),
    uploadSave: async (_romId: number, filePath: string, fileName: string) => {
      uploaded.push({ fileName, from: filePath })
      return save({ file_name: fileName })
    },
    uploadState: async (_romId: number, filePath: string, fileName: string) => {
      uploaded.push({ fileName, from: filePath })
      return save({ file_name: fileName })
    },
    deleteSaves: async (ids: number[]) => void deleted.push(...ids),
    deleteStates: async (ids: number[]) => void deleted.push(...ids)
  } as unknown as RommClient

  const store = new Store(join(home, 'config'))
  const emulator = {
    id: 'retroarch',
    name: 'RetroArch',
    available: true,
    install: null,
    // No config directory, so the descriptor falls back to the folders below
    // rather than reading a `retroarch.cfg` this machine does not have.
    configDir: null,
    dataDir: null,
    unavailableReason: null,
    paths: { home, roms: romDir, saves: saveDir, states: stateDir, bios: home }
  } as EmulatorState

  return {
    sync: new SaveSync(store, client),
    target: {
      rom,
      emulator,
      system: 'genesis',
      romPath: join(romDir, 'Sonic the Hedgehog (USA).md')
    },
    saveDir,
    stateDir,
    uploaded,
    deleted,
    store
  }
}

describe('listing both ends', () => {
  test('a save on the server and on disk is one row, not two', async () => {
    const { sync, target, saveDir } = setUp({ saves: [save()] })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    const assets = await sync.listAssets(7, target)

    assert.equal(assets.length, 1)
    assert.equal(assets[0].id, 1)
    assert.ok(assets[0].localPath)
  })

  test('a save the server has never been given is still a row', async () => {
    const { sync, target, saveDir } = setUp()
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    const [asset] = await sync.listAssets(7, target)

    assert.equal(asset.id, null)
    assert.equal(asset.sync, 'local-only')
    // The tag it would be uploaded under, so the column is not blank on the
    // rows that have never been anywhere.
    assert.equal(asset.emulator, 'retroarch')
  })

  test('a game that is not downloaded has the server side and nothing else', async () => {
    const { sync } = setUp({ saves: [save()] })

    const [asset] = await sync.listAssets(7)

    assert.equal(asset.localPath, null)
    assert.equal(asset.sync, 'remote-only')
  })

  test('a save uploaded from this device is not reported as one to pull', async () => {
    const { sync, target, saveDir, store } = setUp({
      saves: [save({ origin_device_id: 'this-device' })]
    })
    store.updateSettings({ deviceId: 'this-device' })
    const older = new Date('2026-07-01T00:00:00.000Z')
    const path = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(path, 'local')
    const { utimesSync } = await import('node:fs')
    utimesSync(path, older, older)

    const [asset] = await sync.listAssets(7, target)

    assert.equal(asset.fromThisDevice, true)
    assert.equal(asset.sync, 'synced')
  })

  test('the newest thing on either end comes first', async () => {
    const { sync, target } = setUp({
      saves: [
        save({ id: 1, file_name: 'old.srm', updated_at: '2026-01-01T00:00:00.000Z' }),
        save({ id: 2, file_name: 'new.srm', updated_at: '2026-08-01T00:00:00.000Z' })
      ]
    })

    const assets = await sync.listAssets(7, target)

    assert.deepEqual(
      assets.map((asset) => asset.fileName),
      ['new.srm', 'old.srm']
    )
  })
})

describe('pulling', () => {
  test("the server's copy is written into the folder the emulator reads", async () => {
    const { sync, target, saveDir } = setUp({ saves: [save()] })

    const result = await sync.pullNow(target)

    assert.equal(result.saves, 1)
    const path = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    assert.equal(readFileSync(path, 'utf8'), 'from the server')
  })

  test('a local save that is overwritten is copied aside first', async () => {
    const { sync, target, saveDir } = setUp({ saves: [save()] })
    const path = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(path, 'the local one')
    const { utimesSync } = await import('node:fs')
    const older = new Date('2026-01-01T00:00:00.000Z')
    utimesSync(path, older, older)

    await sync.pullNow(target)

    assert.equal(readFileSync(path, 'utf8'), 'from the server')
    assert.equal(readFileSync(`${path}.rommix-bak`, 'utf8'), 'the local one')
  })

  test('a copy already in sync is not fetched again', async () => {
    const { sync, target, saveDir } = setUp({ saves: [save()] })
    const path = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(path, 'the local one')
    const { utimesSync } = await import('node:fs')
    const when = new Date('2026-08-01T12:00:00.000Z')
    utimesSync(path, when, when)

    const result = await sync.pullNow(target)

    assert.equal(result.saves, 0)
    assert.equal(readFileSync(path, 'utf8'), 'the local one')
  })

  test('a save written by another emulator is never dropped into this one folder', async () => {
    const { sync, target, saveDir } = setUp({ saves: [save({ emulator: 'duckstation' })] })

    const result = await sync.pullNow(target)

    assert.equal(result.saves, 0)
    assert.equal(existsSync(join(saveDir, 'Sonic the Hedgehog (USA).srm')), false)
  })

  test('an automatic pull respects the setting; the button does not', async () => {
    const { sync, target, store } = setUp({ saves: [save()] })
    store.updateSettings({ syncSavesDown: false })

    assert.equal(await sync.pull(target), 0)
    // The same target, through the button the user just pressed.
    assert.equal((await sync.pullNow(target)).saves, 1)
  })
})

describe('pushing', () => {
  test('what is on disk is sent, under the name the emulator gave it', async () => {
    const { sync, target, saveDir, uploaded } = setUp()
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    const result = await sync.pushNow(target)

    assert.equal(result.saves, 1)
    assert.deepEqual(
      uploaded.map((item) => item.fileName),
      ['Sonic the Hedgehog (USA).srm']
    )
  })

  test('a save belonging to another game is left where it is', async () => {
    const { sync, target, saveDir, uploaded } = setUp()
    writeFileSync(join(saveDir, 'Streets of Rage (USA).srm'), 'someone else')

    const result = await sync.pushNow(target)

    assert.equal(result.saves, 0)
    assert.deepEqual(uploaded, [])
  })

  test('the automatic push after a session sends only what the session wrote', async () => {
    const { sync, target, saveDir, uploaded } = setUp()
    const path = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(path, 'from last year')
    const { utimesSync } = await import('node:fs')
    const older = new Date('2026-01-01T00:00:00.000Z')
    utimesSync(path, older, older)

    await sync.push(target, Date.parse('2026-08-01T00:00:00.000Z'))

    assert.deepEqual(uploaded, [])
  })

  test('the automatic push respects the setting', async () => {
    const { sync, target, saveDir, store, uploaded } = setUp()
    store.updateSettings({ syncSavesUp: false })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    await sync.push(target, 0)

    assert.deepEqual(uploaded, [])
  })

  test('a preview names the files a push would send, before it sends them', async () => {
    const { sync, target, saveDir, uploaded } = setUp()
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    const preview = await sync.previewPush(target)

    assert.deepEqual(
      preview.files.map((file) => file.fileName),
      ['Sonic the Hedgehog (USA).srm']
    )
    // A preview is a question, not half an upload.
    assert.deepEqual(uploaded, [])
  })

  test('only the files the dialog approved are sent', async () => {
    const { sync, target, saveDir, uploaded } = setUp()
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).state1'), 'local')

    await sync.pushSelected(target, [join(saveDir, 'Sonic the Hedgehog (USA).srm')])

    assert.deepEqual(
      uploaded.map((item) => item.fileName),
      ['Sonic the Hedgehog (USA).srm']
    )
  })

  test('a path the renderer invented is not uploaded because it was named', async () => {
    const { sync, target, uploaded } = setUp()

    await sync.pushSelected(target, ['/etc/passwd'])

    assert.deepEqual(uploaded, [])
  })
})

describe('deleting', () => {
  test('one end at a time: the local copy goes and the server keeps its own', async () => {
    const { sync, target, saveDir, deleted } = setUp({ saves: [save()] })
    const path = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(path, 'local')

    await sync.deleteAsset(7, 'save', 1, 'Sonic the Hedgehog (USA).srm', 'local', target)

    assert.equal(existsSync(path), false)
    assert.deepEqual(deleted, [])
  })

  test('deleting on the server leaves the copy on this device alone', async () => {
    const { sync, target, saveDir, deleted } = setUp({ saves: [save()] })
    const path = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(path, 'local')

    await sync.deleteAsset(7, 'save', 1, 'Sonic the Hedgehog (USA).srm', 'remote', target)

    assert.deepEqual(deleted, [1])
    assert.equal(existsSync(path), true)
  })
})
