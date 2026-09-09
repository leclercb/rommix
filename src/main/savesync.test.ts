import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  existsSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EmulatorState } from '@config/emulators'
import type { RommDevice, RommRom, RommSave, RommState } from '@shared/types'
import { RommError, type RommClient } from './romm/index.ts'
import { SaveSync, type SaveTarget } from './saves.ts'
import { zipDirectory } from './zip.ts'
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
    content_hash: null,
    ...fields
  } as RommSave
}

/** The md5 RomM would hold for these bytes. See `sameContent`. */
function md5(content: string): string {
  return createHash('md5').update(content).digest('hex')
}

function device(fields: Partial<RommDevice> = {}): RommDevice {
  return {
    id: 'device-1',
    name: 'RomMix @ test',
    hostname: null,
    client_device_identifier: null,
    ...fields
  }
}

/** A device with a save folder, a state folder, and a game installed. */
function setUp(
  options: {
    saves?: RommSave[]
    states?: RommState[]
    devices?: RommDevice[]
    /** What the server throws instead of answering, when it is not answering. */
    serverSays?: Error
    /** Whether the server refuses every upload, as an unreachable one does. */
    uploadFails?: boolean
    /** What a download hands back as an archive, for a directory save. */
    archive?: Record<string, string>
  } = {}
): {
  sync: SaveSync
  target: SaveTarget
  saveDir: string
  stateDir: string
  /** Where the copies a pull displaces are kept, one folder per game. */
  backups: string
  uploaded: { fileName: string; from: string; slot: string | null }[]
  deleted: number[]
  store: Store
} {
  const home = scratch()
  const saveDir = join(home, 'saves')
  const stateDir = join(home, 'states')
  const romDir = join(home, 'roms')
  for (const dir of [saveDir, stateDir, romDir]) mkdirSync(dir, { recursive: true })

  const uploaded: { fileName: string; from: string; slot: string | null }[] = []
  const deleted: number[] = []

  /** What the server hands over: a file's contents, or a zip of a folder. */
  const download = async (to: string): Promise<void> => {
    if (!options.archive) return writeFile(to, 'from the server')
    const staging = scratch()
    for (const [name, contents] of Object.entries(options.archive)) {
      mkdirSync(join(staging, name, '..'), { recursive: true })
      writeFileSync(join(staging, name), contents)
    }
    await zipDirectory(staging, to)
  }
  const refuse = (): never => {
    throw options.serverSays as Error
  }
  const client = {
    saves: async () => (options.serverSays ? refuse() : (options.saves ?? [])),
    states: async () => (options.serverSays ? refuse() : (options.states ?? [])),
    devices: async () => (options.serverSays ? refuse() : (options.devices ?? [])),
    downloadSave: async (_id: number, to: string) => download(to),
    downloadState: async (_id: number, to: string) => download(to),
    uploadSave: async (
      _romId: number,
      filePath: string,
      fileName: string,
      _emulator: string | null,
      slot: string | null
    ) => {
      if (options.uploadFails) throw new Error('fetch failed')
      uploaded.push({ fileName, from: filePath, slot })
      return save({ file_name: fileName })
    },
    uploadState: async (_romId: number, filePath: string, fileName: string) => {
      if (options.uploadFails) throw new Error('fetch failed')
      uploaded.push({ fileName, from: filePath, slot: null })
      return save({ file_name: fileName })
    },
    deleteSaves: async (ids: number[]) => void deleted.push(...ids),
    deleteStates: async (ids: number[]) => void deleted.push(...ids)
  } as unknown as RommClient

  const backups = join(home, 'save-copies')
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
    sync: new SaveSync(store, client, backups),
    target: {
      rom,
      emulator,
      system: 'genesis',
      romPath: join(romDir, 'Sonic the Hedgehog (USA).md')
    },
    saveDir,
    stateDir,
    backups,
    uploaded,
    deleted,
    store
  }
}

