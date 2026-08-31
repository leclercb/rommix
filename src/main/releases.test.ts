import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReleaseSource } from '@config/emulators'
import { fetchReleases, installAsset, managedEmulatorDir } from './releases.ts'
import { zipDirectory } from './zip.ts'

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
      { name: mine, url: 'https://git.example/mine', sizeBytes: 10, digest: null },
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
      { name: 'Eden-old.AppImage', url: 'https://git.example/old', sizeBytes: 3, digest: null },
      () => undefined
    )

    serve(() => new Response('two'))
    await installAsset(
      'eden',
      { name: mine, url: 'https://git.example/mine', sizeBytes: 3, digest: null },
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
          { name: mine, url: 'https://git.example/mine', sizeBytes: 10, digest: null },
          () => undefined
        ),
      /404/
    )
    assert.equal(existsSync(join(managedEmulatorDir('eden'), mine)), false)
  })
})

describe('checking an emulator against the digest its release states', () => {
  /** sha256 of the body every `serve` below returns. */
  const BODY = '#!/bin/sh\n'
  const digestOf = async (): Promise<string> => {
    const { createHash } = await import('node:crypto')
    return createHash('sha256').update(BODY).digest('hex')
  }

  test('a stated digest survives the listing into the asset', async () => {
    // If it were dropped here every install would go unchecked, and nothing
    // about the result would look any different.
    serve(() =>
      Response.json([
        {
          tag_name: 'v1',
          assets: [
            {
              name: mine,
              browser_download_url: 'https://git.example/mine',
              size: 10,
              digest: 'sha256:abc123'
            }
          ]
        }
      ])
    )

    const [release] = await fetchReleases(source)

    assert.deepEqual(release.assets[0].digest, { algorithm: 'sha256', expected: 'abc123' })
  })

  test('a release that states none says so rather than inventing one', async () => {
    serve(() =>
      Response.json([
        {
          tag_name: 'v1',
          assets: [{ name: mine, browser_download_url: 'https://git.example/mine', size: 10 }]
        }
      ])
    )

    const [release] = await fetchReleases(source)

    assert.equal(release.assets[0].digest, null)
  })

  test('an emulator matching its digest is installed', async () => {
    const root = scratchRoot()
    serve(() => new Response(BODY))

    const path = await installAsset(
      'eden',
      {
        name: mine,
        url: 'https://git.example/mine',
        sizeBytes: 10,
        digest: { algorithm: 'sha256', expected: await digestOf() }
      },
      () => undefined
    )

    assert.equal(path, join(root, 'emulators', 'eden', mine))
  })

  test('an emulator that is not what was published is never made runnable', async () => {
    const root = scratchRoot()
    serve(() => new Response('a different program entirely'))
    const published = await digestOf()

    await assert.rejects(
      () =>
        installAsset(
          'eden',
          {
            name: mine,
            url: 'https://git.example/mine',
            sizeBytes: 10,
            digest: { algorithm: 'sha256', expected: published }
          },
          () => undefined
        ),
      new RegExp(mine.replace(/\./g, '\\.'))
    )

    // Neither under its own name nor as the part-file it arrived as.
    const dir = join(root, 'emulators', 'eden')
    assert.equal(existsSync(join(dir, mine)), false)
    assert.equal(existsSync(join(dir, `${mine}.part`)), false)
  })
})

describe('an install that fails leaves the working one alone', () => {
  /** An emulator already installed, the way a previous run left it. */
  async function alreadyInstalled(): Promise<{ root: string; path: string }> {
    const root = scratchRoot()
    serve(() => new Response('the one that works'))
    const path = await installAsset(
      'eden',
      { name: mine, url: 'https://git.example/old', sizeBytes: 3, digest: null },
      () => undefined
    )
    return { root, path }
  }

  test('a refused download does not take the installed emulator with it', async () => {
    // Pressing update on an emulator that works, and being left with none, is
    // the outcome this exists to prevent.
    const { path } = await alreadyInstalled()
    serve(() => new Response('nope', { status: 500 }))

    await assert.rejects(() =>
      installAsset(
        'eden',
        { name: mine, url: 'https://git.example/new', sizeBytes: 3, digest: null },
        () => undefined
      )
    )

    assert.equal(existsSync(path), true)
    assert.equal(readFileSync(path, 'utf8'), 'the one that works')
  })

  test('a download that is not what was published does not either', async () => {
    const { path } = await alreadyInstalled()
    serve(() => new Response('a different program entirely'))

    await assert.rejects(() =>
      installAsset(
        'eden',
        {
          name: mine,
          url: 'https://git.example/new',
          sizeBytes: 3,
          digest: { algorithm: 'sha256', expected: 'b'.repeat(64) }
        },
        () => undefined
      )
    )

    assert.equal(readFileSync(path, 'utf8'), 'the one that works')
  })

  test('a successful install still replaces what was there', async () => {
    // The other half of the same rule: building beside the old copy must not
    // turn into leaving the old copy behind.
    const { root } = await alreadyInstalled()
    serve(() => new Response('the new one'))

    const path = await installAsset(
      'eden',
      { name: 'Eden-newer.AppImage', url: 'https://git.example/new', sizeBytes: 3, digest: null },
      () => undefined
    )

    const dir = join(root, 'emulators', 'eden')
    assert.deepEqual(readdirSync(dir), ['Eden-newer.AppImage'])
    assert.equal(readFileSync(path, 'utf8'), 'the new one')
  })

  test('nothing is left beside the install once it is done', async () => {
    const { root } = await alreadyInstalled()
    const parent = join(root, 'emulators')

    // No `.incoming` or `.previous` scratch directories outlive the install.
    assert.deepEqual(readdirSync(parent), ['eden'])
  })

  test('an archive holding no program leaves the working install and no scratch', async () => {
    // shadPS4 publishes its image inside a zip, so an archive is an ordinary
    // release here. One that turns out to hold no image fails after the
    // download has finished, which is the last point a staging directory could
    // be left standing.
    const { root, path } = await alreadyInstalled()
    const contents = join(root, 'contents')
    mkdirSync(contents, { recursive: true })
    writeFileSync(join(contents, 'README.txt'), 'no program in here')
    const archive = join(root, 'release.zip')
    await zipDirectory(contents, archive)
    const bytes = readFileSync(archive)
    serve(() => new Response(bytes))

    await assert.rejects(() =>
      installAsset(
        'eden',
        { name: 'Eden-Linux.zip', url: 'https://git.example/new', sizeBytes: 3, digest: null },
        () => undefined
      )
    )

    assert.equal(readFileSync(path, 'utf8'), 'the one that works')
    assert.deepEqual(readdirSync(join(root, 'emulators')), ['eden'])
  })

  test('what a killed attempt left behind is cleared rather than adopted', async () => {
    const { root, path } = await alreadyInstalled()
    // What losing power part-way through an install leaves on disk.
    const staging = join(root, 'emulators', 'eden.incoming')
    mkdirSync(staging, { recursive: true })
    writeFileSync(join(staging, 'half-written.AppImage'), 'junk')

    serve(() => new Response('the new one'))
    const installed = await installAsset(
      'eden',
      { name: mine, url: 'https://git.example/new', sizeBytes: 3, digest: null },
      () => undefined
    )

    assert.equal(readFileSync(installed, 'utf8'), 'the new one')
    assert.deepEqual(readdirSync(join(root, 'emulators', 'eden')), [mine])
    assert.equal(existsSync(staging), false)
    assert.equal(installed, path)
  })
})
