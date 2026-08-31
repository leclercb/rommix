import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InstalledRom } from '@shared/types'
import { Store } from './store.ts'

/**
 * What RomMix remembers between runs, and what it does with a file it cannot
 * make sense of.
 *
 * The failure this file exists for is silent and total: a settings file that
 * fails to parse, or an index that comes back empty, presents as an application
 * that has forgotten the server, the emulator choices and every game on the
 * disk — and the user's only evidence is that RomMix looks freshly installed.
 * So each read is checked against a file written by hand, including the ones
 * that are damaged.
 *
 * Credentials go through `safeStorage`, which is Electron's and throws out here
 * — see `scripts/test-resolve.mjs`. That is exactly the flatpak-without-a-
 * keyring case, so what these tests exercise is the plaintext fallback, which
 * is the path a real machine can genuinely take.
 */

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-store-test-'))
  scratches.push(dir)
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents)
  return dir
}

function installed(fields: Partial<InstalledRom>): InstalledRom {
  return {
    romId: 1,
    path: '/roms/nes/game.nes',
    launchPath: '/roms/nes/game.nes',
    name: 'A game',
    coverPath: null,
    files: ['game.nes'],
    system: 'nes',
    platformName: 'Nintendo Entertainment System',
    fileName: 'game.nes',
    sizeBytes: 1024,
    installedAt: '2026-08-01T00:00:00.000Z',
    isDirectory: false,
    emulatorId: 'retrodeck',
    ...fields
  } as InstalledRom
}

describe('settings', () => {
  test('a fresh directory starts from the defaults and writes them when changed', () => {
    const dir = scratch()
    const store = new Store(dir)

    assert.equal(store.settings.setupComplete, false)
    assert.equal(store.settings.romStorage, 'rommix')
    assert.equal(store.server, null)

    store.updateSettings({ setupComplete: true })

    const written = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as {
      settings: { setupComplete: boolean }
    }
    assert.equal(written.settings.setupComplete, true)
  })

  test('a stored file is read back, and settings added since keep their defaults', () => {
    const dir = scratch({
      'settings.json': JSON.stringify({
        settings: { deviceName: 'The one under the telly', uiScale: 2 },
        server: { baseUrl: 'https://romm.example', authMode: 'device' }
      })
    })

    const store = new Store(dir)

    assert.equal(store.settings.deviceName, 'The one under the telly')
    assert.equal(store.settings.uiScale, 2)
    // Not in the file, because the version that wrote it did not have it.
    assert.equal(store.settings.confirmUninstall, true)
    assert.equal(store.server?.baseUrl, 'https://romm.example')
  })

  test('a settings file that is not JSON leaves the defaults standing', () => {
    const store = new Store(scratch({ 'settings.json': '{ this is not json' }))

    assert.equal(store.settings.romStorage, 'rommix')
    assert.equal(store.server, null)
  })

  test('signing out is a server of null, written through to the file', () => {
    const dir = scratch()
    const store = new Store(dir)
    store.setServer({ baseUrl: 'https://romm.example', authMode: 'token' })

    store.setServer(null)

    assert.equal(new Store(dir).server, null)
  })

  test('the settings survive a crash mid-write, because the write is a rename', () => {
    const dir = scratch()
    const store = new Store(dir)
    store.updateSettings({ deviceName: 'first' })
    store.updateSettings({ deviceName: 'second' })

    assert.equal(new Store(dir).settings.deviceName, 'second')
  })
})

