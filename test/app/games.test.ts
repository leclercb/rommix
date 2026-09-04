import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
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
    // smaller than a zip around bytes it does not compress. Every RomM under
    // `schema/` serves them this way, which is what makes the fake's version of
    // it worth asserting against.
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

describe('the downloads screen', () => {
  /** The game taken off the disk by hand, so the test after can put it back. */
  let deleted: { path: string; bytes: Buffer } | null = null

  test('it arrives grouped, with a header per system this disk holds', async () => {
    await app.goTo('downloads')
    await app.waitFor(`document.querySelector('.group__header')`, 'the groups')

    // Off what is installed rather than off the platforms the server lists: a
    // header over nothing is a press that opens an empty group, and RomM knows
    // about four systems here while this disk holds fewer.
    const installed = await app.read<string[]>(
      `[...new Set((await window.rommix.library.installed()).map((one) => one.system))]`
    )
    const headers = await app.read<string[]>(
      `[...document.querySelectorAll('.group__header')].map((one) => one.dataset.system)`
    )
    assert.deepEqual(headers.sort(), installed.sort(), `the screen grouped by ${headers}`)
  })

  test('and a group is shut until it is opened', async () => {
    const [system] = await app.read<string[]>(
      `[...document.querySelectorAll('.group__header')].map((one) => one.dataset.system)`
    )

    // Shut is not merely hidden here either: a library of any size is more rows
    // than a television can show, and the lid is what makes the screen a list
    // of systems rather than a list of everything.
    assert.equal(
      await app.read<boolean>(`Boolean(document.querySelector('.group .installed'))`),
      false,
      'a shut group should have drawn no rows'
    )

    await app.choose(`[data-system="${system}"]`)
    await app.waitFor(
      `document.querySelector('[data-system="${system}"]')?.dataset.open === 'true'`,
      'the group to open'
    )
    await app.waitFor(`document.querySelector('.group .installed')`, 'its games')
  })

  test('turning grouping off puts every game in one list', async () => {
    await app.choose('[data-action="group-by-system"]')
    await app.waitFor(`!document.querySelector('.group__header')`, 'the headers to go')

    // Every game, not only the ones whose group happened to be open — which is
    // the reason to turn it off on a machine holding a handful of games.
    const rows = await app.read<number>(`document.querySelectorAll('.installed').length`)
    const held = await app.read<number>(`(await window.rommix.library.installed()).length`)
    assert.equal(rows, held, 'the flat list should hold everything on the disk')
  })

  test('and back on restores the headers', async () => {
    await app.choose('[data-action="group-by-system"]')
    await app.waitFor(`document.querySelector('.group__header')`, 'the groups again')
  })

  test('the sort button cycles the order, and comes round to where it started', async () => {
    // Flat, because an order is only visible where the rows are: grouped, the
    // games sit behind lids and what the sort moved is the lids.
    await app.choose('[data-action="group-by-system"]')
    await app.waitFor(`!document.querySelector('.group__header')`, 'the flat list')

    type Held = { name: string; sizeBytes: number; installedAt: string }
    const held = await app.read<Held[]>(`await window.rommix.library.installed()`)
    /** The names this disk holds, in the order a rule would put them. */
    const namesBy = (rule: (a: Held, b: Held) => number): string[] =>
      [...held].sort(rule).map((one) => one.name)
    const titles = (): Promise<string[]> =>
      app.read<string[]>(
        `[...document.querySelectorAll('.installed__title')].map((one) => one.textContent)`
      )

    // Where it opens, and the order that answers the question this screen is
    // usually opened with: what did I just download.
    const recent = namesBy((a, b) => b.installedAt.localeCompare(a.installedAt))
    assert.deepEqual(await titles(), recent, 'it should open on the most recent install')

    // Largest next. These two orders agree on this disk — the big game is also
    // the last one downloaded — so this press says the button answers, and the
    // press after it is the one that says the order really moved.
    await app.choose('[data-action="sort-by"]')
    assert.deepEqual(
      await titles(),
      namesBy((a, b) => b.sizeBytes - a.sizeBytes),
      'largest first'
    )

    // The one order on this disk that puts a different game first — without
    // which the two assertions below would pass over a button that does
    // nothing, and say so cheerfully.
    const byName = namesBy((a, b) => a.name.localeCompare(b.name))
    assert.notDeepEqual(byName, recent, 'these games should disagree about the two orders')

    await app.choose('[data-action="sort-by"]')
    await app.waitFor(
      `document.querySelector('.installed__title')?.textContent === ${JSON.stringify(byName[0])}`,
      'the list to be reordered by name'
    )
    assert.deepEqual(await titles(), byName, 'by name')

    // Three orders, three presses. A cycle that stopped at the last would leave
    // the first two behind a button that had gone quiet.
    await app.choose('[data-action="sort-by"]')
    await app.waitFor(
      `document.querySelector('.installed__title')?.textContent === ${JSON.stringify(recent[0])}`,
      'the order it opened on'
    )

    await app.choose('[data-action="group-by-system"]')
    await app.waitFor(`document.querySelector('.group__header')`, 'the groups, as they were found')
  })

  test('and a mouse left sitting on the list does not take the highlight off it', async () => {
    // Two things a machine with no window manager does for nothing, and a desk
    // does by accident: the page is drawn at the size RomMix asks for rather
    // than filled to a monitor, and the pointer sits in the middle of it and is
    // never touched again.
    //
    // Sorting then moves the rows under a pointer that has not gone anywhere,
    // and the browser reports what has arrived there as an ordinary move. The
    // highlight has to stay on the button being pressed: taken off it, the next
    // press lands on a row instead — which is a game opened, or worse, by a
    // press aimed at a button plainly under the highlight. See `pointer` in
    // `input/focus`.
    await app.drawAt(1280, 800)
    try {
      await app.pointAt(960, 540)
      await app.waitFor(
        `Boolean(document.elementFromPoint(960, 540)?.closest('.installed'))`,
        'the pointer to be resting on a row'
      )

      // The same three presses as above, which is what makes this the same
      // button rather than a second way of asking.
      for (let press = 0; press < 3; press += 1) {
        await app.choose('[data-action="sort-by"]')
        assert.equal(
          await app.read<boolean>(
            `document.querySelector('[data-action="sort-by"]')?.matches('[data-focused="true"]') ?? false`
          ),
          true,
          `the highlight left the button for ${await app.focused()}`
        )
      }
    } finally {
      await app.drawAsGiven()
    }
  })

  test('checking against the disk drops a game that was deleted behind its back', async () => {
    const entry = await app.read<{ path: string }>(
      `(await window.rommix.library.installed()).find((one) => one.romId === 5)`
    )
    // Kept, so the test below can put the file back where this one found it and
    // the disk ends the way the session left it.
    deleted = { path: entry.path, bytes: readFileSync(entry.path) }

    // Deleted the way a file manager deletes it: nothing tells RomMix. It
    // reconciles as you browse, which only ever covers the pages a screen has
    // loaded, so until something walks the whole library this game keeps its
    // Play button and hands the emulator a file that is not there.
    rmSync(entry.path)

    const askedSoFar = server.asked.length
    await app.choose('[data-action="sync-with-disk"]')
    await app.waitFor(
      `!(await window.rommix.library.installed()).some((one) => one.romId === 5)`,
      'the game that is no longer on disk to leave the index'
    )

    // The whole library rather than a page of it, which is the whole of what
    // this button is: the listing it makes names no platform, no collection and
    // no search, and every other listing this session made named one.
    const walked = server.asked
      .slice(askedSoFar)
      .filter(
        (one) =>
          one.path.startsWith('/api/roms?') &&
          !one.path.includes('platform_ids') &&
          !one.path.includes('collection_id') &&
          !one.path.includes('search_term')
      )
    assert.ok(
      walked.length > 0,
      `it should have asked RomM for the whole library, and asked ${JSON.stringify(
        server.asked.slice(askedSoFar).map((one) => one.path)
      )}`
    )
  })

  test('and adopts one that was copied in behind its back', async () => {
    // The other half of the same walk, and why it asks the server at all: a
    // file sitting where a game belongs is only a game if RomM has one by that
    // name, and without this it is offered as a download of what is already
    // there.
    assert.ok(deleted, 'the test above should have left a file to put back')
    writeFileSync(deleted.path, deleted.bytes)

    await app.choose('[data-action="sync-with-disk"]')
    await app.waitFor(
      `(await window.rommix.library.installed()).some((one) => one.romId === 5)`,
      'the game on the disk to be taken back into the index'
    )

    // Back under the same file, not merely back in the list: an entry adopted
    // onto the wrong path is one the launch would fail on.
    const entry = await app.read<{ path: string }>(
      `(await window.rommix.library.installed()).find((one) => one.romId === 5)`
    )
    assert.equal(entry.path, deleted.path)
  })
})

