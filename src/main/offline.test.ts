/**
 * What RomMix writes down about a game so it can answer for it alone.
 *
 * Everything here fails silently on a machine that is connected, which is the
 * whole problem: a cover that was never fetched and a `RommRom` that was never
 * written look exactly like a working installation right up until the handheld
 * leaves the network, and then the game screen is empty and Play does nothing.
 * So each half is checked against the disk — what was written, what was
 * fetched, and what is left behind after the game is uninstalled.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InstalledRom, RommPlatform, RommRom } from '@shared/types'
import { contentTypeOf, OfflineCache, rememberInstalledGames } from './offline.ts'
import { RommError, type RommClient } from './romm/index.ts'

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-offline-test-'))
  scratches.push(dir)
  return dir
}

function rom(fields: Partial<RommRom> = {}): RommRom {
  return {
    id: 7,
    name: 'Sonic the Hedgehog',
    platform_slug: 'genesis-slash-megadrive',
    platform_display_name: 'Sega Mega Drive',
    path_cover_small: '/assets/romm/resources/roms/1/7/cover/small.webp',
    path_cover_large: '/assets/romm/resources/roms/1/7/cover/big.png',
    merged_screenshots: ['/assets/romm/resources/roms/1/7/screenshots/0.jpg'],
    files: [],
    ...fields
  } as unknown as RommRom
}

/**
 * A server holding whichever assets the test names, and nothing else.
 *
 * `asked` is what the assertions are actually about half the time: the point of
 * the cache is that a second install of the same platform does not re-ask for
 * icons the first one already established are not there.
 */
function server(assets: Record<string, string> = {}): {
  client: RommClient
  asked: string[]
} {
  const asked: string[] = []
  const client = {
    async asset(path: string) {
      asked.push(path)
      const held = assets[path]
      return held === undefined
        ? new Response(null, { status: 404 })
        : new Response(Buffer.from(held), { status: 200 })
    }
  } as unknown as RommClient
  return { client, asked }
}

/** A server nothing answers for, which is what being out of range looks like. */
function unreachable(): RommClient {
  return {
    async asset() {
      throw new TypeError('fetch failed')
    }
  } as unknown as RommClient
}

describe('what is written down about a game', () => {
  test('the whole ROM comes back exactly as the server described it', async () => {
    const dir = scratch()
    const cache = new OfflineCache(dir, server().client)

    await cache.save(rom(), 'genesis')

    assert.equal(cache.has(7), true)
    assert.deepEqual(await cache.game(7), rom())
  })

  test('a game nothing was ever written about is null rather than an error', async () => {
    const cache = new OfflineCache(scratch(), server().client)
    assert.equal(cache.has(7), false)
    assert.equal(await cache.game(7), null)
  })

  test('the artwork is fetched and served back off the disk', async () => {
    const dir = scratch()
    const covers = {
      '/assets/romm/resources/roms/1/7/cover/small.webp': 'small cover bytes',
      '/assets/romm/resources/roms/1/7/cover/big.png': 'big cover bytes',
      '/assets/romm/resources/roms/1/7/screenshots/0.jpg': 'a screenshot'
    }
    const cache = new OfflineCache(dir, server(covers).client)

    await cache.save(rom(), 'genesis')

    for (const [path, contents] of Object.entries(covers)) {
      const file = cache.assetFile(path)
      assert.ok(file, `nothing cached for ${path}`)
      assert.equal(readFileSync(file, 'utf8'), contents)
    }
  })

  test('the console icon is fetched too, so a grid of covers is complete', async () => {
    const icon = '/assets/platforms/systematic/genesis-slash-megadrive.svg'
    const cache = new OfflineCache(scratch(), server({ [icon]: '<svg/>' }).client)

    await cache.save(rom(), 'genesis')

    assert.ok(cache.assetFile(icon))
  })

  test('artwork the server does not have is skipped, and the game is still saved', async () => {
    const cache = new OfflineCache(scratch(), server().client)

    await cache.save(rom(), 'genesis')

    assert.equal(cache.has(7), true)
    assert.equal(cache.assetFile('/assets/romm/resources/roms/1/7/cover/small.webp'), null)
  })

  test('a server that does not answer fails the save, so it can be tried again', async () => {
    const cache = new OfflineCache(scratch(), unreachable())
    await assert.rejects(() => cache.save(rom(), 'genesis'), /fetch failed/)
  })

  test('an asset already here is not fetched a second time', async () => {
    const path = '/assets/romm/resources/roms/1/7/cover/small.webp'
    const { client, asked } = server({ [path]: 'cover' })
    const cache = new OfflineCache(scratch(), client)

    await cache.save(rom(), 'genesis')
    const first = asked.length
    await cache.save(rom(), 'genesis')

    assert.equal(asked.filter((one) => one === path).length, 1)
    // Nor is anything else: the misses are remembered for the session as well,
    // which is what keeps back-filling a library from asking for the same
    // absent console icon once per game on the console.
    assert.equal(asked.length, first)
  })

  test('uninstalling takes the game and its own artwork, and leaves the icon', async () => {
    const cover = '/assets/romm/resources/roms/1/7/cover/small.webp'
    const icon = '/assets/platforms/systematic/genesis-slash-megadrive.svg'
    const cache = new OfflineCache(scratch(), server({ [cover]: 'c', [icon]: 's' }).client)
    await cache.save(rom(), 'genesis')

    await cache.forget(7)

    assert.equal(cache.has(7), false)
    assert.equal(cache.assetFile(cover), null)
    // Shared by every game on the console and a couple of kilobytes: throwing
    // it away would blank the icon beside every other Mega Drive game.
    assert.ok(cache.assetFile(icon))
  })

  test('forgetting a game nothing was written about does nothing at all', async () => {
    const cache = new OfflineCache(scratch(), server().client)
    await cache.forget(7)
  })
})

