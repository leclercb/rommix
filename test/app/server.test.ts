import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RommClient } from '../../src/main/romm/index.ts'
import type { Store } from '../../src/main/store.ts'
import { ROM_CONTENT, startFakeRomm, type FakeRomm } from './server.ts'

/**
 * The fake RomM, against the real client.
 *
 * A fake nobody checks is a second implementation of RomMix's own assumptions,
 * and the scenarios that run against it would go green over a server that
 * answers nothing RomM would. So it is driven here by `RommClient` itself —
 * the same code the application runs, over real HTTP — before anything is
 * asked to believe what it says.
 *
 * This needs no Electron and no window, so it runs wherever `npm test` does.
 * It is what makes a failure in the scenarios mean something: if these pass and
 * those fail, the fault is in RomMix's own wiring, which is the fault they are
 * there to find.
 */

let server: FakeRomm
const scratches: string[] = []

before(async () => {
  server = await startFakeRomm()
})

after(async () => {
  await server.close()
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-fake-test-'))
  scratches.push(dir)
  return dir
}

/** A client signed in to the fake, the way the harness seeds one. */
function client(token = server.token): RommClient {
  const store = {
    server: { baseUrl: server.baseUrl },
    settings: { deviceId: 'integration-test', deviceName: 'the test machine' },
    credentials: { clientToken: token, accessToken: null, refreshToken: null, expiresAt: null },
    setCredentials() {},
    clearCredentials() {}
  } as unknown as Store
  return new RommClient(store)
}

describe('what the fake answers', () => {
  test('it says which RomM it is, before anything is signed in', async () => {
    const { version } = await client('').heartbeat()
    assert.equal(version, '5.1.0')
  })

  test('everything else needs the token, so a badly seeded harness fails here', async () => {
    // The alternative is a run that gets an empty library and reports it as a
    // library with nothing in it.
    await assert.rejects(() => client('the wrong token').me())
  })

  test('the user, the platforms and a page of the library', async () => {
    const romm = client()
    assert.equal((await romm.me()).username, 'tester')
    assert.deepEqual(
      (await romm.platforms()).map((one) => one.slug),
      ['genesis', 'gb']
    )
    const page = await romm.roms()
    assert.equal(page.total, 2)
    assert.equal(page.items[0].fs_name, 'cavestory.md')
  })

  test('a listing asks for the files, which is what names a game on disk', async () => {
    await client().roms()
    // Not an assertion about the fake: `with_files` is the parameter whose
    // absence makes every multi-file game look un-downloaded forever, and the
    // fake is the only place a test can see what was sent.
    assert.ok(server.asked.some((one) => one.path.includes('with_files=true')))
  })

  test('one platform at a time, the way the library screen asks', async () => {
    const page = await client().roms({ platform_ids: [2] })
    assert.deepEqual(
      page.items.map((one) => one.name),
      ['Tobu Tobu Girl']
    )
  })
})

describe('fetching a game from it', () => {
  test('it offers ranges, so the screen may honestly offer Pause', async () => {
    assert.equal(await client().supportsRange(server.roms[0]), true)
  })

  test('the bytes arrive and match the hash RomM published', async () => {
    // Both halves matter: a fake serving a digest of something else would make
    // every download in the scenarios fail as corrupt, and one publishing no
    // digest would mean the check never ran at all.
    const destination = join(scratch(), 'cavestory.md')
    await client().downloadRom(server.roms[0], destination, () => {}, new AbortController().signal)
    assert.deepEqual(readFileSync(destination), ROM_CONTENT)
  })

  test('a transfer picked up part-way appends rather than starting again', async () => {
    // The path `transfer.ts` takes after an interruption, over real HTTP with a
    // real 206 — which is the one thing the unit tests fake.
    const destination = join(scratch(), 'resumed.md')
    const partial = `${destination}.part`
    const half = ROM_CONTENT.subarray(0, 100)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(partial, half)

    let firstReport = 0
    await client().downloadRom(
      server.roms[0],
      destination,
      ({ received }) => {
        firstReport ||= received
      },
      new AbortController().signal,
      { resume: true }
    )

    assert.equal(firstReport, half.length, 'it should start counting from what was already there')
    assert.deepEqual(readFileSync(destination), ROM_CONTENT)
  })

  test('a game the server does not have is an answer, not an outage', async () => {
    const missing = { ...server.roms[0], id: 999 }
    await assert.rejects(
      () =>
        client().downloadRom(
          missing,
          join(scratch(), 'no.md'),
          () => {},
          new AbortController().signal
        ),
      (cause: Error) => cause.name === 'RommError'
    )
  })
})

describe('what a session tells it', () => {
  test('play time is reported in a shape the server takes', async () => {
    await client().reportPlaySession(1, new Date('2026-01-01T10:00:00Z'), 600)
    const sent = server.asked.find((one) => one.path === '/api/play-sessions')
    assert.notEqual(sent, undefined)
    const body = JSON.parse(sent?.body ?? '{}') as { sessions: { duration_ms: number }[] }
    assert.equal(body.sessions[0].duration_ms, 600_000)
  })

  test('a game being played is raised and lowered, not only raised', async () => {
    await client().setNowPlaying(1, true)
    await client().setNowPlaying(1, false)
    const props = server.asked.filter((one) => one.path === '/api/roms/1/props')
    assert.deepEqual(
      props.map((one) => JSON.parse(one.body).now_playing),
      [true, false]
    )
  })
})
