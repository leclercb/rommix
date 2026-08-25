import type { EmulatorState, InstalledRom } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import type { SaveTarget } from '../saves.ts'
import { RommError } from '../romm.ts'
import { t } from '../i18n.ts'

/**
 * What a call about one game has to work out before it can do anything: which
 * copy on disk it means, and which emulator is in charge of it.
 *
 * Shared because the two are the same question asked for different reasons —
 * launching needs the emulator, syncing saves needs the emulator's save tree —
 * and answering it twice, differently, is how a save ends up written where the
 * emulator that is actually running will not look for it.
 */

/** Key under which a per-system launch choice is remembered. */
export const launcherKey = (emulatorId: string, system: string): string => `${emulatorId}:${system}`

/**
 * The ROM plus everything needed to sync its saves.
 *
 * Both save buttons on the game screen need the same four things, and each
 * of the three ways this can fail — not downloaded, no emulator, emulator
 * changed — has its own message.
 */
export async function saveContext(rommix: RomMixApp, romId: number): Promise<SaveTarget> {
  const { store, client, downloads } = rommix
  // Before `installedNow`, not after: whether an entry belongs to the
  // emulator currently in charge is a question about the probe, and an
  // unprobed RomMix would answer "yes" to all of them.
  await rommix.ensureEmulators()
  const installed = downloads.installedNow(romId)
  if (!installed) {
    throw new RommError(t('error.notDownloadedForEmulator'))
  }
  const emulator = rommix.activeEmulator(installed.system)
  if (!emulator) {
    throw new RommError(t('error.noEmulatorForSystem', { system: installed.system }))
  }
  return {
    rom: await client.rom(romId),
    emulator,
    system: installed.system,
    // The file the emulator is handed, never the game directory: RetroArch
    // names its save folder after the directory the *ROM* sits in, so the
    // difference between the two is the difference between finding a save
    // and creating an empty folder beside it.
    romPath: await downloads.launchTarget(installed),
    // The same recorded choice `game:launch` honours, so the save location
    // and the emulator that wrote it can never disagree.
    variant: store.settings.systemLaunchers[launcherKey(emulator.id, installed.system)]
  }
}

/** The downloaded copy plus the emulator that is going to run it. */
export async function launchContext(
  rommix: RomMixApp,
  romId: number
): Promise<{ installed: InstalledRom; emulator: EmulatorState }> {
  const { store, downloads } = rommix
  await rommix.ensureEmulators()

  const installed = downloads.installedNow(romId)
  if (!installed) {
    throw new RommError(
      store.getInstalled(romId) ? t('error.downloadedForOther') : t('error.notDownloadedYet')
    )
  }

  const emulator = rommix.activeEmulator(installed.system)
  if (!emulator) {
    throw new RommError(t('error.noEmulatorForSystem', { system: installed.system }))
  }
  return { installed, emulator }
}
