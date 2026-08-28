import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RommRom } from '@shared/types'
import { RommClient, RommError } from './romm.ts'
import type { Store } from './store.ts'

/**
 * The RomM client, against a server that only exists in this file.
 *
 * Everything here is one HTTP call away from a user-visible failure, and none
 * of it can be checked by reading it: a query built without `with_files` looks
 * exactly like one built with it until a multi-file game is downloaded, and a
 * 401 that does not refresh looks exactly like a session that genuinely
 * expired. So `fetch` is replaced with a server whose answers this file writes,
 * and what is asserted is what RomMix *sent* as much as what it did with the
 * reply.
 *
 * Not covered here: anything that needs Electron. `startDevicePairing` reports
 * `app.getVersion()` to the server, which is a real call into a real Electron
 * app — see `scripts/test-resolve.mjs`.
 */

interface Sent {
  url: string
  method: string
  headers: Headers
  body: string | null
}

const real = globalThis.fetch
const scratches: string[] = []

afterEach(() => {
  globalThis.fetch = real
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-romm-test-'))
  scratches.push(dir)
  return dir
}

/** A server that answers from `reply`, recording everything it was asked. */
function serve(reply: (sent: Sent, index: number) => Response): Sent[] {
  const sent: Sent[] = []
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const record: Sent = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers as Record<string, string> | undefined),
      body: typeof init.body === 'string' ? init.body : null
    }
    sent.push(record)
    return reply(record, sent.length - 1)
  }) as typeof globalThis.fetch
  return sent
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

interface FakeCredentials {
  accessToken: string | null
  refreshToken: string | null
  clientToken: string | null
  expiresAt: number | null
  deviceId: string | null
}

/** Only the parts of the store the client reads or writes. */
function fakeStore(credentials: Partial<FakeCredentials> = {}): {
  store: Store
  credentials: FakeCredentials
  cleared: () => boolean
} {
  const held: FakeCredentials = {
    accessToken: null,
    refreshToken: null,
    clientToken: null,
    expiresAt: null,
    deviceId: null,
    ...credentials
  }
  let cleared = false
  const store = {
    server: { baseUrl: 'https://romm.example' },
    settings: { deviceId: 'this-device', deviceName: 'RomMix on the sofa' },
    credentials: held,
    setCredentials(patch: Partial<FakeCredentials>) {
      Object.assign(held, patch)
    },
    clearCredentials() {
      cleared = true
      Object.assign(held, {
        accessToken: null,
        refreshToken: null,
        clientToken: null,
        expiresAt: null
      })
    }
  } as unknown as Store
  return { store, credentials: held, cleared: () => cleared }
}

