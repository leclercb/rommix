import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rommPlayers } from './rommplayer.ts'

const ON = { DISABLE_EMULATOR_JS: false }

test('the browser player is offered for a platform it has a core for', () => {
  assert.deepEqual(rommPlayers('snes', ON, null), { browser: true, stream: false })
  assert.deepEqual(rommPlayers('ps3', ON, null), { browser: false, stream: false })
})

test('a server that switched the browser player off offers none', () => {
  assert.equal(rommPlayers('snes', { DISABLE_EMULATOR_JS: true }, null).browser, false)
  assert.equal(rommPlayers('snes', null, null).browser, false)
})

test('streaming is offered only for a platform a streaming setup lists', () => {
  const streaming = { enabled: true, containers: [{ platform: 'ps2' }] }
  assert.equal(rommPlayers('ps2', null, streaming).stream, true)
  assert.equal(rommPlayers('PS2', null, streaming).stream, true)
  assert.equal(rommPlayers('gc', null, streaming).stream, false)
  assert.equal(rommPlayers('ps2', null, { ...streaming, enabled: false }).stream, false)
})
