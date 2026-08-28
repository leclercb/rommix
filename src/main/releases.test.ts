import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReleaseSource } from '@config/emulators'
import { fetchReleases, installAsset, managedEmulatorDir } from './releases.ts'

/**
 * Choosing a build of an emulator, and putting it where RomMix can run it.
 *
 * Picking the wrong asset is the failure this guards: an ARM image installs
 * perfectly on an x86 machine, is recorded as the emulator's path, and then
 * every launch dies with an exec format error that names none of this. So what
 * a release listing offers is asserted against a payload shaped like the real
 * one, filtered for the architecture the tests are running on.
 *
 * `builtForThisMachine` itself is covered in `paths.test.ts`.
 */

const real = globalThis.fetch
const scratches: string[] = []
const realHome = process.env.ROMMIX_HOME

afterEach(() => {
  globalThis.fetch = real
  if (realHome === undefined) delete process.env.ROMMIX_HOME
  else process.env.ROMMIX_HOME = realHome
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratchRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-releases-test-'))
  scratches.push(dir)
  process.env.ROMMIX_HOME = dir
  return dir
}

function serve(reply: (url: string) => Response): string[] {
  const asked: string[] = []
  globalThis.fetch = ((input: string) => {
    asked.push(String(input))
    return Promise.resolve(reply(String(input)))
  }) as typeof globalThis.fetch
  return asked
}

const source: ReleaseSource = {
  api: 'https://git.example/api/v1/repos/eden/releases',
  asset: /\.AppImage$/i
}

/** An asset named for the architecture these tests are running on. */
const mine = process.arch === 'arm64' ? 'Eden-Linux-aarch64.AppImage' : 'Eden-Linux-x86_64.AppImage'
const theirs =
  process.arch === 'arm64' ? 'Eden-Linux-x86_64.AppImage' : 'Eden-Linux-aarch64.AppImage'

describe('listing what can be installed', () => {
  test('both page-size spellings are sent, because the two hosts disagree', async () => {
    const asked = serve(() => new Response('[]'))

    await fetchReleases(source)

    const query = new URL(asked[0]).searchParams
    assert.equal(query.get('limit'), '20')
    assert.equal(query.get('per_page'), '20')
  })

  test('a build for another architecture is not offered', async () => {
    serve(
      () =>
        new Response(
          JSON.stringify([
            {
              tag_name: 'v0.1',
              name: 'Eden 0.1',
              assets: [
                { name: mine, browser_download_url: 'https://git.example/mine', size: 10 },
                { name: theirs, browser_download_url: 'https://git.example/theirs', size: 10 }
              ]
            }
          ])
        )
    )

    const [release] = await fetchReleases(source)

    assert.deepEqual(
      release.assets.map((asset) => asset.name),
      [mine]
    )
  })

  test('a release with nothing installable behind it is not a menu entry', async () => {
    serve(
      () =>
        new Response(
          JSON.stringify([
            {
              tag_name: 'v0.2',
              assets: [{ name: 'Eden-Windows.zip', browser_download_url: 'https://git.example/w' }]
            },
            { tag_name: 'v0.3', assets: [] }
          ])
        )
    )

    assert.deepEqual(await fetchReleases(source), [])
  })

  test('drafts are not releases, whatever they contain', async () => {
    serve(
      () =>
        new Response(
          JSON.stringify([
            {
              tag_name: 'v0.4',
              draft: true,
              assets: [{ name: mine, browser_download_url: 'https://git.example/mine' }]
            }
          ])
        )
    )

    assert.deepEqual(await fetchReleases(source), [])
  })

  test('a prerelease is kept, and says so', async () => {
    serve(
      () =>
        new Response(
          JSON.stringify([
            {
              tag_name: 'v0.5-rc1',
              prerelease: true,
              published_at: '2026-05-01T00:00:00Z',
              assets: [{ name: mine, browser_download_url: 'https://git.example/mine' }]
            }
          ])
        )
    )

    const [release] = await fetchReleases(source)

    assert.equal(release.prerelease, true)
    assert.equal(release.tag, 'v0.5-rc1')
    // The name falls back to the tag, so a release published without one is
    // still something the picker can draw.
    assert.equal(release.name, 'v0.5-rc1')
    assert.equal(release.publishedAt, '2026-05-01T00:00:00Z')
    // Nothing in the payload says how big it is, and the picker still has to
    // show a row rather than nothing.
    assert.equal(release.assets[0].sizeBytes, 0)
  })

  test('a listing the host refuses says which host and what it answered', async () => {
    serve(() => new Response('rate limited', { status: 429 }))

    await assert.rejects(() => fetchReleases(source), /429/)
  })
})

describe('installing an asset', () => {
  test('it lands executable, under its own name, in RomMix own folder', async () => {
    const root = scratchRoot()
    serve(() => new Response('#!/bin/sh\n'))
    const progress: number[] = []

    const path = await installAsset(
      'eden',
      { name: mine, url: 'https://git.example/mine', sizeBytes: 10 },
      (update) => progress.push(update.receivedBytes)
    )

    assert.equal(path, join(root, 'emulators', 'eden', mine))
    assert.equal(readFileSync(path, 'utf8'), '#!/bin/sh\n')
    // Owner-executable, which is what makes it a program rather than a file.
    assert.equal((statSync(path).mode & 0o100) !== 0, true)
    assert.ok(progress.length > 0)
    assert.equal(existsSync(`${path}.part`), false)
  })

  test('a previous install is cleared out rather than left beside the new one', async () => {
    scratchRoot()
    serve(() => new Response('one'))
    const older = await installAsset(
      'eden',
      { name: 'Eden-old.AppImage', url: 'https://git.example/old', sizeBytes: 3 },
      () => undefined
    )

    serve(() => new Response('two'))
    await installAsset(
      'eden',
      { name: mine, url: 'https://git.example/mine', sizeBytes: 3 },
      () => undefined
    )

    assert.equal(existsSync(older), false)
  })

  test('a refused download leaves nothing that looks like an emulator', async () => {
    scratchRoot()
    serve(() => new Response('nope', { status: 404 }))

    await assert.rejects(
      () =>
        installAsset(
          'eden',
          { name: mine, url: 'https://git.example/mine', sizeBytes: 10 },
          () => undefined
        ),
      /404/
    )
    assert.equal(existsSync(join(managedEmulatorDir('eden'), mine)), false)
  })
})