describe('sweeping what nothing points at', () => {
  const entry = (romId: number, system = 'genesis'): InstalledRom =>
    ({ romId, system }) as InstalledRom

  test('a game the index has never heard of is dropped, artwork and all', async () => {
    const cover = '/assets/romm/resources/roms/1/7/cover/small.webp'
    const cache = new OfflineCache(scratch(), server({ [cover]: 'a cover' }).client)
    await cache.save(rom(), 'genesis')

    // Uninstalled at some point without `forget` finishing — a crash, or a
    // record truncated mid-write, both of which leave exactly this.
    const swept = await cache.sweep([])

    assert.deepEqual(swept, { games: 1, assets: 1 })
    assert.equal(cache.has(7), false)
    assert.equal(cache.assetFile(cover), null)
  })

  test('an installed game keeps everything it names', async () => {
    const cover = '/assets/romm/resources/roms/1/7/cover/small.webp'
    const icon = '/assets/platforms/systematic/genesis-slash-megadrive.svg'
    const cache = new OfflineCache(scratch(), server({ [cover]: 'c', [icon]: 's' }).client)
    await cache.save(rom(), 'genesis')

    assert.deepEqual(await cache.sweep([entry(7)]), { games: 0, assets: 0 })
    assert.ok(cache.assetFile(cover))
    assert.ok(cache.assetFile(icon))
  })

  test('an icon survives as long as one game on the platform does', async () => {
    const icon = '/assets/platforms/systematic/genesis-slash-megadrive.svg'
    const cache = new OfflineCache(scratch(), server({ [icon]: 's' }).client)
    await cache.save(rom(), 'genesis')
    await cache.save(rom({ id: 8 }), 'genesis')

    await cache.sweep([entry(8)])

    assert.equal(cache.has(7), false)
    // Shared by every Mega Drive game, and one of them is still here.
    assert.ok(cache.assetFile(icon))
  })

  test('a game downloaded under another emulator is not swept away', async () => {
    const cover = '/assets/romm/resources/roms/1/7/cover/small.webp'
    const cache = new OfflineCache(scratch(), server({ [cover]: 'c' }).client)
    await cache.save(rom(), 'genesis')

    // The whole index, stale entries included: the file is still on the disk
    // and still worth its cover the moment the platform is pointed back.
    await cache.sweep([entry(7)])

    assert.ok(cache.assetFile(cover))
  })

  test('the half-written file an interrupted save leaves is swept', async () => {
    const dir = scratch()
    const cache = new OfflineCache(dir, server().client)
    await cache.save(rom(), 'genesis')
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'assets', 'deadbeef.png.tmp'), 'half a picture')

    assert.equal((await cache.sweep([entry(7)])).assets, 1)
    assert.deepEqual(readdirSync(join(dir, 'assets')), [])
  })

  test('what the server last said survives a sweep', async () => {
    const cache = new OfflineCache(scratch(), server().client)
    await cache.savePlatforms([{ id: 3 } as RommPlatform])
    await cache.saveFirmware({ 3: [] })

    // It belongs to the server rather than to any game, so an empty index is
    // no reason to lose it — and losing it is what takes the BIOS screen and
    // the platform filter offline with it.
    await cache.sweep([])

    assert.deepEqual(await cache.platforms(), [{ id: 3 }])
    assert.deepEqual(await cache.firmware(), { 3: [] })
  })

  test('an empty folder is nothing to sweep rather than an error', async () => {
    const cache = new OfflineCache(scratch(), server().client)
    assert.deepEqual(await cache.sweep([]), { games: 0, assets: 0 })
  })
})

