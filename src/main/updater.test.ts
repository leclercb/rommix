import assert from 'node:assert/strict'
import { afterEach, before, describe, test } from 'node:test'
import { app } from 'electron'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UpdatePolicy, UpdateStatus } from '@shared/types'
import { Updater } from './update.ts'
import { Store } from './store.ts'

/**
 * Checking for a new RomMix, and replacing the running image with it.
 *
 * `compareVersions` and `pickImage` — the two rules this is built on — are in
 * `update.test.ts`. What is here is the machine around them: what the user is
 * told after a check, and what is on disk after a download that did not finish.
 * A half-written AppImage renamed over the running one is the worst failure
 * RomMix has, because the next launch is of a program that no longer exists.
 *
 * The running version comes from Electron, so the stub is told what to answer
 * — see `scripts/test-resolve.mjs`. That is the one Electron call this class
 * cannot be separated from: `app.getVersion()` is the version it compares
 * everything against.
 */

const realFetch = globalThis.fetch
const scratches: string[] = []
const heldAppImage = process.env.APPIMAGE

before(() => {
  app.getVersion = () => '1.0.0'
})

afterEach(() => {
  globalThis.fetch = realFetch
  if (heldAppImage === undefined) delete process.env.APPIMAGE
  else process.env.APPIMAGE = heldAppImage
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-updater-test-'))
  scratches.push(dir)
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

/** The release payload GitHub answers with, as far as RomMix reads it. */
function release(tag: string, assets: string[] = []): Response {
  return new Response(
    JSON.stringify({
      tag_name: tag,
      html_url: `https://github.com/leclercb/rommix/releases/tag/${tag}`,
      body: 'Release notes',
      assets: assets.map((name) => ({
        name,
        browser_download_url: `https://github.example/${name}`,
        size: 12
      }))
    })
  )
}

/** The list endpoint's answer: the releases, newest publication first. */
function releaseList(entries: { tag: string; draft?: boolean }[]): Response {
  return new Response(
    JSON.stringify(
      entries.map(({ tag, draft }) => ({
        tag_name: tag,
        draft: draft ?? false,
        html_url: `https://github.com/leclercb/rommix/releases/tag/${tag}`,
        assets: []
      }))
    )
  )
}

/**
 * An updater on `notify`, so a check reports and stops there.
 *
 * The default is `auto`, where finding a release starts fetching it — which is
 * the right behaviour and the wrong thing to have running underneath a test
 * about what a *check* answers. The auto path has a test of its own below.
 */
function updater(
  policy: UpdatePolicy = 'notify',
  prereleases = false
): { updater: Updater; seen: UpdateStatus[] } {
  const seen: UpdateStatus[] = []
  const store = new Store(join(scratch(), 'config'))
  store.updateSettings({ updates: policy, updatePrereleases: prereleases })
  return { updater: new Updater(store, (status) => seen.push(status)), seen }
}

/** The image name for whichever machine the tests are running on. */
const image = process.arch === 'arm64' ? 'RomMix-aarch64.AppImage' : 'RomMix-x86_64.AppImage'

describe('checking for a new version', () => {
  test('the running version is what everything is compared against', () => {
    const { updater: subject } = updater()

    assert.equal(subject.status.current, '1.0.0')
    assert.equal(subject.status.state, 'idle')
  })

  test('a release that is not newer leaves nothing to download', async () => {
    const { updater: subject } = updater()
    serve(() => release('v0.9.0', [image]))

    const status = await subject.check()

    assert.equal(status.state, 'idle')
    assert.equal(status.latest, '0.9.0')
    assert.equal(status.notes, null)
    assert.ok(status.checkedAt)
  })

  test('a newer release is reported with its notes and the page it is on', async () => {
    process.env.APPIMAGE = join(scratch(), image)
    const { updater: subject } = updater()
    serve(() => release('v1.2.0', [image]))

    const status = await subject.check()

    assert.equal(status.latest, '1.2.0')
    assert.match(status.url ?? '', /releases\/tag\/v1\.2\.0/)
    assert.equal(status.notes, 'Release notes')
  })

  test('a copy of RomMix that cannot replace itself still hears about the release', async () => {
    // Not running as an AppImage — a `npm run dev` session, or a distro
    // package. The version is still worth reporting; installing it is not
    // something RomMix can do from here.
    delete process.env.APPIMAGE
    const { updater: subject } = updater()
    serve(() => release('v1.2.0', [image]))

    const status = await subject.check()

    assert.equal(status.latest, '1.2.0')
    assert.ok(status.blockedReason)
    await assert.rejects(() => subject.download())
  })

  test('a release with no image for this machine is reported as one that cannot be taken', async () => {
    process.env.APPIMAGE = join(scratch(), image)
    const { updater: subject } = updater()
    serve(() => release('v1.2.0', ['rommix-steam.sh']))

    const status = await subject.check()

    assert.equal(status.latest, '1.2.0')
    assert.ok(status.blockedReason)
  })

  test('a GitHub that will not answer is reported rather than passed over', async () => {
    const { updater: subject } = updater()
    serve(() => new Response('rate limited', { status: 403 }))

    const status = await subject.check()

    assert.equal(status.state, 'error')
    assert.match(status.error ?? '', /403/)
  })

  test('a release with no version tag is not a version', async () => {
    const { updater: subject } = updater()
    serve(() => new Response(JSON.stringify({ assets: [] })))

    assert.equal((await subject.check()).state, 'error')
  })

  test('the check identifies itself, so RomMix share of the rate limit is its own', async () => {
    const { updater: subject } = updater()
    let agent: string | null = null
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      agent = new Headers(init.headers as Record<string, string>).get('user-agent')
      return Promise.resolve(release('v0.9.0'))
    }) as typeof globalThis.fetch

    await subject.check()

    assert.equal(agent, 'RomMix/1.0.0')
  })
})

