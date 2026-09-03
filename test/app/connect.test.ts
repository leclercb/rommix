import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/**
 * And out again, which is the only way back to the screen above.
 *
 * Here rather than anywhere else for the same reason as the rest of this file:
 * signing out takes the server away from the application it is pressed in, and
 * every other suite is a session that has to keep one. This application has
 * already done what it was started for.
 */
describe('signing out again', () => {
  test('it takes the credentials away and goes back to the sign-in screen', async () => {
    await app.goTo('settings')
    await app.waitFor(`document.querySelector('[data-screen="settings"]')`, 'the settings screen')

    // Named on the page before it is pressed: this is the one button whose
    // consequence is the whole session, and it reads as safe next to Language.
    await app.waitFor(
      `document.body.textContent.includes(${JSON.stringify(server.baseUrl)})`,
      'the server it is about to disconnect from'
    )

    await app.choose('[data-action="disconnect"]')

    // Back at the beginning, not merely one screen behind: every screen in the
    // stack was a view of a library there is no longer a server for.
    await app.waitFor(`document.querySelector('[data-screen="connect"]')`, 'the connect screen')
    assert.equal(
      await app.read<boolean>(`(await window.rommix.server.status()).configured`),
      false,
      'the credentials should be gone rather than merely unused'
    )
  })

  test('and it stops asking the server anything', async () => {
    // Signed out is not the same as offline: the point of this state is that
    // there is nothing to ask with, so a screen still polling would be one
    // failing request a second behind a page that says to sign in.
    const askedSoFar = server.asked.length
    await app.waitFor(`document.querySelector('.field__input')`, 'the address field')

    const until = Date.now() + 3000
    while (Date.now() < until) await new Promise((done) => setTimeout(done, 250))

    // The heartbeat is the exception: the screen checks an address as it is
    // typed, and this one has nothing typed into it yet.
    assert.deepEqual(
      server.asked.slice(askedSoFar).map((one) => one.path),
      [],
      'nothing should be asked of a server this device has signed out of'
    )
  })
})

/**
 * The other two ways in.
 *
 * RomM takes three, and pairing is only the one RomMix offers first. A user on
 * a version without device auth, or one who would rather paste the token from
 * RomM's own admin page, uses these — and neither had ever been driven, so the
 * password grant was a request the fake had no route for at all.
 *
 * Signed out first by the scenario above, which is what makes these the same
 * application rather than another one.
 */

/**
 * Type into one box on the sign-in screen, over whatever it already holds.
 *
 * Selected first because the form is not emptied between attempts — signing
 * out replaces the route, not the screen, so the address stays where it was
 * typed and appending to it produces an address that is not one.
 *
 * Leaving the box costs two presses, for the reason the pairing scenario
 * gives: the first leaves the field and reaches the screen's own Back, which
 * at the bottom of the stack offers to quit, and the second answers that.
 */
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

/** Sign out, which is also how the form is emptied between attempts. */
async function signOut(): Promise<void> {
  await app.goTo('settings')
  await app.waitFor(`document.querySelector('[data-action="disconnect"]')`, 'the way out')
  await app.choose('[data-action="disconnect"]')
  await app.waitFor(`document.querySelector('[data-screen="connect"]')`, 'the sign-in screen')
}

describe('signing in with a token instead', () => {
  test('the token typed in is what every later request carries', async () => {
    await app.waitFor(`document.querySelector('[data-screen="connect"]')`, 'the sign-in screen')
    await fill('server', server.baseUrl)

    // The mode is a control rather than a screen, so the box for the answer
    // appears where the explanation of pairing was.
    await app.choose('[data-option="token"]')
    await fill('token', server.token)

    const askedSoFar = server.asked.length
    await app.choose('[data-action="connect"]')
    await app.waitFor(`document.querySelector('[data-screen="home"]')`, 'the home screen')

    // Nothing was left on this disk to sign in with — the scenario above took
    // it away — so a request that is authorised at all is one carrying what
    // was typed here.
    const authorised = server.asked
      .slice(askedSoFar)
      .filter((one) => one.path.startsWith('/api/roms?'))
    assert.ok(authorised.length > 0, 'it should have fetched a library once signed in')
    assert.equal(authorised[authorised.length - 1].authorization, `Bearer ${server.token}`)
  })
})

describe('and with a username and password', () => {
  test('the grant hands back a token, and that is what is used', async () => {
    await signOut()
    await fill('server', server.baseUrl)
    await app.choose('[data-option="password"]')
    await fill('username', server.signIn.username)
    await fill('password', server.signIn.password)

    const askedSoFar = server.asked.length
    await app.choose('[data-action="connect"]')
    await app.waitFor(`document.querySelector('[data-screen="home"]')`, 'the home screen')

    // The grant's own token rather than anything already here: this is the one
    // mode where what RomMix carries afterwards was issued by the sign-in
    // rather than typed in by the user.
    const authorised = server.asked
      .slice(askedSoFar)
      .filter((one) => one.path.startsWith('/api/roms?'))
    assert.ok(authorised.length > 0, 'it should have fetched a library once signed in')
    assert.equal(
      authorised[authorised.length - 1].authorization,
      `Bearer ${server.grantedToken}`,
      'it should carry what the grant returned'
    )
  })

  test('and a wrong password is refused, on the screen rather than in a log', async () => {
    // Signed out rather than corrected, because that is what empties the form:
    // the screen is replaced, and an attempt starts from nothing again.
    await signOut()
    await fill('server', server.baseUrl)
    await app.choose('[data-option="password"]')
    await fill('username', server.signIn.username)
    await fill('password', 'not the password')

    await app.choose('[data-action="connect"]')

    // RomM answers 401, which is the one status this screen has a sentence of
    // its own for. Said out loud and staying put: a form that goes quiet is one
    // nobody knows what to do with.
    await app.waitFor(`document.querySelector('.notice--error')`, 'the refusal')
    await app.waitFor(
      `document.querySelector('[data-screen="connect"]')`,
      'the screen to stay where it is'
    )
    assert.equal(
      await app.read<boolean>(`(await window.rommix.server.status()).connected`),
      false,
      'a refused sign-in should leave it signed out'
    )
  })
})