describe('writing down the games that had nothing', () => {
  const entry = (romId: number): InstalledRom =>
    ({ romId, system: 'genesis', name: `Game ${romId}` }) as InstalledRom

  /** A server that describes the games named, and 404s for anything else. */
  const describing = (ids: number[]) => async (romId: number) => {
    if (!ids.includes(romId)) throw new RommError('no such ROM', 404)
    return rom({ id: romId })
  }

  test('each installed game with nothing saved is fetched and saved', async () => {
    const cache = new OfflineCache(scratch(), server().client)

    await rememberInstalledGames([entry(7), entry(8)], describing([7, 8]), cache)

    assert.equal(cache.has(7), true)
    assert.equal(cache.has(8), true)
  })

  test('a game already written down is not asked about again', async () => {
    const cache = new OfflineCache(scratch(), server().client)
    await cache.save(rom(), 'genesis')
    const asked: number[] = []

    await rememberInstalledGames(
      [entry(7)],
      async (romId) => {
        asked.push(romId)
        return rom({ id: romId })
      },
      cache
    )

    assert.deepEqual(asked, [])
  })

  test('a game the server has deleted is passed over rather than blocking', async () => {
    const cache = new OfflineCache(scratch(), server().client)

    await rememberInstalledGames([entry(7), entry(8)], describing([8]), cache)

    // The 404 is an answer, so there is nothing to come back for — and the game
    // behind it must not stop the ones after it being written down.
    assert.equal(cache.has(7), false)
    assert.equal(cache.has(8), true)
  })

  test('a server that stops answering leaves the rest for next time', async () => {
    const cache = new OfflineCache(scratch(), server().client)

    await rememberInstalledGames(
      [entry(7), entry(8)],
      async () => {
        throw new TypeError('fetch failed')
      },
      cache
    )

    assert.equal(cache.has(7), false)
    assert.equal(cache.has(8), false)
  })

  test('a game whose artwork could not be fetched is written down again later', async () => {
    const dir = scratch()
    const cover = '/assets/romm/resources/roms/1/7/cover/small.webp'
    // The server describes the game and then goes away before its cover lands,
    // which is what a download finishing as the network drops looks like.
    const flaky = {
      async asset() {
        throw new TypeError('fetch failed')
      }
    } as unknown as RommClient

    await rememberInstalledGames([entry(7)], async () => rom(), new OfflineCache(dir, flaky))
    // Nothing recorded, because nothing was finished: a record on disk is what
    // says this game is done, and it would never be looked at again.
    assert.equal(new OfflineCache(dir, flaky).has(7), false)

    const back = new OfflineCache(dir, server({ [cover]: 'a cover' }).client)
    await rememberInstalledGames([entry(7)], async () => rom(), back)

    assert.equal(back.has(7), true)
    assert.ok(back.assetFile(cover))
  })
})

describe('what the server last said it has', () => {
  const platform = { id: 3, slug: 'gba', display_name: 'Game Boy Advance' } as RommPlatform

  test('nothing is not an empty list, so a caller can tell them apart', async () => {
    const cache = new OfflineCache(scratch(), server().client)
    assert.equal(await cache.platforms(), null)
    assert.equal(await cache.firmware(), null)
  })

  test('each is written and read back on its own', async () => {
    const cache = new OfflineCache(scratch(), server().client)

    await cache.savePlatforms([platform])
    // Only half of it so far, which is the state a device that has never
    // opened the BIOS screen is in — and the reader has to be able to say so.
    assert.deepEqual(await cache.platforms(), [platform])
    assert.equal(await cache.firmware(), null)

    await cache.saveFirmware({ 3: [] })
    assert.deepEqual(await cache.firmware(), { 3: [] })
    assert.deepEqual(await cache.platforms(), [platform])
  })

  test('refreshing the platforms leaves the firmware alone', async () => {
    const cache = new OfflineCache(scratch(), server().client)
    await cache.saveFirmware({ 3: [] })

    // The whole reason the two are separate files: this happens on every
    // start-up, and the firmware behind it is a request per platform.
    await cache.savePlatforms([platform])

    assert.deepEqual(await cache.firmware(), { 3: [] })
  })
})

