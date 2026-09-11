import type { BiosProgress } from '@shared/api'
import type { BiosPlatform, BiosReport, BiosSyncResult } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import type { Handle } from './handler.ts'
import { throttledProgress } from './progress.ts'

/** The progress of one install, on its way to the firmware screen. */
const biosProgress = (rommix: RomMixApp): ((progress: BiosProgress) => void) =>
  throttledProgress<BiosProgress>(rommix, 'bios:progress')

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