/**
 * The first run, which every other application here is seeded past.
 *
 * `setupComplete` is written true by the harness so that what comes up is the
 * sign-in form — otherwise every scenario in every file would answer these
 * three pages first. Which left them drawn by nothing: the text size and where
 * games are stored are only ever asked here, and the flag that ends the wizard
 * is only ever set by getting to the end of it.
 *
 * Its own application for that one setting, and the last in this file: three is
 * the ceiling, and this is the third.
 */
describe('the first run', () => {
  let fresh: App

  before(async () => {
    fresh = await startApp({
      baseUrl: server.baseUrl,
      token: server.token,
      signedOut: true,
      settings: { setupComplete: false },
      // A configuration directory of its own. Two Electrons sharing one refuse
      // to be two: the second finds the first's profile locked and goes away
      // again, taking its debugger with it — which is why every other file that
      // starts a second application pins this too.
      env: { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'rommix-first-run-')) }
    })
    await fresh.waitFor(`document.querySelector('[data-screen="connect"]')`, 'the first page')
  })

  after(async () => {
    await fresh?.stop()
  })

  test('it opens on a question rather than on the sign-in form', async () => {
    // The text size first, because it is the one answer that changes how the
    // rest of the wizard is read.
    await fresh.waitFor(`document.querySelector('[data-option="1.25"]')`, 'the sizes on offer')
    assert.equal(
      await fresh.read<boolean>(`Boolean(document.querySelector('[data-field="server"]'))`),
      false,
      'the sign-in form should be three pages away'
    )

    // Nothing behind the first page, which is what leaving Back unbound means.
    assert.equal(
      await fresh.read<boolean>(`Boolean(document.querySelector('[data-action="setup-back"]'))`),
      false
    )
  })

  test('an answer is kept as it is given, not at the end', async () => {
    // Saved on the press rather than gathered up and written at the end: the
    // scale is applied as it is chosen, which is the only way to see whether
    // the size being picked is the one that suits the room.
    await fresh.choose('[data-option="1"]')
    await fresh.waitFor(
      `(await window.rommix.system.settings()).uiScale === 1`,
      'the size to be kept'
    )

    await fresh.choose('[data-action="setup-next"]')
    await fresh.waitFor(`document.querySelector('[data-option="emulator"]')`, 'where games go')
    await fresh.choose('[data-option="emulator"]')
    await fresh.waitFor(
      `(await window.rommix.system.settings()).romStorage === 'emulator'`,
      'the storage answer to be kept'
    )
  })

  test('and going back to change one does not lose the other', async () => {
    await fresh.choose('[data-action="setup-back"]')
    await fresh.waitFor(
      `document.querySelector('[data-option="1"]')?.dataset.active === 'true'`,
      'the size chosen a moment ago'
    )

    await fresh.choose('[data-action="setup-next"]')
    await fresh.waitFor(
      `document.querySelector('[data-option="emulator"]')?.dataset.active === 'true'`,
      'and the answer this page already had'
    )
  })

  test('the last page is the sign-in form, and answering it ends the setup', async () => {
    await fresh.choose('[data-action="setup-next"]')
    await fresh.waitFor(`document.querySelector('[data-field="server"]')`, 'the sign-in form')

    // Still unfinished here. The flag is what decides whether this wizard is
    // ever shown again, so it is set by a server answering rather than by the
    // questions having been walked past.
    assert.equal(
      await fresh.read<boolean>(`(await window.rommix.system.settings()).setupComplete`),
      false
    )

    /**
     * Fill one box, and come back to the page it is on.
     *
     * Leaving a field is one press of Back, and inside the wizard Back is a
     * page rather than the quit question — so the way out of a box is out of
     * the page, and the way on is the button that brought it up. What is typed
     * survives the trip, which is the other half of what this checks.
     */
    const answer = async (field: string, text: string): Promise<void> => {
      await fresh.choose(`[data-field="${field}"]`)
      await fresh.waitFor(`document.activeElement?.tagName === 'INPUT'`, `the caret in ${field}`)
      await fresh.type(text)
      await fresh.press('Escape')
      await fresh.waitFor(`document.querySelector('[data-option="emulator"]')`, 'the page behind')
      await fresh.choose('[data-action="setup-next"]')
      await fresh.waitFor(`document.querySelector('[data-field="server"]')`, 'the form again')
    }

    await answer('server', server.baseUrl)
    assert.equal(
      await fresh.read<string>(`document.querySelector('[data-field="server"]')?.value`),
      server.baseUrl,
      'the address should have survived the page it was typed on being left'
    )

    await fresh.choose('[data-option="token"]')
    await answer('token', server.token)

    await fresh.choose('[data-action="connect"]')
    await fresh.waitFor(`document.querySelector('[data-screen="home"]')`, 'the home screen')

    // And now it is over, for good: the questions are behind a flag rather than
    // behind a server, so a session that signs out later comes back to the
    // sign-in form and not to page one of three.
    await fresh.waitFor(
      `(await window.rommix.system.settings()).setupComplete === true`,
      'the setup to be over'
    )
  })
})
