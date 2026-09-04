import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { en } from '@shared/i18n/en.ts'
import { fr } from '@shared/i18n/fr.ts'
import type { App } from './driver.ts'
import { startScenario, type Scenario } from './harness.ts'
import type { FakeRomm } from './server.ts'

/**
 * The screens, and the three ways of driving them.
 *
 * Nothing here downloads a game or starts one, so nothing here depends on what
 * ran before it: each scenario navigates to the section it is about and reads
 * what is drawn. That is the difference from `games.test.ts`, which is one
 * session in order and has to be.
 *
 * What it is all for is the seam nothing else can see: these screens are drawn
 * by the renderer, filled over IPC and read through the preload bridge, and a
 * channel renamed in `src/main/ipc/` and not in `src/preload/` typechecks,
 * lints, passes every unit test and builds perfectly.
 *
 * The screens are found by the handles they carry on purpose, never by their
 * text, which changes with the language, nor by position, which changes
 * whenever a button is added. CONTRIBUTING lists the handles; add one when a
 * test needs it rather than reaching for a label.
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

describe('the collections screen', () => {
  test('the shelves it draws are the ones the server holds', async () => {
    await app.goTo('collections')
    await app.waitFor(
      `document.querySelector('[data-screen="collections"]')`,
      'the collections screen'
    )

    // Filled from its own request, so being on the screen is not yet having
    // been answered — the same wait the home screen's shelves need.
    await app.waitFor(`document.querySelector('.card__title')`, 'the shelves to fill')
    const drawn = await app.read<string[]>(
      `[...document.querySelectorAll('.card__title')].map((one) => one.textContent)`
    )
    assert.deepEqual(
      drawn,
      server.collections.map((one) => one.name),
      `the screen drew ${JSON.stringify(drawn)}`
    )
  })

  test('opening one asks for the games on it, and no others', async () => {
    await app.choose('.card')
    await app.waitFor(`document.querySelector('[data-rom="1"]')`, 'the games on the shelf')

    // The filter is the point. A shelf that listed the whole library would look
    // right on a fake this size and be wrong on a real one.
    const asked = server.asked.filter((one) => one.path.includes('collection_id=10'))
    assert.ok(asked.length > 0, 'it should have asked for the collection by id')
    assert.equal(
      await app.read<boolean>(`Boolean(document.querySelector('[data-rom="3"]'))`),
      false,
      'a game that is not on the shelf should not be drawn on it'
    )
  })

  test('the ones RomM derives are behind a lid, and cost nothing while it is shut', async () => {
    await app.goTo('collections')
    await app.waitFor(`document.querySelector('.group__header')`, 'the shelves to fill')

    // Two groups: the ones somebody made, open, and the ones RomM worked out,
    // closed. `data-open` rather than which comes second — the order is a
    // layout decision and this is about the lid.
    await app.waitFor(
      `document.querySelectorAll('.group__header[data-open="false"]').length === 1`,
      'the derived shelves to be closed'
    )

    // Not merely hidden. RomM derives one per genre, per franchise, per
    // company, which on a real library is dozens — a lid that still drew them
    // all would be a lid in name only.
    const drawn = await app.read<string[]>(
      `[...document.querySelectorAll('.card__title')].map((one) => one.textContent)`
    )
    assert.equal(
      drawn.some((name) => name === server.virtualCollections[0].name),
      false,
      `a closed group should have drawn no tiles, but the page has ${JSON.stringify(drawn)}`
    )
  })

  test('opening it draws them, and leaves the empty one out', async () => {
    await app.choose('.group__header[data-open="false"]')
    await app.waitFor(
      `[...document.querySelectorAll('.card__title')].some((one) => one.textContent === ${JSON.stringify(server.virtualCollections[0].name)})`,
      'the derived shelves to be drawn'
    )

    // A shelf with nothing on it is one RomM keeps and this screen drops:
    // opening it would be a page saying it is empty.
    const drawn = await app.read<string[]>(
      `[...document.querySelectorAll('.card__title')].map((one) => one.textContent)`
    )
    const bare = server.virtualCollections.find((one) => one.rom_count === 0)
    assert.equal(
      drawn.includes(bare?.name ?? ''),
      false,
      `${JSON.stringify(bare?.name)} holds nothing and should not be offered`
    )
  })

  test('and a derived one is asked for by the name only it goes under', async () => {
    const derived = server.virtualCollections[0]
    await app.choose(`[data-collection="${derived.id}"]`)
    await app.waitFor(`document.querySelector('[data-rom]')`, 'the games on the derived shelf')

    // The id is a string and the parameter is not the one a collection somebody
    // made uses. Sending `collection_id` here would answer with somebody's
    // shelf number 0 or with nothing, and either reads as an empty genre rather
    // than as a request built wrong.
    const asked = server.asked.filter((one) =>
      one.path.includes(`virtual_collection_id=${encodeURIComponent(derived.id)}`)
    )
    assert.ok(asked.length > 0, `it should have asked for ${derived.id} as a virtual collection`)
  })
})

describe('the settings screen', () => {
  test('what the server said about itself is what it shows', async () => {
    await app.goTo('settings')
    await app.waitFor(`document.querySelector('[data-screen="settings"]')`, 'the settings screen')

    // The whole round trip for the heartbeat, which nothing else checks: the
    // version RomM reports is stored by `connection.ts`, carried over IPC and
    // drawn here. Everywhere else it is only ever logged.
    const shown = await app.read<string[]>(
      `[...document.querySelectorAll('.kv dd')].map((one) => one.textContent)`
    )
    assert.ok(
      shown.some((one) => one?.includes(server.baseUrl)),
      `the address was not among ${JSON.stringify(shown)}`
    )
    assert.ok(
      shown.some((one) => one === server.version),
      `the server version was not among ${JSON.stringify(shown)}`
    )
  })

  test('and its other two tabs are reachable from the shoulder buttons', async () => {
    // Everything RomMix can be told to do that is not about one game lives
    // behind this strip — where the library goes, which emulator runs what.
    // Until now nothing had opened either of them.
    await app.press('TabNext')
    await app.waitFor(
      `document.querySelector('[data-tab="games"]')?.dataset.active === 'true'`,
      'the games tab'
    )

    await app.press('TabNext')
    await app.waitFor(
      `document.querySelector('[data-tab="system"]')?.dataset.active === 'true'`,
      'the system tab'
    )

    // The panel under the strip is what actually changed; a tab that marked
    // itself active over the previous tab's contents would pass a check on the
    // strip alone.
    await app.waitFor(
      `document.querySelectorAll('.panel__body *').length > 0`,
      'the system tab to have drawn something'
    )
  })
})

describe('the emulators screen', () => {
  test('the emulator the settings point at is the one it calls installed', async () => {
    await app.goTo('emulators')
    await app.waitFor(`document.querySelector('[data-screen="emulators"]')`, 'the emulators screen')

    // Probed on the machine rather than listed from a table, so this is the one
    // place the renderer draws a conclusion about the disk. Eden is the one the
    // harness pointed at a stand-in — see `startScenario`.
    //
    // Waited for rather than read once, and the wait is the test: the row is
    // drawn before the probe has answered, and until it does the badge says
    // "not checked" — which is the same `off` the screen uses for an emulator
    // that is genuinely absent. A read taken on arrival passes for whichever of
    // the two happens to be true.
    await app.waitFor(
      `document.querySelector('[data-emulator="eden"] .status')?.dataset.state === 'ok'`,
      'Eden to be probed and found'
    )

    // And the path it names is the one that was configured, not a guess at
    // where Eden usually lives: a screen that reported the default while the
    // launch used the override would agree with nothing.
    const paths = await app.read<string[]>(
      `[...document.querySelectorAll('[data-emulator="eden"] .emulator__line-text')].map((one) => one.textContent)`
    )
    assert.ok(
      paths.some((one) => one?.includes(emulator.path)),
      `the configured path was not among ${JSON.stringify(paths)}`
    )
  })

  test('every emulator RomMix knows about is listed, installed or not', async () => {
    // The list comes off the registry, and `src/config/emulators` is where an
    // emulator is added. One that compiles, registers and then does not reach
    // the screen is a whole feature missing with nothing red to say so.
    const listed = await app.read<number>(`document.querySelectorAll('[data-emulator]').length`)
    assert.ok(listed > 1, `only ${listed} emulators reached the screen`)
  })
})

describe('the buttons that are not on the D-pad', () => {
  test('Start opens the menu from wherever you are', async () => {
    // Bound in App.tsx and advertised in the hint bar as M. Nothing else can
    // reach it: it is not a button on any screen, so a test that only presses
    // directions cannot tell a working binding from a missing one.
    await app.goTo('home')
    await app.press('Menu')
    await app.waitFor(`document.querySelector('[data-screen="settings"]')`, 'the settings screen')
  })

  test('and Y goes to the one search box there is', async () => {
    // The library is where the box lives, so from the home screen the button
    // has to travel before it can search — which is the behaviour, not a
    // shortcut around it.
    await app.goTo('home')
    await app.press('Search')
    await app.waitFor(`document.querySelector('[data-screen="library"]')`, 'the library screen')

    // And on the library itself it lands in the box, which is the only place in
    // RomMix where a key press is meant to become a letter.
    await app.press('Search')
    await app.waitFor(
      `document.activeElement?.tagName === 'INPUT'`,
      'the search box to take the caret'
    )

    // Out again, which the hint under the box promises and which nothing else
    // here could recover from: while a field holds the caret the keyboard
    // handler stands down, so a test that walked away leaving it there would
    // take the menu with it.
    await app.press('Escape')
    await app.waitFor(
      `document.activeElement?.tagName !== 'INPUT'`,
      'the search box to give the caret back'
    )
  })
})

/**
 * The game screen is opened by the download and launch scenarios in
 * `games.test.ts`. What none of them touch is the strip across its panel, and
 * three of its four tabs are the only place saves, files and screenshots are
 * ever drawn.
 */
