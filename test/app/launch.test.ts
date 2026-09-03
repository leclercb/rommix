import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { standInEmulator, startApp, type App } from './driver.ts'
import { startFakeRomm, type FakeRomm } from './server.ts'

/**
 * Choosing which of an emulator's runners a system is played with.
 *
 * Its own file because it needs an emulator RomMix has a choice about, and
 * there is exactly one shape of those: EmuDeck, which writes a launcher script
 * per emulator it installs and leaves RomMix to ask which of them should run a
 * given system. Every other emulator in the registry answers for itself, so no
 * other scenario can reach the question at all — `game:variants` was called
 * from nowhere in the suite, and the dialog it fills had never been opened.
 *
 * The install is a directory of scripts and nothing else, which is exactly what
 * EmuDeck's detection is: the launchers being there is what says an emulator
 * was set up. So a `HOME` with two of them in it is a machine with two ways to
 * play a Game Boy game — and the scripts are stand-ins, which record what they
 * were handed.
 */

let server: FakeRomm
let app: App
/** The two launchers, and what each was run with. See `standInEmulator`. */
let retroarch: ReturnType<typeof standInEmulator>
let mgba: ReturnType<typeof standInEmulator>

before(async () => {
  server = await startFakeRomm()
  const home = mkdtempSync(join(tmpdir(), 'rommix-emudeck-'))
  const launchers = join(home, 'Emulation', 'tools', 'launchers')
  mkdirSync(launchers, { recursive: true })
  // The rest of the folders EmuDeck's own setup makes. Without them RomMix
  // reads the install as one that has never been run — which is the honest
  // answer for a half-made tree, and not the machine being described here.
  for (const dir of ['roms', 'saves', 'bios']) {
    mkdirSync(join(home, 'Emulation', dir), { recursive: true })
  }

  // Under the names EmuDeck gives them, because those names are the whole of
  // what RomMix looks for: a row of the table naming a script that is not here
  // describes an emulator this user never installed. See `usableVariants`.
  retroarch = standInEmulator()
  mgba = standInEmulator()
  for (const [script, standIn] of [
    ['retroarch.sh', retroarch],
    ['mgba.sh', mgba]
  ] as const) {
    copyFileSync(standIn.path, join(launchers, script))
    chmodSync(join(launchers, script), 0o755)
  }

  app = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    settings: {
      systemEmulators: { gb: 'emudeck' },
      // A second emulator that covers the same systems, which is what the
      // scenario at the end of this file needs: handing a platform from one to
      // another is only a change where there is another to hand it to.
      emulatorPaths: { retroarch: retroarch.path }
    },
    // What makes that folder EmuDeck's: the descriptor reads its layout from
    // the home directory when EmuDeck's own settings file is not there.
    env: { HOME: home }
  })

  // Before anything is pressed. `goTo` walks out of wherever it is to reach the
  // menu, and a window that has not finished mounting has no menu to reach —
  // the press lands on the bottom of the stack and offers to quit instead.
  await app.waitFor(`document.querySelector('[data-screen="home"]')`, 'the home screen')
})

after(async () => {
  await app?.stop()
  await server?.close().catch(() => undefined)
})

