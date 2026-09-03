import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { PLATFORM_ICON_PATHS, systemInfo } from '@config/systems'
import type { InstalledRom, RommFirmware, RommPlatform, RommRom } from '@shared/types'
import { log } from './log.ts'
import { answered } from './romm/index.ts'
import type { RommClient } from './romm/index.ts'

/**
 * What RomM last said, kept for the times it cannot be asked again.
 *
 * The index in `Store` records enough to draw a row — a name, a cover path, the
 * platform — because the Downloads screen never fetches the library. Everything
 * else about a game is the server's, which is why a handheld off the network
 * could not open the game screen for a ROM sitting on its own SSD, and could
 * not launch it either: `game:launch` asks RomM for the ROM before it does
 * anything, and the launcher and the save sync are handed that answer.
 *
 * So the answer is written down at install time — the whole `RommRom`, and the
 * pictures RomMix would otherwise fetch over `rommix-img://` — and read back
 * when the server cannot be reached. Kept apart from the index because the two
 * are answering different questions: the index is what is on the disk, this is
 * what RomM knew about it, and only one of them is RomMix's own.
 *
 * The platform list and the firmware behind it are here for the same reason and
 * on different terms. They belong to the server rather than to any one game, so
 * they are written whole whenever a live answer arrives, and they are what lets
 * three screens that are entirely about this machine — the emulator each
 * platform runs on, which BIOS files are in place, the library narrowed to one
 * console — stop being about the server as well.
 */

/** The artwork that belongs to one game, in the order it is most wanted. */
function artworkOf(rom: RommRom): string[] {
  return [rom.path_cover_small, rom.path_cover_large, ...rom.merged_screenshots].filter(
    (path): path is string => Boolean(path)
  )
}

/**
 * Every path the console's icon could be served from.
 *
 * The same cascade `SystemIcon` walks in the renderer — RomM's platform slug,
 * the curated Systematic name, the ES-DE system id, each under both icon
 * directories — because whichever of them answers is the one an `<img>` will
 * ask for later. Most of them 404, which is what the cascade is for.
 */
function iconsFor(slug: string, system: string): string[] {
  const names = [...new Set([slug, systemInfo(system).icon, system])]
  return names.flatMap((name) => PLATFORM_ICON_PATHS.map((path) => path.replace('{name}', name)))
}

/** A RomM path with its query removed, which is where the extension is. */
function withoutQuery(path: string): string {
  const at = path.indexOf('?')
  return at === -1 ? path : path.slice(0, at)
}

/**
 * A cached asset's file name: the whole RomM path hashed, with its extension.
 *
 * Hashed rather than mirrored, because these paths are the server's and a
 * folder tree built from them is a folder tree built from somebody else's
 * strings. The extension is carried through so the file is still recognisable
 * on disk and the protocol handler has a content type to answer with.
 *
 * The query is part of the key and not noise, however much `?ts=` looks like a
 * cache-buster: RomM stamps a resource with the ROM's own `updated_at`, so it
 * changes when and only when the picture behind the path does. Keyed without
 * it, a cover replaced on the server would go on being served from this disk
 * until something happened to rewrite the game's record. Keyed with it, the
 * grid asks under the new stamp, misses, and fetches the picture it asked for.
 */
function fileNameFor(path: string): string {
  const digest = createHash('sha1').update(path).digest('hex')
  const extension = extname(withoutQuery(path))
  return extension ? `${digest}${extension}` : digest
}

/** Content type for a cached asset, by extension. */
export function contentTypeOf(file: string): string {
  switch (extname(file).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.svg':
      return 'image/svg+xml'
    case '.avif':
      return 'image/avif'
    default:
      return 'image/jpeg'
  }
}

/** Firmware as the server listed it, by the platform id it was asked for. */
export type FirmwareByPlatform = Record<number, RommFirmware[]>

export class OfflineCache {
  private readonly games: string
  private readonly assets: string
  private readonly platformsPath: string
  private readonly firmwarePath: string
  /**
   * Assets the server has already been asked for and does not have.
   *
   * Every game carries a cascade of icon candidates and most of them 404 — the
   * same handful per platform, for every game on it. A miss is remembered for
   * the session so that back-filling a library of five hundred games does not
   * ask five hundred times. Only a definite miss: a request that failed because
   * nothing answered is worth making again the moment something does.
   */
  private readonly missing = new Set<string>()

  constructor(
    private readonly dir: string,
    private readonly client: RommClient
  ) {
    this.games = join(dir, 'games')
    this.assets = join(dir, 'assets')
    this.platformsPath = join(dir, 'platforms.json')
    this.firmwarePath = join(dir, 'firmware.json')
  }

  /** Where what RomM said about a game is written. */
  private gamePath(romId: number): string {
    return join(this.games, `${romId}.json`)
  }