describe('the tabs on a game', () => {
  test('it opens on details, and the shoulder buttons walk the strip', async () => {
    await app.goTo('library')
    // Any game will do, and that is the point of it being here rather than in
    // `games.test.ts`: the strip and its four panels are drawn from what the
    // server sent about the game, so none of this needs one on the disk.
    await app.choose('[data-rom="3"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')

    // The strip is bound to LB/RB as well as being focusable, because reaching
    // it by walking focus up from the content is not how a console UI changes
    // tab. That binding is what is under test here.
    await app.waitFor(
      `document.querySelector('[data-tab="details"]')?.dataset.active === 'true'`,
      'the details tab to be the one open'
    )

    await app.press('TabNext')
    await app.waitFor(
      `document.querySelector('[data-tab="saves"]')?.dataset.active === 'true'`,
      'the saves tab'
    )

    await app.press('TabNext')
    await app.waitFor(
      `document.querySelector('[data-tab="files"]')?.dataset.active === 'true'`,
      'the files tab'
    )

    // Back the way it came, which is the half a single direction cannot show.
    await app.press('TabBack')
    await app.waitFor(
      `document.querySelector('[data-tab="saves"]')?.dataset.active === 'true'`,
      'the saves tab again'
    )
  })

  test('the files tab lists the file the server named', async () => {
    await app.press('TabNext')
    await app.waitFor(
      `document.querySelector('[data-tab="files"]')?.dataset.active === 'true'`,
      'the files tab'
    )

    // What a game is called on disk comes off `fs_name`, and it is what the
    // emulator is handed. A tab that showed the game's title instead would look
    // perfectly reasonable and name a file nothing can open.
    const listed = await app.read<string[]>(
      `[...document.querySelectorAll('.asset__name')].map((one) => one.textContent)`
    )
    const rom = server.roms.find((one) => one.id === 3)
    assert.ok(
      listed.some((name) => name === rom?.fs_name),
      `${JSON.stringify(listed)} should have held ${rom?.fs_name}`
    )
  })

  test('and the strip comes round rather than stopping at the end', async () => {
    // Four tabs, four presses. A strip that stopped at the last one would leave
    // the first three unreachable without changing direction, which on a pad is
    // the difference between a control and a puzzle.
    for (let step = 0; step < 4; step += 1) await app.press('TabNext')
    await app.waitFor(
      `document.querySelector('[data-tab="files"]')?.dataset.active === 'true'`,
      'the files tab, one lap later'
    )
  })
})

