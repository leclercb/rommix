import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { standInEmulator, startApp, type App } from './driver.ts'
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
let emulator: ReturnType<typeof standInEmulator>

before(async () => {
  server = await startFakeRomm()
  emulator = standInEmulator()
  app = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    settings: {
      // Eden, pointed at a shell script. `emulatorPaths` is an ordinary setting
      // that exists for the person whose AppImage is somewhere RomMix does not
      // look — it is not a seam added for the tests, which is what makes a
      // launch drivable without one.
      systemEmulators: { switch: 'eden' },
      emulatorPaths: { eden: emulator.path },
      // The push after a session would otherwise stop to ask, and there is
      // nobody here to answer it.
      confirmSavePush: false
    }
  })
})

after(async () => {
  await app?.stop()
  // Tolerated, because the last scenario closes it on purpose.
  await server?.close().catch(() => undefined)
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

    await app.choose('[data-rom="1"]')
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

describe('launching a game', () => {
  test('the emulator is started with the game, and the session is reported', async () => {
    // A different game from the download above, and a Switch one on purpose:
    // Eden is one emulator rather than a core loader, so a launch here fetches
    // nothing off the internet. Through RetroArch the same test would try to
    // download a libretro core.
    await app.goTo('library')
    await app.choose('[data-rom="3"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')

    await app.choose('[data-action="download"]')
    await app.waitFor(
      `(await window.rommix.library.installed()).some((one) => one.romId === 3)`,
      'the game to arrive'
    )

    // The Play button appears in the download button's place once there is
    // something on disk to play.
    await app.choose('[data-action="play"]')

    // Up, and staying up: the overlay is what says the emulator has the screen,
    // and it is the only thing on it while a game is running.
    await app.waitFor(`document.querySelector('.overlay')`, 'the running overlay')

    // The command RomMix built, read from what the stand-in wrote down. Eden
    // takes the game after `-g`; a path assembled wrongly is an emulator that
    // starts and shows an error in its own words, long after RomMix has
    // reported a successful launch.
    const argv = await emulator.argv()
    assert.deepEqual(argv.slice(0, 2), ['-f', '-g'])
    assert.ok(argv[2]?.endsWith('testchamber.nsp'), argv.join(' '))

    // Raised while it runs, so RomM's own interface says so on every device.
    await app.waitFor(`${JSON.stringify(server.asked.length)} >= 0`, 'the app to have settled')
    assert.ok(
      server.asked.some(
        (one) => one.path === '/api/roms/3/props' && JSON.parse(one.body).now_playing === true
      ),
      'it should have told RomM the game is being played'
    )
  })

  test('and when the emulator exits, the session is accounted for', async () => {
    // The overlay comes down by itself when the process ends — nothing is
    // pressed here.
    await app.waitFor(`!document.querySelector('.overlay')`, 'the session to end')

    const played = server.asked.filter((one) => one.path === '/api/play-sessions')
    assert.ok(played.length > 0, 'it should have reported the time played')
    const body = JSON.parse(played[0].body) as { sessions: { rom_id: number }[] }
    assert.equal(body.sessions[0].rom_id, 3)

    // Lowered again, which nothing on the server ever does for us: a flag left
    // raised leaves the game in "now playing" on every device, for good.
    assert.ok(
      server.asked.some(
        (one) => one.path === '/api/roms/3/props' && JSON.parse(one.body).now_playing === false
      ),
      'it should have cleared what is playing'
    )
  })
})

/**
 * A session with saves on both sides of it.
 *
 * Its own application, with its own settings and its own throwaway home,
 * because what it needs is a different emulator: RetroArch keeps a save named
 * after the ROM, which is the shape RomM's own web player can read and the one
 * worth checking a round trip against. Eden's are a folder keyed by a title id
 * read out of the game, and this fake game has none.
 *
 * `XDG_CONFIG_HOME` is pinned so the folders RetroArch's descriptor computes
 * are folders this test knows: it is an ordinary variable the descriptor reads
 * through `xdgConfigHome`, not a seam added for testing.
 */
describe('saves either side of a session', () => {
  let saved: App
  let configHome: string
  let saveDir: string

  before(async () => {
    configHome = mkdtempSync(join(tmpdir(), 'rommix-xdg-'))
    saveDir = join(configHome, 'retroarch', 'saves')

    // The core RetroArch would otherwise stop and download before the launch.
    // Present, so `missingCore` answers null and nothing reaches the internet;
    // it is never loaded, because the emulator is a shell script.
    const coreDir = join(configHome, 'retroarch', 'cores')
    mkdirSync(coreDir, { recursive: true })
    writeFileSync(join(coreDir, 'genesis_plus_gx_libretro.so'), '')

    // Left by another device, and newer than anything here — which is what
    // makes it a save worth bringing down before the game starts.
    server.holdSave({
      romId: 1,
      fileName: 'cavestory.srm',
      // The tag RomMix files a RetroArch save under. A save tagged for another
      // emulator is deliberately not pulled into this one's folder, so getting
      // this wrong reads as a pull that quietly did nothing.
      emulator: 'retroarch',
      content: 'the save from another device'
    })

    saved = await startApp({
      baseUrl: server.baseUrl,
      token: server.token,
      settings: {
        systemEmulators: { genesis: 'retroarch' },
        emulatorPaths: { retroarch: emulator.path },
        confirmSavePush: false
      },
      env: {
        XDG_CONFIG_HOME: configHome,
        // Reaches the stand-in through `Launcher`, which hands the emulator its
        // own environment.
        ROMMIX_STAND_IN_SAVE: join(saveDir, 'cavestory.srm'),
        ROMMIX_STAND_IN_SAVE_CONTENT: 'what the session wrote'
      }
    })
  })

  after(async () => {
    await saved?.stop()
  })

  test("the server's copy is brought down before the game starts", async () => {
    await saved.waitFor(`document.querySelector('[data-screen="home"]')`, 'the home screen')
    await saved.goTo('library')
    await saved.choose('[data-rom="1"]')
    await saved.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')

    await saved.choose('[data-action="download"]')
    await saved.waitFor(
      `(await window.rommix.library.installed()).some((one) => one.romId === 1)`,
      'the game to arrive'
    )

    await saved.choose('[data-action="play"]')
    await saved.waitFor(`document.querySelector('.overlay')`, 'the running overlay')

    // On disk before the emulator could have written anything: a pull that
    // happens after the session is a pull that overwrites the session.
    const pulled = join(saveDir, 'cavestory.srm')
    assert.equal(existsSync(pulled), true, `nothing was pulled into ${saveDir}`)
    assert.ok(
      server.asked.some((one) => /^\/api\/saves\/\d+\/content$/.test(one.path)),
      'it should have fetched the save itself, not only listed it'
    )
  })

  test('and what the session wrote goes back up', async () => {
    await saved.waitFor(`!document.querySelector('.overlay')`, 'the session to end')

    // The file the emulator left, not the one pulled down: a push that sent the
    // copy it had just brought down would be a round trip that loses the game.
    assert.equal(readFileSync(join(saveDir, 'cavestory.srm'), 'utf8'), 'what the session wrote')

    const sent = server.uploaded.filter((one) => one.romId === 1)
    assert.equal(sent.length, 1, `uploads: ${JSON.stringify(server.uploaded)}`)
    assert.equal(sent[0].emulator, 'retroarch')
    // Under the name RomM files it by, which is what another device pulls it
    // down as.
    assert.ok(sent[0].body.includes('cavestory.srm'), sent[0].body.slice(0, 200))
  })
})

/**
 * Last on purpose: it takes the server away and does not put it back.
 */
describe('when the server goes away', () => {
  test('it says so, and still shows what is on this disk', async () => {
    // The failure this is really about: a screen that goes blank, or one that
    // sits on a spinner, when the answer — the games are right here on the
    // disk — is one RomMix already has. Nothing below the main process can be
    // asked this question; the fallback is decided there and shown here.
    await server.close()

    await app.goTo('library')
    await app.waitFor(`document.querySelector('.notice--warn')`, 'the offline notice')

    // Named rather than merely marked offline: "offline" on its own reads as a
    // setting somebody turned on.
    await app.waitFor(`document.querySelector('.topbar__user')`, 'the status in the bar')

    // Both games downloaded above are still listed, from the local index.
    await app.waitFor(
      `document.querySelector('[data-rom="1"]') && document.querySelector('[data-rom="3"]')`,
      'the downloaded games'
    )

    // And the one that was never downloaded is not: offline, the library is
    // what this disk holds, and offering a game that cannot be fetched would
    // be a download button that fails on every press.
    assert.equal(
      await app.read<boolean>(`Boolean(document.querySelector('[data-rom="2"]'))`),
      false
    )
  })
})
