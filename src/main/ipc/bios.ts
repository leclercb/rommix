import type { BiosProgress } from '@shared/api'
import type { BiosPlatform, BiosReport, BiosSyncResult } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import type { Handle } from './handler.ts'

/**
 * How often the bytes of the file arriving are reported to the renderer.
 *
 * The same reasoning as the download queue's own throttle: a chunk lands
 * thousands of times over a console's firmware, the bar cannot show the
 * difference between one and the next, and every message crosses IPC and
 * redraws the screen. See `PROGRESS_INTERVAL_MS` in `downloads.ts`.
 */
const PROGRESS_INTERVAL_MS = 250

/**
 * The progress of one install, on its way to the screen.
 *
 * Anything that moves the run along — a new file, a file finished — goes
 * straight out, so the count and the name are never stale. Only the byte
 * counter inside one file is held back.
 */
function biosProgress(rommix: RomMixApp): (progress: BiosProgress) => void {
  let sentAt = 0
  let sentFor: string | null = null

  return (progress) => {
    const step = `${progress.done}:${progress.fileName}`
    const now = Date.now()
    if (step === sentFor && now - sentAt < PROGRESS_INTERVAL_MS) return
    sentAt = now
    sentFor = step
    rommix.send('bios:progress', progress)
  }
}

/** What each platform needs before its games will start, and putting it there. */
export function registerBiosIpc(rommix: RomMixApp, handle: Handle): void {
  const { bios } = rommix

  handle('bios:list', async (): Promise<BiosReport> => {
    await rommix.ensureEmulators()
    return bios.report()
  })

  /** One platform's BIOS situation, for the warning on a game's page. */
  handle('bios:platform', async (platformId: number): Promise<BiosPlatform | null> => {
    await rommix.ensureEmulators()
    return bios.platformReport(platformId)
  })

  handle('bios:install', async (firmwareId: number): Promise<string> => {
    await rommix.ensureEmulators()
    return bios.install(firmwareId, biosProgress(rommix))
  })

  handle('bios:syncAll', async (platformId?: number | null): Promise<BiosSyncResult> => {
    await rommix.ensureEmulators()
    return bios.syncAll(platformId, biosProgress(rommix))
  })
}