describe('driving it with a mouse instead', () => {
  test('the pointer moves the highlight without choosing anything', async () => {
    // `useFocusable` binds `onMouseMove` as well as `onClick`, so a pointer
    // and a pad have to agree about what is current. They are two ways into
    // every button in the application and only one of them was ever driven.
    await app.goTo('library')
    await app.waitFor(`document.querySelector('[data-rom="2"]')`, 'the library grid')

    await app.hover('[data-rom="2"]')
    await app.waitFor(
      `document.querySelector('[data-rom="2"]')?.dataset.focused === 'true'`,
      'the highlight to follow the pointer'
    )

    // Hovering is not choosing. A card that opened on the way past would make
    // the interface impossible to cross with a mouse.
    assert.equal(
      await app.read<boolean>(`Boolean(document.querySelector('[data-screen="library"]'))`),
      true
    )
  })

  test('and a click opens what it is on', async () => {
    await app.click('[data-rom="2"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')

    // The same game the pointer was over, rather than whatever the highlight
    // happened to be on when the press arrived.
    const title = await app.read<string>(`document.querySelector('.game-hero__title')?.textContent`)
    assert.equal(
      title,
      server.roms.find((one) => one.id === 2)?.name,
      `the screen that opened says ${JSON.stringify(title)}`
    )
  })
})

describe('a page taller than the screen', () => {
  test('walking down brings what is below the fold into view', async () => {
    // The failure this is about is one the stylesheet made real once already:
    // on a screen too short for them, the games are drawn below the fold, where
    // they are focusable and invisible — which reads as a focus engine that has
    // stopped working rather than as a page that has not scrolled. Every focus
    // move is supposed to scroll the page under it. See `revealElement`.
    await app.goTo('emulators')
    await app.waitFor(`document.querySelector('[data-emulator]')`, 'the emulator list')

    const scroller = `document.querySelector('.content')`
    await app.waitFor(
      `${scroller}.scrollHeight > ${scroller}.clientHeight`,
      'a page worth scrolling'
    )
    assert.equal(await app.read<number>(`${scroller}.scrollTop`), 0)

    // Far enough down to leave the first screenful behind, one press at a time
    // the way a player would.
    for (let step = 0; step < 12; step += 1) await app.press('Down')

    // Waited for rather than read: unless the desktop asks for reduced motion
    // the page slides rather than jumps, so the press is over several frames
    // before the scroll it caused is.
    await app.waitFor(`${scroller}.scrollTop > 0`, 'the page to follow the highlight')

    // And what it landed on is on the screen, which is the whole point: a
    // scroll that moved the page without catching up with the highlight is the
    // same bug wearing a different number.
    await app.waitFor(
      `(() => {
         const box = document.querySelector('[data-focused="true"]')?.getBoundingClientRect()
         return Boolean(box && box.top >= 0 && box.bottom <= window.innerHeight)
       })()`,
      'the highlighted element to be within the window'
    )
  })

  test('and the last press goes to the end of the page rather than nowhere', async () => {
    // Past the last focusable there is still page — a title, the paragraph
    // saying what the screen is for, the note under the last row. `scrollToEnd`
    // is what stops the press that means "further down" from being inert while
    // there is plainly more to read.
    const scroller = `document.querySelector('.content')`
    for (let step = 0; step < 40; step += 1) await app.press('Down')

    const atEnd = await app.read<boolean>(
      `${scroller}.scrollTop + ${scroller}.clientHeight >= ${scroller}.scrollHeight - 2`
    )
    assert.equal(atEnd, true, 'holding Down should have reached the bottom of the page')
  })

  test('the wheel scrolls it too, and the next press brings focus back', async () => {
    const scroller = `document.querySelector('.content')`
    const wasAt = await app.read<number>(`${scroller}.scrollTop`)
    // Backwards, because the scenario above left the page at its bottom. A turn
    // of the wheel is a distance rather than a destination, so this asks how far
    // it went rather than where it arrived.
    await app.wheel('.content', -900)
    await app.waitFor(`${scroller}.scrollTop < ${wasAt}`, 'the wheel to move the page')

    // The highlight did not move, so it is now somewhere off the screen. The
    // next press has to bring the page back to it rather than carrying on from
    // wherever the wheel left the view.
    await app.press('Down')
    await app.waitFor(
      `(() => {
         const box = document.querySelector('[data-focused="true"]')?.getBoundingClientRect()
         return Boolean(box && box.top >= 0 && box.bottom <= window.innerHeight)
       })()`,
      'the page to come back to the highlight'
    )
  })
})

/**
 * The controller, which is the input RomMix is actually built for and the one
 * nothing else here can produce.
 *
 * Chromium polls `navigator.getGamepads()` rather than delivering events, so a
 * pad is an object the page reads sixty times a second — see `plugInPad`.
 *
 * Button numbers are written out rather than imported: `input/gamepad.ts` holds
 * the same numbers, and a test that shared the table with the code would agree
 * with it however either of them changed.
 */
