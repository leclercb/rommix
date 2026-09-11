import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atHome, standInEmulator, startApp, type App } from './driver.ts'
import { startFakeRomm, type FakeRomm } from './server.ts'

/**
 * The machine RomM has to know about before a save can name it.
 *
 * RomM resolves `device_id` against its own devices table and refuses an upload
 * naming one that is not in it. Pairing hands that id back with the token — a
 * client token typed in or a username and password do not, and the identifier
 * RomMix generated for itself is not a device on the server until something
 * asks for one. So a client signed in either of those two ways has to register
 * before its first upload, and the only thing that can prove it did is a save
 * going up with a device on it.
 *
 * Its own file because the application cannot be shared: every other one in
 * this suite is seeded with credentials that already carry a device id, which
 * is the single state in which none of this happens. The sign-in is driven
 * rather than seeded for the same reason — what a grant writes to disk is the
 * subject, not a shortcut past it.
 */

let server: FakeRomm
let app: App
let emulator: ReturnType<typeof standInEmulator>
let saveDir: string

before(async () => {
  server = await startFakeRomm()
  emulator = standInEmulator()
  const configHome = mkdtempSync(join(tmpdir(), 'rommix-device-xdg-'))
  saveDir = join(configHome, 'retroarch', 'saves')

  app = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    // Nothing on disk to sign in with, which is what makes the credentials
    // below the ones this sign-in wrote.
    signedOut: true,
    settings: {
      systemEmulators: { genesis: 'retroarch' },
      emulatorPaths: { retroarch: emulator.path },
      // The push is the thing being watched; a question in front of it is one
      // more press between the sign-in and the answer.
      confirmSavePush: false
    },
    env: { XDG_CONFIG_HOME: configHome }
  })
})

after(async () => {
  await app?.stop()
  await server?.close().catch(() => undefined)
})

/** Type into one of the sign-in boxes. The caret decides where text lands. */
async function fill(field: string, text: string): Promise<void> {
  await app.choose(`[data-field="${field}"]`)
  await app.waitFor(`document.activeElement?.tagName === 'INPUT'`, `the caret in ${field}`)
  await app.read(`document.activeElement.setSelectionRange(0, document.activeElement.value.length)`)
  await app.type(text)
  await app.press('Escape')
  await app.waitFor(`document.activeElement?.tagName !== 'INPUT'`, 'the caret to come back')
  await app.press('Escape')
  await app.waitFor(`!document.querySelector('.overlay')`, 'the quit question to go')
}

/** Every request to the devices endpoint so far, by method. */
const devicesAsked = (method: string): number =>
  server.asked.filter((one) => one.method === method && one.path === '/api/devices').length

/** Download the one game this file uses, and leave a save beside it. */
async function aSaveWaitingToGoUp(content: string): Promise<void> {
  await app.goTo('library')
  await app.choose('[data-rom="1"]')
  await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
  if (await app.read<boolean>(`Boolean(document.querySelector('[data-action="download"]'))`)) {
    await app.choose('[data-action="download"]')
    await app.waitFor(
      `(await window.rommix.library.installed()).some((one) => one.romId === 1)`,
      'the game to arrive'
    )
  }
  // Written rather than played: what a session adds here is eight seconds and
  // an emulator, and neither is what decides whether the upload names a device.
  mkdirSync(saveDir, { recursive: true })
  writeFileSync(join(saveDir, 'cavestory.srm'), content)
}