describe('serving a cached asset back', () => {
  test('the type comes off the name, so an SVG is not sent as a JPEG', () => {
    assert.equal(contentTypeOf('abc.svg'), 'image/svg+xml')
    assert.equal(contentTypeOf('abc.png'), 'image/png')
    assert.equal(contentTypeOf('abc.webp'), 'image/webp')
    // What RomM serves most of, and the answer for anything unrecognised.
    assert.equal(contentTypeOf('abc.jpg'), 'image/jpeg')
    assert.equal(contentTypeOf('abc'), 'image/jpeg')
  })

  test('a cover asked for under a new stamp is not answered with the old one', async () => {
    const stamped = (ts: string): string =>
      `/assets/romm/resources/roms/1/7/cover/small.webp?ts=${ts}`
    const cache = new OfflineCache(scratch(), server({ [stamped('one')]: 'the cover' }).client)

    await cache.save(rom({ path_cover_small: stamped('one') }), 'genesis')

    // RomM stamps a resource with the ROM's `updated_at`, so a different stamp
    // is a different picture. Answering it from the copy here would serve
    // artwork the server has already replaced, for as long as the record went
    // unrefreshed — which is most of the time, for a game nobody opens.
    assert.equal(cache.assetFile(stamped('two')), null)
    assert.ok(cache.assetFile(stamped('one')))
  })

  test('a restamped path is fetched again, because the picture changed', async () => {
    const stamped = (ts: string): string =>
      `/assets/romm/resources/roms/1/7/cover/small.webp?ts=${ts}`
    const { client, asked } = server({
      [stamped('one')]: 'the old cover',
      [stamped('two')]: 'the new cover'
    })
    const cache = new OfflineCache(scratch(), client)

    await cache.save(rom({ path_cover_small: stamped('one') }), 'genesis')
    await cache.save(rom({ path_cover_small: stamped('two') }), 'genesis')

    assert.equal(readFileSync(String(cache.assetFile(stamped('two'))), 'utf8'), 'the new cover')
    assert.deepEqual(
      asked.filter((one) => one.includes('cover/small')),
      [stamped('one'), stamped('two')]
    )
  })

  test('a screenshot RomM has dropped goes with the record that named it', async () => {
    const dir = scratch()
    const shot = '/assets/romm/resources/roms/1/7/screenshots/0.jpg'
    const cover = '/assets/romm/resources/roms/1/7/cover/small.webp'
    const cache = new OfflineCache(dir, server({ [shot]: 'a shot', [cover]: 'a cover' }).client)

    await cache.save(rom(), 'genesis')
    assert.ok(cache.assetFile(shot))

    // The next scan matched the game to something else, and the screenshot is
    // no longer named. Left here it would be unreachable: `forget` deletes only
    // what the record it holds points at.
    await cache.save(rom({ merged_screenshots: [] }), 'genesis')

    assert.equal(cache.assetFile(shot), null)
    assert.ok(cache.assetFile(cover))
  })

  test('a restamped cover leaves nothing behind on the disk', async () => {
    const dir = scratch()
    const stamped = (ts: string): string =>
      `/assets/romm/resources/roms/1/7/cover/small.webp?ts=${ts}`
    const cache = new OfflineCache(
      dir,
      server({ [stamped('one')]: 'old', [stamped('two')]: 'new' }).client
    )

    await cache.save(rom({ path_cover_small: stamped('one') }), 'genesis')
    await cache.save(rom({ path_cover_small: stamped('two') }), 'genesis')
    await cache.forget(7)

    // Every rescan would otherwise leave a copy nothing names and nothing ever
    // deletes: `forget` can only remove what the record it holds points at.
    assert.deepEqual(readdirSync(join(dir, 'assets')), [])
  })

  test('two games with alike paths keep their own pictures', async () => {
    const one = '/assets/romm/resources/roms/1/7/cover/small.webp'
    const two = '/assets/romm/resources/roms/1/8/cover/small.webp'
    const cache = new OfflineCache(scratch(), server({ [one]: 'sonic', [two]: 'streets' }).client)

    await cache.save(rom(), 'genesis')
    await cache.save(rom({ id: 8, path_cover_small: two }), 'genesis')

    assert.equal(readFileSync(String(cache.assetFile(one)), 'utf8'), 'sonic')
    assert.equal(readFileSync(String(cache.assetFile(two)), 'utf8'), 'streets')
  })
})
