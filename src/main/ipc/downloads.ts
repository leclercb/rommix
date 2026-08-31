import type { DownloadItem } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import type { Handle } from './handler.ts'

/** The transfer queue, and the copies it has already put on disk. */
export function registerDownloadIpc(rommix: RomMixApp, handle: Handle): void {
  const { client, downloads, library } = rommix

  /**
   * The queue, with whatever was interrupted put back into it first.
   *
   * Restored on the way past rather than at start-up: the transfers only matter
   * once something is looking at them, and this is the call every screen that
   * shows them makes.
   */
  handle('downloads:list', async () => {
    await downloads.restorePending()
    return downloads.items
  })

  handle('downloads:start', async (romId: number): Promise<DownloadItem> => {
    // Probe first so an emulator installed since startup is seen.
    await rommix.ensureEmulators()
    const rom = await client.rom(romId)

    // Check the disk before queueing anything. Without this, a game RomMix has
    // simply not noticed yet gets downloaded again over the copy already there.
    await library.adopt([rom])
    // Deliberately the emulator-aware view: a copy downloaded for an emulator
    // this platform no longer uses is not one the user can play, so it must
    // not short-circuit the download that would put a copy where it now goes.
    const existing = library.installedNow(romId)
    if (existing) {
      return {
        romId,
        name: rom.name ?? rom.fs_name,
        coverPath: rom.path_cover_small ?? rom.path_cover_large,
        system: existing.system,
        platformName: rom.platform_display_name,
        state: 'done',
        receivedBytes: existing.sizeBytes,
        totalBytes: existing.sizeBytes,
        error: null
      }
    }

    return downloads.enqueue(rom)
  })

  handle('downloads:promote', (romId: number) => downloads.promote(romId))
  handle('downloads:pause', (romId: number) => downloads.pause(romId))
  handle('downloads:cancel', (romId: number) => downloads.cancel(romId))
  handle('downloads:clearFinished', () => downloads.clearFinished())
  handle('downloads:uninstall', (romId: number) => library.uninstall(romId))
}
