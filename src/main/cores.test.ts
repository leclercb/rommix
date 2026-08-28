import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EmulatorState, RequiredCore } from '@config/emulators'
import { coreInstalled, installCore, missingCore } from './cores.ts'
import { zipDirectory } from './zip.ts'

/**
 * The libretro core a launch needs, and putting one on disk.
 *
 * The failure this file is about is the one that heals nothing: a truncated
 * core in the directory RetroArch loads from reads as installed, so the install
 * is never retried, and every launch from then on dies inside the emulator with
 * a message that names neither RomMix nor the download. Hence the assertions on
 * what is left behind when a download or an archive goes wrong — those matter
 * more than the happy path.
 */

const real = globalThis.fetch
const scratches: string[] = []

afterEach(() => {
  globalThis.fetch = real
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-cores-test-'))
  scratches.push(dir)
  return dir
}

function core(fields: Partial<RequiredCore> = {}): RequiredCore {
  return {
    id: 'mupen64plus_next',
    name: 'Mupen64Plus-Next',
    dir: scratch(),
    fileName: 'mupen64plus_next_libretro.so',
    buildbotUrl: 'http://buildbot.example/nightly/linux/x86_64/latest/',
    ...fields
  }
}

/** An archive holding whatever the buildbot is pretending to publish. */
async function archive(files: Record<string, string>): Promise<Buffer> {
  const source = scratch()
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(source, name), contents)
  const zip = join(scratch(), 'core.zip')
  await zipDirectory(source, zip)
  return readFileSync(zip)
}

function serve(reply: (url: string) => Response): string[] {
  const asked: string[] = []
  globalThis.fetch = ((input: string) => {
    asked.push(String(input))
    return Promise.resolve(reply(String(input)))
  }) as typeof globalThis.fetch
  return asked
}

describe('whether a core has to be installed at all', () => {
  test('a core already in the emulator own folder is not missing', async () => {
    const required = core()
    writeFileSync(join(required.dir, required.fileName), 'so')

    assert.equal(await coreInstalled(required), true)
  })

  test('an emulator that ships its own cores never asks for one', async () => {
    const state = { id: 'retrodeck', configDir: null } as EmulatorState

    assert.equal(await missingCore(state, 'n64'), null)
  })

  test('a core the emulator needs and does not have is named', async () => {
    const dir = scratch()
    const state = {
      id: 'retroarch',
      configDir: dir,
      paths: { home: dir, roms: dir, saves: dir, states: dir, bios: dir }
    } as EmulatorState

    const required = await missingCore(state, 'n64')

    assert.ok(required)
    assert.match(required.fileName, /_libretro\.so$/)
  })
})

describe('installing one', () => {
  test('it arrives over https even when the config asked for plain http', async () => {
    const required = core()
    const asked = serve(() => new Response(''))

    await installCore(required, () => undefined).catch(() => undefined)

    assert.match(asked[0], /^https:\/\//)
    assert.ok(asked[0].endsWith(`${required.fileName}.zip`))
  })

  test('the core lands where the emulator loads cores from', async () => {
    const required = core()
    const payload = await archive({ [required.fileName]: 'ELF' })
    serve(() => new Response(payload))
    const progress: number[] = []

    await installCore(required, (update) => progress.push(update.receivedBytes))

    assert.equal(readFileSync(join(required.dir, required.fileName), 'utf8'), 'ELF')
    assert.ok(progress.length > 0)
  })

  test('an archive without the file the emulator will ask for installs nothing', async () => {
    const required = core()
    const payload = await archive({ 'something_else_libretro.so': 'ELF' })
    serve(() => new Response(payload))

    await assert.rejects(() => installCore(required, () => undefined))
    assert.equal(existsSync(join(required.dir, required.fileName)), false)
  })

  test('a refused download leaves the cores folder exactly as it was', async () => {
    const required = core()
    mkdirSync(required.dir, { recursive: true })
    serve(() => new Response('nope', { status: 503 }))

    await assert.rejects(() => installCore(required, () => undefined), /503/)
    assert.deepEqual(await readdir(required.dir), [])
  })

  test('nothing part-written is left in the folder the emulator scans', async () => {
    const required = core()
    const payload = await archive({ 'wrong_libretro.so': 'ELF' })
    serve(() => new Response(payload))

    await assert.rejects(() => installCore(required, () => undefined))

    // Not even the `.part` the copy goes through: a stray file in this folder
    // is one RetroArch will try to load.
    assert.deepEqual(await readdir(required.dir), [])
  })
})