describe('draining what a session left behind', () => {
  /** A local save written after `since`, which is what the drain looks at. */
  function played(saveDir: string, at = '2026-08-10T12:00:00.000Z'): number {
    const path = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(path, 'played offline')
    const when = new Date(at)
    utimesSync(path, when, when)
    return new Date('2026-08-10T11:00:00.000Z').getTime()
  }

  test('a name RomM holds nothing under goes up without asking', async () => {
    const { sync, target, saveDir, uploaded } = setUp()
    const since = played(saveDir)

    const result = await sync.drain(target, since, { sendUnasked: true })

    assert.equal(result.sent, 1)
    assert.equal(result.conflicts, 0)
    assert.deepEqual(
      uploaded.map((file) => file.fileName),
      ['Sonic the Hedgehog (USA).srm']
    )
  })

  test('a server copy this device uploaded is its own to carry on from', async () => {
    const { sync, target, saveDir, uploaded, store } = setUp({
      saves: [save({ origin_device_id: 'this-device' })]
    })
    store.updateSettings({ deviceId: 'this-device' })
    const since = played(saveDir)

    const result = await sync.drain(target, since, { sendUnasked: true })

    assert.equal(result.sent, 1)
    assert.equal(result.conflicts, 0)
    assert.equal(uploaded.length, 1)
  })

  test('a server copy from another device is never written over', async () => {
    const { sync, target, saveDir, uploaded, store } = setUp({
      saves: [save({ origin_device_id: 'the-other-console' })]
    })
    store.updateSettings({ deviceId: 'this-device' })
    const since = played(saveDir)

    const result = await sync.drain(target, since, { sendUnasked: true })

    // The whole point of the pass: a fortnight out of range says nothing about
    // what the rest of the household did meanwhile.
    assert.equal(result.sent, 0)
    assert.equal(result.conflicts, 1)
    assert.deepEqual(uploaded, [])
  })

  test('a newer copy from another device is a question, not an overwrite', async () => {
    const { sync, target, saveDir, uploaded, store } = setUp({
      saves: [
        save({ origin_device_id: 'the-other-console', updated_at: '2026-09-01T00:00:00.000Z' })
      ]
    })
    store.updateSettings({ deviceId: 'this-device' })
    const since = played(saveDir, '2026-08-10T12:00:00.000Z')

    const result = await sync.drain(target, since, { sendUnasked: true })

    assert.equal(result.sent, 0)
    assert.equal(result.conflicts, 1)
    assert.deepEqual(uploaded, [])
  })

  test('this device’s own later upload is nothing to send and nothing to ask', async () => {
    const { sync, target, saveDir, uploaded, store } = setUp({
      saves: [save({ origin_device_id: 'this-device', updated_at: '2026-09-01T00:00:00.000Z' })]
    })
    store.updateSettings({ deviceId: 'this-device' })
    const since = played(saveDir, '2026-08-10T12:00:00.000Z')

    const result = await sync.drain(target, since, { sendUnasked: true })

    // RomM holds this device's own copy, made after the file here — restored
    // from a backup, most likely. `syncStateOf` already calls that pair in
    // sync, so the file never reaches the decision: there is nothing to send
    // and nothing worth interrupting anybody about.
    assert.deepEqual(result, { sent: 0, conflicts: 0, ready: 0 })
    assert.deepEqual(uploaded, [])
  })

  test('a push that sends nothing reports the files it could not send', async () => {
    const { sync, target, saveDir } = setUp({ uploadFails: true })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'played')

    const result = await sync.pushNow(target)

    // The count that arrived is not the count that was tried, and anything
    // deciding a save is safely on RomM has to be able to tell them apart.
    assert.equal(result.saves + result.states, 0)
    assert.equal(result.failed, 1)
  })

  test('nothing goes up unasked when the user asked to be asked', async () => {
    const { sync, target, saveDir, uploaded } = setUp()
    const since = played(saveDir)

    const result = await sync.drain(target, since, { sendUnasked: false })

    // Safe to send and still not sent: `confirmSavePush` means every push is a
    // decision, and a pass nobody watched is the last place to make one.
    assert.equal(result.sent, 0)
    assert.equal(result.ready, 1)
    assert.equal(result.conflicts, 0)
    assert.deepEqual(uploaded, [])
  })

  test('a server that will not take the files leaves them waiting', async () => {
    const { sync, target, saveDir, uploaded } = setUp({ uploadFails: true })
    const since = played(saveDir)

    const result = await sync.drain(target, since, { sendUnasked: true })

    // Uploading carries on past a file the server refuses, so a push against a
    // server that has gone *resolves* having sent nothing. Read as "nothing
    // left to send", that is how a save still only on this disk is forgotten.
    assert.equal(result.sent, 0)
    assert.equal(result.ready, 1)
    assert.deepEqual(uploaded, [])
  })

  test('a save folder with nothing in it is not left waiting forever', async () => {
    const { sync, target, stateDir } = setUp()
    // What an emulator that made its folder and never wrote to it leaves. The
    // upload passes over it without sending or failing, so counting it as
    // still waiting would keep the record — and the warning on the game — for
    // a game with nothing outstanding at all.
    mkdirSync(join(stateDir, 'Sonic the Hedgehog (USA)'), { recursive: true })

    const result = await sync.drain(target, 0, { sendUnasked: true })

    assert.equal(result.ready, 0)
    assert.equal(result.conflicts, 0)
  })

  test('a session that wrote nothing leaves nothing waiting', async () => {
    const { sync, target } = setUp()

    const result = await sync.drain(target, Date.now(), { sendUnasked: true })

    assert.deepEqual(result, { sent: 0, conflicts: 0, ready: 0 })
  })
})

