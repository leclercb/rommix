import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The shell script the image execs before the Electron binary.
 *
 * Tested from here rather than by `npm run test:app`, which drives the built
 * application: what this decides is decided *before* there is an application,
 * and every one of its answers is reached with environment variables and no
 * window at all.
 *
 * It is worth a test for one reason above the others. This is the single code
 * path every launch takes, on every machine, and a mistake in it is not a
 * feature that misbehaves — it is a RomMix that cannot start, reported as
 * nothing happening. See packaging/rommix-launcher.sh.
 */

const LAUNCHER = join(import.meta.dirname, 'rommix-launcher.sh')

interface Launch {
  /** What the stand-in binary was handed, which is the command line RomMix gets. */
  argv: string[]
  /** Everything written to the console, where a failing start is watched. */
  stderr: string
  /** The lines in `<root>/logs/launcher.log`. */
  logged: (root: string) => string[]
  /** The root a launch with no ROMMIX_HOME and no pointer resolves to. */
  root: string
}

/**
 * A temporary directory that goes when the run does.
 *
 * Each of these holds an executable copy of the launcher, and the suite makes
 * one per case — so without this every `npm test` left a dozen of them behind
 * in the system temp directory, for nothing to ever clear away.
 */
const scratches: string[] = []
after(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratches.push(dir)
  return dir
}

/**
 * Run the launcher with a stand-in for the binary, and read back what happened.
 *
 * The stand-in writes its own arguments down: what the launcher decides is a
 * command line, and the only honest account of one is the process that received
 * it.
 */
function launch(env: Record<string, string>, args: string[] = []): Launch {
  const dir = scratch('rommix-launcher-')
  const home = join(dir, 'home')
  mkdirSync(home, { recursive: true })
  const runtime = join(dir, 'run')
  mkdirSync(runtime, { recursive: true })

  writeFileSync(join(dir, 'rommix'), readFileSync(LAUNCHER))
  chmodSync(join(dir, 'rommix'), 0o755)
  writeFileSync(join(dir, 'rommix.bin'), `#!/bin/sh\nprintf '%s\\n' "$@" > ${dir}/argv\n`)
  chmodSync(join(dir, 'rommix.bin'), 0o755)

  // One run, not two: the script writes a line per launch, and a helper that
  // started it twice to read two of its outputs would be counting its own.
  const ran = spawnSync(join(dir, 'rommix'), args, {
    env: { PATH: process.env.PATH ?? '', HOME: home, XDG_RUNTIME_DIR: runtime, ...env },
    encoding: 'utf8'
  })

  return {
    argv: readFileSync(join(dir, 'argv'), 'utf8').split('\n').filter(Boolean),
    stderr: ran.stderr,
    root: join(home, 'rommix'),
    logged: (root) =>
      readFileSync(join(root, 'logs', 'launcher.log'), 'utf8')
        .split('\n')
        .filter(Boolean)
  }
}