describe('sending a request', () => {
  test('a client token is sent in preference to an access token', async () => {
    const { store } = fakeStore({ clientToken: 'rmm_client', accessToken: 'jwt' })
    const sent = serve(() => json({ id: 1 }))

    await new RommClient(store).me()

    assert.equal(sent[0].url, 'https://romm.example/api/users/me')
    assert.equal(sent[0].headers.get('authorization'), 'Bearer rmm_client')
  })

  test('no credentials at all means no Authorization header, not an empty one', async () => {
    const { store } = fakeStore()
    const sent = serve(() => json([]))

    await new RommClient(store).platforms()

    assert.equal(sent[0].headers.has('authorization'), false)
  })

  test('a server that cannot be reached is named in the error', async () => {
    const { store } = fakeStore()
    globalThis.fetch = (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof globalThis.fetch

    const failure = await new RommClient(store).me().then(
      () => null,
      (cause: RommError) => cause
    )
    assert.ok(failure instanceof RommError)
    assert.match(failure.message, /romm\.example/)
    assert.match(failure.message, /ECONNREFUSED/)
  })
})

describe('an expired access token', () => {
  test('is refreshed once and the request replayed with the new one', async () => {
    const { store, credentials } = fakeStore({ accessToken: 'stale', refreshToken: 'refresh-me' })
    const sent = serve((request, index) => {
      if (index === 0) return json({ detail: 'expired' }, 401)
      if (request.url.endsWith('/api/token')) {
        return json({ access_token: 'fresh', refresh_token: 'next', expires: 900 })
      }
      return json({ id: 7, username: 'player' })
    })

    const me = await new RommClient(store).me()

    assert.equal(me.username, 'player')
    assert.deepEqual(
      sent.map((request) => `${request.method} ${new URL(request.url).pathname}`),
      ['GET /api/users/me', 'POST /api/token', 'GET /api/users/me']
    )
    assert.equal(credentials.accessToken, 'fresh')
    assert.equal(credentials.refreshToken, 'next')
    // The replayed request carries the token the refresh just produced, which
    // is the whole point of refreshing.
    assert.equal(sent[2].headers.get('authorization'), 'Bearer fresh')
  })

  test('with no refresh token to use, the 401 is simply reported', async () => {
    const { store } = fakeStore({ accessToken: 'stale' })
    const sent = serve(() => json({ detail: 'expired' }, 401))

    const failure = await new RommClient(store).me().then(
      () => null,
      (cause: RommError) => cause
    )
    assert.equal(failure?.status, 401)
    assert.equal(sent.length, 1)
  })

  test('a refresh the server refuses clears the credentials rather than leaving them', async () => {
    const { store, cleared } = fakeStore({ accessToken: 'stale', refreshToken: 'revoked' })
    serve((request) => (request.url.endsWith('/api/token') ? json({}, 401) : json({}, 401)))

    const failure = await new RommClient(store).me().then(
      () => null,
      (cause: RommError) => cause
    )
    assert.equal(failure?.status, 401)
    assert.equal(cleared(), true)
  })
})

describe('turning a failed response into a message', () => {
  test("the body's detail is what the user is told", async () => {
    const { store } = fakeStore()
    serve(() => json({ detail: 'platform 12 does not exist' }, 404))

    const failure = await new RommClient(store).platforms().then(
      () => null,
      (cause: RommError) => cause
    )
    assert.equal(failure?.status, 404)
    assert.match(failure?.message ?? '', /platform 12 does not exist/)
  })

  test('a detail that is not a string is still shown rather than dropped', async () => {
    const { store } = fakeStore()
    serve(() => json({ detail: [{ msg: 'field required' }] }, 422))

    const failure = await new RommClient(store).platforms().then(
      () => null,
      (cause: RommError) => cause
    )
    assert.match(failure?.message ?? '', /field required/)
  })

  test('a body that is not JSON at all falls back to the status text', async () => {
    const { store } = fakeStore()
    serve(() => new Response('<html>gateway</html>', { status: 502, statusText: 'Bad Gateway' }))

    const failure = await new RommClient(store).platforms().then(
      () => null,
      (cause: RommError) => cause
    )
    assert.equal(failure?.status, 502)
    assert.match(failure?.message ?? '', /Bad Gateway/)
  })

  test('403 is reported as a permission problem, which is what it means here', async () => {
    const { store } = fakeStore({ clientToken: 'narrow' })
    serve(() => json({ detail: 'missing scope collections.write' }, 403))

    const failure = await new RommClient(store).platforms().then(
      () => null,
      (cause: RommError) => cause
    )
    assert.equal(failure?.status, 403)
    assert.match(failure?.message ?? '', /collections\.write/)
  })
})

describe('signing in', () => {
  test('a password grant asks for every scope RomMix needs and stores the pair', async () => {
    const { store, credentials } = fakeStore()
    const sent = serve(() => json({ access_token: 'jwt', refresh_token: 'again', expires: 60 }))

    await new RommClient(store).loginWithPassword('player', 'hunter2')

    const body = new URLSearchParams(sent[0].body ?? '')
    assert.equal(body.get('grant_type'), 'password')
    assert.equal(body.get('username'), 'player')
    assert.match(body.get('scope') ?? '', /roms\.read/)
    assert.match(body.get('scope') ?? '', /collections\.write/)
    assert.equal(credentials.accessToken, 'jwt')
    assert.equal(credentials.clientToken, null)
    assert.ok((credentials.expiresAt ?? 0) > Date.now())
  })

  test('a refused password says the credentials were wrong, not that the session expired', async () => {
    const { store } = fakeStore()
    serve(() => json({ detail: 'incorrect' }, 401))

    const failure = await new RommClient(store).loginWithPassword('player', 'wrong').then(
      () => null,
      (cause: RommError) => cause
    )
    assert.equal(failure?.status, 401)
    assert.match(failure?.message ?? '', /password/i)
  })

  test('a client token typed in replaces whatever session was there', async () => {
    const { store, credentials } = fakeStore({ accessToken: 'jwt', refreshToken: 'again' })

    new RommClient(store).setClientToken('  rmm_pasted  ')

    assert.equal(credentials.clientToken, 'rmm_pasted')
    assert.equal(credentials.accessToken, null)
    assert.equal(credentials.refreshToken, null)
  })
})

describe('device pairing', () => {
  test('the codes RomM answers with are not approval yet', async () => {
    const { store, credentials } = fakeStore()
    for (const status of [400, 401, 428]) {
      serve(() => json({ detail: 'authorization_pending' }, status))
      assert.equal(await new RommClient(store).pollDevicePairing('device-code'), false)
      assert.equal(credentials.clientToken, null)
    }
  })

  test('approval stores the client token and the device it was issued to', async () => {
    const { store, credentials } = fakeStore()
    serve(() =>
      json({ access_token: 'rmm_paired', device_id: 'romm-device-9', expires_at: null, scopes: [] })
    )

    assert.equal(await new RommClient(store).pollDevicePairing('device-code'), true)
    assert.equal(credentials.clientToken, 'rmm_paired')
    assert.equal(credentials.deviceId, 'romm-device-9')
  })

  test('anything else is a failure rather than another round of polling', async () => {
    const { store } = fakeStore()
    serve(() => json({ detail: 'no such device' }, 500))

    await assert.rejects(() => new RommClient(store).pollDevicePairing('device-code'), RommError)
  })
})

describe('the library', () => {
  test('a heartbeat reports the version, and says nothing when the server does not', async () => {
    const { store } = fakeStore()
    serve(() => json({ SYSTEM: { VERSION: '5.1.0' } }))
    assert.deepEqual(await new RommClient(store).heartbeat(), { version: '5.1.0' })

    serve(() => json({}))
    assert.deepEqual(await new RommClient(store).heartbeat(), { version: null })
  })

  test('a heartbeat can probe a server that is not the configured one', async () => {
    const { store } = fakeStore()
    const sent = serve(() => json({ SYSTEM: { VERSION: '5.0.0' } }))

    await new RommClient(store).heartbeat('https://other.example')

    assert.equal(sent[0].url, 'https://other.example/api/heartbeat')
  })

  test('a listing always asks for the files, whatever else it asks for', async () => {
    const { store } = fakeStore()
    const sent = serve(() => json({ items: [], total: 0, limit: 60, offset: 0 }))

    await new RommClient(store).roms({ search_term: 'sonic', platform_ids: [3, 4], offset: 60 })

    const query = new URL(sent[0].url).searchParams
    assert.equal(query.get('with_files'), 'true')
    assert.equal(query.get('search_term'), 'sonic')
    assert.deepEqual(query.getAll('platform_ids'), ['3', '4'])
    assert.equal(query.get('offset'), '60')
    // Unasked-for parameters still have to be sent: RomM's own defaults are not
    // the ones the grid is drawn from.
    assert.equal(query.get('order_by'), 'name')
    assert.equal(query.get('order_dir'), 'asc')
    assert.equal(query.get('limit'), '60')
  })

  test('a server with no virtual collections endpoint has no virtual collections', async () => {
    const { store } = fakeStore()
    serve(() => json({ detail: 'Not Found' }, 404))

    assert.deepEqual(await new RommClient(store).virtualCollections(), [])
  })

  test('a virtual collections call that fails any other way is not swallowed', async () => {
    const { store } = fakeStore()
    serve(() => json({ detail: 'type is required' }, 422))

    await assert.rejects(() => new RommClient(store).virtualCollections(), RommError)
  })
})

describe('favourites', () => {
  const shelf = {
    id: 4,
    name: 'Favourites',
    is_favorite: true,
    rom_ids: [11],
    rom_count: 1
  }

  test('a game is favourite when it is in the collection RomM marks as such', async () => {
    const { store } = fakeStore()
    serve(() => json([{ ...shelf, is_favorite: false, rom_ids: [11] }, shelf]))

    assert.equal(await new RommClient(store).isFavourite(11), true)
    serve(() => json([shelf]))
    assert.equal(await new RommClient(store).isFavourite(99), false)
  })

  test('unfavouriting with no favourites collection creates nothing', async () => {
    const { store } = fakeStore()
    const sent = serve(() => json([]))

    assert.equal(await new RommClient(store).setFavourite(11, false), false)
    assert.equal(sent.length, 1)
  })

  test('the first favourite makes the collection, then adds the game to it', async () => {
    const { store } = fakeStore()
    const sent = serve((request) => {
      if (request.method === 'GET') return json([])
      if (new URL(request.url).pathname === '/api/collections') return json({ ...shelf, id: 12 })
      return json({})
    })

    assert.equal(await new RommClient(store).setFavourite(11, true), true)
    assert.deepEqual(
      sent.map((request) => `${request.method} ${new URL(request.url).pathname}`),
      ['GET /api/collections', 'POST /api/collections', 'POST /api/collections/12/roms']
    )
  })

  test('taking a game off a shelf is the same call the other way round', async () => {
    const { store } = fakeStore()
    const sent = serve(() => json({}))

    await new RommClient(store).setCollectionMembership(4, 11, false)

    assert.equal(sent[0].method, 'DELETE')
    assert.equal(sent[0].body, JSON.stringify({ rom_ids: [11] }))
  })
})

describe('saves and states', () => {
  test('deleting none of them asks the server nothing at all', async () => {
    const { store } = fakeStore()
    const sent = serve(() => json({}))

    await new RommClient(store).deleteSaves([])
    await new RommClient(store).deleteStates([])

    assert.equal(sent.length, 0)
  })

  test('deleting several is one call carrying the list', async () => {
    const { store } = fakeStore()
    const sent = serve(() => json({}))

    await new RommClient(store).deleteSaves([1, 2])
    await new RommClient(store).deleteStates([3])

    assert.deepEqual(
      sent.map((request) => request.body),
      [JSON.stringify({ saves: [1, 2] }), JSON.stringify({ states: [3] })]
    )
  })

  test('a save is fetched to the path it was asked for', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'game.srm')
    serve(() => new Response('save bytes'))

    await new RommClient(store).downloadSave(3, destination)

    assert.equal(readFileSync(destination, 'utf8'), 'save bytes')
  })
})