describe('listing both ends', () => {
  test('a save on the server and on disk is one row, not two', async () => {
    const { sync, target, saveDir } = setUp({ saves: [save()] })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    const assets = await sync.listAssets(7, target)

    assert.equal(assets.length, 1)
    assert.equal(assets[0].id, 1)
    assert.ok(assets[0].localPath)
  })

  test('a state another core wrote is marked as one the pull will leave', async () => {
    // The row and the pull have to agree. The tab draws a badge saying no
    // button will act on this file, and `pullKind` is what makes that true —
    // both ask `tagDecides`, so a screen cannot come to promise a fetch that
    // will not happen.
    const { sync, target } = setUp({
      states: [
        save({
          file_name: 'Sonic the Hedgehog (USA).state1',
          emulator: 'picodrive'
        }) as unknown as RommState
      ]
    })

    const [asset] = await sync.listAssets(7, target)

    assert.equal(asset.kind, 'state')
    assert.equal(asset.forAnotherEmulator, true)
    // And the pull agrees, which is the whole point of the mark.
    assert.equal((await sync.pullNow(target)).states, 0)
  })

  test('a battery save another core wrote is not marked, being one that comes down', async () => {
    const { sync, target } = setUp({ saves: [save({ emulator: 'pcsx_rearmed' })] })

    const [asset] = await sync.listAssets(7, target)

    assert.equal(asset.forAnotherEmulator, false)
    assert.equal((await sync.pullNow(target)).saves, 1)
  })

  test('a save the server has never been given is still a row', async () => {
    const { sync, target, saveDir } = setUp()
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    const [asset] = await sync.listAssets(7, target)

    assert.equal(asset.id, null)
    assert.equal(asset.sync, 'local-only')
    // The tag it would be uploaded under, so the column is not blank on the
    // rows that have never been anywhere — the core RomMix loads for the
    // system, not the frontend that loads it.
    assert.equal(asset.emulator, 'genesis_plus_gx')
  })

  test('a server that cannot be asked leaves the local files uncompared', async () => {
    const { sync, target, saveDir } = setUp({ serverSays: new TypeError('fetch failed') })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    const [asset] = await sync.listAssets(7, target)

    // Not `local-only`, which claims RomM has never been given this file. That
    // reads as a push candidate, and pushing it would write over whatever is
    // actually up there — which is the one thing nobody can see from here.
    assert.equal(asset.sync, 'unchecked')
    assert.ok(asset.localPath)
    assert.equal(asset.id, null)
  })

  test('a server that refuses is a failure, not an empty list', async () => {
    const { sync, target, saveDir } = setUp({
      // A token paired without `assets.read`. The server is right there and
      // saying no, and a screen of local files with no mention of it would
      // hide the only thing that is wrong.
      serverSays: new RommError('forbidden', 403)
    })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    await assert.rejects(() => sync.listAssets(7, target), /forbidden/)
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

  test('a save from another device is named by it', async () => {
    const { sync, target } = setUp({
      saves: [save({ origin_device_id: 'device-2' })],
      devices: [device({ id: 'device-2', name: 'RomMix @ handheld' })]
    })

    const [asset] = await sync.listAssets(7, target)

    assert.equal(asset.fromThisDevice, false)
    assert.equal(asset.originName, 'RomMix @ handheld')
  })

  test('a save uploaded before pairing is named by the identifier it chose', async () => {
    // An unpaired RomMix uploads under the id it made for itself, which RomM
    // files as `client_device_identifier` rather than as the device's own id.
    const { sync, target } = setUp({
      saves: [save({ origin_device_id: 'local-id' })],
      devices: [
        device({ id: 'device-2', name: 'RomMix @ handheld', client_device_identifier: 'local-id' })
      ]
    })

    const [asset] = await sync.listAssets(7, target)

    assert.equal(asset.originName, 'RomMix @ handheld')
  })

  test('a device with no name of its own is named by its hostname', async () => {
    const { sync, target } = setUp({
      saves: [save({ origin_device_id: 'device-2' })],
      devices: [device({ id: 'device-2', name: null, hostname: 'handheld.local' })]
    })

    const [asset] = await sync.listAssets(7, target)

    assert.equal(asset.originName, 'handheld.local')
  })

  test('an origin the server no longer lists is left unnamed', async () => {
    // The row falls back to "another device", which is still true.
    const { sync, target } = setUp({
      saves: [save({ origin_device_id: 'device-gone' })],
      devices: [device({ id: 'device-2', name: 'RomMix @ handheld' })]
    })

    const [asset] = await sync.listAssets(7, target)

    assert.equal(asset.fromThisDevice, false)
    assert.equal(asset.originName, null)
  })

  test('a state is never named, the server recording no origin for one', async () => {
    const { sync, target } = setUp({
      states: [save({ file_name: 'Sonic the Hedgehog (USA).state1' }) as unknown as RommState],
      devices: [device({ id: 'device-2', name: 'RomMix @ handheld' })]
    })

    const [asset] = await sync.listAssets(7, target)

    assert.equal(asset.kind, 'state')
    assert.equal(asset.fromThisDevice, null)
    assert.equal(asset.originName, null)
  })

  test('a server stamp in another offset is ordered by the instant it means', async () => {
    // RomM writes `updated_at` in whatever offset its clock keeps and this
    // device writes `Z`, so the two are only comparable once parsed: as text
    // `14:00+02:00` reads as later than the `13:00Z` that actually followed it.
    const { sync, target, saveDir } = setUp({
      saves: [save({ file_name: 'earlier.srm', updated_at: '2026-08-01T14:00:00+02:00' })]
    })
    const later = new Date('2026-08-01T13:00:00.000Z')
    const path = join(saveDir, 'Sonic the Hedgehog (USA).sav')
    writeFileSync(path, 'local')
    utimesSync(path, later, later)

    const assets = await sync.listAssets(7, target)

    assert.deepEqual(
      assets.map((asset) => asset.fileName),
      ['Sonic the Hedgehog (USA).sav', 'earlier.srm']
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
    const { sync, target, saveDir, backups } = setUp({ saves: [save()] })
    const path = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(path, 'the local one')
    const older = new Date('2026-01-01T00:00:00.000Z')
    utimesSync(path, older, older)

    await sync.pullNow(target)

    assert.equal(readFileSync(path, 'utf8'), 'from the server')
    const kept = join(backups, '7', 'Sonic the Hedgehog (USA).srm.1')
    assert.equal(readFileSync(kept, 'utf8'), 'the local one')
  })

  test('a file the pull lands on is copied aside even when nothing matched it', async () => {
    // The server holds names under a game that this game's own rule does not
    // read as its: a save uploaded by a client whose ROM is named otherwise,
    // or by a version of RomMix that matched on a prefix. The download still
    // lands on whatever is at that path, so the copy cannot be conditional on
    // the file having been recognised as this game's.
    const { sync, target, saveDir, backups } = setUp({
      saves: [save({ file_name: 'Another Game (USA).srm' })]
    })
    const path = join(saveDir, 'Another Game (USA).srm')
    writeFileSync(path, 'the local one')
    const older = new Date('2026-01-01T00:00:00.000Z')
    utimesSync(path, older, older)

    await sync.pullNow(target)

    assert.equal(readFileSync(path, 'utf8'), 'from the server')
    const kept = join(backups, '7', 'Another Game (USA).srm.1')
    assert.equal(readFileSync(kept, 'utf8'), 'the local one')
  })

  test('a file the pull lands on that is already the newer one is left alone', async () => {
    // The other half of the same rule: what is on disk is weighed by its date
    // whether or not this game claimed it, so a name the server holds and this
    // game does not recognise is not re-fetched on every launch — which would
    // rotate the kept copies until the save they were kept for is gone.
    const { sync, target, saveDir, backups } = setUp({
      saves: [save({ file_name: 'Another Game (USA).srm' })]
    })
    const path = join(saveDir, 'Another Game (USA).srm')
    writeFileSync(path, 'the local one')

    const result = await sync.pullNow(target)

    assert.equal(result.saves, 0)
    assert.equal(readFileSync(path, 'utf8'), 'the local one')
    assert.equal(existsSync(join(backups, '7')), false)
  })

  test('the copy is kept in the RomMix folder, not in the emulator tree', async () => {
    const { sync, target, saveDir } = setUp({ saves: [save()] })
    const path = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(path, 'the local one')
    const older = new Date('2026-01-01T00:00:00.000Z')
    utimesSync(path, older, older)

    await sync.pullNow(target)

    assert.deepEqual(readdirSync(saveDir), ['Sonic the Hedgehog (USA).srm'])
  })

  test('a copy already in sync is not fetched again', async () => {
    const { sync, target, saveDir } = setUp({ saves: [save()] })
    const path = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(path, 'the local one')
    const when = new Date('2026-08-01T12:00:00.000Z')
    utimesSync(path, when, when)

    const result = await sync.pullNow(target)

    assert.equal(result.saves, 0)
    assert.equal(readFileSync(path, 'utf8'), 'the local one')
  })

  test('a battery save is taken whichever emulator wrote it', async () => {
    // The case this got wrong for every save RomM's own browser player made:
    // it runs a different core, the file is the one memory card the server
    // holds for the game, and refusing it left the user with no save at all.
    // A `.srm` is in its system's format, not its core's.
    const { sync, target, saveDir } = setUp({ saves: [save({ emulator: 'pcsx_rearmed' })] })

    const result = await sync.pullNow(target)

    assert.equal(result.saves, 1)
    assert.equal(existsSync(join(saveDir, 'Sonic the Hedgehog (USA).srm')), true)
  })

  test('an untagged save is taken rather than left where it can only be looked at', async () => {
    // What an upload through RomM's own interface looks like. It was listed on
    // the game screen and declined by the button beside it, which is the shape
    // this arrived as a bug report in.
    const { sync, target, saveDir } = setUp({ saves: [save({ emulator: null })] })

    const result = await sync.pullNow(target)

    assert.equal(result.saves, 1)
    assert.equal(existsSync(join(saveDir, 'Sonic the Hedgehog (USA).srm')), true)
  })

  test('a state another core wrote is never dropped into this one folder', async () => {
    // Where the tag still decides, and the one case that is worse than useless
    // to get wrong: a state is a snapshot of one core's memory under a name
    // every core uses, so the wrong one is not ignored on load, it is loaded.
    const { sync, target, stateDir } = setUp({
      states: [
        save({
          file_name: 'Sonic the Hedgehog (USA).state1',
          emulator: 'picodrive'
        }) as unknown as RommState
      ]
    })

    const result = await sync.pullNow(target)

    assert.equal(result.states, 0)
    assert.equal(existsSync(join(stateDir, 'Sonic the Hedgehog (USA).state1')), false)
  })

  test('an untagged state is left too, a state needing a positive match', async () => {
    // Stricter than the untagged save above, and deliberately: nothing says
    // which core wrote this snapshot, and one that does not belong to the core
    // loading it is not a file that gets ignored.
    const { sync, target, stateDir } = setUp({
      states: [
        save({
          file_name: 'Sonic the Hedgehog (USA).state1',
          emulator: null
        }) as unknown as RommState
      ]
    })

    const result = await sync.pullNow(target)

    assert.equal(result.states, 0)
    assert.equal(existsSync(join(stateDir, 'Sonic the Hedgehog (USA).state1')), false)
  })

  test('a pull says what the server had, so a zero says which zero it is', async () => {
    // Three situations end in nothing being written — the server holds none,
    // it holds some this emulator cannot use, it holds some already here — and
    // a count on its own tells them apart for none of them. This is the number
    // that does.
    const { sync, target } = setUp({
      states: [
        save({
          file_name: 'Sonic the Hedgehog (USA).state1',
          emulator: 'picodrive'
        }) as unknown as RommState
      ]
    })

    const states = await sync.pull(target)

    assert.equal(states.written, 0)
    assert.equal(states.offered, 1)
  })

  test('a pull offered nothing at all reports the zero as a zero', async () => {
    const { sync, target } = setUp()

    assert.deepEqual(await sync.pull(target), { written: 0, offered: 0 })
  })

  test('an automatic pull respects the setting; the button does not', async () => {
    const { sync, target, store } = setUp({ saves: [save()] })
    store.updateSettings({ syncSavesDown: false })

    assert.equal((await sync.pull(target)).written, 0)
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

  test('a copy RomM already has is left out of the preview and counted instead', async () => {
    // Sending it would upload the file over itself, which is not a decision to
    // put in a dialog — and the count is what lets the button say that
    // everything here is already up there rather than that there is nothing.
    const { sync, target, saveDir } = setUp({ saves: [save()] })
    const path = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(path, 'local')
    const uploadedAt = new Date('2026-08-01T12:00:00.000Z')
    utimesSync(path, uploadedAt, uploadedAt)

    const preview = await sync.previewPush(target)

    assert.deepEqual(preview.files, [])
    assert.equal(preview.inSync, 1)
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

describe('the ways a pull can go wrong without losing the launch', () => {
  test('one asset that cannot be fetched does not stop the others', async () => {
    // It is the user's save, so it is reported — but a failed download is not a
    // reason to refuse to start the game.
    const { sync, target, saveDir } = setUp({
      saves: [
        save({ id: 1, file_name: 'Sonic the Hedgehog (USA).srm' }),
        save({ id: 2, file_name: 'Sonic the Hedgehog (USA).sav' })
      ]
    })
    const client = sync as unknown as {
      client: { downloadSave: (id: number, to: string) => Promise<void> }
    }
    const original = client.client.downloadSave
    client.client.downloadSave = async (id, to) => {
      if (id === 1) throw new Error('the connection went')
      return original(id, to)
    }

    const written = await sync.pullNow(target)

    assert.equal(written.saves, 1)
    assert.equal(existsSync(join(saveDir, 'Sonic the Hedgehog (USA).sav')), true)
    assert.equal(existsSync(join(saveDir, 'Sonic the Hedgehog (USA).srm')), false)
  })

  test('only the newest few states are pulled, however many the server holds', async () => {
    // A shelf of states from months of play is not something to fetch in full
    // before a game starts.
    const states = Array.from({ length: 9 }, (_, index) =>
      save({
        id: index + 1,
        file_name: `Sonic the Hedgehog (USA).state${index}`,
        updated_at: `2026-08-0${index + 1}T12:00:00.000Z`
      })
    ) as unknown as RommState[]
    const { sync, target, stateDir } = setUp({ states })

    const result = await sync.pullNow(target)

    assert.equal(result.states, 5)
    // The newest, not the first five the server listed.
    assert.equal(existsSync(join(stateDir, 'Sonic the Hedgehog (USA).state8')), true)
    assert.equal(existsSync(join(stateDir, 'Sonic the Hedgehog (USA).state0')), false)
  })

  test('a server with nothing for this game is not an error', async () => {
    const { sync, target } = setUp()

    const result = await sync.pullNow(target)
    assert.equal(result.saves, 0)
    assert.equal(result.states, 0)
  })

  test('an emulator with nowhere to put saves pulls nothing rather than throwing', async () => {
    const { sync, target } = setUp({ saves: [save()] })
    // What an emulator that has never been run looks like: found, but with no
    // folders yet. The game still starts, unsynced.
    target.emulator = {
      ...target.emulator,
      paths: { home: null, roms: null, saves: null, states: null, bios: null }
    } as typeof target.emulator

    const result = await sync.pullNow(target)
    assert.equal(result.saves, 0)
    assert.equal(result.states, 0)
  })
})

describe('a save the emulator keeps as a folder', () => {
  /**
   * A Switch game and the NAND its saves sit in.
   *
   * The one save layout where the unit is a directory rather than a file, so it
   * is the only way to reach the archive path from here — RetroArch, which the
   * rest of this file uses, never produces one. The id comes from the ROM's
   * name, which is what `switchTitleId` falls back to when the file itself is
   * not a container it can read a header out of.
   */
  const TITLE_ID = '0100000000010000'
  const PROFILE = 'a'.repeat(32)

  function switchGame(
    options: Parameters<typeof setUp>[0] = {}
  ): ReturnType<typeof setUp> & { gameDir: string } {
    const made = setUp(options)
    const nand = join(made.saveDir, 'nand')
    const gameDir = join(nand, '0000000000000000', PROFILE, TITLE_ID)
    mkdirSync(gameDir, { recursive: true })

    made.target = {
      ...made.target,
      rom: {
        ...made.target.rom,
        fs_name: `Zelda [${TITLE_ID}].nsp`,
        fs_name_no_ext: `Zelda [${TITLE_ID}]`
      } as RommRom,
      romPath: join(made.target.romPath, '..', `Zelda [${TITLE_ID}].nsp`),
      system: 'switch',
      emulator: {
        ...made.target.emulator,
        id: 'eden',
        name: 'Eden',
        paths: { ...made.target.emulator.paths, saves: nand }
      } as EmulatorState
    }
    return { ...made, gameDir }
  }

  test('a folder with something in it is sent as one archive', async () => {
    const { sync, target, gameDir, uploaded } = switchGame()
    writeFileSync(join(gameDir, 'save.dat'), 'progress')

    await sync.pushNow(target)

    // One upload standing for the whole folder, under the archive name — the
    // files inside it have no names the server could file them under.
    assert.equal(uploaded.length, 1)
    assert.match(uploaded[0].fileName, /\.rommix-save\.zip$/)
  })

  test('a folder save is not put in the slot the ecosystem shares', async () => {
    const { sync, target, gameDir, uploaded } = switchGame()
    writeFileSync(join(gameDir, 'save.dat'), 'progress')

    await sync.pushNow(target)

    // What goes up is a zip RomMix names itself, which no other client reads as
    // a save. It also could not come back: RomM stamps the time into the name
    // of every copy it files into a slot, displacing the suffix the archive is
    // recognised by, so the zip would be written into the save folder whole
    // instead of being unpacked into it.
    assert.deepEqual(
      uploaded.map((file) => file.slot),
      [null]
    )
  })

  test('a folder another emulator wrote is left, unlike a save file', async () => {
    // The third shape, and the one the pull rule covers by saying nothing about
    // it: only a save named after the ROM is taken whatever wrote it, so this
    // keeps the tag filter without a test of its own in `pullKind`. A Switch
    // save is one emulator's own tree, and Ryujinx's unpacked over Eden's is a
    // state loaded into the wrong core by another name.
    const { sync, target, gameDir } = switchGame({
      saves: [
        save({
          file_name: `Zelda [${TITLE_ID}].rommix-save.zip`,
          emulator: 'ryujinx'
        })
      ],
      archive: { 'save.dat': 'from the server' }
    })

    const result = await sync.pullNow(target)

    assert.equal(result.saves, 0)
    assert.equal(existsSync(join(gameDir, 'save.dat')), false)
  })

  test('the folder is copied aside whole before the archive is unpacked over it', async () => {
    const { sync, target, gameDir, backups } = switchGame({
      saves: [
        save({
          file_name: `Zelda [${TITLE_ID}].rommix-save.zip`,
          emulator: 'eden',
          updated_at: '2026-08-01T12:00:00.000Z'
        })
      ],
      // Only one of the two files the folder holds, which is the case the copy
      // is for: what the archive does not carry survives in the copy alone.
      archive: { 'save.dat': 'from the server' }
    })
    for (const [name, contents] of Object.entries({
      'save.dat': 'played here',
      'profile/settings.dat': 'played here too'
    })) {
      mkdirSync(join(gameDir, name, '..'), { recursive: true })
      writeFileSync(join(gameDir, name), contents)
      const older = new Date('2026-01-01T00:00:00.000Z')
      utimesSync(join(gameDir, name), older, older)
    }

    const result = await sync.pullNow(target)

    assert.equal(result.saves, 1)
    assert.equal(readFileSync(join(gameDir, 'save.dat'), 'utf8'), 'from the server')
    const kept = join(backups, '7', `${TITLE_ID}.1`)
    assert.equal(readFileSync(join(kept, 'save.dat'), 'utf8'), 'played here')
    assert.equal(readFileSync(join(kept, 'profile/settings.dat'), 'utf8'), 'played here too')
  })

  test('an empty folder is not uploaded as if it were a save', async () => {
    /**
     * The folder is there — a Switch emulator creates it on first run — so
     * "nothing to send" cannot be answered by looking for the directory. What
     * answers is its age: a directory save is as new as the newest file
     * anywhere under it, and under an empty one there is nothing to be newer
     * than. Uploading it anyway would put an archive of nothing on the server
     * and hand it back as this game's save on another device.
     *
     * `upload` has a second guard for the archive that comes out empty. That
     * one is for a folder emptied between the listing and the zip, and is not
     * what this reaches.
     */
    const { sync, target, uploaded } = switchGame()

    await sync.pushNow(target)

    assert.deepEqual(uploaded, [])
  })
})

describe('deleting an asset that is only at one end', () => {
  test('a local delete needs a local copy, and says so when there is none', async () => {
    const { sync, target } = setUp({ saves: [save()] })

    await assert.rejects(
      () => sync.deleteAsset(7, 'save', 1, 'Sonic the Hedgehog (USA).srm', 'local', target),
      // Names the file: the dialog that raised this is about one save.
      /Sonic the Hedgehog \(USA\)\.srm is not on this device/
    )
  })

  test('a server delete needs a server copy, and says so when there is none', async () => {
    const { sync, target, saveDir } = setUp()
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local only')

    await assert.rejects(
      () => sync.deleteAsset(7, 'save', null, 'Sonic the Hedgehog (USA).srm', 'remote', target),
      /Sonic the Hedgehog \(USA\)\.srm is not on RomM/
    )
  })

  test('an asset neither end has is refused rather than reported as deleted', async () => {
    const { sync, target } = setUp()

    await assert.rejects(() =>
      sync.deleteAsset(7, 'save', null, 'nothing-here.srm', 'local', target)
    )
  })
})

describe('what a push preview says about what it would replace', () => {
  test('a copy that came from this device is marked as such', async () => {
    // The difference between "you are about to overwrite your own upload" and
    // "you are about to overwrite something from the handheld".
    // The device id is the store's own, so the fixture has to be built from a
    // store before the one under test is set up around it.
    const deviceId = new Store(join(scratch(), 'config')).settings.deviceId
    const { sync, target, saveDir, store } = setUp({
      saves: [save({ origin_device_id: deviceId })]
    })
    store.updateSettings({ deviceId })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    const preview = await sync.previewPush(target)
    const file = preview.files.find((entry) => entry.fileName.endsWith('.srm'))

    assert.ok(file?.replaces)
    assert.equal(file.replaces.fromThisDevice, true)
  })

  test('a copy from somewhere else is marked as not from here', async () => {
    const { sync, target, saveDir } = setUp({
      saves: [save({ origin_device_id: 'the-handheld' })]
    })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    const preview = await sync.previewPush(target)
    const file = preview.files.find((entry) => entry.fileName.endsWith('.srm'))

    assert.equal(file?.replaces?.fromThisDevice, false)
  })

  test('the copy a push would replace names the device it came from', async () => {
    // The dialog is where overwriting is agreed to, so whose copy is at stake
    // is worth more than "another device" there of all places.
    const { sync, target, saveDir } = setUp({
      saves: [save({ origin_device_id: 'the-handheld' })],
      devices: [device({ id: 'the-handheld', name: 'RomMix @ handheld' })]
    })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    const preview = await sync.previewPush(target)
    const file = preview.files.find((entry) => entry.fileName.endsWith('.srm'))

    assert.equal(file?.replaces?.originName, 'RomMix @ handheld')
  })

  test('a server that does not record an origin gives no answer rather than a wrong one', async () => {
    const { sync, target, saveDir } = setUp({ saves: [save({ origin_device_id: null })] })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    const preview = await sync.previewPush(target)
    const file = preview.files.find((entry) => entry.fileName.endsWith('.srm'))

    assert.equal(file?.replaces?.fromThisDevice, null)
  })

  test('a file the server has never seen replaces nothing', async () => {
    const { sync, target, saveDir } = setUp()
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'local')

    const preview = await sync.previewPush(target)

    assert.equal(preview.files[0].replaces, null)
  })

  test('saves come before states, and the newest of each first', async () => {
    // The file you are about to send on purpose is almost always the one
    // written most recently.
    const { sync, target, saveDir, stateDir } = setUp()
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'a')
    writeFileSync(join(stateDir, 'Sonic the Hedgehog (USA).state1'), 'b')

    const preview = await sync.previewPush(target)

    assert.equal(preview.files[0].kind, 'save')
    assert.ok(preview.files.every((file, index) => index === 0 || file.kind === 'state'))
  })
})

/**
 * Saves as the rest of the ecosystem sees them.
 *
 * RomM pairs a client's save with the server's on the slot it was sent under
 * and never on what the file is called, so these are the assertions that a save
 * made here and a save made on a phone are one save: it goes up under the
 * shared slot, it comes back whatever the other client named it, and it lands
 * on the file this emulator opens rather than beside it.
 */
describe('pairing on the slot rather than the name', () => {
  /** What another client uploaded: its own file name, under the shared slot. */
  function elsewhere(fields: Partial<RommSave> = {}): RommSave {
    return save({
      id: 42,
      file_name: 'Sonic The Hedgehog.srm',
      slot: 'autosave',
      origin_device_id: 'a-phone',
      updated_at: '2026-08-05T12:00:00.000Z',
      ...fields
    })
  }

  test('the save this game has goes up under the shared slot', async () => {
    const { sync, target, saveDir, uploaded } = setUp()
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'played')

    await sync.pushSelected(target, [join(saveDir, 'Sonic the Hedgehog (USA).srm')])

    assert.deepEqual(
      uploaded.map((file) => file.slot),
      ['autosave']
    )
  })

  test('a state goes up under none, RomM keeping no slot for them', async () => {
    const { sync, target, stateDir, uploaded } = setUp()
    writeFileSync(join(stateDir, 'Sonic the Hedgehog (USA).state1'), 'a snapshot')

    await sync.pushSelected(target, [join(stateDir, 'Sonic the Hedgehog (USA).state1')])

    assert.deepEqual(
      uploaded.map((file) => file.slot),
      [null]
    )
  })

  test("another client's copy pairs with the local file despite the name", async () => {
    const { sync, target, saveDir } = setUp({ saves: [elsewhere()] })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'played here')

    const assets = await sync.listAssets(7, target)

    // One row, not two: the same save under two names is one save.
    assert.equal(assets.length, 1)
    assert.equal(assets[0].localPath, join(saveDir, 'Sonic the Hedgehog (USA).srm'))
    assert.equal(assets[0].slot, 'autosave')
    // Named as this device has it. RomM stamps the copies it files into a slot
    // with the time they arrived, so its own name for one is never the name
    // the emulator opens.
    assert.equal(assets[0].fileName, 'Sonic the Hedgehog (USA).srm')
  })

  test('a copy no local file answers to keeps the name RomM holds it under', async () => {
    const { sync, target } = setUp({
      saves: [elsewhere({ file_name: 'Sonic the Hedgehog (USA) [2026-09-08_22-30-05].srm' })]
    })

    const [asset] = await sync.listAssets(7, target)

    assert.equal(asset.fileName, 'Sonic the Hedgehog (USA) [2026-09-08_22-30-05].srm')
  })

  test('it is pulled onto the file the emulator opens, not beside it', async () => {
    const { sync, target, saveDir } = setUp({ saves: [elsewhere()] })

    const result = await sync.pullNow(target)

    assert.equal(result.saves, 1)
    // The bug this replaced: the server's own name written into the folder, so
    // the emulator went on opening the save it already had.
    assert.equal(existsSync(join(saveDir, 'Sonic The Hedgehog.srm')), false)
    assert.equal(
      readFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'utf8'),
      'from the server'
    )
  })

  test('a slot holds a history, and only its newest copy is a row', async () => {
    const { sync, target } = setUp({
      saves: [
        elsewhere({ id: 1, updated_at: '2026-08-01T12:00:00.000Z' }),
        elsewhere({ id: 2, updated_at: '2026-08-03T12:00:00.000Z' }),
        elsewhere({ id: 3, updated_at: '2026-08-02T12:00:00.000Z' })
      ]
    })

    const assets = await sync.listAssets(7, target)

    assert.equal(assets.length, 1)
    assert.equal(assets[0].id, 2)
  })

  test('a slot another client set aside is listed and left where it is', async () => {
    const { sync, target, saveDir } = setUp({
      saves: [elsewhere({ id: 8, slot: 'before-the-boss' })]
    })

    const [asset] = await sync.listAssets(7, target)

    assert.equal(asset.slot, 'before-the-boss')
    assert.equal(asset.sync, 'remote-only')
    // Nothing on this device answers to it, so the only place a pull could put
    // it is on top of the save being played. That is a decision, not a sync.
    assert.equal((await sync.pullNow(target)).saves, 0)
    assert.equal(existsSync(join(saveDir, 'Sonic the Hedgehog (USA).srm')), false)
  })

  test('the copy sent under the old name does not land on the slotted one', async () => {
    // The state a device is in the first time it runs a RomMix that sends
    // slots: its own earlier push is still up there under the file's name, and
    // another device has written the slot since. Both name the same file here.
    const { sync, target, saveDir } = setUp({
      saves: [
        save({
          id: 1,
          slot: null,
          file_name: 'Sonic the Hedgehog (USA).srm',
          updated_at: '2026-08-02T12:00:00.000Z'
        }),
        elsewhere({ id: 2, updated_at: '2026-08-05T12:00:00.000Z' })
      ]
    })
    const local = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(local, 'played here long ago')
    const before = new Date('2026-08-01T12:00:00.000Z')
    utimesSync(local, before, before)

    await sync.pullNow(target)

    // The slotted copy is the newer of the two and the one a later pull would
    // bring back, so it is what the emulator has to be left holding. Pulled
    // second, the older copy would overwrite it — and the tolerance check
    // cannot catch that, being asked of the mtime read before the pull began.
    assert.equal(
      statSync(local).mtime.toISOString(),
      '2026-08-05T12:00:00.000Z',
      'the copy sent under the old name was written over the slotted one'
    )
  })

  test('the slotted copy is never written over a file of another format', async () => {
    // The local battery save has been deleted to force a fresh pull, leaving
    // the clock file that sits beside it. Paired on the slot and nothing else,
    // the save would arrive as SRAM bytes on top of the clock file — and the
    // save the pull was for would never appear under the name that loads it.
    const { sync, target, saveDir } = setUp({ saves: [elsewhere()] })
    const clock = join(saveDir, 'Sonic the Hedgehog (USA).rtc')
    writeFileSync(clock, 'the clock file')

    await sync.pullNow(target)

    assert.equal(readFileSync(clock, 'utf8'), 'the clock file')
    assert.equal(
      readFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'utf8'),
      'from the server'
    )
  })

  test('a memory card is left to its name rather than sent under the slot', async () => {
    const { sync, target, saveDir, uploaded } = setUp()
    const card = join(saveDir, 'Sonic the Hedgehog (USA)_1.mcd')
    writeFileSync(card, 'card one')

    await sync.pushSelected(target, [card])

    // Its number is part of the name the emulator opens and cannot be read off
    // another client's copy, so a slot could only promise a pairing that would
    // land the card under a name nothing reads.
    assert.deepEqual(
      uploaded.map((file) => file.slot),
      [null]
    )
  })

  test('deleting a slotted save takes the copies behind it too', async () => {
    const { sync, target, deleted } = setUp({
      saves: [
        elsewhere({ id: 3, updated_at: '2026-08-01T12:00:00.000Z' }),
        elsewhere({ id: 4, updated_at: '2026-08-05T12:00:00.000Z' }),
        save({ id: 5, slot: null, file_name: 'Sonic the Hedgehog (USA).sav' })
      ]
    })

    const [newest] = await sync.listAssets(7, target)
    await sync.deleteAsset(7, 'save', newest.id, newest.fileName, 'remote', target)

    // The row is a slot, not a copy: taking only the newest uncovers the one
    // behind it, and the row comes back with older contents and the same
    // button. What is left alone is the save that was never in that slot.
    assert.deepEqual(
      deleted.toSorted((a, b) => a - b),
      [3, 4]
    )
  })

  test('a clock that disagrees does not make a save look changed', async () => {
    // The handheld case: no battery-backed clock, so the file it wrote is
    // stamped with whatever date the machine woke up believing — years out,
    // and behind the server rather than ahead of it. Every launch
    // then reads the server as ahead and pulls a copy of the save already
    // sitting there, displacing the real one into the backups a launch at a
    // time until the copies it went into have rotated away.
    const { sync, target, saveDir } = setUp({
      saves: [elsewhere({ content_hash: md5('the same bytes') })]
    })
    const local = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(local, 'the same bytes')
    const wrong = new Date('2001-01-01T00:00:00.000Z')
    utimesSync(local, wrong, wrong)

    const [asset] = await sync.listAssets(7, target)
    assert.equal(asset.sync, 'synced', 'identical bytes are in sync whatever the clocks say')

    const result = await sync.pullNow(target)

    assert.equal(result.saves, 0)
    assert.equal(readFileSync(local, 'utf8'), 'the same bytes')
    // And the disagreement is settled rather than skipped over, so the next
    // launch answers without reading the file at all.
    assert.equal(statSync(local).mtime.toISOString(), '2026-08-05T12:00:00.000Z')
  })

  test('bytes that really differ are still pulled', async () => {
    // The other side of it: the hash only ever says "these are the same file",
    // and a hash that does not match leaves the timestamps deciding exactly as
    // they did before.
    const { sync, target, saveDir } = setUp({
      saves: [elsewhere({ content_hash: md5('what the server holds') })]
    })
    const local = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(local, 'something else entirely')
    const old = new Date('2026-08-01T12:00:00.000Z')
    utimesSync(local, old, old)

    assert.equal((await sync.pullNow(target)).saves, 1)
    assert.equal(readFileSync(local, 'utf8'), 'from the server')
  })

  test('the preview names the slot each file is going into', async () => {
    // The dialog answers the question the row does: which slot, and so whether
    // this is a copy the rest of the ecosystem reads back or one filed where
    // only RomMix will look at it again. Asked of the same rule the upload
    // uses, so the two cannot name different slots for one file.
    const { sync, target, saveDir, stateDir } = setUp()
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'played')
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).rtc'), 'the clock file')
    writeFileSync(join(stateDir, 'Sonic the Hedgehog (USA).state1'), 'a snapshot')

    const preview = await sync.previewPush(target)

    // Sorted here rather than relied on: the dialog orders by what was written
    // most recently, which is not what this is about.
    assert.deepEqual(preview.files.map((file) => `${file.fileName} -> ${file.slot}`).toSorted(), [
      'Sonic the Hedgehog (USA).rtc -> null',
      'Sonic the Hedgehog (USA).srm -> autosave',
      'Sonic the Hedgehog (USA).state1 -> null'
    ])
  })

  test('a save the slot holds in another format is still offered for push', async () => {
    // The dialog and the game screen have to pair the same way. Where they did
    // not, the row read local-only while the dialog counted the file as already
    // up there and offered nothing — and `drain` is built on the same preview,
    // so the automatic push skipped it too and the save could never leave.
    const { sync, target, saveDir } = setUp({
      saves: [elsewhere({ file_name: 'Sonic The Hedgehog.sav' })]
    })
    const local = join(saveDir, 'Sonic the Hedgehog (USA).srm')
    writeFileSync(local, 'played here')
    // Stamped as the slot's copy was. Paired with it the timestamps read as in
    // sync, which is how a file that had never been sent came to be counted as
    // already up there.
    const when = new Date('2026-08-05T12:00:00.000Z')
    utimesSync(local, when, when)

    const preview = await sync.previewPush(target)

    assert.deepEqual(
      preview.files.map((file) => file.fileName),
      ['Sonic the Hedgehog (USA).srm']
    )
    assert.equal(preview.inSync, 0)
  })

  test('a clock file left on its own does not take the slot', async () => {
    const { sync, target, saveDir, uploaded } = setUp()
    const clock = join(saveDir, 'Sonic the Hedgehog (USA).rtc')
    writeFileSync(clock, 'the clock file')

    await sync.pushSelected(target, [clock])

    // It still goes up, under its own name. What it cannot do is stand in the
    // slot in front of the battery save every other client reads it for.
    assert.deepEqual(
      uploaded.map((file) => file.slot),
      [null]
    )
  })

  test('a save with no slot is still matched on its name', async () => {
    const { sync, target, saveDir } = setUp({ saves: [save({ slot: null })] })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'played here')

    const assets = await sync.listAssets(7, target)

    // Every save RomMix uploaded before it sent a slot is one of these, and a
    // server too old to keep slots sends nothing else.
    assert.equal(assets.length, 1)
    assert.equal(assets[0].localPath, join(saveDir, 'Sonic the Hedgehog (USA).srm'))
  })

  test('the slotted copy and the name it was sent under before are one row', async () => {
    const { sync, target, saveDir } = setUp({
      saves: [
        save({ id: 1, slot: null, file_name: 'Sonic the Hedgehog (USA).srm' }),
        elsewhere({ id: 2, file_name: 'Sonic the Hedgehog (USA).srm' })
      ]
    })
    writeFileSync(join(saveDir, 'Sonic the Hedgehog (USA).srm'), 'played here')

    const assets = await sync.listAssets(7, target)

    // Both are on the server and the local file is one file: it belongs to the
    // slotted copy, which is the one a later pull would bring back. The older
    // upload stays listed, with nothing on this device claimed by it.
    assert.equal(assets.length, 2)
    const [slotted, byName] = [
      assets.find((asset) => asset.slot === 'autosave'),
      assets.find((asset) => asset.slot === null)
    ]
    assert.equal(slotted?.localPath, join(saveDir, 'Sonic the Hedgehog (USA).srm'))
    assert.equal(byName?.localPath, null)
  })
})
