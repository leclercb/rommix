import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { standInEmulator, startApp, type App } from './driver.ts'
import { startFakeRomm, type FakeRomm } from './server.ts'

/**
 * While an emulator owns the screen.
 *
 * The one state RomMix is in where the interface is not the thing in front of
 * the player, and where nearly every input is deliberately thrown away. It
 * needs an emulator that ignores being asked to quit — see `standInEmulator` —
 * because a stand-in that dies on the first signal never holds the screen long
 * enough for any of this to be asked of it.
 *
 * Its own file for a second reason: `games.test.ts` already starts three
 * applications, and a fourth in the same process reliably never brought its
 * debugger up.
 *
 * The real emulators go quiet for ordinary reasons: Eden raises its own
 * confirmation dialog, and one opened off-screen or hung never answers it. A
 * direct emulator then had nothing left to try, and RomMix sat waiting on it
 * for as long as it stayed up.
 */

let server: FakeRomm
let stuck: App
let stubborn: ReturnType<typeof standInEmulator>

before(async () => {
  server = await startFakeRomm()
  stubborn = standInEmulator({ stubborn: true })
  stuck = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    settings: {
      systemEmulators: { switch: 'eden' },
      emulatorPaths: { eden: stubborn.path },
      confirmSavePush: false
    }
  })
})

after(async () => {
  await stuck?.stop()
  await server?.close().catch(() => undefined)
})

describe('while an emulator owns the screen', () => {
  /** Standard mapping, the two buttons that matter here. */
  const A = 0
  const START = 9

  test('a game takes the screen, and the overlay says so', async () => {
    await stuck.waitFor(`document.querySelector('[data-screen="home"]')`, 'the home screen')
    await stuck.goTo('library')
    await stuck.choose('[data-rom="3"]')
    await stuck.choose('[data-action="download"]')
    await stuck.waitFor(
      `(await window.rommix.library.installed()).some((one) => one.romId === 3)`,
      'the game to arrive'
    )
    await stuck.choose('[data-action="play"]')
    await stuck.waitFor(`document.querySelector('.overlay')`, 'the running overlay')
  })

  test('the pad belongs to the game, so nothing on it reaches RomMix', async () => {
    // The Gamepad API is polled rather than delivered: `navigator.getGamepads()`
    // reports button state whoever holds window focus, so without suspending it
    // every press meant for the game was read here too. A was the one that hurt
    // — the overlay used to autofocus its close button, so pressing A in a game
    // quit the game.
    const pad = await stuck.plugInPad()

    await pad.tap(A)
    await pad.tap(START)

    // Nothing moved. Asserted rather than waited for, because the claim is that
    // no press arrived: the overlay is still offering to close rather than
    // reporting that it has asked.
    assert.equal(
      await stuck.read<boolean>(
        `Boolean(document.querySelector('[data-action="close-emulator"]'))`
      ),
      true,
      'a tap should not have reached the overlay'
    )
    await pad.unplug()
  })

  test('except Start held down, which is the way back from a hung one', async () => {
    // The one press that gets through, and it has to be held: no game's own use
    // of Start can trip a hold this long, and an emulator that has hung or
    // opened off-screen leaves nothing else to try. The game sees the press
    // either way and will open its own pause menu, which is fine.
    const pad = await stuck.plugInPad()
    await pad.hold(START)
    await new Promise((done) => setTimeout(done, 1_800))
    await pad.release(START)
    await pad.unplug()

    // The same handler the close button reaches. The request is not the
    // outcome: an emulator is given time to save, so the overlay stays up and
    // would otherwise look like a press that did nothing.
    await stuck.waitFor(
      `!document.querySelector('[data-action="close-emulator"]')`,
      'the close offer to be spent'
    )
    await stuck.waitFor(`document.querySelector('.overlay')`, 'the overlay to stay up')
  })

  test('and once it is plainly not going, forcing it is offered', async () => {
    // Only after a wait, because the emulator is entitled to take a moment and
    // a force offered immediately is a force people press by reflex. See
    // `FORCE_AFTER_MS`.
    await stuck.waitFor(
      `document.querySelector('[data-action="force-close"]')`,
      'the offer to force it',
      20_000
    )

    await stuck.choose('[data-action="force-close"]')

    // Gone, which is the only outcome that counts: the overlay is up for
    // exactly as long as something has the screen, so its leaving is the
    // emulator being gone rather than a message about it.
    await stuck.waitFor(`!document.querySelector('.overlay')`, 'the emulator to go', 20_000)
    await stuck.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen back')
  })
})
