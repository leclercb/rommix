import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { startApp, type App } from './driver.ts'
import { startFakeRomm, type FakeRomm } from './server.ts'

/**
 * Getting signed in, which is the one screen a working RomMix cannot reach.
 *
 * Its own file because it is the only scenario that starts from nothing: every
 * other one is handed credentials so that what is under test is everything
 * after this. Here the credentials are what is under test, and there is no way
 * to have both in one application.
 *
 * Pairing rather than a token or a password, because it is the way RomMix
 * offers first and the only one that reaches `startDevicePairing` — a method
 * the unit tests cannot call at all, since it reports `app.getVersion()` and
 * there is no Electron out there to answer. Whether the body it sends is one
 * RomM would take is settled elsewhere, against the real schema; what this
 * settles is that the screen does the sequence.
 */

let server: FakeRomm
let app: App

before(async () => {
  server = await startFakeRomm()
  app = await startApp({ baseUrl: server.baseUrl, token: server.token, signedOut: true })
})

after(async () => {
  await app?.stop()
  await server?.close().catch(() => undefined)
})

describe('signing in for the first time', () => {
  test('it comes up asking for a server rather than showing a library', async () => {
    await app.waitFor(`document.querySelector('[data-screen="connect"]')`, 'the connect screen')

    // The address is empty, which is the state the button below is disabled by.
    assert.equal(
      await app.read<string>(`document.querySelector('.field__input')?.value`),
      '',
      'a first run has no server to offer'
    )
  })

  test('the address is typed in, and pairing asks the server for a code', async () => {
    await app.choose('.field__input')
    await app.waitFor(`document.activeElement?.tagName === 'INPUT'`, 'the caret in the address')
    await app.type(server.baseUrl)

    // Out of the field before pressing anything: while it holds the caret the
    // focus engine stands down, so the button cannot be walked to.
    //
    // The same press also reaches the screen's own Back, which here offers to
    // quit — this is the bottom of the stack and there is nothing behind it. So
    // leaving the address costs two presses, the second being the one the
    // dialog answers itself.
    await app.press('Escape')
    await app.waitFor(`document.activeElement?.tagName !== 'INPUT'`, 'the caret to come back')
    await app.press('Escape')
    await app.waitFor(`!document.querySelector('.overlay')`, 'the quit question to go')

    await app.choose('[data-action="start-pairing"]')

    // The code is the whole of the flow's point: it is short enough to read off
    // a television and type into a phone, and nothing secret goes the other way.
    await app.waitFor(`document.querySelector('.pair-code')`, 'the code to appear')
    assert.equal(
      await app.read<string>(`document.querySelector('.pair-code')?.textContent`),
      server.pairing()?.userCode,
      'the screen should show the code this server issued'
    )
  })

  test('and it keeps asking until somebody approves it', async () => {
    const polls = (): number =>
      server.asked.filter((one) => one.path === '/api/auth/device/token').length

    // Still on the code, and asking. RomM answers 428 until the person with the
    // phone says yes, which the client reads as "not yet" rather than as a
    // failure — a screen that gave up on the first refusal would never pair at
    // all.
    await app.waitFor(`document.querySelector('.pair-code')`, 'the code to still be up')

    // Waited for in Node, because what is being watched is what the server was
    // asked rather than anything the page shows.
    const until = Date.now() + 10_000
    while (polls() < 2 && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 100))
    }
    assert.ok(polls() >= 2, `it should keep asking; it asked ${polls()} times`)

    server.approvePairing()

    // Signed in, and on the home screen rather than one press behind it: this
    // is the start of a session, not a step into one.
    await app.waitFor(`document.querySelector('[data-screen="home"]')`, 'the home screen')
    await app.waitFor(`document.querySelector('.topbar__user')`, 'the signed-in name')
  })

  test('the token it was given is the one it uses from then on', async () => {
    // The point of pairing: what comes back is a credential, and everything
    // after it is an ordinary request carrying that credential. A screen that
    // reached the library while still unauthenticated would look identical.
    const library = server.asked.filter((one) => one.path.startsWith('/api/roms?'))
    assert.ok(library.length > 0, 'it should have fetched a library once signed in')
    assert.equal(library[library.length - 1].authorization, `Bearer ${server.token}`)
  })
})