describe('driving it with a controller', () => {
  /** Standard mapping: A, the d-pad, and the shoulders. */
  const A = 0
  const DPAD_RIGHT = 15

  test('the d-pad moves the highlight and A opens what it is on', async () => {
    await app.goTo('library')
    await app.waitFor(`document.querySelector('[data-rom="1"]')`, 'the library grid')

    const pad = await app.plugInPad()
    // The pointer puts the highlight somewhere known without choosing it, which
    // no press can do.
    await app.hover('[data-rom="1"]')

    await pad.tap(DPAD_RIGHT)
    await app.waitFor(
      `document.querySelector('[data-rom="2"]')?.dataset.focused === 'true'`,
      'the highlight to step right'
    )

    await pad.tap(A)
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game it was on')
    await pad.unplug()
  })

  test('a held direction repeats, and a tap does not', async () => {
    // The repeat is the pad's alone: a keyboard's comes from the operating
    // system, and the driver sends one event per press. Without it, crossing a
    // library of any size means pressing a hundred times.
    await app.goTo('library')
    const pad = await app.plugInPad()

    await app.hover('[data-rom="1"]')
    await pad.tap(DPAD_RIGHT)
    const afterOne = await app.read<string>(
      `document.querySelector('[data-focused="true"]')?.dataset.rom`
    )
    assert.equal(afterOne, '2', 'one press should be one step')

    await app.hover('[data-rom="1"]')
    await pad.hold(DPAD_RIGHT)
    // Past the delay before repeating starts, and far enough into it for
    // several. See REPEAT_DELAY_MS and REPEAT_INTERVAL_MS.
    await app.waitFor(
      `Number(document.querySelector('[data-focused="true"]')?.dataset.rom) > 2`,
      'a held direction to carry on moving'
    )
    await pad.release(DPAD_RIGHT)
    await pad.unplug()
  })

  test('a pad Chromium could not identify is still a working pad', async () => {
    // The case `UNMAPPED` exists for: an Xbox pad over Bluetooth, a clone, or
    // anything missing from the vendor table Chromium keeps. Its buttons are
    // nearly in the standard places, and the two that are not are the two here —
    // the d-pad arrives as a hat on axes 6 and 7 rather than as buttons, and
    // Start is button 7.
    //
    // Nobody holding one can tell this from a controller RomMix ignores, and
    // no keyboard test can reach it.
    const HAT_X = 6
    const UNMAPPED_START = 7

    await app.goTo('library')
    const pad = await app.plugInPad('')
    await app.hover('[data-rom="1"]')

    await pad.axis(HAT_X, 1)
    await app.waitFor(
      `document.querySelector('[data-rom="2"]')?.dataset.focused === 'true'`,
      'the hat to move the highlight'
    )
    await pad.axis(HAT_X, 0)

    await pad.tap(UNMAPPED_START)
    await app.waitFor(`document.querySelector('[data-screen="settings"]')`, 'the settings screen')
    await pad.unplug()
  })

  test('and the same button on a mapped pad is the right trigger, not Start', async () => {
    // Button 7 is a trigger on a pad Chromium mapped, and reading it as Start
    // would open the menu every time somebody held it — which is most of a
    // racing game.
    await app.goTo('library')
    const pad = await app.plugInPad('standard')
    await pad.tap(7)

    // Still where it was. Asserted rather than waited for, because what is
    // being claimed is that nothing happened.
    assert.equal(
      await app.read<boolean>(`Boolean(document.querySelector('[data-screen="library"]'))`),
      true,
      'the right trigger should not have opened the menu'
    )
    await pad.unplug()
  })

  test('Settings names the pad it can see, which is the pre-flight answer', async () => {
    // A controller that does not work looks the same from the sofa whichever
    // end it failed at. A name here means the pad reached the page and the
    // fault is further in; nothing means it never arrived.
    const pad = await app.plugInPad()
    await app.goTo('settings')
    await app.waitFor(`document.querySelector('[data-tab="system"]')`, 'the settings tabs')
    await app.choose('[data-tab="system"]')

    await app.waitFor(
      `document.body.textContent.includes('RomMix test pad')`,
      'the pad to be named on the system tab'
    )
    await pad.unplug()
  })
})

/**
 * Last on purpose: it takes the server away and does not put it back.
 */

describe('narrowing the library down', () => {
  test('a platform chip asks the server for that platform and nothing else', async () => {
    await app.goTo('library')
    await app.waitFor(`document.querySelector('[data-rom="1"]')`, 'the whole library')

    const megadrive = server.platforms[0]
    await app.choose(`[data-platform="${megadrive.id}"]`)

    // Narrowed at the server rather than in the page. A library runs to
    // thousands and arrives a page at a time, so a filter applied to what has
    // been fetched so far would agree with this fake and be wrong on anything
    // real — it would hide the games it has and never ask for the rest.
    await app.waitFor(`!document.querySelector('[data-rom="2"]')`, 'the other platforms to go')
    assert.ok(
      server.asked.some((one) => one.path.includes(`platform_ids=${megadrive.id}`)),
      'it should have asked for that platform by id'
    )

    // What is left is the platform that was asked for.
    const shown = await app.read<number[]>(
      `[...document.querySelectorAll('[data-rom]')].map((one) => Number(one.dataset.rom))`
    )
    const expected = server.roms
      .filter((one) => one.platform_id === megadrive.id)
      .map((one) => one.id)
    const byNumber = (a: number, b: number): number => a - b
    assert.deepEqual(
      shown.sort(byNumber),
      expected.sort(byNumber),
      'the grid should hold that platform'
    )
  })

  test('and All platforms puts them back', async () => {
    await app.choose('[data-platform="all"]')
    await app.waitFor(`document.querySelector('[data-rom="2"]')`, 'the whole library again')
  })

  test('Downloaded only is answered from this disk, without asking the server', async () => {
    // The one filter that is not a query. The downloaded scope is what the
    // machine holds, which RomMix already knows — asking the server to name
    // them would be a request that cannot be answered, since RomM has no idea
    // what is on this disk.
    const askedSoFar = server.asked.length
    await app.choose('[data-option="downloaded"]')
    await app.waitFor(
      `document.querySelector('[data-option="downloaded"]')?.dataset.active === 'true'`,
      'the downloaded scope to be chosen'
    )

    // Nothing has been downloaded in this file, so the honest answer is none —
    // and the interesting half is that it did not go and ask.
    await app.waitFor(`!document.querySelector('[data-rom]')`, 'the grid to empty')
    assert.deepEqual(
      server.asked.slice(askedSoFar).filter((one) => one.path.startsWith('/api/roms?')),
      [],
      'the downloaded scope should not have asked the server for a library'
    )
  })

  test('and All games goes back to what the server has', async () => {
    await app.choose('[data-option="all"]')
    await app.waitFor(`document.querySelector('[data-rom="2"]')`, 'the server library again')
  })
})

