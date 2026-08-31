import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedInstall } from '@config/emulators'
import { spawn } from 'node:child_process'
import {
  binaryPath,
  descendantsOf,
  execPrefix,
  findMatchingFile,
  flatpakAvailable,
  flatpakLocation,
  flathubConfigured,
  installFlatpak,
  isWritable,
  killFlatpakApp,
  killProcessTree,
  signalProcessGroup,
  stopFlatpakApp
} from './host.ts'

/**
 * What RomMix can ask the machine without starting a subprocess: reading a
 * process tree, matching a file name against a descriptor's glob, and building
 * the argv an emulator is started with.
 *
 * All of it feeds decisions that are hard to see going wrong. A missed
 * descendant is a Close button that does nothing, because the process actually
 * running the game was never signalled. A glob that matches too much is RomMix
 * adopting some other program as an emulator. A variable on the wrong side of
 * a flatpak's application id is one the emulator never receives.
 */

const roots: string[] = []
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

function scratch(files: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-host-test-'))
  roots.push(dir)
  for (const name of files) writeFileSync(join(dir, name), '')
  return dir
}

/** `ps -eo pid=,ppid=` output, which is what `descendantsOf` is handed. */
function ps(rows: readonly [number, number][]): string {
  return rows.map(([pid, ppid]) => `  ${pid}  ${ppid}`).join('\n')
}

test('every generation below the sandbox is found, not just its children', () => {
  // The shape that matters: `flatpak ps` names bubblewrap, the emulator is its
  // child, and the process that actually holds the game open is a grandchild.
  const tree = ps([
    [100, 1], // bubblewrap, the sandbox
    [200, 100], // the emulator
    [300, 200], // its render process
    [400, 300], // something below that
    [999, 1] // unrelated
  ])
  assert.deepEqual(
    descendantsOf(tree, [100]).sort((a, b) => a - b),
    [200, 300, 400]
  )
})

test('an unrelated tree is left alone', () => {
  const tree = ps([
    [100, 1],
    [200, 100],
    [500, 1],
    [600, 500]
  ])
  assert.deepEqual(descendantsOf(tree, [500]), [600])
})

test('two sandboxes are both walked', () => {
  const tree = ps([
    [100, 1],
    [101, 100],
    [200, 1],
    [201, 200]
  ])
  assert.deepEqual(
    descendantsOf(tree, [100, 200]).sort((a, b) => a - b),
    [101, 201]
  )
})

test('a sandbox with nothing under it yields nothing rather than throwing', () => {
  assert.deepEqual(descendantsOf(ps([[100, 1]]), [100]), [])
  assert.deepEqual(descendantsOf('', [100]), [])
})

test('a corrupt process table cannot become an infinite loop', () => {
  // Impossible in a real kernel, and the guard is there because a parse that
  // went wrong must not hang the close button forever.
  const cycle = ps([
    [100, 200],
    [200, 100]
  ])
  const found = descendantsOf(cycle, [100])
  assert.ok(found.length <= 2, 'terminates')
})

test('garbage lines are skipped rather than parsed as processes', () => {
  const tree = `${ps([[200, 100]])}\nnot a row\n   \nPID PPID`
  assert.deepEqual(descendantsOf(tree, [100]), [200])
})

test('a glob matches case-insensitively, as a renamed AppImage needs', async () => {
  const dir = scratch(['Eden-Linux-v0.2.1-amd64.AppImage'])
  assert.equal(
    await findMatchingFile(dir, ['eden*.appimage']),
    join(dir, 'Eden-Linux-v0.2.1-amd64.AppImage')
  )
})

test('a glob is anchored at both ends', async () => {
  const dir = scratch(['not-eden-really.AppImage.zsync', 'prefix-eden.AppImage'])
  // `eden*.appimage` must not match a name that merely contains it, or the
  // `.zsync` update manifest beside every Eden build gets adopted as the
  // program.
  assert.equal(await findMatchingFile(dir, ['eden*.appimage']), null)
})

