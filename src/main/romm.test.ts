import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RommFirmware, RommRom, RommRomFile } from '@shared/types'
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

/**
 * A response body that delivers some bytes and then loses the connection.
 *
 * The error comes on the pull *after* the chunk rather than beside it: a stream
 * that fails in the same turn it enqueues never hands the bytes over at all,
 * which is a connection that dropped before sending anything and not the case
 * these tests are about.
 */
function broken(prefix: string): ReadableStream {
  let delivered = false
  return new ReadableStream({
    async pull(controller) {
      if (delivered) {
        // A turn of the loop before the failure, so the chunk above is read,
        // written and counted first. Failing any sooner is a connection that
        // dropped before delivering anything, which resuming has no use for.
        await new Promise((resolve) => setTimeout(resolve, 20))
        controller.error(new Error('terminated'))
        return
      }
      delivered = true
      controller.enqueue(new TextEncoder().encode(prefix))
    }
  })
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

describe('how far through a game', () => {
  test('setting the progress sends only that field', async () => {
    const { store } = fakeStore({ clientToken: 'rmm_token' })
    const sent = serve(() => new Response(null, { status: 200 }))

    await new RommClient(store).setStatus(7, 'finished')

    assert.equal(sent[0].method, 'PUT')
    assert.match(sent[0].url, /\/api\/roms\/7\/props$/)
    // Only the status: the endpoint leaves out what it is not sent, so a rating
    // or a backlog flag set in RomM's own interface survives this.
    assert.deepEqual(JSON.parse(sent[0].body ?? '{}'), { status: 'finished' })
  })

  test('clearing it is a status of null, not an absent one', async () => {
    const { store } = fakeStore({ clientToken: 'rmm_token' })
    const sent = serve(() => new Response(null, { status: 200 }))

    await new RommClient(store).setStatus(7, null)

    assert.deepEqual(JSON.parse(sent[0].body ?? '{}'), { status: null })
  })

  test('a server that refuses it says so', async () => {
    const { store } = fakeStore({ clientToken: 'rmm_token' })
    serve(() => new Response(JSON.stringify({ detail: 'nope' }), { status: 403 }))

    await assert.rejects(new RommClient(store).setStatus(7, 'retired'), RommError)
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

  test('a transfer that breaks is picked up where it stopped, not started again', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sonic.md')
    const seen: number[] = []
    const sent = serve((_request, index) =>
      index === 0
        ? // Half the ROM, then the connection dies — which is what a proxy in
          // front of RomM capping a response looks like from here.
          new Response(broken('01234'))
        : new Response('56789', { status: 206 })
    )

    await new RommClient(store).downloadRom(
      rom,
      destination,
      (progress) => seen.push(progress.received),
      new AbortController().signal
    )

    assert.equal(readFileSync(destination, 'utf8'), '0123456789')
    assert.equal(sent[1].headers.get('range'), 'bytes=5-')
    // Progress never goes backwards past what is on disk, and ends at the whole
    // ROM rather than at what the second leg carried.
    assert.equal(seen.at(-1), 10)
  })

  test('a server that ignores the range starts the ROM again rather than doubling it', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sonic.md')
    serve((_request, index) =>
      index === 0
        ? new Response(broken('01234'))
        : // 200, not 206: the whole file again, from a server that does not do
          // ranges. Appending it to what is on disk is the corruption this
          // guards against.
          new Response('0123456789')
    )

    await new RommClient(store).downloadRom(
      rom,
      destination,
      () => undefined,
      new AbortController().signal
    )

    assert.equal(readFileSync(destination, 'utf8'), '0123456789')
  })

  test('a transfer that keeps breaking is a failure, and leaves what arrived', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sonic.md')
    const sent = serve(() => new Response(broken('01')))

    const failure = await new RommClient(store)
      .downloadRom(rom, destination, () => undefined, new AbortController().signal)
      .then(
        () => null,
        (cause: Error) => cause
      )

    assert.ok(failure instanceof RommError)
    // Not `terminated`, which is what the network layer calls it and what the
    // screen used to show.
    assert.match(failure.message, /RomM/)
    assert.equal(existsSync(destination), false)
    // Kept, not deleted: whether a part-downloaded ROM is worth keeping is the
    // queue's decision — see `DownloadManager.keepPartial`.
    assert.equal(readFileSync(`${destination}.part`, 'utf8'), '01')
    // Tried again rather than given up on at the first break.
    assert.ok(sent.length > 1)
  })

  test('a cancelled transfer is not picked up again', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sonic.md')
    const controller = new AbortController()
    const sent = serve(() => {
      controller.abort()
      return new Response(broken('01'))
    })

    await assert.rejects(() =>
      new RommClient(store).downloadRom(rom, destination, () => undefined, controller.signal)
    )
    assert.equal(sent.length, 1)
  })

  test('a ROM left half-downloaded by an earlier attempt is never appended to', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sonic.md')
    // A `.part` from some previous run, which nothing has vouched for.
    writeFileSync(`${destination}.part`, 'from another download')
    serve(() => new Response('0123456789'))

    await new RommClient(store).downloadRom(
      rom,
      destination,
      () => undefined,
      new AbortController().signal
    )

    assert.equal(readFileSync(destination, 'utf8'), '0123456789')
  })

  test('a partial the caller vouches for is continued rather than fetched again', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sonic.md')
    writeFileSync(`${destination}.part`, '01234')
    const seen: number[] = []
    const sent = serve(() => new Response('56789', { status: 206 }))

    await new RommClient(store).downloadRom(
      rom,
      destination,
      (progress) => seen.push(progress.received),
      new AbortController().signal,
      { resume: true }
    )

    assert.equal(sent[0].headers.get('range'), 'bytes=5-')
    assert.equal(readFileSync(destination, 'utf8'), '0123456789')
    // The bar starts from what is already there rather than from zero.
    assert.equal(seen[0], 5)
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

describe('checking what arrived against what RomM holds', () => {
  /** The same game, with the digest RomM recorded for it. */
  const hashed = (fields: Partial<RommRom> = {}): RommRom =>
    ({
      id: 5,
      fs_name: 'Sonic (USA).md',
      fs_extension: 'md',
      fs_size_bytes: 10,
      md5_hash: '781e5e245d69b566979b86e28d23f2c7',
      files: [{ file_name: 'Sonic (USA).md' }],
      ...fields
    }) as RommRom

  test('a ROM that hashes to what RomM recorded is kept', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sonic.md')
    serve(() => new Response('0123456789'))

    await new RommClient(store).downloadRom(
      hashed(),
      destination,
      () => undefined,
      new AbortController().signal
    )

    assert.equal(readFileSync(destination, 'utf8'), '0123456789')
  })

  test('a ROM that does not is thrown away rather than installed', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sonic.md')
    // The right length and the wrong bytes, which is what a file replaced on
    // the server between two halves of one transfer leaves behind.
    serve(() => new Response('9876543210'))

    await assert.rejects(
      new RommClient(store).downloadRom(
        hashed(),
        destination,
        () => undefined,
        new AbortController().signal
      ),
      RommError
    )

    // Neither the game nor anything to resume it from: appending to bytes
    // already known to be wrong could only ever produce the same file again.
    assert.equal(existsSync(destination), false)
    assert.equal(existsSync(`${destination}.part`), false)
  })

  test('the bytes are judged whole, however many transfers carried them', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sonic.md')
    serve((_request, index) =>
      index === 0 ? new Response(broken('01234')) : new Response('56789', { status: 206 })
    )

    await new RommClient(store).downloadRom(
      hashed(),
      destination,
      () => undefined,
      new AbortController().signal
    )

    assert.equal(readFileSync(destination, 'utf8'), '0123456789')
  })

  test('each file of a game fetched one by one is judged on its own hash', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sky.dsk')
    serve(() => new Response('0123456789'))

    await new RommClient(store).downloadRomFile(
      {
        id: 841,
        rom_id: 139,
        file_name: 'sky.dsk',
        file_size_bytes: 10,
        md5_hash: '781e5e245d69b566979b86e28d23f2c7'
      } as RommRomFile,
      destination,
      () => undefined,
      new AbortController().signal
    )

    assert.equal(readFileSync(destination, 'utf8'), '0123456789')
  })

  test('a file of a game that does not match is thrown away like any other', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'sky.dsk')
    serve(() => new Response('9876543210'))

    await assert.rejects(
      new RommClient(store).downloadRomFile(
        {
          id: 841,
          rom_id: 139,
          file_name: 'sky.dsk',
          file_size_bytes: 10,
          md5_hash: '781e5e245d69b566979b86e28d23f2c7'
        } as RommRomFile,
        destination,
        () => undefined,
        new AbortController().signal
      ),
      RommError
    )

    assert.equal(existsSync(destination), false)
    assert.equal(existsSync(`${destination}.part`), false)
  })

  test('a ROM RomM holds archived is not judged against the hash of its contents', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'advance-wars.zip')
    // The zip, which is what the content endpoint serves — and never what the
    // hash on the ROM describes: RomM opens the archive and records what it
    // found inside. Checked, every archived game in the library was refused.
    serve(() => new Response('the zip around it'))

    await new RommClient(store).downloadRom(
      hashed({ fs_name: 'Advance Wars (Europe).zip', fs_extension: 'zip' }),
      destination,
      () => undefined,
      new AbortController().signal
    )

    assert.equal(readFileSync(destination, 'utf8'), 'the zip around it')
  })

  test('an archive is recognised by its whole ending, not by its last dot', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'game.tar.gz')
    serve(() => new Response('the tarball around it'))

    await new RommClient(store).downloadRom(
      hashed({ fs_name: 'Game (Europe).tar.gz', fs_extension: 'gz' }),
      destination,
      () => undefined,
      new AbortController().signal
    )

    assert.equal(readFileSync(destination, 'utf8'), 'the tarball around it')
  })

  test('the game unpacked out of an archive is held to the hash instead', async () => {
    const { store } = fakeStore()
    const unpacked = join(scratch(), 'Advance Wars (Europe).gba')
    writeFileSync(unpacked, '0123456789')

    await new RommClient(store).verifyUnpacked(
      hashed({ fs_name: 'Advance Wars (Europe).zip', fs_extension: 'zip' }),
      unpacked
    )

    assert.equal(existsSync(unpacked), true)
  })

  test('a game unpacked out of an archive that is not the one RomM holds goes', async () => {
    const { store } = fakeStore()
    const unpacked = join(scratch(), 'Advance Wars (Europe).gba')
    writeFileSync(unpacked, '9876543210')

    await assert.rejects(
      new RommClient(store).verifyUnpacked(
        hashed({ fs_name: 'Advance Wars (Europe).zip', fs_extension: 'zip' }),
        unpacked
      ),
      RommError
    )

    // Under the name an emulator would load it by, so it cannot be left there.
    assert.equal(existsSync(unpacked), false)
  })

  test('a game that arrived as a plain file is not hashed a second time', async () => {
    const { store } = fakeStore()
    const installed = join(scratch(), 'Sonic (USA).md')
    // Checked on the way in, against the bytes RomM served. Nothing here.
    writeFileSync(installed, 'whatever ended up here')

    await new RommClient(store).verifyUnpacked(hashed(), installed)

    assert.equal(existsSync(installed), true)
  })

  test('an archive that held more than the game is left to its files', async () => {
    const { store } = fakeStore()
    const unpacked = join(scratch(), 'disc1.bin')
    writeFileSync(unpacked, '9876543210')

    // RomM hashes such an archive by running every member through one digest in
    // path order, which is not a figure RomMix can arrive at.
    await new RommClient(store).verifyUnpacked(
      hashed({
        fs_name: 'Final Fantasy VII (Europe).zip',
        fs_extension: 'zip',
        has_multiple_files: true
      }),
      unpacked
    )

    assert.equal(existsSync(unpacked), true)
  })

  test('a game of several files is not judged against a hash of one of them', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'ff7.zip')
    // The archive RomM builds for the request is not what any of these describe.
    serve(() => new Response('not the same bytes at all'))

    await new RommClient(store).downloadRom(
      hashed({ has_multiple_files: true, fs_size_bytes: 25 }),
      destination,
      () => undefined,
      new AbortController().signal
    )

    assert.equal(existsSync(destination), true)
  })

  test('a BIOS file that is not the one on the server is not left in place', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'scph5501.bin')
    serve(() => new Response('9876543210'))

    await assert.rejects(
      new RommClient(store).downloadFirmware(
        {
          id: 3,
          file_name: 'scph5501.bin',
          md5_hash: '781e5e245d69b566979b86e28d23f2c7'
        } as RommFirmware,
        destination
      ),
      RommError
    )

    assert.equal(existsSync(destination), false)
    assert.equal(existsSync(`${destination}.part`), false)
  })

  test('the BIOS already installed survives a replacement that is refused', async () => {
    // Checking in place would mean the refused copy had overwritten a working
    // BIOS on its way to being thrown away, leaving the emulator with none —
    // off a button that offered to install one.
    const { store } = fakeStore()
    const destination = join(scratch(), 'scph5501.bin')
    writeFileSync(destination, 'the one that works')
    serve(() => new Response('9876543210'))

    await assert.rejects(
      new RommClient(store).downloadFirmware(
        {
          id: 3,
          file_name: 'scph5501.bin',
          md5_hash: '781e5e245d69b566979b86e28d23f2c7'
        } as RommFirmware,
        destination
      ),
      RommError
    )

    assert.equal(readFileSync(destination, 'utf8'), 'the one that works')
  })

  test('a BIOS RomM has not scanned is installed rather than refused', async () => {
    // A check that cannot be made is not a failure: RomM records no digest for
    // firmware it has not scanned, and refusing would leave the emulator with
    // no BIOS at all.
    const { store } = fakeStore()
    const destination = join(scratch(), 'scph5501.bin')
    serve(() => new Response('0123456789'))

    await new RommClient(store).downloadFirmware(
      { id: 3, file_name: 'scph5501.bin', md5_hash: null } as RommFirmware,
      destination
    )

    assert.equal(readFileSync(destination, 'utf8'), '0123456789')
    assert.equal(existsSync(`${destination}.part`), false)
  })
})