describe('searching the library', () => {
  test('what is typed reaches the server as a search, once', async () => {
    await app.goTo('library')
    await app.waitFor(`document.querySelector('[data-rom="2"]')`, 'the whole library')

    // Y is how anybody gets here, and the caret is what decides where typing
    // lands — see `type` in the driver.
    await app.press('Search')
    await app.waitFor(`document.activeElement?.tagName === 'INPUT'`, 'the caret in the box')

    const askedSoFar = server.asked.length
    // A letter at a time, because the thing being checked is what happens
    // between them: the box waits for a pause before asking, and without that a
    // four-letter word is four queries against a library of thousands.
    for (const letter of 'Tobu') await app.type(letter)

    await app.waitFor(`document.querySelector('[data-rom="2"]')`, 'the game that matches')
    await app.waitFor(`!document.querySelector('[data-rom="1"]')`, 'the ones that do not')

    const sent = server.asked
      .slice(askedSoFar)
      // The grid's own query rather than the counts that go out on the same
      // term: the platform chips are counted one query apiece, and what is
      // being weighed here is how long the box waited before asking at all.
      .filter((one) => one.path.includes('search_term=Tobu') && !one.path.includes('platform_ids'))
    assert.equal(sent.length, 1, `four letters should be one query, not ${sent.length}`)

    // The chips narrow with the grid. A platform's own count is the whole
    // platform, and a chip left carrying it under a search promises games the
    // grid it opens does not hold.
    const gameboy = server.platforms[1]
    await app.waitFor(
      `document.querySelector('[data-platform="${gameboy.id}"]')?.textContent?.includes('(1)')`,
      'the Game Boy chip to count what matches'
    )
    await app.waitFor(
      `!document.querySelector('[data-platform="${server.platforms[0].id}"]')`,
      'the platforms with nothing matching to go'
    )

    // Out of the field before anything else is driven. While it holds the caret
    // the keyboard handler stands down, so a scenario that walked away leaving
    // it there would take the menu with it for everything after.
    await app.press('Escape')
    await app.waitFor(`document.activeElement?.tagName !== 'INPUT'`, 'the caret to come back')
  })

  test('and leaving the screen forgets it', async () => {
    // The search is a way of looking at the library rather than a setting, so
    // coming back to it should be the whole library and not the last thing
    // somebody looked for.
    await app.goTo('home')
    await app.goTo('library')
    await app.waitFor(`document.querySelector('[data-rom="1"]')`, 'the whole library again')
    assert.equal(
      await app.read<string>(`document.querySelector('.field__input')?.value`),
      '',
      'the box should have been emptied'
    )
  })
})