  /** Where a RomM asset path is cached, whether or not anything is there. */
  private assetPath(path: string): string {
    return join(this.assets, fileNameFor(path))
  }

  /**
   * Write down everything about a game, and fetch the pictures that go with it.
   *
   * Throws when the server could not be reached, so a caller back-filling a
   * library knows the game still has to be done. A picture the server answers
   * for with a 404 is not that: most of the icon candidates are misses by
   * design, and a game whose cover RomM never had is complete without one.
   */
  async save(rom: RommRom, system: string): Promise<void> {
    // What was last written about this game, for the one thing the paths alone
    // cannot say: whether the picture behind one of them has changed.
    const previous = await this.game(rom.id)

    /**
     * Artwork the last record named and this one does not.
     *
     * Two things arrive as the same fact. A screenshot RomM has since dropped
     * is gone for good, and nothing else will ever name the file it left here —
     * `forget` deletes what the *current* record points at, so a copy that fell
     * out of the record before the game was uninstalled is a copy nothing can
     * reach. And a cover RomM has restamped is the same path under a new
     * `?ts=`, which the cache keys alike on purpose: the file has to go before
     * it can be fetched again, or the loop below would find it already here and
     * keep serving the old picture.
     */
    const current = artworkOf(rom)
    for (const path of previous ? artworkOf(previous) : []) {
      if (!current.includes(path)) await rm(this.assetPath(path), { force: true })
    }

    for (const path of [...current, ...iconsFor(rom.platform_slug, system)]) {
      await this.fetchAsset(path)
    }

    /**
     * The record last, once the pictures it names are here.
     *
     * `has` tests for this file and nothing else, and it is what decides
     * whether a game still needs writing down. Written first, a fetch that
     * threw part-way would leave a record that looks finished with half its
     * artwork missing, and nothing would ever come back for the rest — the
     * game would read as done and be blank the day it mattered.
     */
    await mkdir(this.games, { recursive: true })
    await writeAtomic(this.gamePath(rom.id), JSON.stringify(rom))
  }

  /**
   * Throw away everything here that nothing on this disk still points at.
   *
   * `save` and `forget` between them keep the store correct as long as the
   * records are; this is what makes it correct when they are not. A record
   * truncated by a crash mid-write names nothing and so deletes nothing on
   * uninstall, and a folder restored from a backup taken at a different moment
   * can hold either half of the pair. Neither leaves anything that reads as
   * wrong — the cost is silent and cumulative, which is exactly the kind of
   * thing nobody ever goes looking for.
   *
   * Answered from the installed index rather than from the records here, so
   * this can also drop a game the index has never heard of. Every stale entry
   * counts: a game downloaded under a different emulator is still on the disk
   * and still worth its cover, which is why this takes the whole index and not
   * `Library.installed`.
   */
  async sweep(installed: readonly InstalledRom[]): Promise<{ games: number; assets: number }> {
    const here = new Set(installed.map((entry) => entry.romId))
    const wanted = new Set<string>()
    let games = 0

    for (const file of await readdir(this.games).catch(() => [])) {
      const romId = Number(file.replace(/\.json$/, ''))
      const known = Number.isInteger(romId) && here.has(romId)
      if (!known) {
        await rm(join(this.games, file), { force: true })
        games += 1
        continue
      }

      const rom = await this.game(romId)
      if (!rom) continue
      for (const path of artworkOf(rom)) wanted.add(fileNameFor(path))
      // The console's icon belongs to the platform rather than to this game, so
      // it survives as long as any one game on the platform does.
      const system = installed.find((entry) => entry.romId === romId)?.system ?? ''
      for (const path of iconsFor(rom.platform_slug, system)) wanted.add(fileNameFor(path))
    }

    let assets = 0
    for (const file of await readdir(this.assets).catch(() => [])) {
      if (wanted.has(file)) continue
      await rm(join(this.assets, file), { force: true })
      assets += 1
    }

    if (games > 0 || assets > 0) {
      log.info('offline', 'dropped what nothing points at any more', { games, assets })
    }
    return { games, assets }
  }

