import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { startScenario, type Scenario } from './harness.ts'

/**
 * A handheld carried out of the room, and back into it.
 *
 * Its own file because the server has to leave and return on the same address:
 * `games.test.ts` takes it away in its last scenario and never brings it back,
 * which is the half that cannot be tested that way round. What makes this path
 * worth anything is that it ends — a machine that went quiet and came back has
 * to end up where it started without anybody signing in again.
 *
 * Everything here is about what is still true with no server: the screens that
 * need one give way, the ones that do not narrow to this disk, and the pictures
 * come off the copies RomMix kept when the game was installed.
 */

let scenario: Scenario
let server: Scenario['server']
let app: Scenario['app']

before(async () => {
  scenario = await startScenario()
  ;({ server, app } = scenario)
})

after(async () => {
  await scenario?.stop()
})

describe('when the server goes out of reach', () => {
  test('a game is downloaded first, so there is something to be offline with', async () => {
    await app.goTo('library')
    await app.choose('[data-rom="1"]')
    await app.choose('[data-action="download"]')
    await app.waitFor(
      `(await window.rommix.library.installed()).some((one) => one.romId === 1)`,
      'the game to arrive'
    )

    // Its cover with it: `OfflineCache.save` fetches the artwork a game names
    // before it writes the record down.
    await app.waitFor(
      `[...document.querySelectorAll('.cover img')].some((one) => one.naturalWidth > 0)`,
      'the cover to arrive while there is still a server'
    )
  })

  test('it says which machine is missing rather than only that one is', async () => {
    await server.goAway()

    // Prompted rather than waited out: a screen making requests finds out
    // within the request, and the poll behind it is the backstop for a session
    // sitting still. See `PROBE_WHILE_AWAY_MS`.
    await app.goTo('library')
    await app.waitFor(`document.querySelector('.notice--warn')`, 'the offline notice')

    // "Offline" alone reads as a setting somebody turned on, so the bar names
    // the server it cannot reach.
    const host = new URL(server.baseUrl).host
    await app.waitFor(
      `document.querySelector('.topbar__host')?.textContent?.includes(${JSON.stringify(host)})`,
      'the missing server to be named'
    )
  })

  test('the section with no local half is taken out of the menu', async () => {
    // Every other screen narrows to what is on this disk. A collection is a
    // list the server keeps and there is nothing of it here, so the honest
    // answer is not to offer it.
    await app.waitFor(
      `!document.querySelector('[data-route="collections"]')`,
      'collections to leave the bar'
    )
    await app.waitFor(`document.querySelector('[data-route="library"]')`, 'the rest to stay')
  })

  test('the library is what this disk holds', async () => {
    await app.waitFor(`document.querySelector('[data-rom="1"]')`, 'the downloaded game')

    // And nothing else. Offering a game that cannot be fetched would be a
    // download button that fails on every press.
    assert.equal(
      await app.read<boolean>(`Boolean(document.querySelector('[data-rom="2"]'))`),
      false,
      'a game that is not on this disk should not be offered'
    )
  })

  test('and its cover comes off the copy RomMix kept', async () => {
    // Asking the tile is not enough to know this still works. The picture is
    // served with a long `max-age`, so the page answers for it from its own
    // cache and an `img` that loaded while there was a server goes on looking
    // loaded whether or not anything behind it still can.
    //
    // So this asks for the same picture under a URL the page has never seen.
    // `registerImageProtocol` reads `p` and nothing else, so it lands on the
    // same asset — and with no server to fall back to, only the saved copy can
    // answer it. See `OfflineCache.assetFile`.
    const drawn = await app.read<string>(
      `(async () => {
         const src = document.querySelector('[data-rom="1"] .cover img')?.getAttribute('src')
         if (!src) return 'the tile drew no picture at all'
         const uncached = new Image()
         uncached.src = src + '&uncached=' + Date.now()
         return await new Promise((settle) => {
           uncached.onload = () => settle(uncached.naturalWidth > 0 ? 'drawn' : 'empty')
           uncached.onerror = () => settle('nothing answered')
         })
       })()`
    )
    assert.equal(drawn, 'drawn')
  })
})

describe('and when it comes back', () => {
  test('it finds its way back on its own', async () => {
    await server.comeBack()

    // Nothing is pressed here on purpose. Away from the server almost nothing
    // is being asked, so there are no failures left to learn from and the poll
    // is the only way back — a handheld carried into the room has nobody
    // telling RomMix it arrived.
    await app.waitFor(
      `!document.querySelector('.notice--warn')`,
      'the offline notice to clear itself',
      30_000
    )
    await app.waitFor(`document.querySelector('.topbar__user')`, 'the signed-in name again')
  })

  test('and the screens it took away are offered again', async () => {
    await app.waitFor(
      `document.querySelector('[data-route="collections"]')`,
      'collections to return to the bar'
    )

    // The whole library again, not only what is on the disk.
    await app.goTo('library')
    await app.waitFor(`document.querySelector('[data-rom="2"]')`, 'the games only RomM has')
  })
})