describe('downloading a ROM', () => {
  const rom = { id: 5, fs_name: 'Sonic (USA).md', fs_size_bytes: 10 } as RommRom

  test('it lands under its final name only once it is whole', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sonic.md')
    const seen: number[] = []
    serve(() => new Response('0123456789'))

    await new RommClient(store).downloadRom(
      rom,
      destination,
      (progress) => seen.push(progress.received),
      new AbortController().signal
    )

    assert.equal(readFileSync(destination, 'utf8'), '0123456789')
    assert.equal(existsSync(`${destination}.part`), false)
    assert.deepEqual(seen, [10])
  })

  test('a transfer that fails leaves no half-written ROM behind', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sonic.md')
    serve(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('012'))
              controller.error(new Error('connection reset'))
            }
          })
        )
    )

    await assert.rejects(() =>
      new RommClient(store).downloadRom(
        rom,
        destination,
        () => undefined,
        new AbortController().signal
      )
    )
    assert.equal(existsSync(destination), false)
    assert.equal(existsSync(`${destination}.part`), false)
  })

  test('a response with no body is a failure, not an empty ROM', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sonic.md')
    serve(() => new Response(null, { status: 204 }))

    await assert.rejects(
      () =>
        new RommClient(store).downloadRom(
          rom,
          destination,
          () => undefined,
          new AbortController().signal
        ),
      RommError
    )
  })
})

describe('reporting play time', () => {
  test('a session too short to mean anything is not reported', async () => {
    const { store } = fakeStore()
    const sent = serve(() => json({}))

    await new RommClient(store).reportPlaySession(5, new Date(), 2)

    assert.equal(sent.length, 0)
  })

  test('a session that counts is sent with the device that played it', async () => {
    const { store } = fakeStore({ deviceId: 'romm-device-9' })
    const sent = serve(() => json({}))
    const startedAt = new Date('2026-08-01T20:00:00.000Z')

    await new RommClient(store).reportPlaySession(5, startedAt, 600)

    const body = JSON.parse(sent[0].body ?? '{}') as {
      device_id: string
      sessions: { rom_id: number; start_time: string; end_time: string }[]
    }
    assert.equal(body.device_id, 'romm-device-9')
    assert.deepEqual(body.sessions, [
      {
        rom_id: 5,
        start_time: '2026-08-01T20:00:00.000Z',
        end_time: '2026-08-01T20:10:00.000Z'
      }
    ])
  })

  test('a server that will not take it never fails the launch it belongs to', async () => {
    const { store } = fakeStore()
    serve(() => json({ detail: 'no' }, 500))

    await new RommClient(store).reportPlaySession(5, new Date(), 600)
  })
})
