import type { LibrarySyncResult, RommPlatform, RomUserStatus } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import { log } from '../log.ts'
import { refusedUs } from '../romm/index.ts'
import { romFor } from './context.ts'
import type { Handle } from './handler.ts'

/** The library as RomM has it, reconciled with what is on this disk. */
export function registerLibraryIpc(rommix: RomMixApp, handle: Handle): void {
  const { client, library } = rommix

  /**
   * The platforms on the server, or the last list it gave.
   *
   * Three screens are built on this list and only one of them is about the
   * server: which emulator runs each platform, which BIOS files are in place,
   * and the library narrowed to one console. Refusing all three because the
   * server is not answering makes an unreachable RomM look like a broken
   * RomMix. See `OfflineCache`.
   */
  handle('library:platforms', async (): Promise<RommPlatform[]> => {
    try {
      const platforms = await client.platforms()
      await rommix.offline.savePlatforms(platforms)
      return platforms
    } catch (cause) {
      // Not for a refusal: three screens drawn from a saved list would hide a
      // token that RomM has stopped accepting. See `refusedUs`.
      const held = refusedUs(cause) ? null : await rommix.offline.platforms()
      if (!held) throw cause
      log.info('library', 'the server did not answer, using the platforms it last listed', {
        count: held.length,
        reason: (cause as Error).message
      })
      return held
    }
  })
  /**
   * How many games each platform holds for a search term.
   *
   * A platform's own `rom_count` is the whole of it, which stops being the
   * answer the moment anything narrows the library — so the chips that carry
   * that number ask for it again. See `romCounts`.
   */
  handle('library:platformCounts', (platformIds: number[], search: string) =>
    client.romCounts(platformIds, search)
  )
  handle('library:collections', () => client.collections())
  handle('library:virtualCollections', () => client.virtualCollections())
  /**
   * The library, reconciled with the disk on the way past.
   *
   * A ROM already sitting where RomMix would install it counts as downloaded
   * even if nothing in the index says so — which is what keeps moving the
   * RomMix folder, or restoring it, from making a full library look empty.
   */
  handle('library:roms', async (query) => {
    await rommix.ensureEmulators()
    const page = await client.roms(query ?? {})
    await library.adopt(page.items)
    return page
  })

  /**
   * One game, from the server or from what was written down when it arrived.
   *
   * The game screen is the one screen that has to work for a game already on
   * this disk with nothing to ask — it is where Play is — so a server that does
   * not answer falls back to the copy saved at install time rather than putting
   * an error where the game goes. See `OfflineCache`.
   *
   * A successful answer is written down again on the way past, for an installed
   * game: it is the newer copy, the artwork it names is already cached, and it
   * is what keeps the offline view of a rescanned game from ageing.
   */
  handle('library:rom', async (id: number) => {
    await rommix.ensureEmulators()
    const rom = await romFor(rommix, id)
    // Harmless on the saved copy: a record only exists for a game that is
    // already in the index, which is the first thing adoption passes over.
    await library.adopt([rom])
    return rom
  })
  handle('library:favourite', (romId: number) => client.isFavourite(romId))
  handle('library:setCollection', (romId: number, collectionId: number, member: boolean) =>
    client.setCollectionMembership(collectionId, romId, member)
  )
  handle('library:setFavourite', (romId: number, favourite: boolean) =>
    client.setFavourite(romId, favourite)
  )
  handle('library:setStatus', (romId: number, status: RomUserStatus | null) =>
    client.setStatus(romId, status)
  )
  handle('library:installed', async () => {
    // The probe decides which entries belong to the emulator now in charge, so
    // answering before it has run would report every stale copy as present —
    // which is exactly what this call is asked first, on startup.
    await rommix.ensureEmulators()
    return library.installed
  })

  /**
   * The sizes of this game's files as they are on this disk.
   *
   * Separate from `library:installed`, which carries one total per game: the
   * files screen lists them one by one, and the copy on this device is the
   * only side that can answer for a file the server has never had.
   */
  handle('library:files', (romId: number) => library.localFiles(romId))

  /**
   * Check the whole library against the disk, rather than only the ROMs a
   * screen has loaded. Reports progress because a large library takes a while
   * and a frozen button is indistinguishable from a broken one.
   */
  handle('library:sync', async (): Promise<LibrarySyncResult> => {
    await rommix.ensureEmulators()
    const took = log.since()
    const result = await library.sync((checked, total) =>
      rommix.send('library:syncProgress', { checked, total })
    )
    rommix.send('library:installed', library.installed)
    log.info('library', 'full sync finished', { ...result, ms: took() })
    return result
  })
}
