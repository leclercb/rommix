import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { standInEmulator, startApp, type App } from './driver.ts'
import { startScenario, type Scenario } from './harness.ts'
import type { FakeRomm } from './server.ts'

/**
 * One session with a library, from signing in to the server going away.
 *
 * These run in order and each leaves the next something to work with: a game
 * downloaded here is the game launched below, and the save that comes back down
 * is the one that session wrote. Read top to bottom, it is what somebody
 * actually does with RomMix over an evening — which is the only way to reach
 * the states worth testing, since none of them can be seeded from outside
 * without also seeding away the thing under test.
 *
 * The screens themselves are `interface.test.ts`, which needs nothing on disk
 * and can be read in any order.
 *
 * Needs `npm run build` to have run, because what it drives is `out/` — the
 * real bundle, not the sources. And it needs an Electron that this machine can
 * execute and somewhere to put a window: on a headless CI runner that means
 * `xvfb-run`, and on NixOS it means the `electron` from the system profile,
 * which `.envrc` points `ELECTRON_EXEC_PATH` at.
 */

let scenario: Scenario
let server: FakeRomm
let app: App
let emulator: Scenario['emulator']

before(async () => {
  scenario = await startScenario()
  ;({ server, app, emulator } = scenario)
})

after(async () => {
  await scenario?.stop()
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

describe('downloading a game of several files', () => {
  test('every file arrives, in a folder of its own, and the set is launchable', async () => {
    // Fetched one file at a time rather than as one archive: these are ordinary
    // files on RomM's disk, so each can be resumed and the sum of them is
    // smaller than a zip around bytes it does not compress. That the fake can
    // serve this path faithfully is the reason it is worth a scenario — the
    // other path, an archive built per request, it cannot. See TODO.md.
    await app.goTo('library')
    await app.choose('[data-rom="4"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')

    await app.choose('[data-action="download"]')
    await app.waitFor(
      `(await window.rommix.library.installed()).some((one) => one.romId === 4)`,
      'the disc set to arrive'
    )

    const entry = await app.read<{
      path: string
      launchPath: string
      files: string[]
      isDirectory: boolean
    }>(`(await window.rommix.library.installed()).find((one) => one.romId === 4)`)

    // A folder of its own, because a disc set that lands loose among every
    // other game on the platform is one nothing can keep together.
    assert.equal(entry.isDirectory, true)
    assert.deepEqual(entry.files.slice().sort(), [
      'Disc Adventure (Track 1).bin',
      'Disc Adventure.cue'
    ])
    for (const file of entry.files) {
      assert.equal(
        existsSync(join(entry.path, file)),
        true,
        `${file} is missing from ${entry.path}`
      )
    }

    // The descriptor, not the largest file: handing an emulator the `.bin` of a
    // disc set starts nothing, and which file to hand it is decided at install
    // time and recorded here.
    assert.ok(entry.launchPath.endsWith('.cue'), entry.launchPath)

    // Asked for by file id, twice — one request per file, and never the game's
    // own content endpoint, which is where the archive would have come from.
    const perFile = server.asked.filter((one) => /\/files\/content\//.test(one.path))
    assert.ok(perFile.length >= 2, `only asked for ${perFile.length} files`)
    assert.equal(
      server.asked.some((one) => one.path.startsWith('/api/roms/4/content/')),
      false,
      'it should not have fallen back to the archive'
    )
  })
})

describe('uninstalling a game', () => {
  test('it asks first, and then the whole folder goes', async () => {
    // The disc set rather than the single file, because it is the shape with
    // something to get wrong: the game is a folder, and a delete that removed
    // the file it launches by would leave the rest behind — an empty-ish
    // directory that `adopt` reads back as a game already on disk, installed
    // and unplayable and refusing to download again.
    const discSet = await app.read<{ path: string; files: string[] }>(
      `(await window.rommix.library.installed()).find((one) => one.romId === 4)`
    )
    assert.notEqual(discSet, undefined, 'the disc set should still be installed')

    await app.goTo('library')
    await app.choose('[data-rom="4"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')

    await app.choose('[data-action="uninstall"]')

    // Asked rather than done: one press on a focused danger button would
    // otherwise throw away a download of several gigabytes.
    await app.waitFor(`document.querySelector('.overlay')`, 'the confirmation')
    assert.equal(existsSync(discSet.path), true, 'nothing should be gone before it is confirmed')

    await app.choose('[data-action="uninstall-confirm"]')

    await app.waitFor(
      `!(await window.rommix.library.installed()).some((one) => one.romId === 4)`,
      'the game to leave the index'
    )

    // The folder and everything in it. An empty directory left behind is a
    // game RomMix would believe in again on the next pass.
    assert.equal(existsSync(discSet.path), false, `${discSet.path} is still there`)
    for (const file of discSet.files) {
      assert.equal(existsSync(join(discSet.path, file)), false, `${file} survived`)
    }
  })
})

describe('pausing a download and picking it up again', () => {
  test('what arrived is kept, and the rest is asked for by range', async () => {
    // The one game the fake serves slowly, because a transfer that is over
    // before the first key press cannot be interrupted. Everything under test
    // here is in `transfer.ts`, and this is the only place it runs against a
    // real socket rather than a stubbed fetch.
    await app.goTo('library')
    await app.choose('[data-rom="5"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await app.choose('[data-action="download"]')

    // Part-way, and not finished: pausing something already done proves
    // nothing, and pausing before a byte has landed leaves nothing to resume
    // onto.
    await app.waitFor(
      `(await window.rommix.downloads.list()).some(
         (one) => one.romId === 5 && one.state === 'downloading' && one.receivedBytes > 0
       )`,
      'the transfer to be under way'
    )

    await app.choose('[data-action="pause"]')
    await app.waitFor(
      `(await window.rommix.downloads.list()).some(
         (one) => one.romId === 5 && one.state === 'paused'
       )`,
      'the transfer to stop'
    )

    const stopped = await app.read<{ receivedBytes: number; totalBytes: number }>(
      `(await window.rommix.downloads.list()).find((one) => one.romId === 5)`
    )
    assert.ok(stopped.receivedBytes > 0, 'it should have kept what had arrived')
    assert.ok(
      stopped.receivedBytes < stopped.totalBytes,
      `it finished before it could be paused: ${JSON.stringify(stopped)}`
    )

    // The same button, which is what the screen offers: what the player wants
    // is the game, and whether that means starting or finishing a transfer is
    // not a second decision to make.
    await app.choose('[data-action="download"]')
    await app.waitFor(
      `(await window.rommix.library.installed()).some((one) => one.romId === 5)`,
      'the transfer to finish'
    )

    // Picked up rather than started again: a range was asked for, and it began
    // where the first attempt stopped. Without this the test would pass just as
    // well over a download that quietly fetched the whole file twice.
    const ranged = server.asked.filter(
      (one) => one.path.startsWith('/api/roms/5/content/') && one.range !== null
    )
    assert.ok(ranged.length > 0, 'the resumed transfer should have asked for a range')
    assert.ok(
      ranged.some((one) => one.range !== 'bytes=0-0' && one.range !== 'bytes=0-'),
      `every range asked for started from nothing: ${ranged.map((one) => one.range).join(', ')}`
    )

    // And the whole game is there, which is the point of keeping the bytes: a
    // resume onto the wrong offset produces a file of the right size that no
    // emulator will load, and the hash is what refuses it.
    const entry = await app.read<{ path: string; sizeBytes: number }>(
      `(await window.rommix.library.installed()).find((one) => one.romId === 5)`
    )
    assert.equal(statSync(entry.path).size, stopped.totalBytes)
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
  /** Its own, so what it wrote down belongs to this session and no other. */
  let retroarch: ReturnType<typeof standInEmulator>

  before(async () => {
    retroarch = standInEmulator()
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
        emulatorPaths: { retroarch: retroarch.path },
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

    // Asked of the emulator rather than of the disk. `launch` pulls before it
    // spawns, so what the stand-in found when it started is what the pull left
    // — and it is the only account of that moment which the session cannot
    // have overwritten by the time a test looks.
    //
    // The overlay is no answer here: it goes up the moment Play is pressed,
    // ahead of the core check and the pull both, so a machine slow enough to
    // still be working reads as a pull that never happened.
    // Started at all, first: a launch that stopped earlier — a core it decided
    // to fetch, a path it would not write — leaves nothing to have found, and
    // "found nothing" is a different fault from "was never asked".
    const argv = await retroarch.argv()
    assert.ok(argv.length > 0, 'the emulator was never started')

    assert.equal(
      await retroarch.found(join(saveDir, 'cavestory.srm')),
      'the save from another device',
      'the emulator started, and the save the server was holding was not there'
    )

    assert.ok(
      server.asked.some((one) => /^\/api\/saves\/\d+\/content$/.test(one.path)),
      'it should have fetched the save itself, not only listed it'
    )
  })

  test('and what the session wrote goes back up', async () => {
    // Longer than the usual wait: the stand-in stays up past `Launcher`'s
    // startup grace on purpose, and everything before the spawn — the core
    // check, the pull — is time a busy machine adds to that.
    await saved.waitFor(`!document.querySelector('.overlay')`, 'the session to end', 45_000)

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
 * Firmware fetched from the server into the folder an emulator reads it from.
 *
 * Its own application again, and for the same reason as the saves above: this
 * needs an emulator with a BIOS folder, and where that folder is has to be
 * knowable from outside. RetroArch's is under `XDG_CONFIG_HOME`, so pinning
 * that pins the answer.
 *
 * A missing BIOS is the most common reason an emulator refuses a game, and it
 * refuses in its own words — a black screen, or a complaint about a core. The
 * unit tests cover what the screen decides; nothing until now covered the
 * bytes actually arriving where the emulator looks.
 */
describe('installing the BIOS a platform needs', () => {
  let bios: App
  let systemDir: string

  before(async () => {
    const configHome = mkdtempSync(join(tmpdir(), 'rommix-bios-xdg-'))
    systemDir = join(configHome, 'retroarch', 'system')
    bios = await startApp({
      baseUrl: server.baseUrl,
      token: server.token,
      settings: {
        systemEmulators: { segacd: 'retroarch' },
        emulatorPaths: { retroarch: emulator.path }
      },
      env: { XDG_CONFIG_HOME: configHome }
    })
  })

  after(async () => {
    await bios?.stop()
  })

  test('what the server holds lands where the emulator reads firmware from', async () => {
    await bios.waitFor(`document.querySelector('[data-screen="home"]')`, 'the home screen')
    await bios.goTo('bios')
    await bios.waitFor(`document.querySelector('[data-screen="bios"]')`, 'the BIOS screen')

    // Enabled only once the screen has worked out there is something to fetch,
    // which is a request per platform — so the button is waited for rather than
    // pressed the moment it is drawn.
    await bios.waitFor(
      `document.querySelector('[data-action="install-all"]')?.dataset.disabled === 'false'`,
      'something to install'
    )
    await bios.choose('[data-action="install-all"]')

    await bios.waitFor(`!document.querySelector('.overlay')`, 'the install to finish')

    // Both files the fake holds for the Sega CD, under the names RomM gave
    // them: a BIOS renamed on the way in is one the emulator will not find.
    for (const fileName of ['bios_CD_U.bin', 'bios_CD_E.bin']) {
      const path = join(systemDir, fileName)
      assert.equal(existsSync(path), true, `${fileName} is missing from ${systemDir}`)
      assert.equal(readFileSync(path, 'utf8'), `RomMix integration test firmware — ${fileName}\n`)
    }

    // The third file the Sega CD can take is one the server does not hold, so
    // nothing was invented for it.
    assert.equal(existsSync(join(systemDir, 'bios_CD_J.bin')), false)

    assert.ok(
      server.asked.some((one) => one.path.startsWith('/api/firmware/70/content/')),
      'it should have fetched the firmware itself'
    )
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
