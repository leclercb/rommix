import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { STARTUP_MS, complaint, flaggedLines, readExit, stageFor, tailOf } from './emulatorexit.ts'

/**
 * Deciding what an emulator's exit meant.
 *
 * The one part of launching that can be checked without a process, and the part
 * where being wrong costs the most: a real session read as a failed launch
 * leaves the saves it wrote unsent, and a launch that never happened read as a
 * clean exit is a Play button that appears to do nothing.
 *
 * Every emulator RomMix drives breaks one of the obvious rules. RetroDECK exits
 * 0 when it cannot start a game; RetroArch logs its fatal error to stdout, not
 * stderr; several return non-zero after a perfectly good session. So the
 * assertions here are mostly about which signal is allowed to decide.
 */

/** An exit with nothing unusual about it, for a test to vary one thing of. */
function exit(over: Partial<Parameters<typeof readExit>[0]> = {}): Parameters<typeof readExit>[0] {
  return { code: 0, signal: null, signalled: false, ranMs: STARTUP_MS * 2, output: '', ...over }
}

describe('an exit somebody asked for', () => {
  test('stopping the game from RomMix is not a failure, whatever it returned', () => {
    const reading = readExit(exit({ signalled: true, code: 1, ranMs: 10 }))
    assert.equal(reading.kind, 'asked')
    assert.deepEqual(reading.report, { startupError: null, warning: null })
  })

  test('killed from outside the same, and it is the signal that says so', () => {
    const reading = readExit(exit({ signal: 'SIGKILL', code: null, ranMs: 10 }))
    assert.equal(reading.kind, 'asked')
    assert.equal(reading.report.startupError, null)
  })

  test('being asked outranks the clock: an immediate stop is not a crash', () => {
    // The close button pressed on a game still loading. Read by the clock alone
    // this is the shape of a launch that never started, and the user would be
    // told the emulator quit immediately about a thing they closed themselves.
    assert.equal(readExit(exit({ signalled: true, ranMs: 0, code: 1 })).kind, 'asked')
  })
})

describe('an exit after a session', () => {
  test('zero after a real session is a clean exit', () => {
    const reading = readExit(exit())
    assert.equal(reading.kind, 'clean')
    assert.deepEqual(reading.report, { startupError: null, warning: null })
  })

  test('non-zero after a real session is a warning, never a failed launch', () => {
    // The session happened and wrote saves. Reporting this as a failure is what
    // would throw them away.
    const reading = readExit(exit({ code: 1, output: 'shaders ok\n[ERROR] audio device gone\n' }))
    assert.equal(reading.kind, 'complained')
    assert.equal(reading.report.startupError, null)
    assert.equal(reading.report.warning, 'The emulator reported: [ERROR] audio device gone')
  })

  test('a session that grumbled about nothing in particular says nothing', () => {
    const reading = readExit(exit({ code: 1, output: 'saving state\nbye\n' }))
    assert.equal(reading.kind, 'complained')
    assert.deepEqual(reading.report, { startupError: null, warning: null })
  })

  test('a session is one that lasted, not one that returned zero', () => {
    // RetroDECK asked to start a game it cannot start says so and exits 0. The
    // clock is the only thing that separates that from a game somebody played.
    assert.equal(readExit(exit({ code: 0, ranMs: STARTUP_MS - 1 })).kind, 'never-started')
    assert.equal(readExit(exit({ code: 0, ranMs: STARTUP_MS })).kind, 'clean')
  })
})

describe('an exit before anything was on screen', () => {
  test('what the emulator flagged is what the user is told', () => {
    const output = 'checking cores\n[ERROR] failed to load content\n'
    const reading = readExit(exit({ code: 1, ranMs: 20, output }))
    assert.equal(reading.kind, 'never-started')
    assert.equal(
      reading.report.startupError,
      'The emulator quit immediately: [ERROR] failed to load content'
    )
    assert.equal(reading.report.warning, null)
  })

  test('an emulator that flagged nothing is still reported, using its last words', () => {
    const reading = readExit(exit({ code: 1, ranMs: 20, output: 'starting up\nno such file\n' }))
    assert.equal(
      reading.report.startupError,
      'The emulator quit immediately: starting up no such file'
    )
  })

  test('a silent exit names its code, because zero would explain nothing', () => {
    assert.equal(
      readExit(exit({ code: 3, ranMs: 20 })).report.startupError,
      'The emulator quit immediately (code 3).'
    )
    // Zero is the least informative thing an exit can say, and quoting it
    // invites the reply that nothing went wrong.
    assert.equal(
      readExit(exit({ code: 0, ranMs: 20 })).report.startupError,
      'The emulator quit immediately.'
    )
  })
})

describe('reading what the emulator said', () => {
  test('flagged lines are picked out of a run that logged everything else too', () => {
    const output = [
      'compiling shader 1',
      'ERROR: no BIOS',
      'audio: pipewire',
      'fatal: giving up'
    ].join('\n')
    assert.equal(flaggedLines(output), 'ERROR: no BIOS fatal: giving up')
  })

  test('only the last three, so a notification is readable', () => {
    const output = Array.from({ length: 6 }, (_, i) => `error ${i}`).join('\n')
    assert.equal(flaggedLines(output), 'error 3 error 4 error 5')
  })

  test('a word inside another is not a flag', () => {
    // `\berror\b`: "terrorist" and "errors.log" are not an emulator complaining.
    assert.equal(flaggedLines('loading terrorists.rom\n'), null)
  })

  test('the tail skips the blank lines an emulator signs off with', () => {
    assert.equal(tailOf('one\n\ntwo\n\n\n'), 'one two')
    assert.equal(tailOf('   \n\n'), null)
  })

  test('a complaint prefers what was flagged and falls back to the tail', () => {
    assert.equal(complaint('setting up\nERROR: no core\n'), 'ERROR: no core')
    assert.equal(complaint('setting up\ngoodbye\n'), 'setting up goodbye')
    assert.equal(complaint(''), null)
  })
})

describe('the line under the Play button while a core installs', () => {
  test('a download of known size counts up', () => {
    const stage = stageFor({ core: 'genesis_plus_gx', receivedBytes: 512, totalBytes: 1024 })
    assert.equal(stage, 'Installing the genesis_plus_gx core… 50%')
  })

  test('one the server declared no length for says only what it is doing', () => {
    // A percentage of an unknown total is either a lie or a NaN on screen.
    const stage = stageFor({ core: 'mgba', receivedBytes: 512, totalBytes: 0 })
    assert.equal(stage, 'Installing the mgba core…')
  })
})