describe('release candidates', () => {
  test('the release GitHub calls latest is the only one asked for by default', async () => {
    const { updater: subject } = updater()
    const asked = serve(() => release('v0.9.0', [image]))

    await subject.check()

    // The endpoint that never answers with a pre-release, so nothing else has
    // to decide whether a candidate counts.
    assert.deepEqual(asked, ['https://api.github.com/repos/leclercb/rommix/releases/latest'])
  })

  test('volunteering for them reads the list and takes the newest version', async () => {
    const { updater: subject } = updater('notify', true)
    // As GitHub sorts it — by publication — which is not version order once a
    // fix for the old line is published after a candidate for the new one.
    const asked = serve(() => releaseList([{ tag: 'v1.0.1' }, { tag: 'v1.1.0-rc.2' }]))

    const status = await subject.check()

    assert.match(asked[0] ?? '', /\/releases\?/)
    assert.equal(status.latest, '1.1.0-rc.2')
  })

  test('a draft is not a release anybody but its author can download', async () => {
    const { updater: subject } = updater('notify', true)
    serve(() => releaseList([{ tag: 'v2.0.0', draft: true }, { tag: 'v1.1.0-rc.2' }]))

    assert.equal((await subject.check()).latest, '1.1.0-rc.2')
  })

  test('the finished release beats the candidate it was a candidate for', async () => {
    const { updater: subject } = updater('notify', true)
    serve(() => releaseList([{ tag: 'v1.1.0-rc.2' }, { tag: 'v1.1.0' }]))

    assert.equal((await subject.check()).latest, '1.1.0')
  })

  test('a repository with no releases yet is not a version', async () => {
    const { updater: subject } = updater('notify', true)
    serve(() => releaseList([]))

    assert.equal((await subject.check()).state, 'error')
  })
})

describe('downloading it', () => {
  test('nothing has been found yet, so there is nothing to fetch', async () => {
    const { updater: subject } = updater()

    await assert.rejects(() => subject.download())
  })

  test('the new image is written over the running one, executable, in one step', async () => {
    const running = join(scratch(), image)
    process.env.APPIMAGE = running
    const { updater: subject } = updater()
    serve((url) => (url.includes('api') ? release('v1.2.0', [image]) : new Response('new bytes')))

    await subject.check()
    const status = await subject.download()

    assert.equal(status.state, 'ready')
    assert.equal(status.readyPath, running)
    assert.equal(readFileSync(running, 'utf8'), 'new bytes')
    assert.equal((statSync(running).mode & 0o100) !== 0, true)
    // The path RomMix is wired into never gains a version or a suffix.
    assert.equal(existsSync(`${running}.part`), false)
  })

  test('a download that fails leaves the running image untouched', async () => {
    const running = join(scratch(), image)
    process.env.APPIMAGE = running
    const { updater: subject } = updater()
    serve((url) =>
      url.includes('api') ? release('v1.2.0', [image]) : new Response('nope', { status: 500 })
    )

    await subject.check()

    await assert.rejects(() => subject.download())
    assert.equal(existsSync(running), false)
    assert.equal(existsSync(`${running}.part`), false)
  })

  test('once an image is staged the checks stop finding the same release again', async () => {
    const running = join(scratch(), image)
    process.env.APPIMAGE = running
    const { updater: subject } = updater()
    serve((url) => (url.includes('api') ? release('v1.2.0', [image]) : new Response('new bytes')))
    await subject.check()
    await subject.download()

    const asked = serve(() => release('v1.2.0', [image]))
    await subject.check()

    assert.deepEqual(asked, [])
  })
})

describe('with updates left on automatic', () => {
  test('finding a release is enough to start fetching it', async () => {
    const running = join(scratch(), image)
    process.env.APPIMAGE = running
    const { updater: subject } = updater('auto')
    serve((url) => (url.includes('api') ? release('v1.2.0', [image]) : new Response('new bytes')))

    await subject.check()
    // Started rather than awaited: the check answers the version question as
    // soon as it can, and the transfer runs on behind it.
    await new Promise((resolve) => setTimeout(resolve, 50))

    assert.equal(subject.status.state, 'ready')
    assert.equal(readFileSync(running, 'utf8'), 'new bytes')
  })
})

describe('the timer', () => {
  test('turning checks off leaves none running, and stopping twice is harmless', () => {
    const { updater: subject } = updater()

    subject.schedule()
    subject.stop()
    subject.stop()
  })
})
