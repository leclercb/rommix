/**
 * Whether RomM is there, and what kind of "no" the answer is.
 *
 * The distinction this file exists for is the one the whole interface hangs
 * off: a server that did not answer leaves a signed-in device with a disk full
 * of playable games, while credentials RomM refuses leave it with nothing to do
 * but sign in again. Get it the wrong way round and either a handheld out of
 * range is asked for a password it cannot check, or a genuinely rejected token
 * hides behind an offline mode with no way to fix it.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConnectionStatus } from '@shared/types'
import { ConnectionWatch, connectionStatus } from './connection.ts'
import { RommError, type RommClient } from './romm.ts'
import { Store } from './store.ts'

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A store with a server configured and a token held, unless told otherwise. */
function store(options: { signedIn?: boolean } = {}): Store {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-connection-test-'))
  scratches.push(dir)
  const made = new Store(join(dir, 'config'))
  if (options.signedIn !== false) {
    made.setServer({ baseUrl: 'https://romm.example', authMode: 'token' })
    made.setCredentials({ clientToken: 'rmm_token' })
  }
  return made
}

/** A server that answers `me` however the test says, and a version from the beat. */
function client(answer: 'ok' | Error): RommClient {
  return {
    async me() {
      if (answer !== 'ok') throw answer
      return { id: 1, username: 'someone' }
    },
    async heartbeat() {
      if (answer !== 'ok') throw answer
      return { version: '5.1.0' }
    }
  } as unknown as RommClient
}

describe('what "not connected" means', () => {
  test('a server that answers is simply connected', async () => {
    const status = await connectionStatus(store(), client('ok'))

    assert.equal(status.connected, true)
    assert.equal(status.configured, true)
    assert.equal(status.offline, false)
    assert.equal(status.user?.username, 'someone')
  })

  test('a server that did not answer is offline, not signed out', async () => {
    const status = await connectionStatus(store(), client(new TypeError('fetch failed')))

    assert.equal(status.connected, false)
    assert.equal(status.configured, true)
    assert.equal(status.offline, true)
  })

  test('credentials RomM refuses are an answer, and not offline', async () => {
    for (const code of [401, 403]) {
      const status = await connectionStatus(store(), client(new RommError('nope', code)))
      assert.equal(status.offline, false, `${code} should send the user to the sign-in screen`)
    }
  })

  test('a server that is broken rather than absent is still offline', async () => {
    // A proxy answering 502 leaves RomMix with nothing it can do about it and a
    // disk full of games it can still play, which is the offline case exactly.
    const status = await connectionStatus(store(), client(new RommError('bad gateway', 502)))
    assert.equal(status.offline, true)
  })

  test('a server that never answers is offline rather than a spinner', async () => {
    // The case a bound exists for: joined to a network that goes nowhere, so
    // nothing fails and nothing answers. Without it the check waits on the
    // operating system, which is minutes.
    const silent = {
      me: () => new Promise(() => undefined),
      heartbeat: () => new Promise(() => undefined)
    } as unknown as RommClient

    const status = await connectionStatus(store(), silent, 10)

    assert.equal(status.connected, false)
    assert.equal(status.offline, true)
    assert.match(status.error ?? '', /did not answer in time/)
  })

  test('an answer that arrives inside the bound is the answer', async () => {
    const slow = {
      me: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return { id: 1, username: 'someone' }
      },
      heartbeat: async () => ({ version: '5.1.0' })
    } as unknown as RommClient

    const status = await connectionStatus(store(), slow, 200)

    assert.equal(status.connected, true)
  })

  test('a device that was never set up has nowhere to go but the sign-in screen', async () => {
    const status = await connectionStatus(store({ signedIn: false }), client('ok'))

    assert.equal(status.connected, false)
    assert.equal(status.configured, false)
    // Nothing was ever downloaded from a server that was never named.
    assert.equal(status.offline, false)
  })
})