  /** The platforms as the server last listed them. */
  async savePlatforms(platforms: readonly RommPlatform[]): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeAtomic(this.platformsPath, JSON.stringify({ platforms }))
  }

  /** That list, or null where the server has never answered here. */
  async platforms(): Promise<RommPlatform[] | null> {
    const held = await this.read<{ platforms?: RommPlatform[] }>(this.platformsPath)
    return Array.isArray(held?.platforms) ? held.platforms : null
  }

  /**
   * The firmware the server holds, by the platform id it was asked for.
   *
   * Written only when every platform answered — see `BiosManager.serverHalf`.
   * A half-captured map is worse than none: a platform with an empty entry is
   * indistinguishable from one the server holds nothing for, and the BIOS
   * screen would report files as missing from a server nobody managed to ask.
   */
  async saveFirmware(firmware: FirmwareByPlatform): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeAtomic(this.firmwarePath, JSON.stringify({ firmware }))
  }

  /** That map, or null where it has never been captured. */
  async firmware(): Promise<FirmwareByPlatform | null> {
    const held = await this.read<{ firmware?: FirmwareByPlatform }>(this.firmwarePath)
    return held?.firmware ?? null
  }

  /** One of RomMix's own JSON files, or null where there is not one yet. */
  private async read<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T
    } catch {
      // Never written, or not finished being written. Both mean the server is
      // the only place this answer can come from.
      return null
    }
  }

  /** Is this game written down already? */
  has(romId: number): boolean {
    return existsSync(this.gamePath(romId))
  }

  /** The stored `RommRom`, or null where the game was never cached. */
  async game(romId: number): Promise<RommRom | null> {
    try {
      return JSON.parse(await readFile(this.gamePath(romId), 'utf8')) as RommRom
    } catch {
      // Nothing cached, or a file RomMix did not finish writing. Both mean the
      // server is the only place this answer can come from.
      return null
    }
  }

  /** The cached copy of a RomM asset, or null when there is none. */
  assetFile(path: string): string | null {
    const file = this.assetPath(path)
    return existsSync(file) ? file : null
  }

  /**
   * Drop what was written about a game, and the artwork only it was using.
   *
   * RomM keys a game's resources by its own id — `.../roms/<platform>/<rom>/…` —
   * so a cover or a screenshot belongs to exactly one game and goes with it.
   * The console icons cached beside them do not: they are shared by every game
   * on the platform, they are a few kilobytes each, and there are only as many
   * of them as there are consoles.
   */
  async forget(romId: number): Promise<void> {
    const rom = await this.game(romId)
    for (const path of rom ? artworkOf(rom) : []) {
      await rm(this.assetPath(path), { force: true })
    }
    await rm(this.gamePath(romId), { force: true })
  }

  /** Fetch one asset unless it is already here, or known not to exist. */
  private async fetchAsset(path: string): Promise<void> {
    if (this.missing.has(path)) return
    const file = this.assetPath(path)
    if (existsSync(file)) return

    const response = await this.client.asset(path)
    if (!response.ok) {
      this.missing.add(path)
      log.debug('offline', 'the server has no such asset', { path, status: response.status })
      return
    }

    await mkdir(this.assets, { recursive: true })
    await writeAtomic(file, Buffer.from(await response.arrayBuffer()))
  }
}

/**
 * Write down every installed game that has nothing written down yet.
 *
 * Deliberately not a migration, though it began as one: a migration is recorded
 * the first time it finishes and never runs again, and the gap this closes
 * opens continually. A download that lands as the network drops keeps its index
 * entry and fails to save its record; so does a game adopted off the disk while
 * out of range. Both would then show on "Ready to play" and have nothing behind
 * them — the one case the whole feature exists for.
 *
 * Cheap enough to run on every connected start: one `existsSync` per installed
 * game, and a request only for the ones with nothing. A game the server has
 * since deleted is passed over rather than retried forever; a server that stops
 * answering ends the pass, since nothing after it will answer either.
 */
export async function rememberInstalledGames(
  installed: readonly InstalledRom[],
  fetch: (romId: number) => Promise<RommRom>,
  cache: OfflineCache
): Promise<void> {
  const wanted = installed.filter((entry) => !cache.has(entry.romId))
  if (wanted.length === 0) return

  log.info('offline', 'writing down what RomM knows about games that had nothing', {
    count: wanted.length
  })

  let skipped = 0
  for (const entry of wanted) {
    try {
      await cache.save(await fetch(entry.romId), entry.system)
    } catch (cause) {
      if (!answered(cause)) {
        log.info('offline', 'the server stopped answering, leaving the rest for next time', {
          done: wanted.indexOf(entry),
          left: wanted.length - wanted.indexOf(entry),
          reason: (cause as Error).message
        })
        return
      }
      // The server has an opinion and it is no. Nothing here can act on it —
      // the game is on the disk either way — so it is noted and passed over.
      skipped += 1
      log.warn('offline', 'the server would not describe an installed game', {
        romId: entry.romId,
        name: entry.name,
        reason: (cause as Error).message
      })
    }
  }
  if (skipped > 0) log.info('offline', 'games the server could not describe', { skipped })
}

/** Written aside and renamed, so an interrupted write cannot leave half a file. */
async function writeAtomic(path: string, contents: string | Buffer): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, contents)
  await rename(tmp, path)
}
