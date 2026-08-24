import type { UpdateStatus } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import type { Handle } from './handler.ts'

/**
 * RomMix's own version: what is published, fetching it, and restarting into it.
 *
 * Three verbs rather than one "update now", because the three are separately
 * refusable and separately interesting. Checking is cheap and safe. Downloading
 * is a hundred megabytes, which on a metered connection is a decision. And
 * restarting closes whatever is on screen, so it is never anything but an
 * explicit press — the `auto` policy stops after the file is in place, and the
 * new version starts the next time RomMix does.
 */
export function registerUpdateIpc(rommix: RomMixApp, handle: Handle): void {
  const { updates } = rommix

  handle('update:status', (): UpdateStatus => updates.status)

  /**
   * Check now, whatever the policy says.
   *
   * Offered even with automatic checks off: that setting is about RomMix
   * deciding to look, and a button the user pressed is not RomMix deciding.
   */
  handle('update:check', () => updates.check())

  handle('update:download', () => updates.download())

  handle('update:restart', () => updates.restart())
}
