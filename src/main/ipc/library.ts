import type { LibrarySyncResult, RomUserStatus } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import { log } from '../log.ts'
import type { Handle } from './handler.ts'

/** The library as RomM has it, reconciled with what is on this disk. */
export function registerLibraryIpc(rommix: RomMixApp, handle: Handle): void {
  const { client, library } = rommix

  handle('library:platforms', () => client.platforms())
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

  handle('library:rom', async (id: number) => {
    await rommix.ensureEmulators()
    const rom = await client.rom(id)
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