describe('credentials', () => {
  test('with no keyring they are written as plain text, and read back', () => {
    const dir = scratch()
    new Store(dir).setCredentials({ clientToken: 'rmm_token', deviceId: 'device-9' })

    const stored = new Store(dir).credentials
    assert.equal(stored.clientToken, 'rmm_token')
    assert.equal(stored.deviceId, 'device-9')
    // The marker says which decoder read it, and is what lets a machine that
    // gains a keyring later still open what it wrote without one.
    assert.equal(readFileSync(join(dir, 'credentials.bin')).subarray(0, 4).toString(), 'RAW1')
  })

  test('nothing stored is empty credentials rather than a failure', () => {
    const credentials = new Store(scratch()).credentials

    assert.equal(credentials.clientToken, null)
    assert.equal(credentials.accessToken, null)
  })

  test('clearing them empties the file rather than leaving the tokens in it', () => {
    const dir = scratch()
    const store = new Store(dir)
    store.setCredentials({ accessToken: 'jwt', refreshToken: 'again' })

    store.clearCredentials()

    assert.equal(readFileSync(join(dir, 'credentials.bin'), 'utf8').includes('jwt'), false)
    assert.equal(new Store(dir).credentials.accessToken, null)
  })

  test('a file written with a marker nothing understands is read as no credentials', () => {
    const dir = scratch({ 'credentials.bin': 'WHAT{"clientToken":"rmm_token"}' })

    assert.equal(new Store(dir).credentials.clientToken, null)
  })

  test('a file that cannot be read is not remembered as "signed out"', () => {
    const dir = scratch({ 'credentials.bin': 'RAW1{ not json' })
    const store = new Store(dir)

    assert.equal(store.credentials.clientToken, null)
    // The distinction the cache makes: a failed read is retried, so credentials
    // that become readable again — a keyring that came back — are picked up
    // without a restart.
    writeFileSync(join(dir, 'credentials.bin'), 'RAW1{"clientToken":"rmm_token"}')
    assert.equal(store.credentials.clientToken, 'rmm_token')
  })
})

describe('the index of what is downloaded', () => {
  test('an entry is kept by ROM id and survives a restart', () => {
    const dir = scratch()
    const store = new Store(dir)

    store.addInstalled(installed({ romId: 7, name: 'Sonic' }))
    store.addInstalled(installed({ romId: 8, name: 'Streets of Rage' }))

    const reopened = new Store(dir)
    assert.equal(reopened.installed.length, 2)
    assert.equal(reopened.getInstalled(7)?.name, 'Sonic')
    assert.equal(reopened.getInstalled(99), undefined)
  })

  test('installing the same game twice replaces the entry rather than doubling it', () => {
    const store = new Store(scratch())

    store.addInstalled(installed({ romId: 7, emulatorId: 'retrodeck' }))
    store.addInstalled(installed({ romId: 7, emulatorId: 'emudeck' }))

    assert.equal(store.installed.length, 1)
    assert.equal(store.getInstalled(7)?.emulatorId, 'emudeck')
  })

  test('removing a game takes it out of the file too', () => {
    const dir = scratch()
    const store = new Store(dir)
    store.addInstalled(installed({ romId: 7 }))

    store.removeInstalled(7)

    assert.deepEqual(new Store(dir).installed, [])
  })

  test('an index file that is damaged is an empty library, not a crash on start', () => {
    const store = new Store(scratch({ 'downloaded_roms.json': '{"roms": [' }))

    assert.deepEqual(store.installed, [])
  })
})

describe('pruning the index against the disk', () => {
  test('a game whose file was deleted is forgotten', () => {
    const dir = scratch()
    const roms = join(dir, 'roms', 'nes')
    mkdirSync(roms, { recursive: true })
    writeFileSync(join(roms, 'kept.nes'), 'rom')
    const store = new Store(dir)
    store.addInstalled(installed({ romId: 1, path: join(roms, 'kept.nes') }))
    store.addInstalled(installed({ romId: 2, path: join(roms, 'deleted.nes') }))

    assert.equal(store.pruneInstalled(), 1)
    assert.deepEqual(
      store.installed.map((entry) => entry.romId),
      [1]
    )
  })

  test('a whole folder that has gone is an unplugged card, and is kept', () => {
    const dir = scratch()
    const store = new Store(dir)
    store.addInstalled(installed({ romId: 3, path: '/run/media/sdcard/roms/snes/game.sfc' }))

    assert.equal(store.pruneInstalled(), 0)
    assert.equal(store.installed.length, 1)
  })

  test('a game recorded as a folder with nothing in it is not installed', () => {
    const dir = scratch()
    const empty = join(dir, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)')
    const full = join(dir, 'roms', 'psx', 'Final Fantasy VII')
    mkdirSync(empty, { recursive: true })
    mkdirSync(full, { recursive: true })
    writeFileSync(join(full, 'disc1.cue'), 'x')
    const store = new Store(dir)
    store.addInstalled(installed({ romId: 1, path: empty, isDirectory: true }))
    store.addInstalled(installed({ romId: 2, path: full, isDirectory: true }))

    assert.equal(store.pruneInstalled(), 1)
    assert.deepEqual(
      store.installed.map((entry) => entry.romId),
      [2]
    )
    // The claim goes; the folder itself is left where it is.
    assert.equal(existsSync(empty), true)
  })

  test('nothing to prune leaves the file alone', () => {
    const store = new Store(scratch())

    assert.equal(store.pruneInstalled(), 0)
  })
})