describe('what is being played', () => {
  test('starting a session says so, and only that', async () => {
    const { store } = fakeStore({ clientToken: 'rmm_token' })
    const sent = serve(() => new Response(null, { status: 200 }))

    await new RommClient(store).setNowPlaying(7, true)

    assert.equal(sent[0].method, 'PUT')
    assert.match(sent[0].url, /\/api\/roms\/7\/props$/)
    assert.deepEqual(JSON.parse(sent[0].body ?? '{}'), { now_playing: true })
  })

  test('ending one lowers the flag, which nothing on the server does', async () => {
    const { store } = fakeStore({ clientToken: 'rmm_token' })
    const sent = serve(() => new Response(null, { status: 200 }))

    await new RommClient(store).setNowPlaying(7, false)

    assert.deepEqual(JSON.parse(sent[0].body ?? '{}'), { now_playing: false })
  })

  test('a server that will not take it never fails the launch it belongs to', async () => {
    const { store } = fakeStore({ clientToken: 'rmm_token' })
    serve(() => json({ detail: 'no' }, 403))

    await new RommClient(store).setNowPlaying(7, true)
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

describe('asking the server what it can do before a transfer', () => {
  const multi = {
    id: 5,
    fs_name: 'Castlevania',
    files: [
      { id: 11, rom_id: 5, file_name: 'disc.cue' },
      { id: 12, rom_id: 5, file_name: 'disc.bin' }
    ]
  } as unknown as RommRom

  test('a 206 to a one-byte range means file-by-file, resumable', async () => {
    const { store } = fakeStore()
    const sent = serve(() => new Response('0', { status: 206 }))

    const answer = await new RommClient(store).fileTransfers(multi)

    assert.deepEqual(answer, { available: true, resumable: true })
    // The *file's* id, not the game's: that endpoint serves an ordinary file on
    // the server's disk, which is the whole reason these are fetched one by one.
    assert.match(sent[0].url, /\/api\/roms\/11\/files\/content\//)
    assert.equal(sent[0].headers.get('range'), 'bytes=0-0')
  })

  test('a 200 means the endpoint works but nothing can be resumed', async () => {
    const { store } = fakeStore()
    serve(() => new Response('0', { status: 200 }))

    assert.deepEqual(await new RommClient(store).fileTransfers(multi), {
      available: true,
      resumable: false
    })
  })

  test('a 404 is a server too old to serve a game a file at a time', async () => {
    const { store } = fakeStore()
    serve(() => new Response(null, { status: 404 }))

    assert.deepEqual(await new RommClient(store).fileTransfers(multi), {
      available: false,
      resumable: false
    })
  })

  test('a refusal is a reason to leave the strategy alone, not to push through it', async () => {
    // A 403 or a 500 means the endpoint is there and has just refused one byte.
    const { store } = fakeStore()
    serve(() => new Response(null, { status: 403 }))

    assert.deepEqual(await new RommClient(store).fileTransfers(multi), {
      available: false,
      resumable: false
    })
  })

  test('a game of one file is never fetched a file at a time', async () => {
    const { store } = fakeStore()
    const sent = serve(() => new Response('0', { status: 206 }))

    const single = { id: 5, files: [{ id: 11, file_name: 'x.md' }] } as unknown as RommRom
    assert.deepEqual(await new RommClient(store).fileTransfers(single), {
      available: false,
      resumable: false
    })
    // Not even asked: there is nothing the answer could change.
    assert.equal(sent.length, 0)
  })

  test('a probe that throws answers no, which is the safe way round', async () => {
    // Believing a transfer resumable when it is not costs the whole download.
    const { store } = fakeStore()
    globalThis.fetch = (() => Promise.reject(new Error('ECONNRESET'))) as typeof globalThis.fetch

    assert.deepEqual(await new RommClient(store).fileTransfers(multi), {
      available: false,
      resumable: false
    })
    assert.equal(await new RommClient(store).supportsRange(multi), false)
  })

  test('a whole ROM is resumable only on a 206', async () => {
    const { store } = fakeStore()
    const single = { id: 5, fs_name: 'Sonic.md' } as RommRom

    serve(() => new Response('0', { status: 206 }))
    assert.equal(await new RommClient(store).supportsRange(single), true)

    serve(() => new Response('0', { status: 200 }))
    assert.equal(await new RommClient(store).supportsRange(single), false)
  })
})

describe('the queries a listing is built from', () => {
  test('a ROM listing always asks for the files, whatever else it asks for', async () => {
    const { store } = fakeStore()
    const sent = serve(() => json({ items: [], total: 0, limit: 60, offset: 0 }))

    await new RommClient(store).roms({
      search_term: 'sonic',
      platform_ids: [1, 2],
      collection_id: 7,
      virtual_collection_id: 'recent',
      favorite: true,
      last_played: true,
      order_by: 'name',
      order_dir: 'desc',
      limit: 25,
      offset: 50
    })

    const url = new URL(sent[0].url)
    // Without this a game the server holds as a folder can only be offered
    // under the folder's name, which matches nothing on disk — so it looks
    // un-downloaded however many times the library is reconciled.
    assert.equal(url.searchParams.get('with_files'), 'true')
    assert.equal(url.searchParams.get('search_term'), 'sonic')
    assert.deepEqual(url.searchParams.getAll('platform_ids'), ['1', '2'])
    assert.equal(url.searchParams.get('collection_id'), '7')
    assert.equal(url.searchParams.get('virtual_collection_id'), 'recent')
    assert.equal(url.searchParams.get('favorite'), 'true')
    assert.equal(url.searchParams.get('last_played'), 'true')
    assert.equal(url.searchParams.get('order_dir'), 'desc')
    assert.equal(url.searchParams.get('limit'), '25')
    assert.equal(url.searchParams.get('offset'), '50')
  })

  test('an empty query still asks for a page, in a defined order', async () => {
    const { store } = fakeStore()
    const sent = serve(() => json({ items: [], total: 0, limit: 60, offset: 0 }))

    await new RommClient(store).roms({})

    const url = new URL(sent[0].url)
    assert.equal(url.searchParams.get('order_by'), 'name')
    assert.equal(url.searchParams.get('order_dir'), 'asc')
    assert.equal(url.searchParams.get('with_files'), 'true')
    assert.equal(url.searchParams.has('search_term'), false)
  })

  test('one game, and an asset path that is answered whether or not it is rooted', async () => {
    const { store } = fakeStore()
    const sent = serve(() => json({ id: 5 }))

    await new RommClient(store).rom(5)
    await new RommClient(store).asset('assets/cover.png')
    await new RommClient(store).asset('/assets/cover.png')

    assert.equal(sent[0].url, 'https://romm.example/api/roms/5')
    assert.equal(sent[1].url, 'https://romm.example/assets/cover.png')
    assert.equal(sent[2].url, 'https://romm.example/assets/cover.png')
  })
})

describe('firmware, saves and states', () => {
  const firmware = {
    id: 3,
    file_name: 'scph5501.bin',
    md5_hash: '781e5e245d69b566979b86e28d23f2c7'
  } as RommFirmware

  test('firmware is listed for one platform or for all of them', async () => {
    const { store } = fakeStore()
    const sent = serve(() => json([]))

    await new RommClient(store).firmware(4)
    await new RommClient(store).firmware()

    assert.equal(sent[0].url, 'https://romm.example/api/firmware?platform_id=4')
    assert.equal(sent[1].url, 'https://romm.example/api/firmware')
  })

  test('a BIOS that matches the digest RomM holds is kept', async () => {
    const { store } = fakeStore()
    const destination = join(scratch(), 'scph5501.bin')
    serve(() => new Response('0123456789'))

    await new RommClient(store).downloadFirmware(firmware, destination)

    assert.equal(readFileSync(destination, 'utf8'), '0123456789')
  })

  test('a BIOS that is the wrong bytes is deleted rather than left to be loaded', async () => {
    // A BIOS that is wrong is a console that hangs on a black screen, and
    // nothing on the way to that names the file.
    const { store } = fakeStore()
    const destination = join(scratch(), 'scph5501.bin')
    serve(() => new Response('not the firmware'))

    await assert.rejects(
      () => new RommClient(store).downloadFirmware(firmware, destination),
      RommError
    )
    assert.equal(existsSync(destination), false)
  })

  test('a BIOS the server never scanned is taken as it comes', async () => {
    // A check that cannot be made is not a failure: refusing the file would
    // leave the emulator with no BIOS at all.
    const { store } = fakeStore()
    const destination = join(scratch(), 'scph5501.bin')
    serve(() => new Response('whatever this is'))

    await new RommClient(store).downloadFirmware(
      { ...firmware, md5_hash: null } as RommFirmware,
      destination
    )

    assert.equal(readFileSync(destination, 'utf8'), 'whatever this is')
  })

  test('an asset with no body at all is an error rather than an empty file', async () => {
    const { store } = fakeStore()
    serve(() => new Response(null, { status: 204 }))

    await assert.rejects(
      () => new RommClient(store).downloadSave(1, join(scratch(), 'save.srm')),
      RommError
    )
  })

  test('saves and states are listed and fetched per game', async () => {
    const { store } = fakeStore()
    const dir = scratch()
    const sent = serve((request) =>
      request.url.includes('/content') ? new Response('save bytes') : json([])
    )
    const client = new RommClient(store)

    await client.saves(5)
    await client.states(5)
    await client.downloadSave(11, join(dir, 'a.srm'))
    await client.downloadState(12, join(dir, 'b.state'))

    assert.equal(sent[0].url, 'https://romm.example/api/saves?rom_id=5')
    assert.equal(sent[1].url, 'https://romm.example/api/states?rom_id=5')
    assert.equal(sent[2].url, 'https://romm.example/api/saves/11/content')
    assert.equal(sent[3].url, 'https://romm.example/api/states/12/content')
    assert.equal(readFileSync(join(dir, 'a.srm'), 'utf8'), 'save bytes')
  })

  test('a save is uploaded with the device and emulator that produced it', async () => {
    const { store } = fakeStore({ deviceId: 'romm-device-9' })
    const file = join(scratch(), 'sonic.srm')
    writeFileSync(file, 'save bytes')
    const sent = serve(() => json({ id: 21 }))

    const saved = await new RommClient(store).uploadSave(5, file, 'sonic.srm', 'retroarch')

    assert.equal(saved.id, 21)
    const url = new URL(sent[0].url)
    assert.equal(sent[0].method, 'POST')
    assert.equal(url.searchParams.get('rom_id'), '5')
    assert.equal(url.searchParams.get('emulator'), 'retroarch')
    assert.equal(url.searchParams.get('device_id'), 'romm-device-9')
    // Overwriting is the point: the copy on the server is meant to be replaced
    // by the one the emulator just wrote.
    assert.equal(url.searchParams.get('overwrite'), 'true')
  })

  test('a save from no particular emulator says so by leaving it out', async () => {
    const { store } = fakeStore()
    const file = join(scratch(), 'sonic.srm')
    writeFileSync(file, 'save bytes')
    const sent = serve(() => json({ id: 21 }))

    await new RommClient(store).uploadSave(5, file, 'sonic.srm', null)

    assert.equal(new URL(sent[0].url).searchParams.has('emulator'), false)
  })

  test('a refused upload is an error, not a save quietly not sent', async () => {
    const { store } = fakeStore()
    const file = join(scratch(), 'sonic.srm')
    writeFileSync(file, 'save bytes')
    serve(() => json({ detail: 'too large' }, 413))

    await assert.rejects(
      () => new RommClient(store).uploadSave(5, file, 'sonic.srm', null),
      RommError
    )
  })
})