describe('the backend it chooses', () => {
  test('a wayland session with no compositor falls back to X11', () => {
    const { argv } = launch({ XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' })
    assert.deepEqual(argv, ['--ozone-platform=x11'])
  })

  test('and leaves a session with a compositor alone', () => {
    const dir = scratch('rommix-compositor-')
    writeFileSync(join(dir, 'wayland-0'), '')
    const { argv } = launch({
      XDG_SESSION_TYPE: 'wayland',
      DISPLAY: ':0',
      XDG_RUNTIME_DIR: dir
    })
    assert.deepEqual(argv, [])
  })

  test('and a session that does not claim wayland, since Chromium chooses well there', () => {
    assert.deepEqual(launch({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }).argv, [])
  })

  test('and a backend somebody named themselves, whichever it is', () => {
    const chosen = launch({ XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }, [
      '--ozone-platform=wayland'
    ])
    assert.deepEqual(chosen.argv, ['--ozone-platform=wayland'])
  })

  test('and says so, on a session that would not have been touched anyway', () => {
    // The record is there to have its decision disagreed with, so the reason it
    // gives has to be the one that decided. Naming a backend on an X11 session
    // changes nothing about the outcome and everything about the why.
    const run = launch({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, ['--ozone-platform=wayland'])
    assert.match(run.logged(run.root)[0], /a backend was named on the command line/)
  })

  test('and says nothing about X11 where there is no DISPLAY to fall back to', () => {
    // Naming x11 with nowhere to draw trades a backend that cannot connect for
    // another one that cannot either, and the second is RomMix's doing.
    assert.deepEqual(launch({ XDG_SESSION_TYPE: 'wayland' }).argv, [])
  })
})

describe('what it writes down', () => {
  test('one line per launch, in the shape the log is written in', () => {
    const first = launch({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' })
    const lines = first.logged(first.root)
    assert.equal(lines.length, 1)
    assert.match(lines[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ INFO {2}startup {4}\S/)
  })

  test('and the record is JSON, whatever the values carry', () => {
    // A newline in a value would be a second line that reads as a second
    // launch, and a quote would be a record nothing can parse.
    const run = launch({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0\nnot a launch"\\x' })
    const lines = run.logged(run.root)
    assert.equal(lines.length, 1)
    const detail = JSON.parse(lines[0].slice(lines[0].indexOf('{')))
    assert.equal(detail.display, ':0not a launch"\\x')
    assert.equal(detail.session, 'x11')
  })

  test('and the switches it hands on, but never an operand', () => {
    // The desktop entry passes `%U`, so a bare argument can be a URL somebody
    // was opened into — and a URL is the one thing here that carries a token.
    const run = launch({ XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }, [
      '--no-sandbox',
      'rommix://open?token=secret'
    ])
    const line = run.logged(run.root)[0]
    assert.equal(line.includes('secret'), false)
    assert.equal(
      JSON.parse(line.slice(line.indexOf('{'))).switches,
      '--ozone-platform=x11 --no-sandbox'
    )
  })

  test('and the same line on the console, for the terminal somebody is watching', () => {
    const run = launch({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' })
    assert.match(run.stderr, /INFO {2}startup/)
  })
})

describe('the root it writes under', () => {
  test('ROMMIX_HOME, before anything else', () => {
    const elsewhere = scratch('rommix-elsewhere-')
    const run = launch({ XDG_SESSION_TYPE: 'x11', ROMMIX_HOME: elsewhere })
    assert.equal(run.logged(elsewhere).length, 1)
  })

  test('then the pointer file, newline or no newline', () => {
    const pointed = scratch('rommix-pointed-')
    const dir = scratch('rommix-pointer-')
    mkdirSync(join(dir, '.config', 'rommix'), { recursive: true })
    // Written without one, which is the shape a hand-edited pointer takes.
    writeFileSync(join(dir, '.config', 'rommix', 'root'), pointed)
    launch({ XDG_SESSION_TYPE: 'x11', HOME: dir })
    assert.equal(
      readFileSync(join(pointed, 'logs', 'launcher.log'), 'utf8').trim().length > 0,
      true
    )
  })

  test('and a root that is only spaces is one nobody meant to set', () => {
    // `resolveRoot` trims it and falls through; a launcher that did not would
    // make a directory named " " wherever it happened to be started from.
    const run = launch({ XDG_SESSION_TYPE: 'x11', ROMMIX_HOME: '  ' })
    assert.equal(run.logged(run.root).length, 1)
  })
})

describe('what it refuses to let stop a launch', () => {
  /** Run with the named commands replaced by ones that fail. */
  function without(missing: string[], env: Record<string, string>): string[] {
    const dir = scratch('rommix-missing-')
    for (const name of missing) {
      writeFileSync(join(dir, name), '#!/bin/sh\nexit 127\n')
      chmodSync(join(dir, name), 0o755)
    }
    return launch({ ...env, PATH: `${dir}:${process.env.PATH ?? ''}` }).argv
  }

  test('every command the record needs, missing', () => {
    // The whole of the reporting is a function whose status is tested, so
    // `set -e` stands down inside it: none of this is worth a RomMix that
    // does not start.
    assert.deepEqual(
      without(['date', 'sed', 'tr', 'mkdir', 'tail', 'mv', 'uname', 'head', 'wc'], {
        XDG_SESSION_TYPE: 'wayland',
        DISPLAY: ':0'
      }),
      ['--ozone-platform=x11']
    )
  })

  test('and a root it cannot write to', () => {
    assert.deepEqual(
      launch({ XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0', ROMMIX_HOME: '/proc/nowhere' }).argv,
      ['--ozone-platform=x11']
    )
  })

  test('and a console nobody is reading any more', () => {
    // A reader that has gone delivers SIGPIPE, which ends a shell before any
    // status can be tested — so the write is made under an ignored one.
    const dir = scratch('rommix-pipe-')
    writeFileSync(join(dir, 'rommix'), readFileSync(LAUNCHER))
    chmodSync(join(dir, 'rommix'), 0o755)
    writeFileSync(join(dir, 'rommix.bin'), `#!/bin/sh\nprintf '%s\\n' "$@" > ${dir}/argv\n`)
    chmodSync(join(dir, 'rommix.bin'), 0o755)
    const home = join(dir, 'home')
    mkdirSync(home)

    execFileSync('sh', ['-c', `{ "${join(dir, 'rommix')}" 2>&1 1>/dev/null; } | head -0`], {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: home,
        XDG_RUNTIME_DIR: dir,
        XDG_SESSION_TYPE: 'wayland',
        DISPLAY: ':0'
      }
    })
    assert.deepEqual(readFileSync(join(dir, 'argv'), 'utf8').split('\n').filter(Boolean), [
      '--ozone-platform=x11'
    ])
  })

  test('and a root it cannot write to, with nobody reading the console either', () => {
    // The two together, which is the pair that used to be fatal: the shell's
    // own complaint about the unwritable file went to a pipe whose reader had
    // gone, and SIGPIPE ended it before the exec.
    const dir = scratch('rommix-both-')
    writeFileSync(join(dir, 'rommix'), readFileSync(LAUNCHER))
    chmodSync(join(dir, 'rommix'), 0o755)
    writeFileSync(join(dir, 'rommix.bin'), `#!/bin/sh\nprintf '%s\\n' "$@" > ${dir}/argv\n`)
    chmodSync(join(dir, 'rommix.bin'), 0o755)

    execFileSync('sh', ['-c', `{ "${join(dir, 'rommix')}" 2>&1 1>/dev/null; } | head -0`], {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(dir, 'home'),
        XDG_RUNTIME_DIR: dir,
        XDG_SESSION_TYPE: 'wayland',
        DISPLAY: ':0',
        ROMMIX_HOME: '/proc/nowhere'
      }
    })
    assert.deepEqual(readFileSync(join(dir, 'argv'), 'utf8').split('\n').filter(Boolean), [
      '--ozone-platform=x11'
    ])
  })

  test('and says nothing to the console about a file nobody asked it to write', () => {
    // A root on a disk that is not mounted used to be three "Permission denied"
    // lines and an `integer expected` on every launch, in the one place this
    // script is trying to keep readable.
    const run = launch({
      XDG_SESSION_TYPE: 'x11',
      DISPLAY: ':0',
      ROMMIX_HOME: '/proc/nowhere'
    })
    assert.equal(run.stderr.split('\n').filter(Boolean).length, 1, run.stderr)
    assert.match(run.stderr, /INFO {2}startup/)
  })

  test('and it leaves the binary the signals it expects', () => {
    // An ignored disposition survives `exec`, and Chromium is entitled to the
    // default one.
    const dir = scratch('rommix-signals-')
    writeFileSync(join(dir, 'rommix'), readFileSync(LAUNCHER))
    chmodSync(join(dir, 'rommix'), 0o755)
    writeFileSync(
      join(dir, 'rommix.bin'),
      `#!/bin/sh\ngrep -E '^SigIgn' /proc/self/status > ${dir}/signals\n`
    )
    chmodSync(join(dir, 'rommix.bin'), 0o755)
    const home = join(dir, 'home')
    mkdirSync(home)

    execFileSync(join(dir, 'rommix'), [], {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: home,
        XDG_RUNTIME_DIR: dir,
        XDG_SESSION_TYPE: 'x11'
      },
      stdio: 'ignore'
    })
    assert.match(readFileSync(join(dir, 'signals'), 'utf8'), /SigIgn:\s+0+$/m)
  })
})

describe('the history it keeps', () => {
  test('launches accumulate rather than replacing each other', () => {
    const root = scratch('rommix-history-')
    for (let at = 0; at < 3; at += 1) launch({ XDG_SESSION_TYPE: 'x11', ROMMIX_HOME: root })
    assert.equal(
      readFileSync(join(root, 'logs', 'launcher.log'), 'utf8')
        .split('\n')
        .filter(Boolean).length,
      3
    )
  })

  test('and it is trimmed back to the cap once it is over it', () => {
    const root = scratch('rommix-trim-')
    mkdirSync(join(root, 'logs'), { recursive: true })
    const seeded = Array.from({ length: 400 }, (_, at) => `seeded line ${at}`).join('\n')
    writeFileSync(join(root, 'logs', 'launcher.log'), `${seeded}\n`)

    const run = launch({ XDG_SESSION_TYPE: 'x11', ROMMIX_HOME: root })
    const kept = run.logged(root)
    assert.equal(kept.length, 200, 'the cap is `KEEP` in the script')
    // The newest end, and this launch's own line at the bottom of it.
    assert.match(kept[kept.length - 1], /INFO {2}startup/)
    // And nothing left lying beside it: the trim writes through a name of its
    // own and takes it away again.
    assert.deepEqual(readdirSync(join(root, 'logs')), ['launcher.log'])
  })

  test('and left alone while it is under the cap', () => {
    const root = scratch('rommix-untrimmed-')
    mkdirSync(join(root, 'logs'), { recursive: true })
    writeFileSync(join(root, 'logs', 'launcher.log'), 'an older launch\n')

    const run = launch({ XDG_SESSION_TYPE: 'x11', ROMMIX_HOME: root })
    assert.deepEqual(run.logged(root).length, 2)
    assert.equal(run.logged(root)[0], 'an older launch')
  })

  test('and concurrent ones never leave it empty', () => {
    // Every second launch of RomMix runs this script — the application refuses
    // to be two, the launcher in front of it cannot. Two of them trimming
    // through one shared name emptied the file outright; through a name each,
    // the worst a lost race costs is the line it was adding.
    const root = scratch('rommix-concurrent-')
    mkdirSync(join(root, 'logs'), { recursive: true })
    const seeded = Array.from({ length: 400 }, (_, at) => `seeded line ${at}`).join('\n')
    writeFileSync(join(root, 'logs', 'launcher.log'), `${seeded}\n`)

    const dir = scratch('rommix-racing-')
    writeFileSync(join(dir, 'rommix'), readFileSync(LAUNCHER))
    chmodSync(join(dir, 'rommix'), 0o755)
    writeFileSync(join(dir, 'rommix.bin'), '#!/bin/sh\nexit 0\n')
    chmodSync(join(dir, 'rommix.bin'), 0o755)

    const one = `ROMMIX_HOME='${root}' XDG_SESSION_TYPE=x11 '${join(dir, 'rommix')}' 2>/dev/null`
    // A smoke test rather than a guard: the window is small enough that a
    // shared name only empties the file on some passes. What makes the trim
    // safe is a name this process alone writes, which is a property of the
    // script; this is here to notice a run that loses the file outright.
    for (let round = 0; round < 3; round += 1) {
      execFileSync('sh', ['-c', `${`${one} & `.repeat(8)}wait`], { stdio: 'ignore' })
      const kept = readFileSync(join(root, 'logs', 'launcher.log'), 'utf8')
        .split('\n')
        .filter(Boolean)
      assert.ok(kept.length > 0, `the history was emptied on round ${round + 1}`)
    }
  })
})
