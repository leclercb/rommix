import { after, before, describe, test } from 'node:test'
import { standInEmulator, startApp, type App } from './driver.ts'
import { startFakeRomm, type FakeRomm } from './server.ts'

/**
 * An emulator that will not close when it is asked.
 *
 * Its own file, and not only because it needs an emulator that ignores being
 * asked — see `standInEmulator`. `games.test.ts` already starts three
 * applications of its own, and a fourth in the same process reliably never
 * brought its debugger up.
 *
 * The real emulators go quiet for ordinary reasons: Eden raises its own
 * confirmation dialog, and one opened off-screen or hung never answers it. A
 * direct emulator then had nothing left to try, and RomMix sat waiting on it
 * for as long as it stayed up.
 *
 * The whole of what is under test is the second press. Anything the emulator
 * had not written is lost when it lands, which is why nothing reaches it until
 * the user has been told so.
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

describe('forcing a stuck emulator closed', () => {
  test('asking it to quit is said rather than assumed to have worked', async () => {
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

    await stuck.choose('[data-action="close-emulator"]')

    // The request is not the outcome: an emulator is given time to save, so the
    // overlay stays up and would otherwise look like a button that did nothing.
    await stuck.waitFor(
      `!document.querySelector('[data-action="close-emulator"]')`,
      'the close button to be spent'
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