describe('the artwork a library is mostly made of', () => {
  test('a cover is fetched through the main process and decodes', async () => {
    // The one asset path in RomMix, and the reason it exists: RomM serves
    // artwork behind the same token as everything else, so the renderer cannot
    // ask for a cover directly. `imageUrl` hands it a `rommix-img://` URL, and
    // the main process answers that by going to the server — or to the copy it
    // saved. Nothing had ever driven it, because every cover the fake served
    // was null.
    await app.goTo('library')
    await app.waitFor(`document.querySelector('.cover img')`, 'a cover to be drawn')

    const src = await app.read<string>(`document.querySelector('.cover img')?.getAttribute('src')`)
    assert.match(src, /^rommix-img:\/\//, 'a cover should go through the main process')

    // Decoded, not merely requested. A path that answered 404 leaves an `img`
    // in the page looking exactly like this one, and the fallback that replaces
    // it is drawn on an error the test would otherwise never see.
    await app.waitFor(
      `[...document.querySelectorAll('.cover img')].some((one) => one.naturalWidth > 0)`,
      'the picture to arrive and decode'
    )
  })

  test('and a game RomM has no artwork for falls back to its name', async () => {
    // Not every game has a cover, and the tile for one that does not has to say
    // something rather than leave a hole the size of a cover.
    await app.waitFor(
      `document.querySelector('[data-rom="3"] .cover__fallback')`,
      'the fallback for the game with no art'
    )
  })
})

describe('putting a game on a shelf', () => {
  test('the dialog says which shelves this game is already on', async () => {
    // Rom 3 is on none of them — the fake's shelf holds 1 and 2 — so the row
    // starts off, which is the state the toggle below has somewhere to go from.
    await app.goTo('library')
    await app.choose('[data-rom="3"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await app.choose('[data-action="collections"]')

    const shelf = server.collections[0]
    await app.waitFor(
      `document.querySelector('.overlay [data-collection="${shelf.id}"]')`,
      'the shelves to be listed'
    )
    assert.equal(
      await app.read<string>(
        `document.querySelector('.overlay [data-collection="${shelf.id}"] .status')?.dataset.state`
      ),
      'off',
      'a game that is not on the shelf should not be marked as on it'
    )
  })

  test('choosing one puts the game on it', async () => {
    const shelf = server.collections[0]
    await app.choose(`.overlay [data-collection="${shelf.id}"]`)

    await app.waitFor(
      `document.querySelector('.overlay [data-collection="${shelf.id}"] .status')?.dataset.state === 'ok'`,
      'the shelf to be marked'
    )

    // Asked for by the verb that means add. Two verbs share this path and the
    // screen draws what it believes rather than what the server did, so the
    // shelf itself is what settles it.
    const added = server.asked.filter((one) => one.path === `/api/collections/${shelf.id}/roms`)
    assert.equal(added.at(-1)?.method, 'POST')
    assert.ok(shelf.rom_ids.includes(3), `the shelf holds ${JSON.stringify(shelf.rom_ids)}`)
  })

  test('and choosing it again takes the game off', async () => {
    const shelf = server.collections[0]
    await app.choose(`.overlay [data-collection="${shelf.id}"]`)

    await app.waitFor(
      `document.querySelector('.overlay [data-collection="${shelf.id}"] .status')?.dataset.state === 'off'`,
      'the shelf to be cleared'
    )

    const asked = server.asked.filter((one) => one.path === `/api/collections/${shelf.id}/roms`)
    assert.equal(asked.at(-1)?.method, 'DELETE')
    assert.equal(
      shelf.rom_ids.includes(3),
      false,
      `the shelf still holds ${JSON.stringify(shelf.rom_ids)}`
    )

    // Shut behind itself. This dialog stays open through several answers —
    // unlike the ones that close on the first — and an `Overlay` binds nothing
    // to Back, so the button is the way out and a scenario that walked away
    // would leave the next one escaping through it.
    await app.choose('[data-action="close-collections"]')
    await app.waitFor(`!document.querySelector('.overlay')`, 'the dialog to close')
  })
})

describe('saying how far through a game you are', () => {
  test('the dialog opens on the answer already given', async () => {
    await app.goTo('library')
    await app.choose('[data-rom="2"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await app.choose('[data-action="status"]')

    // Nothing has been said about this game, so the row the dialog opens on is
    // the one that means nothing has — which is what makes the answer below a
    // change rather than a repeat.
    await app.waitFor(`document.querySelector('.overlay [data-status]')`, 'the answers')
    await app.waitFor(
      `document.querySelector('.overlay [data-status="none"]')?.dataset.focused === 'true'`,
      'the highlight to open on the answer already given'
    )
  })

  test('choosing one tells RomM, which keeps it', async () => {
    await app.choose('.overlay [data-status="finished"]')

    // The dialog closes on its own: a game has exactly one answer here, so
    // there is nothing further to say once it is given.
    await app.waitFor(`!document.querySelector('.overlay')`, 'the dialog to close')

    // Kept on the server rather than in RomMix, which is the whole point of it
    // — a game marked finished from the sofa is finished in a browser too. The
    // fake merges the patch rather than replacing the object, so this also says
    // nothing else about the game was cleared on the way.
    const rom = server.roms.find((one) => one.id === 2)
    assert.equal(rom?.rom_user.status, 'finished')
    assert.equal(rom?.rom_user.rom_id, 2, 'the rest of what RomM holds should survive the patch')
  })

  test('and the dialog opens on it the next time', async () => {
    await app.choose('[data-action="status"]')
    await app.waitFor(
      `document.querySelector('.overlay [data-status="finished"]')?.dataset.focused === 'true'`,
      'the answer given last time'
    )
    // By its own button. An `Overlay` binds nothing to Back, so in every dialog
    // but the handful that bind it themselves the way out is a button.
    await app.choose('[data-action="close-status"]')
    await app.waitFor(`!document.querySelector('.overlay')`, 'the dialog to close again')
  })
})

/**
 * The screenshots tab and the viewer it opens into.
 *
 * The one tab whose contents are pictures rather than rows, and the only place
 * in RomMix where a focus layer is raised over a screen that is not a dialog.
 * Neither had ever been drawn: the fake served every game with an empty
 * `merged_screenshots`, so the tab was the empty state and nothing else.
 */
describe('looking at the screenshots of a game', () => {
  /** What RomM says this game's pictures are, in the order the tab draws them. */
  const shots = (): string[] => server.roms.find((one) => one.id === 2)?.merged_screenshots ?? []

  /** The viewer is showing this one. Its `src` is the only thing that says so. */
  const showing = (path: string, what: string): Promise<void> =>
    app.waitFor(
      `document.querySelector('.viewer__image')?.src.includes(${JSON.stringify(
        encodeURIComponent(path)
      )})`,
      what
    )

  test('the tab draws one thumbnail per shot, and they decode', async () => {
    await app.goTo('library')
    await app.choose('[data-rom="2"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await app.choose('[data-tab="screenshots"]')

    await app.waitFor(`document.querySelector('.shot')`, 'the thumbnails')
    const drawn = await app.read<string[]>(
      `[...document.querySelectorAll('.shot')].map((one) => one.dataset.shot)`
    )
    assert.deepEqual(drawn, shots(), `the tab drew ${JSON.stringify(drawn)}`)

    // Arrived rather than merely asked for. These go through `rommix-img://`
    // like a cover does, and a path the main process could not answer leaves a
    // grid of buttons that look exactly like these with nothing in them.
    await app.waitFor(
      `[...document.querySelectorAll('.shot__image')].every((one) => one.naturalWidth > 0)`,
      'every thumbnail to decode'
    )
  })

  test('pressing one opens it as large as the screen will show it', async () => {
    await app.choose(`[data-shot="${shots()[0]}"]`)
    await showing(shots()[0], 'the shot that was pressed')
    await app.waitFor(
      `document.querySelector('.viewer__image').naturalWidth > 0`,
      'the full picture'
    )
  })

  test('and the walk through the set comes round at both ends', async () => {
    // A run of presses on one button, which is how a set is looked through on a
    // pad. Focus opens on next for that reason, so this is the button already
    // under the thumb.
    await app.choose('[data-action="shot-next"]')
    await showing(shots()[1], 'the second shot')

    for (let step = 1; step < shots().length; step += 1) {
      await app.choose('[data-action="shot-next"]')
    }
    await showing(shots()[0], 'the first shot, one lap later')

    // The other end, which the first half cannot show: a viewer that stopped
    // here rather than wrapping reads as one that has stuck.
    await app.choose('[data-action="shot-previous"]')
    await showing(shots()[shots().length - 1], 'the last shot, backwards past the start')
  })

  test('Back closes the picture and leaves the game where it was', async () => {
    // The viewer binds Back itself, on a layer of its own. Without that layer
    // the same press would be the game screen's, and a look at a screenshot
    // would end in the library.
    await app.press('Escape')
    await app.waitFor(`!document.querySelector('.viewer')`, 'the viewer to close')
    await app.waitFor(
      `document.querySelector('[data-screen="game"]')`,
      'the game screen to still be there'
    )
  })

  test('a game RomM holds no shots for says so', async () => {
    await app.goTo('library')
    // The game the fake serves without artwork, which is also the one without
    // pictures — an empty tab has to say something rather than be a blank card.
    await app.choose('[data-rom="3"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await app.choose('[data-tab="screenshots"]')
    await app.waitFor(`document.querySelector('.panel__body .empty')`, 'the empty tab')
    assert.equal(
      await app.read<number>(`document.querySelectorAll('.shot').length`),
      0,
      'a game with no screenshots should draw no thumbnails'
    )
  })
})

/**
 * The heart, which is the one mark RomM has no field for.
 *
 * A favourite is a membership of an ordinary collection that RomM calls the
 * favourites one by its name — so the first press of the heart *creates* a
 * collection, on a multipart POST that nothing else in RomMix makes. The fake
 * had no route for it, and the screen it is pressed on had never been asked.
 */
describe('marking a game a favourite', () => {
  test('a library nobody has favourited anything in has no shelf for it', async () => {
    assert.equal(
      server.collections.some((one) => one.is_favorite),
      false,
      'the fixtures should start with no favourites shelf'
    )

    // And the home screen draws no row for one: an empty shelf is left out
    // rather than drawn empty, which is what makes its arrival below the whole
    // of the assertion.
    await app.goTo('home')
    await app.waitFor(`document.querySelector('[data-shelf="recent"]')`, 'the home shelves')
    assert.equal(
      await app.read<boolean>(`Boolean(document.querySelector('[data-shelf="favourites"]'))`),
      false
    )
  })

  test('pressing it makes the shelf and puts the game on it', async () => {
    await app.goTo('library')
    await app.choose('[data-rom="1"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')

    // Off to begin with, and it has to have been answered before it can be
    // pressed: the button is disabled while RomMix does not yet know which way
    // it is set.
    await app.waitFor(
      `document.querySelector('[data-action="favourite"]')?.dataset.disabled !== 'true'`,
      'the heart to know which way it is set'
    )
    await app.choose('[data-action="favourite"]')

    await app.waitFor(
      `document.querySelector('[data-action="favourite"]')?.dataset.on === 'true'`,
      'the heart to fill in'
    )

    // Made on the server rather than remembered here, which is the whole point
    // of a mark that lives on RomM: the shelf did not exist a moment ago.
    const shelf = server.collections.find((one) => one.is_favorite)
    assert.ok(shelf, 'the press should have created the favourites shelf')
    assert.deepEqual(shelf.rom_ids, [1])
  })

  test('and the home screen draws the shelf it just made', async () => {
    await app.goTo('home')
    await app.waitFor(
      `document.querySelector('[data-shelf="favourites"] [data-rom="1"]')`,
      'the game on the favourites shelf'
    )

    // The shelf, not the library: RomM answers `favorite=true` from that one
    // collection, so a row drawn from any other query would hold every game
    // here and say nothing.
    const drawn = await app.read<string[]>(
      `[...document.querySelectorAll('[data-shelf="favourites"] [data-rom]')].map(
         (one) => one.dataset.rom
       )`
    )
    assert.deepEqual(drawn, ['1'])
  })

  test('and pressing it again takes the game off, leaving the shelf behind', async () => {
    await app.goTo('library')
    await app.choose('[data-rom="1"]')
    await app.waitFor(
      `document.querySelector('[data-action="favourite"]')?.dataset.on === 'true'`,
      'the heart, still filled in from last time'
    )
    await app.choose('[data-action="favourite"]')
    await app.waitFor(
      `document.querySelector('[data-action="favourite"]')?.dataset.on !== 'true'`,
      'the heart to empty'
    )

    // The shelf stays, because RomM keeps it: what changed is the membership.
    // A second collection here would mean the create call ran twice, which is
    // the failure this is really watching for.
    const shelves = server.collections.filter((one) => one.is_favorite)
    assert.equal(shelves.length, 1, 'it should not have made a second shelf')
    assert.deepEqual(shelves[0].rom_ids, [])
  })
})

/**
 * Where downloaded games are written, and where RomMix keeps its own folder.
 *
 * Two settings that move files rather than change how something is drawn, and
 * neither had been driven. The first is asked about before it takes effect —
 * both directions have a consequence that shows up on another screen entirely —
 * and the question is the part worth testing: it is what stands between one
 * press and a library the emulators stop reading.
 */
describe('moving where games are kept', () => {
  const storage = (): Promise<string> =>
    app.read<string>(`(await window.rommix.system.settings()).romStorage`)

  test('changing it asks first, and holds the answer until it is agreed to', async () => {
    await app.goTo('settings')
    await app.waitFor(`document.querySelector('[data-tab="games"]')`, 'the settings tabs')
    await app.choose('[data-tab="games"]')
    await app.waitFor(`document.querySelector('[data-option="rommix"]')`, 'the storage control')
    assert.equal(await storage(), 'rommix', 'the fixtures should start on the shared folder')

    await app.choose('[data-option="emulator"]')
    await app.waitFor(`document.querySelector('.overlay')`, 'the question')

    // Held, not applied: the dialog is up and the setting is what it was. A
    // control that wrote first and asked afterwards would be explaining a
    // change that had already happened.
    assert.equal(await storage(), 'rommix')
  })

  test('and staying put leaves the control where it was', async () => {
    await app.choose('[data-action="storage-keep"]')
    await app.waitFor(`!document.querySelector('.overlay')`, 'the question to close')

    // The control follows the setting rather than the press, so the row that
    // was pressed does not stay lit after the answer was no.
    await app.waitFor(
      `document.querySelector('[data-option="rommix"]')?.dataset.active === 'true'`,
      'the shared folder to still be the one in force'
    )
    assert.equal(await storage(), 'rommix')
  })

  test('agreeing moves the library into each emulator’s own folder', async () => {
    await app.choose('[data-option="emulator"]')
    await app.waitFor(`document.querySelector('.overlay')`, 'the question again')
    await app.choose('[data-action="storage-confirm"]')

    await app.waitFor(
      `(await window.rommix.system.settings()).romStorage === 'emulator'`,
      'the setting to change'
    )
    await app.waitFor(
      `document.querySelector('[data-option="emulator"]')?.dataset.active === 'true'`,
      'the control to agree with it'
    )
  })

  test('and back again, which is the other half of the question', async () => {
    // Both directions are asked about and the two are not the same question —
    // one warns that a download stops counting when a platform is repointed,
    // the other that no emulator reads the shared folder until it is told to.
    await app.choose('[data-option="rommix"]')
    await app.waitFor(`document.querySelector('.overlay')`, 'the other direction')
    await app.choose('[data-action="storage-confirm"]')
    await app.waitFor(
      `(await window.rommix.system.settings()).romStorage === 'rommix'`,
      'the setting to come back'
    )
  })
})

describe('the folder RomMix keeps everything in', () => {
  test('it is named on the screen, and pinned where the environment set it', async () => {
    await app.goTo('settings')
    await app.waitFor(`document.querySelector('[data-tab="system"]')`, 'the settings tabs')
    await app.choose('[data-tab="system"]')
    await app.waitFor(`document.querySelector('[data-field="root"]')`, 'the folder')

    // The folder in force, not the default one: a box that showed where RomMix
    // would keep its files by default, while it is keeping them somewhere else,
    // is worse than not naming a folder at all.
    const root = await app.read<{ current: string; fromEnvironment: boolean }>(
      `await window.rommix.system.root()`
    )
    assert.equal(
      await app.read<string>(`document.querySelector('[data-field="root"]')?.value`),
      root.current
    )

    // And it cannot be moved from here, because `ROMMIX_HOME` wins over the
    // pointer file this button writes — so moving it would report success and
    // be ignored on the next launch. Every application in this suite is run
    // that way, which is also why the move itself is `root.test.ts` rather
    // than a scenario.
    assert.equal(root.fromEnvironment, true, 'the harness pins this with ROMMIX_HOME')
    await app.waitFor(
      `document.querySelector('[data-action="move-root"]')?.dataset.disabled === 'true'`,
      'the move to be off'
    )
  })

  test('and the pre-flight check can be run again, and says what it found', async () => {
    await app.waitFor(`document.querySelector('[data-action="recheck-system"]')`, 'the check')

    // Almost every failure in RomMix is something about the machine rather
    // than about RomMix, and this is the button that goes and looks again
    // after the machine has been changed. It used to redraw the same list
    // silently, which on a machine where nothing had changed was
    // indistinguishable from a button that does nothing — so what is waited
    // for here is it saying so.
    await app.choose('[data-action="recheck-system"]')
    await app.waitFor(`document.querySelector('.toast')`, 'what the check found')
    await app.waitFor(
      `document.querySelector('[data-action="recheck-system"]')?.dataset.disabled === 'false'`,
      'the button to come back'
    )
  })
})

/**
 * The language, changed from the screen that offers it.
 *
 * Four catalogues are checked against each other by `npm test` — every key in
 * one is a key in the others — and not one of them had ever been drawn. What
 * that leaves untested is the part between a catalogue and a screen: the
 * setting reaching the renderer, and every label being read through `t` rather
 * than written into the JSX in English.
 */
describe('reading it in another language', () => {
  test('choosing one redraws what is on screen, without a restart', async () => {
    await app.goTo('settings')
    // The strip keeps whichever tab was last opened, and the scenarios above
    // leave it on another one.
    await app.waitFor(`document.querySelector('[data-tab="general"]')`, 'the settings tabs')
    await app.choose('[data-tab="general"]')
    await app.waitFor(`document.querySelector('[data-option="fr"]')`, 'the languages')

    // The menu rather than anything on the settings page itself: it is drawn by
    // the shell, so a language that reached only the screen that set it would
    // still pass. The label is compared against the catalogue rather than a
    // sentence typed here, so a wording change is not a broken test.
    await app.choose('[data-option="fr"]')
    await app.waitFor(
      `document.querySelector('[data-route="settings"]')?.title === ${JSON.stringify(
        fr['nav.settings']
      )}`,
      'the menu to come back in French'
    )
    await app.waitFor(
      `(await window.rommix.system.settings()).language === 'fr'`,
      'the choice to be kept'
    )
  })

  test('and it goes back, which is the half a one-way switch would hide', async () => {
    // Still findable while the screen is in a language the test does not read,
    // which is what the handles are for.
    await app.choose('[data-option="en"]')
    await app.waitFor(
      `document.querySelector('[data-route="settings"]')?.title === ${JSON.stringify(
        en['nav.settings']
      )}`,
      'the menu in English again'
    )

    // Left as it was found: every scenario after this one shares the
    // application, and the language it starts in is the machine's own.
    await app.choose('[data-option="auto"]')
    await app.waitFor(
      `(await window.rommix.system.settings()).language === 'auto'`,
      'the language to be handed back to the system'
    )
  })
})
