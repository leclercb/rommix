import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedInstall } from '@config/emulators'
import {
  binaryPath,
  descendantsOf,
  execPrefix,
  findMatchingFile,
  isWritable,
  realHome,
  xdgConfigHome,
  xdgDataHome
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

test("the user's own directories follow the environment, and fall back to the home", () => {
  process.env.HOME = '/home/player'
  delete process.env.XDG_CONFIG_HOME
  delete process.env.XDG_DATA_HOME

  assert.equal(realHome(), '/home/player')
  assert.equal(xdgConfigHome(), '/home/player/.config')
  assert.equal(xdgDataHome(), '/home/player/.local/share')

  process.env.XDG_CONFIG_HOME = '/elsewhere/config'
  process.env.XDG_DATA_HOME = '/elsewhere/data'
  assert.equal(xdgConfigHome(), '/elsewhere/config')
  assert.equal(xdgDataHome(), '/elsewhere/data')
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