describe('watching it', () => {
  /** A watch over a scripted sequence of answers, recording what it announced. */
  function watching(answers: ConnectionStatus[]): {
    watch: ConnectionWatch
    announced: ConnectionStatus[]
  } {
    const announced: ConnectionStatus[] = []
    let at = 0
    const watch = new ConnectionWatch(
      () => Promise.resolve(answers[Math.min(at++, answers.length - 1)]),
      (status) => announced.push(status)
    )
    return { watch, announced }
  }

  const answer = (fields: Partial<ConnectionStatus>): ConnectionStatus => ({
    connected: false,
    configured: true,
    offline: false,
    baseUrl: 'https://romm.example',
    user: null,
    serverVersion: null,
    error: null,
    ...fields
  })

  test('the same answer twice is announced once', async () => {
    const { watch, announced } = watching([answer({ connected: true })])

    await watch.refresh()
    await watch.refresh()

    assert.equal(announced.length, 1)
  })

  test('going offline and coming back are both announced', async () => {
    const { watch, announced } = watching([
      answer({ connected: true }),
      answer({ offline: true }),
      answer({ connected: true })
    ])

    await watch.refresh()
    await watch.refresh()
    await watch.refresh()

    assert.deepEqual(
      announced.map((status) => status.connected),
      [true, false, true]
    )
  })

  test('a request that could not be sent puts it offline at once', async () => {
    const { watch, announced } = watching([answer({ connected: true })])
    await watch.refresh()

    // No round trip: there is nothing to ask, which is the whole point. This
    // is the difference between the mode arriving on the next failed press and
    // arriving on the next poll, half a minute of errors later.
    watch.observed(false, 'fetch failed')

    assert.equal(announced.length, 2)
    assert.equal(announced[1].offline, true)
    assert.equal(announced[1].error, 'fetch failed')
    assert.equal(announced[1].baseUrl, 'https://romm.example')
  })

  test('a burst of failures is one announcement', async () => {
    const { watch, announced } = watching([answer({ connected: true })])
    await watch.refresh()

    // A screen going out of range fails every request it had in flight.
    watch.observed(false, 'fetch failed')
    watch.observed(false, 'fetch failed')
    watch.observed(false, 'fetch failed')

    assert.equal(announced.length, 2)
  })

  test('a device that was never signed in is not put into offline mode', async () => {
    const { watch, announced } = watching([answer({ configured: false })])
    await watch.refresh()

    watch.observed(false, 'fetch failed')

    // An unreachable server it does not have is the sign-in screen, not a
    // library to fall back on.
    assert.equal(announced.length, 1)
    assert.equal(announced[0].offline, false)
  })

  test('nothing is claimed before the first check has answered', () => {
    const { watch, announced } = watching([answer({ connected: true })])
    watch.observed(false, 'fetch failed')
    assert.deepEqual(announced, [])
  })

  test('a request getting through asks who we are', async () => {
    const { watch, announced } = watching([answer({ offline: true }), answer({ connected: true })])
    await watch.refresh()

    // Worth the round trip, unlike a failure: being connected means naming the
    // user and the version, and only the check knows those.
    watch.observed(true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(announced.length, 2)
    assert.equal(announced[1].connected, true)
  })

  test('it keeps asking while the server is away, and stops when told', async () => {
    const asked: number[] = []
    const watch = new ConnectionWatch(
      () => {
        asked.push(Date.now())
        return Promise.resolve(answer({ offline: true }))
      },
      () => undefined,
      { away: 2, connected: 10_000 }
    )

    watch.start()
    await new Promise((resolve) => setTimeout(resolve, 40))
    const whileRunning = asked.length
    watch.stop()
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Away from the server almost nothing is being asked, so there are no
    // failures to learn from and this is the only way back.
    assert.ok(whileRunning > 1, `expected several probes, got ${whileRunning}`)
    assert.equal(asked.length, whileRunning)
  })

  test('it asks far less often once the server is answering', async () => {
    let connected = false
    const asked: number[] = []
    const watch = new ConnectionWatch(
      () => {
        asked.push(Date.now())
        return Promise.resolve(answer(connected ? { connected: true } : { offline: true }))
      },
      () => undefined,
      { away: 2, connected: 10_000 }
    )

    watch.start()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.ok(asked.length > 1)

    connected = true
    await watch.refresh()
    const afterConnecting = asked.length
    await new Promise((resolve) => setTimeout(resolve, 40))
    watch.stop()

    // With a server there, every screen is making requests against it and the
    // first one to fail says so within the request. This is only a backstop.
    assert.equal(asked.length, afterConnecting, 'kept probing at the away rate')
  })

  test('an answer somebody else already has is not announced again', async () => {
    const { watch, announced } = watching([answer({ connected: true })])

    watch.seen(answer({ connected: true }))
    await watch.refresh()

    assert.deepEqual(announced, [])
  })
})
