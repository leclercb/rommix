import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { existsSync } from 'node:fs'
import { startApp, type App } from './driver.ts'
import { startFakeRomm, type FakeRomm } from './server.ts'

/**
 * The built application, driven from outside, against a server that is not
 * real.
 *
 * Everything under `src/**` is tested a module at a time and deliberately
 * leaves out the renderer, the IPC wiring and the preload bridge. This is the
 * only thing that runs all three together, and the failure it exists to catch
 * is the one nothing else can see: an IPC channel renamed in `src/main/ipc/`
 * and not in `src/preload/` typechecks, lints, passes every unit test and
 * builds perfectly.
 *
 * Needs `npm run build` to have run, because what it drives is `out/` — the
 * real bundle, not the sources. And it needs an Electron that this machine can
 * execute and somewhere to put a window: on a headless CI runner that means
 * `xvfb-run`, and on NixOS it means the `electron` from the system profile,
 * which `.envrc` points `ELECTRON_EXEC_PATH` at.
 *
 * The screens are found by the handles they carry on purpose — `data-screen`,
 * `data-route`, `data-action` — never by their text, which changes with the
 * language, nor by position, which changes whenever a button is added.
 */

let server: FakeRomm
let app: App

before(async () => {
  server = await startFakeRomm()
  app = await startApp({ baseUrl: server.baseUrl, token: server.token })
})

after(async () => {
  await app?.stop()
  await server?.close()
})

describe('starting up', () => {
  test('it comes up signed in, on the home screen', async () => {
    // Seeded credentials rather than a driven sign-in: what is under test is
    // everything after it, and a pairing flow would need a web UI to approve
    // the code on. See `seed` in the driver.
    await app.waitFor(`document.querySelector('[data-screen="home"]')`, 'the home screen')
  })

  test('it reached the server, and said who it was', async () => {
    await app.waitFor(`document.querySelector('.topbar__user')`, 'the signed-in name')
    const asked = server.asked.filter((one) => one.path === '/api/users/me')
    assert.ok(asked.length > 0, 'it should have asked who it is signed in as')
    assert.equal(asked[0].authorization, `Bearer ${server.token}`)
  })

  test('the library it drew is the one the server sent', async () => {
    // Waited for rather than read straight away: the shelves are filled from a
    // request, and a screen that is up is not yet a screen that has answers.
    await app.waitFor(`document.querySelector('.card__title')`, 'the shelves to fill')
    const names = await app.read<string[]>(
      `[...document.querySelectorAll('.card__title')].map((one) => one.textContent)`
    )
    // Not an exact list: the home screen shows shelves rather than everything,
    // and what matters is that a game the fake serves reached the screen at all.
    assert.ok(
      names.some((name) => name?.includes('Cave Story')),
      `the home screen drew ${JSON.stringify(names)}`
    )
  })
})

describe('moving around', () => {
  test('the navigation bar goes where its items say they go', async () => {
    // `data-route` rather than the label: this test should not fail because
    // somebody improved the wording, and should not pass only in English.
    await app.goTo('downloads')
    await app.waitFor(`document.querySelector('[data-screen="downloads"]')`, 'the downloads screen')
  })

  test('back out of a section offers to quit rather than doing it', async () => {
    // The highlight is in the navigation bar, having just chosen from it, and
    // there is nowhere further back to go — so the press that would leave
    // RomMix asks first. The same press arrives here by accident, which is the
    // whole reason it asks. See `back` in App.tsx.
    await app.press('Escape')
    await app.waitFor(`document.querySelector('.overlay')`, 'the quit confirmation')

    // The dialog answers Back itself, which is what makes the accident cost
    // one press rather than a lost session.
    await app.press('Escape')
    await app.waitFor(`!document.querySelector('.overlay')`, 'the confirmation to close')
  })

  test('and back to where it started', async () => {
    await app.goTo('home')
    await app.waitFor(`document.querySelector('[data-screen="home"]')`, 'the home screen again')
  })
})

describe('downloading a game', () => {
  test('the file lands on this disk and the queue says so', async () => {
    await app.goTo('library')
    await app.waitFor(`document.querySelector('[data-screen="library"]')`, 'the library')

    await app.choose('.card')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'a game screen')

    await app.choose('[data-action="download"]')

    // Asked of the main process over IPC rather than read off the screen: the
    // index is the answer that matters — a row that says "Done" over a file
    // that is not there is the failure, not the success.
    await app.waitFor(
      `(await window.rommix.library.installed()).length > 0`,
      'the transfer to finish'
    )

    const content = server.asked.filter((one) => /\/content\//.test(one.path))
    assert.ok(content.length > 0, 'it should have fetched the ROM itself')

    // On disk under the name RomM gave it, which is the name an emulator's own
    // scanner has to find.
    const roms = await app.read<{ path: string }[]>(
      `(await window.rommix.library.installed()).map(({ path }) => ({ path }))`
    )
    assert.equal(roms.length, 1)
    assert.ok(roms[0].path.endsWith('cavestory.md'), roms[0].path)
    assert.equal(existsSync(roms[0].path), true)
  })
})