describe('a client that signed in with a token', () => {
  test('it registers nothing on the way in', async () => {
    await app.waitFor(`document.querySelector('[data-screen="setup"]')`, 'the sign-in screen')
    await fill('server', server.baseUrl)
    await app.choose('[data-option="token"]')
    await fill('token', server.token)
    await app.choose('[data-action="connect"]')
    // Settled rather than merely arrived: everything below walks to a section,
    // and a home screen still filling moves the highlight underneath it. See
    // `atHome`.
    await atHome(app)

    // Signing in is not the moment. A device is a thing saves are filed under,
    // and a client that never pushes one should never appear in somebody's
    // device list for having opened the application.
    assert.equal(devicesAsked('POST'), 0, 'signing in should have registered nothing')
  })

  test('and asks RomM to record it when a save first needs a name', async () => {
    await aSaveWaitingToGoUp('what the sofa session wrote')

    await app.goTo('library')
    await app.choose('[data-rom="1"]')
    await app.waitFor(`document.querySelector('[data-action="push-saves"]')`, 'the game screen')
    await app.choose('[data-action="push-saves"]')

    // Watched on the server rather than on the screen: the upload is what
    // carries the device, and the screen says the same thing whether or not it
    // did. See `uploadSave`.
    const until = Date.now() + 15_000
    while (server.uploaded.length === 0 && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 100))
    }
    assert.equal(server.uploaded.length, 1, 'the save should have gone up')

    // Looked for first, then created: a machine that paired once and signed in
    // again with a token is already in RomM's table under the identifier RomMix
    // chose for it, and registering blind would stand a second device beside
    // the one that is there.
    assert.ok(devicesAsked('GET') > 0, 'it should have looked for this machine first')
    assert.equal(devicesAsked('POST'), 1, 'and asked for exactly one device')

    // The id RomM handed back, not the identifier RomMix generated for itself:
    // the second is what the registration is *about*, and an upload naming it
    // is one RomM refuses.
    assert.equal(server.uploaded[0].deviceId, 'a-registered-device')
  })

  test('and does not ask again, because the answer is kept with the credentials', async () => {
    writeFileSync(join(saveDir, 'cavestory.srm'), 'another evening')

    await app.goTo('library')
    await app.choose('[data-rom="1"]')
    await app.waitFor(`document.querySelector('[data-action="push-saves"]')`, 'the game screen')
    await app.choose('[data-action="push-saves"]')

    const until = Date.now() + 15_000
    while (server.uploaded.length < 2 && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 100))
    }
    assert.equal(server.uploaded.length, 2, 'the second save should have gone up too')

    // One registration for the session, not one per push: the id is written
    // beside the token that obtained it, so every save after the first names it
    // without asking anybody.
    assert.equal(devicesAsked('POST'), 1, 'it should not have registered a second time')
    assert.equal(server.uploaded[1].deviceId, 'a-registered-device')
  })
})

describe('and one that signed in with a username and password', () => {
  test('signing out takes the device with the credentials', async () => {
    await app.goTo('settings')
    await app.waitFor(`document.querySelector('[data-action="disconnect"]')`, 'the way out')
    await app.choose('[data-action="disconnect"]')
    await app.waitFor(`document.querySelector('[data-screen="setup"]')`, 'the sign-in screen')

    // The device belongs to the account rather than to the machine, so it
    // cannot outlive the credentials it was issued against — a saved id reused
    // after signing in as somebody else would file this machine's saves under a
    // device on another account.
    assert.equal(
      await app.read<string | null>(`(await window.rommix.server.status()).baseUrl ?? null`),
      null,
      'signing out should have let the server go'
    )
  })

  test('and the grant registers for one of its own before its first save', async () => {
    await fill('server', server.baseUrl)
    await app.choose('[data-option="password"]')
    await fill('username', server.signIn.username)
    await fill('password', server.signIn.password)
    await app.choose('[data-action="connect"]')
    await atHome(app)

    await aSaveWaitingToGoUp('and one more after signing back in')
    await app.goTo('library')
    await app.choose('[data-rom="1"]')
    await app.waitFor(`document.querySelector('[data-action="push-saves"]')`, 'the game screen')
    await app.choose('[data-action="push-saves"]')

    const until = Date.now() + 15_000
    while (server.uploaded.length < 3 && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 100))
    }
    assert.equal(server.uploaded.length, 3, 'the save should have gone up')

    // A second registration, which is the point of the scenario above: the
    // grant's token is not the one the first id was issued against, so the
    // client cannot carry that id over and has to ask again.
    assert.equal(devicesAsked('POST'), 2, 'a new session should have registered again')
    assert.equal(server.uploaded[2].deviceId, 'a-registered-device')
  })
})