/**
 * The queue, driven from the row each transfer is drawn on.
 *
 * The activity tab is where a transfer is watched and where the four things
 * that can be done to one live — move it up, pause it, pick it up, throw it
 * away. None of them had a handle, so `downloads:promote` and `downloads:cancel`
 * were reached from nowhere at all, and pause and resume only from the game
 * screen's own pair.
 *
 * It runs on the slow game, which is the only one here that can be caught in
 * the middle, and it leaves the game uninstalled: this is the last scenario
 * that has anything to say about it.
 */
describe('driving the queue from the activity tab', () => {
  /** What the queue says about one game right now. */
  const stateOf = (romId: number): Promise<string | undefined> =>
    app.read<string | undefined>(
      `(await window.rommix.downloads.list()).find((one) => one.romId === ${romId})?.state`
    )

  test('one moved to the front takes the wire off the one that had it', async () => {
    // Uninstalled first, so there is something to download. The confirmation is
    // the same one the uninstall scenario above answers.
    await app.goTo('library')
    await app.choose('[data-rom="5"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await app.choose('[data-action="uninstall"]')
    await app.choose('[data-action="uninstall-confirm"]')
    await app.waitFor(
      `!(await window.rommix.library.installed()).some((one) => one.romId === 5)`,
      'the slow game to leave the disk'
    )

    await app.choose('[data-action="download"]')
    await app.waitFor(`(await window.rommix.downloads.list()).length > 0`, 'the transfer to start')

    // And a second game behind it. One transfer at a time is what makes a queue
    // a queue, and what makes moving something up mean anything.
    await app.goTo('library')
    await app.choose('[data-rom="4"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the other game')
    await app.choose('[data-action="download"]')

    await app.goTo('downloads')
    await app.waitFor(`document.querySelector('[data-download="5"]')`, 'the transfer rows')
    await app.waitFor(
      `(await window.rommix.downloads.list()).find((one) => one.romId === 4)?.state === 'queued'`,
      'the second game to be waiting its turn'
    )

    await app.choose('[data-download="4"] [data-action="promote"]')

    // The slow one gives way rather than being cancelled: it can be picked up
    // where it stopped, which is the whole reason the button offers to start
    // the other game now rather than merely next.
    await app.waitFor(
      `(await window.rommix.downloads.list()).find((one) => one.romId === 5)?.state !== 'downloading'`,
      'the slow game to give the wire up'
    )
    await app.waitFor(
      `['downloading', 'extracting', 'done'].includes(
         (await window.rommix.downloads.list()).find((one) => one.romId === 4)?.state
       )`,
      'the promoted game to take it'
    )
  })

  test('pausing one stops it where it is, and it picks up from there', async () => {
    // Back on the wire on its own once the promoted game is done, which is the
    // other half of a queue: nothing is pressed to make this happen.
    await app.waitFor(
      `(await window.rommix.downloads.list()).find((one) => one.romId === 5)?.state === 'downloading'`,
      'the slow game to get its turn back'
    )

    await app.choose('[data-download="5"] [data-action="pause-transfer"]')
    await app.waitFor(
      `(await window.rommix.downloads.list()).find((one) => one.romId === 5)?.state === 'paused'`,
      'the transfer to stop'
    )

    // What it had fetched is kept. A pause that threw the bytes away would be
    // cancel under a gentler word, and the row goes on saying how far it got.
    const held = await app.read<number>(
      `(await window.rommix.downloads.list()).find((one) => one.romId === 5)?.receivedBytes`
    )
    assert.ok(held > 0, 'the paused transfer should have kept what it fetched')

    await app.choose('[data-download="5"] [data-action="resume"]')
    await app.waitFor(
      `(await window.rommix.downloads.list()).find((one) => one.romId === 5)?.state === 'downloading'`,
      'the transfer to pick itself up'
    )
    assert.ok(
      (await app.read<number>(
        `(await window.rommix.downloads.list()).find((one) => one.romId === 5)?.receivedBytes`
      )) >= held,
      'it should carry on from what it had rather than start again'
    )
  })

  test('and cancelling throws it away rather than pausing it', async () => {
    await app.choose('[data-download="5"] [data-action="cancel-transfer"]')

    // Cancelled is an end: the row leaves the active list and the game is not
    // on the disk, which is what separates this button from the one beside it.
    await app.waitFor(
      `(await window.rommix.downloads.list()).find((one) => one.romId === 5)?.state === 'cancelled'`,
      'the transfer to be given up on'
    )
    assert.equal(
      await app.read<boolean>(
        `(await window.rommix.library.installed()).some((one) => one.romId === 5)`
      ),
      false,
      'a cancelled transfer should leave nothing installed'
    )
    assert.equal(await stateOf(4), 'done', 'the game promoted past it should still have finished')
  })

  test('and the finished rows can be cleared away without touching the games', async () => {
    // Everything this session has moved is on the screen: one finished, one
    // cancelled, and the rest of the downloads above. The list is a history,
    // and this is the only thing that empties it.
    const finished = await app.read<number[]>(
      `(await window.rommix.downloads.list())
         .filter((one) => ['done', 'error', 'cancelled'].includes(one.state))
         .map((one) => one.romId)`
    )
    assert.ok(finished.length > 0, 'there should be something to clear')

    const onDisk = await app.read<number[]>(
      `(await window.rommix.library.installed()).map((one) => one.romId)`
    )

    await app.choose('[data-action="clear-finished"]')
    await app.waitFor(
      `(await window.rommix.downloads.list()).every(
         (one) => !['done', 'error', 'cancelled'].includes(one.state)
       )`,
      'the finished rows to go'
    )

    // The list, not the library. What was downloaded is still downloaded —
    // clearing the history of a transfer that finished is not undoing it.
    assert.deepEqual(
      await app.read<number[]>(`(await window.rommix.library.installed()).map((one) => one.romId)`),
      onDisk,
      'clearing the list should not have removed anything from the disk'
    )
  })

  test('and a game can be thrown away from the list it is in', async () => {
    // The other end of the same screen: the device tab is where a full disk is
    // dealt with, and its rows have an uninstall of their own. It is a
    // different call site from the game screen's, on a row rather than on a
    // page about one game — which is exactly where deleting the wrong one
    // would not be noticed.
    await app.choose('[data-tab="device"]')
    await app.choose('[data-action="group-by-system"]')
    await app.waitFor(`document.querySelector('[data-rom="4"]')`, 'the row for the disc set')

    const entry = await app.read<{ path: string }>(
      `(await window.rommix.library.installed()).find((one) => one.romId === 4)`
    )
    await app.choose('[data-rom="4"] [data-action="uninstall-game"]')

    // Asked here too. One press on a focused danger button is otherwise a
    // multi-gigabyte download gone, and the row is easier to land on by
    // accident than the button on a game's own page.
    await app.waitFor(`document.querySelector('.overlay')`, 'the confirmation')
    await app.choose('[data-action="keep-game"]')
    await app.waitFor(`!document.querySelector('.overlay')`, 'the question to close')
    assert.equal(existsSync(entry.path), true, 'Keep should keep it')

    await app.choose('[data-rom="4"] [data-action="uninstall-game"]')
    await app.waitFor(`document.querySelector('.overlay')`, 'the confirmation again')
    await app.choose('[data-action="uninstall-confirm"]')

    await app.waitFor(
      `!(await window.rommix.library.installed()).some((one) => one.romId === 4)`,
      'the game to leave the index'
    )
    assert.equal(existsSync(entry.path), false, `${entry.path} is still there`)
    await app.waitFor(`!document.querySelector('[data-rom="4"]')`, 'the row to go with it')

    // Left as the rest of the file expects to find it.
    await app.choose('[data-action="group-by-system"]')
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
    // The curtain rather than the panel: this game has a cover, and a launch
    // that has one draws it full-screen instead. Waiting on the panel here
    // would find no panel and call the session over before it started.
    //
    // It is also the screen RomMix is looked at hardest — the one somebody
    // waits through from across the room — and until the fake served artwork
    // nothing had ever drawn it.
    await saved.waitFor(`document.querySelector('.curtain')`, 'the cover to fill the screen')
    await saved.waitFor(
      `document.querySelector('.curtain__cover img')?.naturalWidth > 0`,
      'the cover to arrive'
    )

    // Longer than the usual wait: the stand-in stays up past `Launcher`'s
    // startup grace on purpose, and everything before the spawn — the core
    // check, the pull — is time a busy machine adds to that.
    await saved.waitFor(`!document.querySelector('.curtain')`, 'the session to end', 45_000)

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

  test('and the save can be deleted from one end without touching the other', async () => {
    // Both ends hold it now — pulled down before the session, pushed back up
    // after — which is the only state where the dialog has a choice to offer.
    // A file one end holds alone gets one button, so it can never offer a
    // delete that would do nothing.
    await saved.goTo('library')
    await saved.choose('[data-rom="1"]')
    await saved.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await saved.choose('[data-tab="saves"]')
    await saved.waitFor(`document.querySelector('[data-action="delete-asset"]')`, 'the save row')

    await saved.choose('[data-action="delete-asset"]')
    await saved.waitFor(`document.querySelector('.overlay')`, 'the delete question')

    // Keep first, because that is the answer the dialog opens on and the one a
    // stray press lands on. A confirmation that deleted anything on the way out
    // would be worse than no confirmation at all.
    await saved.choose('[data-action="keep-asset"]')
    await saved.waitFor(`!document.querySelector('.overlay')`, 'the question to close')
    assert.equal(existsSync(join(saveDir, 'cavestory.srm')), true, 'Keep should keep it')

    await saved.choose('[data-action="delete-asset"]')
    await saved.waitFor(`document.querySelector('.overlay')`, 'the delete question again')
    const askedSoFar = server.asked.length
    await saved.choose('[data-action="delete-local"]')

    // Gone from this disk. The dialog shuts on the press rather than on the
    // delete, so a scenario that read the disk as soon as it closed would be
    // racing the main process — and would report a delete that never happened
    // as one that did. The list is what has waited for it.
    await saved.waitFor(`!document.querySelector('.overlay')`, 'the question to close again')
    await saved.waitFor(
      `!(await window.rommix.saves.list(1)).some(
        (one) => one.fileName === 'cavestory.srm' && one.localPath
      )`,
      'the local copy to leave the list'
    )
    assert.equal(existsSync(join(saveDir, 'cavestory.srm')), false, 'the local copy should be gone')

    // And still on the server, which is the whole point of asking which end:
    // deleting the copy here and pulling RomM's back is a reason somebody
    // deletes one at all. Asked after the wait above, so an absent request is
    // one that was never made rather than one that has not been made yet.
    assert.deepEqual(
      server.asked.slice(askedSoFar).filter((one) => one.path === '/api/saves/delete'),
      [],
      'deleting the local copy should not have asked RomM to delete anything'
    )
  })

  test('and then from RomM, which is the copy nothing brings back', async () => {
    // One end left, so one button: the dialog never offers a delete that would
    // do nothing. The warning comes with it — a delete at one end undoes itself
    // when sync next runs, and this one has nothing to come back from.
    // Come back to the screen rather than carrying on from where the dialog
    // above left off. Closing one leaves the highlight nowhere for a moment and
    // the list rebuilds underneath it, so a walk that starts there is racing
    // both; arriving fresh is neither.
    await saved.goTo('library')
    await saved.choose('[data-rom="1"]')
    await saved.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await saved.choose('[data-tab="saves"]')
    await saved.waitFor(`document.querySelector('[data-action="delete-asset"]')`, 'the save row')

    await saved.choose('[data-action="delete-asset"]')
    await saved.waitFor(`document.querySelector('.overlay')`, 'the delete question')
    await saved.waitFor(
      `!document.querySelector('[data-action="delete-local"]')`,
      'the end that no longer holds it to be dropped'
    )
    await saved.waitFor(`document.querySelector('.notice--warn')`, 'the only-copy warning')

    await saved.choose('[data-action="delete-remote"]')

    // The row goes, and that is what says the right id was sent: the fake
    // removes by id and the screen re-lists from the server, so a delete
    // carrying the wrong one would leave the save exactly where it was.
    await saved.waitFor(
      `!document.querySelector('[data-action="delete-asset"]')`,
      'the save to leave the list'
    )
    assert.ok(
      server.asked.some((one) => one.path === '/api/saves/delete'),
      'it should have asked RomM to delete the save'
    )
  })

  test('a save the server holds is fetched by hand, without a launch', async () => {
    // Both ends were emptied above, so there is one copy again and it is
    // RomM's. Nothing here starts the game: the automatic sync happens around
    // a launch, and a save made on another device is wanted before the game is
    // started, not as a side effect of starting it.
    server.holdSave({
      romId: 1,
      fileName: 'cavestory.srm',
      emulator: 'retroarch',
      content: 'brought down by hand'
    })
    // And a state with it, which RomM keeps at its own endpoint and RomMix
    // writes into a different folder. Nothing had ever pulled one: a state that
    // landed where saves live would be invisible to the emulator and look
    // exactly like a sync that worked.
    server.holdState({
      romId: 1,
      fileName: 'cavestory.state1',
      emulator: 'retroarch',
      content: 'stopped somewhere else'
    })

    await saved.goTo('library')
    await saved.choose('[data-rom="1"]')
    await saved.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await saved.choose('[data-action="pull-saves"]')

    await saved.waitFor(
      `(await window.rommix.saves.list(1)).some(
         (one) => one.fileName === 'cavestory.srm' && one.localPath
       )`,
      'the save to land on this disk'
    )
    assert.equal(readFileSync(join(saveDir, 'cavestory.srm'), 'utf8'), 'brought down by hand')

    // Each kind in the folder its own emulator reads it from — the save beside
    // the ROM, the state under `states` — which is the whole reason the two are
    // pulled separately rather than as one list of files.
    assert.equal(
      readFileSync(join(configHome, 'retroarch', 'states', 'cavestory.state1'), 'utf8'),
      'stopped somewhere else'
    )
  })

  test('and the confirmation is turned on where it lives', async () => {
    // Through the screen rather than through the settings file, because the
    // question below is the one this toggle asks: a setting written from
    // outside would prove the dialog works for a state nobody can reach.
    await saved.goTo('settings')
    await saved.waitFor(`document.querySelector('[data-tab="games"]')`, 'the settings tabs')
    await saved.choose('[data-tab="games"]')
    await saved.choose('[data-setting="confirmSavePush"] [data-option="on"]')

    await saved.waitFor(
      `(await window.rommix.system.settings()).confirmSavePush === true`,
      'the setting to be kept'
    )
  })

  test('so a push by hand says what would go before it goes', async () => {
    // Written the way a session played outside RomMix leaves them: the save is
    // ahead of the server's copy now, and the state is a file RomM has never
    // had at all. Both are what the automatic sync never sees — it only looks
    // at what a session it started wrote.
    writeFileSync(join(saveDir, 'cavestory.srm'), 'played on the sofa')
    const stateDir = join(configHome, 'retroarch', 'states')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, 'cavestory.state1'), 'stopped mid-boss')

    await saved.goTo('library')
    await saved.choose('[data-rom="1"]')
    await saved.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await saved.choose('[data-action="push-saves"]')

    // The list is the point of the question: a push that overwrites the
    // server's copy is worth reading first, and each row says which end is
    // ahead of which.
    await saved.waitFor(`document.querySelector('.overlay .asset__kind')`, 'the preview')
    const listed = await saved.read<string[]>(
      `[...document.querySelectorAll('.overlay .asset__kind')].map((one) => one.dataset.kind)`
    )
    assert.deepEqual(listed.sort(), ['save', 'state'], `the dialog listed ${listed}`)
  })

  test('and sending it puts each kind at its own end of RomM', async () => {
    const sentSoFar = server.uploaded.length
    await saved.choose('[data-action="push-send"]')
    await saved.waitFor(`!document.querySelector('.overlay')`, 'the dialog to close')

    // Waited for in Node, because what is being watched is what the server was
    // sent rather than anything the page shows.
    const until = Date.now() + 10_000
    while (server.uploaded.length - sentSoFar < 2 && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 100))
    }

    // A save goes to /api/saves and a state to /api/states, which is RomM's
    // own split and the one place RomMix could send a state where no state
    // would ever be found again.
    const sent = server.uploaded.slice(sentSoFar)
    assert.deepEqual(
      sent.map((one) => one.kind).sort(),
      ['save', 'state'],
      `it sent ${JSON.stringify(sent.map((one) => one.kind))}`
    )
    assert.ok(
      sent.every((one) => one.romId === 1 && one.emulator === 'retroarch'),
      'both should have been filed under the game and the emulator that wrote them'
    )
  })

  test('cancelling the question sends nothing at all', async () => {
    // Something new to send, so the dialog has a list rather than a message
    // saying everything is already up.
    writeFileSync(join(saveDir, 'cavestory.srm'), 'one more evening')

    const sentSoFar = server.uploaded.length
    await saved.choose('[data-action="push-saves"]')
    await saved.waitFor(`document.querySelector('.overlay')`, 'the question')
    await saved.choose('[data-action="push-cancel"]')
    await saved.waitFor(`!document.querySelector('.overlay')`, 'the question to close')

    // Nothing went. Waited out rather than read at once: an upload started and
    // then abandoned would arrive a moment after the dialog closed.
    await new Promise((done) => setTimeout(done, 1000))
    assert.equal(
      server.uploaded.length,
      sentSoFar,
      `it should have sent nothing: ${JSON.stringify(server.uploaded.slice(sentSoFar))}`
    )

    // And the file is still waiting to go, which is the other half of cancel:
    // the question was refused, not the file.
    assert.equal(
      await saved.read<boolean>(
        `(await window.rommix.saves.list(1)).some(
           (one) => one.fileName === 'cavestory.srm' && one.sync === 'local-newer'
         )`
      ),
      true
    )
  })

  test('and the third answer sends it and stops asking', async () => {
    const sentSoFar = server.uploaded.length
    await saved.choose('[data-action="push-saves"]')
    await saved.waitFor(`document.querySelector('.overlay')`, 'the question again')
    await saved.choose('[data-action="push-send-no-ask"]')
    await saved.waitFor(`!document.querySelector('.overlay')`, 'the question to close')

    // Both halves of one press: turning the question off and leaving the files
    // unsent is not what "do not ask me again" means.
    const until = Date.now() + 10_000
    while (server.uploaded.length === sentSoFar && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 100))
    }
    assert.ok(server.uploaded.length > sentSoFar, 'it should have sent what it was showing')
    await saved.waitFor(
      `(await window.rommix.system.settings()).confirmSavePush === false`,
      'the question to be turned off'
    )
  })

  test('so the next push goes without a word', async () => {
    writeFileSync(join(saveDir, 'cavestory.srm'), 'and another')
    const sentSoFar = server.uploaded.length

    await saved.choose('[data-action="push-saves"]')

    // Straight up, which is what the setting means. The dialog is the thing
    // being watched for here, so its absence is the assertion.
    const until = Date.now() + 10_000
    while (server.uploaded.length === sentSoFar && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 100))
    }
    assert.ok(server.uploaded.length > sentSoFar, 'it should have sent it')
    assert.equal(
      await saved.read<boolean>(`Boolean(document.querySelector('.overlay'))`),
      false,
      'nothing should have been asked this time'
    )
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

  test('one file is fetched where one file is what was asked for', async () => {
    await bios.waitFor(`document.querySelector('[data-screen="home"]')`, 'the home screen')
    await bios.goTo('bios')
    await bios.waitFor(`document.querySelector('[data-screen="bios"]')`, 'the BIOS screen')

    // Drawn only once the screen has worked out what each platform needs and
    // what the server holds, which is a request per platform.
    await bios.waitFor(
      `document.querySelector('[data-bios="bios_CD_U.bin"] [data-action="install-bios"]')`,
      'the row for one file'
    )
    await bios.choose('[data-bios="bios_CD_U.bin"] [data-action="install-bios"]')

    await bios.waitFor(
      `document.querySelector('[data-bios="bios_CD_U.bin"] .status')?.dataset.state === 'ok'`,
      'the row to say it is in place'
    )
    assert.equal(existsSync(join(systemDir, 'bios_CD_U.bin')), true)

    // And nothing else came with it. A row's own button is about that row; one
    // that quietly fetched the platform's other files would be the same press
    // as the button below it.
    assert.equal(
      existsSync(join(systemDir, 'bios_CD_E.bin')),
      false,
      'installing one file should not have installed the rest'
    )
  })

  test('what the server holds lands where the emulator reads firmware from', async () => {
    // Enabled only while something is still outstanding, which after the file
    // above is the rest of them.
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

  test('and checking again reads the disk rather than what it said last time', async () => {
    // Taken away the way a file manager takes it: nothing tells RomMix, and
    // the screen goes on saying the file is in place because that is what it
    // found when it was drawn.
    rmSync(join(systemDir, 'bios_CD_U.bin'))
    assert.equal(
      await bios.read<string | undefined>(
        `document.querySelector('[data-bios="bios_CD_U.bin"] .status')?.dataset.state`
      ),
      'ok',
      'the screen should still be showing what it found before'
    )

    await bios.choose('[data-action="recheck-bios"]')
    await bios.waitFor(
      `document.querySelector('[data-bios="bios_CD_U.bin"] .status')?.dataset.state === 'warn'`,
      'the row to notice the file has gone'
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