describe('a game its emulator has more than one way to run', () => {
  test('pressing Play asks which, rather than picking for you', async () => {
    await app.goTo('library')
    await app.choose('[data-rom="2"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await app.choose('[data-action="download"]')
    await app.waitFor(
      `(await window.rommix.library.installed()).some((one) => one.romId === 2)`,
      'the game to arrive'
    )

    await app.choose('[data-action="play"]')

    // Both, and only the ones whose script is really there: the table lists
    // what EmuDeck can install, and the probe drops what it did not.
    await app.waitFor(`document.querySelector('[data-action="variant-gambatte"]')`, 'the question')
    await app.waitFor(`document.querySelector('[data-action="variant-mgba"]')`, 'the other answer')
  })

  test('and the answer is what starts, with the arguments that runner takes', async () => {
    await app.choose('[data-action="variant-mgba"]')
    // The curtain rather than the panel: a game RomM has artwork for is covered
    // by its own cover while it runs. See `RunningOverlay`.
    await app.waitFor(`document.querySelector('.curtain')`, 'the running overlay')

    // The standalone emulator's own shape — `mgba.sh -f <rom>` — rather than
    // RetroArch's, which takes a core before the game. A launch that built one
    // runner's command line for another is an emulator that opens on an error
    // in its own words, with RomMix reporting a session that went fine.
    const argv = await mgba.argv()
    assert.equal(argv[0], '-f')
    assert.ok(argv[1]?.endsWith('tobutobugirl.gb'), argv.join(' '))
  })

  test('the choice is kept, so the next launch does not ask again', async () => {
    await app.waitFor(`!document.querySelector('.curtain')`, 'the session to end', 20_000)

    // Recorded against the emulator and the system together, which is what
    // makes it a choice about Game Boy rather than about this game.
    await app.waitFor(
      `(await window.rommix.system.settings()).systemLaunchers['emudeck:gb'] === 'mgba'`,
      'the answer to be written down'
    )

    await app.choose('[data-action="play"]')
    await app.waitFor(`document.querySelector('.curtain')`, 'the game to start with no question')
    assert.equal(
      await app.read<boolean>(`Boolean(document.querySelector('[data-action="variant-mgba"]'))`),
      false,
      'a question already answered should not be asked again'
    )
  })

  test('and Run with is the way back to it', async () => {
    await app.waitFor(`!document.querySelector('.curtain')`, 'the session to end', 20_000)

    // Without this button an answer given once could only be changed by
    // editing the settings file, which is not a thing to do from a sofa.
    await app.choose('[data-action="run-with"]')
    await app.waitFor(
      `document.querySelector('[data-action="variant-gambatte"]')`,
      'the question again'
    )

    await app.choose('[data-action="variant-gambatte"]')
    await app.waitFor(`document.querySelector('.curtain')`, 'the other runner to start')

    // RetroArch's shape this time, core first: the same game, the same button,
    // a different command line entirely.
    const argv = await retroarch.argv()
    assert.deepEqual(argv.slice(0, 2), ['-L', 'gambatte_libretro.so'])
    assert.ok(argv[2]?.endsWith('tobutobugirl.gb'), argv.join(' '))
    await app.waitFor(
      `(await window.rommix.system.settings()).systemLaunchers['emudeck:gb'] === 'gambatte'`,
      'the new answer to replace the old one'
    )
  })
})

/**
 * Handing a platform to a different emulator.
 *
 * The other half of what this file's machine is for: two emulators here cover
 * the same systems, which is the only state in which this control does
 * anything. It decides where a download for that platform is written and
 * whether the games already there still count as installed — so it asks first,
 * and that question had never been raised by a scenario.
 */
describe('handing a platform to another emulator', () => {
  /**
   * Which emulator this platform has been given, or nothing while it is on
   * whatever the default is. Keyed by RomMix's own name for the system rather
   * than RomM's: the server calls it `genesis-slash-megadrive`, and
   * `resolveSystem` is what turns that into the id the descriptors are written
   * against.
   */
  const chosen = (): Promise<string | null> =>
    app.read<string | null>(
      `(await window.rommix.system.settings()).systemEmulators['genesis'] ?? null`
    )

  test('it asks before it changes anything', async () => {
    // The scenario above left a game running, and while one is up it owns the
    // screen — there is no menu to walk to underneath it.
    await app.waitFor(`!document.querySelector('.curtain')`, 'the session to end', 20_000)

    await app.goTo('emulators')
    await app.waitFor(`document.querySelector('[data-platform="genesis"]')`, 'the platforms')
    assert.equal(await chosen(), null, 'it should start on whatever the default is')

    await app.choose('[data-platform="genesis"] [data-action="choose-emulator"]')
    await app.waitFor(`document.querySelector('.overlay')`, 'the question')

    // Asked before it is done, like the storage question: a download under the
    // old emulator's folder stops counting the moment this is agreed to, and
    // that is discovered on the game screen rather than here.
    assert.equal(await chosen(), null, 'the platform should not have moved yet')
  })

  test('staying put leaves the platform where it was', async () => {
    await app.choose('[data-action="emulator-keep"]')
    await app.waitFor(`!document.querySelector('.overlay')`, 'the question to close')
    assert.equal(await chosen(), null)
  })

  test('and agreeing hands it over', async () => {
    await app.choose('[data-platform="genesis"] [data-action="choose-emulator"]')
    await app.waitFor(`document.querySelector('.overlay')`, 'the question again')
    await app.choose('[data-action="emulator-change"]')

    await app.waitFor(
      `(await window.rommix.system.settings()).systemEmulators['genesis'] !== undefined`,
      'the platform to change hands'
    )
  })

  test('and the third answer stops it being asked at all', async () => {
    await app.choose('[data-platform="genesis"] [data-action="choose-emulator"]')
    await app.waitFor(`document.querySelector('.overlay')`, 'the question once more')
    const wasOn = await chosen()
    await app.choose('[data-action="emulator-change-quiet"]')

    // It changes as well as silences: turning the question off and leaving the
    // platform where it was is not what "do not ask me again" means.
    await app.waitFor(
      `(await window.rommix.system.settings()).systemEmulators['genesis'] !== ${JSON.stringify(
        wasOn
      )}`,
      'the change to be made as well'
    )
    await app.waitFor(
      `(await window.rommix.system.settings()).dismissedNotices.length > 0`,
      'the notice to be written off'
    )

    // And the proof of it: the same press, one step further round the cycle,
    // with nothing in the way. Unlike the storage question, this one is asked
    // every time a platform is repointed — which on a machine being set up is
    // once per console — so it is the one that has to be silenceable.
    const wasOnAgain = await chosen()
    await app.choose('[data-platform="genesis"] [data-action="choose-emulator"]')
    await app.waitFor(
      `(await window.rommix.system.settings()).systemEmulators['genesis'] !== ${JSON.stringify(
        wasOnAgain
      )}`,
      'the next change to go through unasked'
    )
    assert.equal(
      await app.read<boolean>(`Boolean(document.querySelector('.overlay'))`),
      false,
      'nothing should have been asked this time'
    )
  })
})