test('regex metacharacters in a pattern are literal', async () => {
  // A descriptor writes shell globs, not expressions. `.` has to mean a dot.
  const dir = scratch(['shadps4X.AppImage'])
  assert.equal(await findMatchingFile(dir, ['shadps4.appimage']), null)
})

test('a missing directory is an answer, not an error', async () => {
  assert.equal(await findMatchingFile('/nonexistent/rommix/path', ['*.appimage']), null)
})

/**
 * The rest of what RomMix asks the machine, minus the parts that are a
 * subprocess: how an install is started, where other applications keep their
 * settings, and whether a folder can be written into.
 *
 * `execPrefix` is the one worth stating plainly. It is the argv every emulator
 * is started with, so an `--env` on the wrong side of a flatpak's application
 * id is a variable the emulator never sees and a launch that fails for reasons
 * nothing on screen explains.
 */

const environment = {
  home: process.env.HOME,
  config: process.env.XDG_CONFIG_HOME,
  data: process.env.XDG_DATA_HOME
}

after(() => {
  for (const [name, value] of Object.entries({
    HOME: environment.home,
    XDG_CONFIG_HOME: environment.config,
    XDG_DATA_HOME: environment.data
  })) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test('a flatpak is started through flatpak run, with any variables before the app id', () => {
  const install: ResolvedInstall = { kind: 'flatpak', ref: 'net.retrodeck.retrodeck' }

  assert.deepEqual(execPrefix(install, { SDL_VIDEODRIVER: 'wayland' }), [
    'flatpak',
    'run',
    '--env=SDL_VIDEODRIVER=wayland',
    'net.retrodeck.retrodeck'
  ])
})

test('an AppImage is run directly, and a scripts install has no program of its own', () => {
  assert.deepEqual(execPrefix({ kind: 'appimage', ref: '/home/player/Eden.AppImage' }), [
    '/home/player/Eden.AppImage'
  ])
  assert.deepEqual(execPrefix({ kind: 'binary', ref: '/usr/bin/retroarch' }), [
    '/usr/bin/retroarch'
  ])
  assert.deepEqual(execPrefix({ kind: 'scripts', ref: '/home/player/emudeck/tools' }), [])
})

test('a name that is not a plain program name is never handed to a shell', async () => {
  // The string would run `id` if it reached `sh -c`. It has to be refused on
  // sight: descriptors are data, and data does not get to write commands.
  assert.equal(await binaryPath(['retroarch; id']), null)
})

test('a program on PATH is found by its absolute path', async () => {
  const found = await binaryPath(['sh'])

  assert.ok(found?.endsWith('/sh'))
})

test('a directory RomMix cannot write to, and one that is not there at all', async () => {
  const dir = scratch([])

  assert.equal(await isWritable(dir), true)
  assert.equal(await isWritable(join(dir, 'not-created')), false)
  assert.equal(await isWritable(null), false)
})

/**
 * The half of this file that is a subprocess: finding, stopping and installing
 * flatpak applications, and killing a process tree.
 *
 * Driven by a `flatpak` of our own on PATH. RomMix asks flatpak rather than
 * constructing paths or reading its database, deliberately — that is what
 * covers a system or a user installation, either architecture and any branch —
 * so there is nothing to point these at instead, and leaving them untested
 * leaves the close button and the installer untested. The script answers only
 * the questions RomMix actually asks.
 *
 * The process-tree tests use real processes, because the thing under test is
 * whether the right ones are signalled.
 */

const pathBefore = process.env.PATH ?? ''
after(() => {
  process.env.PATH = pathBefore
})

/** A `flatpak` on PATH that answers from a scripted table. */
function fakeFlatpak(answers: {
  version?: string
  location?: string
  remotes?: string
  ps?: string
  installExit?: number
  installOutput?: string
  /**
   * A pid `flatpak ps` reports for as long as it is actually alive.
   *
   * What makes the kill path testable: `flatpak kill` here does nothing, the
   * same as the real one does for an instance flatpak has lost track of, so
   * whether the app goes depends entirely on RomMix signalling it — and this
   * answers honestly about whether it did.
   */
  livePid?: number
}): void {
  const dir = scratch([])
  const script = join(dir, 'flatpak')
  // `printf` rather than a heredoc: the branches are one-liners ending in `;;`,
  // and a heredoc terminator is only a terminator on a line of its own.
  const say = (value: string | undefined): string =>
    value === undefined
      ? 'exit 1'
      : `printf '%s\\n' ${value
          .split('\n')
          .map((line) => `'${line}'`)
          .join(' ')}`

  writeFileSync(
    script,
    [
      '#!/bin/sh',
      'case "$1" in',
      `  --version) ${say(answers.version)} ;;`,
      `  info) ${say(answers.location)} ;;`,
      `  remotes) ${say(answers.remotes)} ;;`,
      `  ps) ${
        answers.livePid === undefined
          ? say(answers.ps)
          : `if kill -0 ${answers.livePid} 2>/dev/null; then printf '%s %s\n' 'net.retrodeck.retrodeck' '${answers.livePid}'; fi`
      } ;;`,
      `  kill) exit 0 ;;`,
      '  install)',
      `    ${answers.installOutput ? `printf '%s\\n' '${answers.installOutput}'` : ':'}`,
      `    exit ${answers.installExit ?? 0} ;;`,
      '  remote-add) exit 0 ;;',
      '  *) exit 1 ;;',
      'esac',
      ''
    ].join('\n'),
    { mode: 0o755 }
  )
  // Built on the original PATH, never on whatever the last test left behind:
  // one test empties it, and `sh` has to keep working for the ones after.
  process.env.PATH = `${dir}:${pathBefore}`
}

test('a machine with no flatpak at all says so, rather than looking like no emulators', async () => {
  // Worth asking separately from "is RetroDECK installed": without flatpak the
  // answer to that is always no, and the reason is invisible.
  process.env.PATH = '/nonexistent/rommix/bin'
  try {
    assert.equal(await flatpakAvailable(), false)
    assert.equal(await flatpakLocation('net.retrodeck.retrodeck'), null)
    assert.equal(await flathubConfigured(), false)
  } finally {
    process.env.PATH = pathBefore
  }
})

test('an installed flatpak reports where it is deployed', async () => {
  fakeFlatpak({ version: 'Flatpak 1.14.0', location: '/var/lib/flatpak/app/x/current/abc' })

  assert.equal(await flatpakAvailable(), true)
  assert.equal(
    await flatpakLocation('net.retrodeck.retrodeck'),
    '/var/lib/flatpak/app/x/current/abc'
  )
})

test('an application flatpak does not have is not installed', async () => {
  fakeFlatpak({ version: 'Flatpak 1.14.0' })

  assert.equal(await flatpakLocation('net.retrodeck.retrodeck'), null)
})

test('flathub counts only when it is on the user installation', async () => {
  fakeFlatpak({ remotes: 'fedora\nflathub' })
  assert.equal(await flathubConfigured(), true)

  fakeFlatpak({ remotes: 'fedora' })
  assert.equal(await flathubConfigured(), false)
})

test('nothing running means there is nothing to stop', async () => {
  fakeFlatpak({ ps: 'net.example.Other\t1234' })

  assert.equal(await stopFlatpakApp('net.retrodeck.retrodeck'), false)
})

test('an application id that is not one is refused before flatpak is run', async () => {
  // Descriptors are data, and data does not get to write commands.
  await assert.rejects(() => installFlatpak('net.example.App; id', () => {}))
})

test('a flatpak install reports its output line by line', async () => {
  fakeFlatpak({ remotes: 'flathub', installOutput: 'Installing net.example.App' })
  const lines: string[] = []

  await installFlatpak('net.example.App', (line) => lines.push(line))

  assert.ok(lines.includes('Installing net.example.App'))
})

test('a flatpak install that fails reports what it said, not just a code', async () => {
  fakeFlatpak({ remotes: 'flathub', installExit: 1, installOutput: 'error: nothing matches' })

  await assert.rejects(
    () => installFlatpak('net.example.App', () => {}),
    (error: Error) => error.message.includes('nothing matches')
  )
})

test('flathub is added when it is missing, and the caller is told', async () => {
  // The whole fix for the likeliest first-run failure: a stock Debian or Fedora
  // has flatpak and no usable Flathub, and the raw error names neither.
  fakeFlatpak({ remotes: 'fedora', installOutput: 'done' })
  const lines: string[] = []

  await installFlatpak('net.example.App', (line) => lines.push(line))

  assert.ok(lines.length > 1, 'adding the remote has to be said, not done silently')
})

test('asking a flatpak to quit signals it, and waits for it to go', async () => {
  /**
   * The ordinary way an emulator is closed, which nothing covered.
   *
   * `flatpak ps` names the sandbox, and the application is normally a child of
   * it — so what has to be signalled is the descendants. A test that only
   * checked the sandbox would pass while the emulator kept the screen, which is
   * the bug this function was written for.
   */
  const sandbox = spawn('sh', ['-c', 'sleep 30'], { stdio: 'ignore' })
  const pid = sandbox.pid
  assert.ok(pid)
  const exited = new Promise<void>((resolve) => sandbox.on('exit', () => resolve()))
  fakeFlatpak({ livePid: pid })

  assert.equal(await stopFlatpakApp('net.retrodeck.retrodeck'), true)

  // It went because it was signalled, not because the grace period ran out:
  // the fake's `flatpak kill` does nothing at all.
  await exited
})

test('an app that ignores the request is killed rather than waited on for ever', async () => {
  /**
   * A SIGTERM an emulator opens a dialog over and never answers.
   *
   * The pid here cannot be signalled and never stops being listed, so the grace
   * period expires — and being stuck in an emulator with no way back is worse
   * than the save that is lost. It answers true either way: what the caller
   * needs to know is whether anything was found to act on.
   */
  const dead = spawn('sh', ['-c', 'exit 0'], { stdio: 'ignore' })
  await new Promise((resolve) => dead.on('exit', resolve))
  fakeFlatpak({ ps: `net.retrodeck.retrodeck ${dead.pid}` })

  assert.equal(await stopFlatpakApp('net.retrodeck.retrodeck'), true)
})

test('an app flatpak will not kill is signalled directly', async () => {
  /**
   * The press that is meant to be the last resort.
   *
   * `flatpak kill` fails silently for an instance flatpak is not tracking, and
   * says nothing either way — so a force close that trusted it did nothing at
   * all, on the emulators most likely to need it. What is still listed
   * afterwards is what decides, and what is still there is signalled.
   */
  const running = spawn('sh', ['-c', 'sleep 30'], { stdio: 'ignore' })
  const pid = running.pid
  assert.ok(pid)
  const exited = new Promise<void>((resolve) => running.on('exit', () => resolve()))
  fakeFlatpak({ livePid: pid })

  assert.equal(await killFlatpakApp('net.retrodeck.retrodeck'), true)

  await exited
})

test('an app that survives being killed is reported, not assumed gone', async () => {
  // Nothing RomMix can do about it, which is exactly why it must not be
  // answered with a silence the screen reads as success.
  const dead = spawn('sh', ['-c', 'exit 0'], { stdio: 'ignore' })
  await new Promise((resolve) => dead.on('exit', resolve))
  // A pid that is listed for ever and cannot be signalled: the shape of an app
  // that ignores everything it is sent.
  fakeFlatpak({ ps: `net.retrodeck.retrodeck ${dead.pid}` })

  assert.equal(await killFlatpakApp('net.retrodeck.retrodeck'), false)
})

test('an app that flatpak does close is not signalled a second time', async () => {
  // Nothing listed once the kill has been sent, which is the ordinary case.
  fakeFlatpak({ ps: '' })

  assert.equal(await killFlatpakApp('net.retrodeck.retrodeck'), true)
})

test('a process tree is killed from the root down', async () => {
  // A real tree, because what is under test is which processes are signalled:
  // an AppImage runs its payload as a child, so a signal to what RomMix spawned
  // kills the wrapper and leaves the emulator holding the screen.
  const parent = spawn('sh', ['-c', 'sleep 30 & sleep 30'], { stdio: 'ignore' })
  const pid = parent.pid
  assert.ok(pid)
  const exited = new Promise<void>((resolve) => parent.on('exit', () => resolve()))
  // Long enough for the shell to have started the children it will be killed
  // alongside; the point of the test is that they go too.
  await new Promise((resolve) => setTimeout(resolve, 300))

  await killProcessTree(pid)

  // Awaited rather than polled: the root is gone when the process really ends,
  // not when a `kill(pid, 0)` stops finding a pid that may still be a zombie.
  await exited
})

test('signalling a process that has already gone is not an error', async () => {
  // The tree is read from one snapshot, and an emulator shutting down takes its
  // children with it while this is still walking the list.
  const child = spawn('sh', ['-c', 'exit 0'], { stdio: 'ignore' })
  const pid = child.pid
  assert.ok(pid)
  await new Promise((resolve) => child.on('exit', resolve))

  // ESRCH is the ordinary case here, not a failure worth reporting.
  await killProcessTree(pid)
})

/** Poll until `path` appears, which is how a signalled process reports in. */
async function appears(path: string): Promise<void> {
  for (let waited = 0; waited < 5000; waited += 50) {
    if (existsSync(path)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail(`nothing wrote ${path}, so the signal never arrived`)
}

test('a process the launcher left behind is still signalled', async () => {
  /**
   * The shape that made the close button do nothing.
   *
   * An EmuDeck launcher is a shell script that starts the emulator, and bash
   * does not forward SIGTERM — it dies on it. What it started outlives it,
   * reparented onto init, where nothing descending from what RomMix spawned
   * finds it again. The group is what still does: the script here exits at
   * once, so the process that answers is by construction not the one signalled.
   */
  const dir = scratch([])
  const ready = join(dir, 'ready')
  const answered = join(dir, 'signalled')
  // The marker is written once the trap is installed, so the signal is not sent
  // into the gap before there is anything to handle it. `wait` rather than a
  // plain sleep in front of it, because a shell defers a trap until the command
  // it is running returns — this would otherwise be waiting on the sleep rather
  // than on the signal.
  const child = `trap 'echo yes > ${answered}; exit 0' TERM; echo yes > ${ready}; sleep 30 & wait`
  const script = spawn('sh', ['-c', `sh -c "${child}" & exit 0`], {
    // What makes the group addressable at all: the spawned process leads one.
    detached: true,
    stdio: 'ignore'
  })
  const pid = script.pid
  assert.ok(pid)
  await new Promise((resolve) => script.on('exit', resolve))
  await appears(ready)

  assert.equal(signalProcessGroup(pid, 'SIGTERM'), true)

  await appears(answered)
})

test('signalling a group nothing is left in is not an error', async () => {
  // The ordinary case for a second press: the emulator quit while the first
  // request was in flight.
  const gone = spawn('sh', ['-c', 'exit 0'], { detached: true, stdio: 'ignore' })
  const pid = gone.pid
  assert.ok(pid)
  await new Promise((resolve) => gone.on('exit', resolve))

  assert.equal(signalProcessGroup(pid, 'SIGTERM'), false)
})
