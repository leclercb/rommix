import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultRoot, ensureRoot, relocateRoot, resolveRoot, rootPaths } from './root.ts'

/**
 * Finding the folder RomMix keeps everything in.
 *
 * The one resolution in the application that cannot read a setting, because the
 * settings live inside the answer. Getting it wrong is not a visible error: a
 * second, empty root is a perfectly working RomMix that has forgotten the
 * server, the emulator choices and every downloaded game — which is why the
 * pointer is written atomically and why a blank one is ignored rather than
 * followed.
 */

const scratches: string[] = []
const held = {
  home: process.env.ROMMIX_HOME,
  config: process.env.XDG_CONFIG_HOME,
  userHome: process.env.HOME
}

afterEach(() => {
  for (const [name, value] of Object.entries({
    ROMMIX_HOME: held.home,
    XDG_CONFIG_HOME: held.config,
    HOME: held.userHome
  })) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-root-test-'))
  scratches.push(dir)
  return dir
}

/** A machine with nothing configured: its own home, its own config directory. */
function bareMachine(): { home: string; config: string } {
  const home = scratch()
  const config = join(home, '.config')
  mkdirSync(config, { recursive: true })
  delete process.env.ROMMIX_HOME
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = config
  return { home, config }
}

describe('resolving the root', () => {
  test('the environment wins over everything, which is what makes it testable', () => {
    const { config } = bareMachine()
    mkdirSync(join(config, 'rommix'), { recursive: true })
    writeFileSync(join(config, 'rommix', 'root'), '/pointed/elsewhere\n')
    process.env.ROMMIX_HOME = '/from/the/environment'

    assert.equal(resolveRoot(), '/from/the/environment')
  })

  test('a pointer file is followed when nothing in the environment says otherwise', () => {
    const { config } = bareMachine()
    mkdirSync(join(config, 'rommix'), { recursive: true })
    writeFileSync(join(config, 'rommix', 'root'), '  /on/the/sd/card  \n')

    assert.equal(resolveRoot(), '/on/the/sd/card')
  })

  test('with no pointer at all it is the folder beside the user own directories', () => {
    const { home } = bareMachine()

    assert.equal(resolveRoot(), join(home, 'rommix'))
    assert.equal(defaultRoot(), join(home, 'rommix'))
  })

  test('an empty pointer is ignored rather than resolving to nothing', () => {
    const { home, config } = bareMachine()
    mkdirSync(join(config, 'rommix'), { recursive: true })
    writeFileSync(join(config, 'rommix', 'root'), '\n')

    assert.equal(resolveRoot(), join(home, 'rommix'))
  })
})

describe('the layout inside it', () => {
  test('every directory is stated relative to the root it was given', () => {
    assert.deepEqual(rootPaths('/somewhere'), {
      root: '/somewhere',
      config: '/somewhere/config',
      emulators: '/somewhere/emulators',
      roms: '/somewhere/roms',
      offline: '/somewhere/offline',
      saves: '/somewhere/saves'
    })
  })

  test('creating it makes the ROM folder too, before anything is downloaded', () => {
    const root = join(scratch(), 'rommix')

    ensureRoot(root)

    // Eden has to be pointed at this folder by hand, which cannot be done to a
    // folder that is not there yet.
    assert.equal(existsSync(join(root, 'roms')), true)
    assert.equal(existsSync(join(root, 'config')), true)
    assert.equal(existsSync(join(root, 'emulators')), true)
  })

  test('creating a root that already exists is not a failure', () => {
    const root = join(scratch(), 'rommix')

    ensureRoot(root)
    ensureRoot(root)
  })
})

describe('moving the root', () => {
  test('the configuration is copied to the new root and the pointer rewritten', () => {
    const { config } = bareMachine()
    const from = join(scratch(), 'old-root')
    ensureRoot(from)
    writeFileSync(join(from, 'config', 'settings.json'), '{"settings":{}}')
    process.env.ROMMIX_HOME = from
    const to = join(scratch(), 'new-root')

    relocateRoot(to)

    assert.equal(readFileSync(join(to, 'config', 'settings.json'), 'utf8'), '{"settings":{}}')
    assert.equal(readFileSync(join(config, 'rommix', 'root'), 'utf8').trim(), to)
  })

  test('the old root is left complete, so changing your mind costs nothing', () => {
    bareMachine()
    const from = join(scratch(), 'old-root')
    ensureRoot(from)
    writeFileSync(join(from, 'config', 'settings.json'), '{"settings":{}}')
    process.env.ROMMIX_HOME = from

    relocateRoot(join(scratch(), 'new-root'))

    assert.equal(existsSync(join(from, 'config', 'settings.json')), true)
  })

  test('a root with nothing in it yet still gets its whole layout', () => {
    bareMachine()
    const to = join(scratch(), 'new-root')

    relocateRoot(to)

    assert.equal(existsSync(join(to, 'roms')), true)
    assert.equal(existsSync(join(to, 'emulators')), true)
  })
})