describe('a state file that is not what RomMix wrote', () => {
  /**
   * These are RomMix's own files, so every way they come back wrong is a way it
   * did not write them: a truncated write, an edit by hand, a restore of the
   * wrong file. None of those is a reason to refuse to start — the index is a
   * record of what was downloaded, and the disk still has the games.
   */
  const shapes = {
    'a null where the list should be': '{"roms": null}',
    'the key holding an object': '{"roms": {"1": {"romId": 1}}}',
    'the key holding a string': '{"roms": "none"}',
    'a document of the wrong kind': '[]',
    'a bare value': '4',
    'nothing at all': '',
    'a truncated write': '{"roms": [{"romId": 1,'
  }

  for (const [what, contents] of Object.entries(shapes)) {
    test(`the index survives ${what}`, () => {
      const dir = scratch({ 'downloaded_roms.json': contents })

      const store = new Store(dir)

      assert.deepEqual(store.installed, [])
      // And still works: the file is replaced by the next thing written.
      store.addInstalled(installed({ romId: 7 }))
      assert.deepEqual(
        new Store(dir).installed.map((entry) => entry.romId),
        [7]
      )
    })

    test(`the pending list survives ${what.replace('roms', 'downloads')}`, () => {
      const dir = scratch({ 'pending_downloads.json': contents.replace('roms', 'downloads') })

      assert.deepEqual(new Store(dir).pending, [])
    })
  }

  test('entries that are not records are skipped, and the rest are kept', () => {
    // A half-written list is still worth what is readable in it.
    const dir = scratch({
      'downloaded_roms.json': '{"roms": [null, {"romId": 1}, 5, {"nope": true}, {"romId": 2}]}'
    })

    assert.deepEqual(
      new Store(dir).installed.map((entry) => entry.romId),
      [1, 2]
    )
  })

  test('settings fall back rather than taking the shape of whatever is there', () => {
    const dir = scratch({ 'settings.json': '["not", "an", "object"]' })

    const store = new Store(dir)

    assert.equal(store.settings.romStorage, 'rommix')
    assert.equal(store.server, null)
  })
})

describe('writing a state file', () => {
  test('the name never points at a partial document', () => {
    // Written beside and renamed over, so a reader sees the previous version
    // or the new one. The scratch file is not left behind either way.
    const dir = scratch()
    const store = new Store(dir)

    store.addInstalled(installed({ romId: 1 }))
    store.addInstalled(installed({ romId: 2 }))

    assert.equal(existsSync(join(dir, 'downloaded_roms.json.tmp')), false)
    assert.deepEqual(
      new Store(dir).installed.map((entry) => entry.romId),
      [1, 2]
    )
  })

  test('a write into a directory that has gone is reported, not swallowed', () => {
    // The record of an unfinished transfer is what a restart reads; a write
    // that quietly did nothing would lose it with nothing said.
    const dir = scratch()
    const store = new Store(dir)
    rmSync(dir, { recursive: true, force: true })

    assert.throws(() => store.addInstalled(installed({ romId: 1 })))
  })
})
