import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { homedir } from 'node:os'
import { realHome, xdgConfigHome, xdgDataHome } from './xdg.ts'

/**
 * Where the desktop says an application's directories are.
 *
 * Small enough to look obviously right and worth testing anyway, because both
 * ends of RomMix build paths on it: the config root decides where RomMix finds
 * its own pointer file, and the data root decides where it looks for another
 * emulator's saves. A wrong answer here is not an error anywhere — it is a
 * directory that quietly does not hold what was expected.
 */

const env = { ...process.env }
afterEach(() => {
  process.env = { ...env }
})

test('the environment is followed where it says something', () => {
  process.env.HOME = '/home/player'
  process.env.XDG_CONFIG_HOME = '/elsewhere/config'
  process.env.XDG_DATA_HOME = '/elsewhere/data'

  assert.equal(realHome(), '/home/player')
  assert.equal(xdgConfigHome(), '/elsewhere/config')
  assert.equal(xdgDataHome(), '/elsewhere/data')
})

test('an unset variable falls back to the conventional folder under the home', () => {
  process.env.HOME = '/home/player'
  delete process.env.XDG_CONFIG_HOME
  delete process.env.XDG_DATA_HOME

  assert.equal(xdgConfigHome(), '/home/player/.config')
  assert.equal(xdgDataHome(), '/home/player/.local/share')
})

test('a variable set to nothing falls back too, rather than yielding a relative path', () => {
  // A stray `export XDG_CONFIG_HOME=` in a shell profile is indistinguishable
  // from an unset one to everything else on the system. Read as a directory
  // name it produces a relative path, and RomMix would write its configuration
  // wherever it happened to be started from.
  process.env.HOME = '/home/player'
  process.env.XDG_CONFIG_HOME = ''
  process.env.XDG_DATA_HOME = ''

  assert.equal(xdgConfigHome(), '/home/player/.config')
  assert.equal(xdgDataHome(), '/home/player/.local/share')
})

test('an empty HOME falls back to the account the process is running as', () => {
  process.env.HOME = ''

  assert.equal(realHome(), homedir())
  assert.ok(xdgConfigHome().startsWith(homedir()))
})
