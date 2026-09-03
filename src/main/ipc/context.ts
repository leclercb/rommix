import { emulatorById } from '@config/emulators'
import type { EmulatorDescriptor, LaunchVariant } from '@config/emulators'
import type { EmulatorState, InstalledRom, RommRom } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import type { SaveTarget } from '../saves.ts'
import { usableVariants } from '../emulators.ts'
import { log } from '../log.ts'
import { refusedUs, RommError } from '../romm/index.ts'
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

/** What this emulator can run a system with here, and what has been settled on. */
export interface LaunchOptions {
  descriptor: EmulatorDescriptor | null
  /** Only the variants that survived the probe — see `usableVariants`. */
  options: readonly LaunchVariant[]
  /** The recorded choice, or null when there is none to honour. */
  chosen: string | null
  /**
   * True when the descriptor offers ways to run this system and none of them
   * are on the machine — distinct from an emulator with no variants at all,
   * which is most of them and is not a problem.
   */
  noLauncher: boolean
}

/**
 * The launch options for one system, resolved once.
 *
 * Shared for the same reason the rest of this file is: the picker, the launch
 * and the save path all have to reach the same answer. Asked separately, the
 * screen offers three Switch emulators, the launch runs a fourth that is only
 * in the table, and the save is filed under a fifth.
 *
 * A recorded choice is honoured only while it is still one of the options. When
 * its launcher has gone the answer is null rather than a substitute: the user
 * is asked again, which is the same treatment `resolveEmulator` gives an
 * emulator that has been uninstalled.
 */
export function launchOptions(
  rommix: RomMixApp,
  emulator: EmulatorState,
  system: string
): LaunchOptions {
  const descriptor = emulatorById(emulator.id)
  const options = descriptor ? usableVariants(descriptor, system, emulator.install) : []
  const recorded = rommix.store.settings.systemLaunchers[launcherKey(emulator.id, system)]
  return {
    descriptor,
    options,
    chosen: options.some((option) => option.id === recorded) ? recorded : null,
    noLauncher: options.length === 0 && (descriptor?.variants?.(system).length ?? 0) > 0
  }
}

/**
 * The ROM as RomM has it, or as this device wrote it down when it arrived.
 *
 * Every call about a game that is already on this disk goes through here, which
 * is what makes those calls survive a network that is not there: launching one
 * needs its name and its files, and both were written down at install time
 * precisely so the game could be started away from the server. See
 * `OfflineCache`.
 *
 * The server first, always, because it is the copy that can have changed — a
 * game rescanned, renamed, or matched to different artwork. The cache is the
 * fallback and never the preference.
 *
 * A live answer for a game that is on this disk is written down on the way
 * past, which is the whole of when the saved copy is refreshed: install time,
 * and every time afterwards that something asks the server about a game it
 * already has. That is deliberately not a sweep of the library on every
 * reconnect — a thousand games is a thousand requests for records that were
 * right when they were written — but it does mean the games actually opened
 * and played, which are the ones that matter away from the network, keep an
 * answer no older than the last time they were touched with a server present.
 * Costs a small local write, since the artwork is only fetched when it has
 * changed.
 */
export async function romFor(rommix: RomMixApp, romId: number): Promise<RommRom> {
  let rom: RommRom
  try {
    rom = await rommix.client.rom(romId)
  } catch (cause) {
    // Never for a request RomM turned down. An expired token answers 401, and
    // a game screen served from the cache would work perfectly while the rest
    // of the app was on its way to the sign-in form. Everything else — nothing
    // answered, a proxy in the way, a game the server has since deleted — is a
    // game that is still on this disk and still worth showing.
    const cached = refusedUs(cause) ? null : await rommix.offline.game(romId)
    if (!cached) throw cause
    log.info('game', 'the server did not answer, using the copy saved at install time', {
      romId,
      reason: (cause as Error).message
    })
    return cached
  }

  const installed = rommix.library.installedNow(romId)
  if (installed) {
    await rommix.library.remember(rom, installed.system).catch((cause: Error) =>
      log.debug('game', 'could not write the game down again', {
        romId,
        reason: cause.message
      })
    )
  }
  return rom
}

/**
 * The ROM plus everything needed to sync its saves.
 *
 * Both save buttons on the game screen need the same four things, and each
 * of the three ways this can fail — not downloaded, no emulator, emulator
 * changed — has its own message.
 */
export async function saveContext(rommix: RomMixApp, romId: number): Promise<SaveTarget> {
  const { library } = rommix
  // Before `installedNow`, not after: whether an entry belongs to the
  // emulator currently in charge is a question about the probe, and an
  // unprobed RomMix would answer "yes" to all of them.
  await rommix.ensureEmulators()
  const installed = library.installedNow(romId)
  if (!installed) {
    throw new RommError(t('error.notDownloadedForEmulator'))
  }
  const emulator = rommix.activeEmulator(installed.system)
  if (!emulator) {
    throw new RommError(t('error.noEmulatorForSystem', { system: installed.system }))
  }
  return {
    rom: await romFor(rommix, romId),
    emulator,
    system: installed.system,
    // The file the emulator is handed, never the game directory: RetroArch
    // names its save folder after the directory the *ROM* sits in, so the
    // difference between the two is the difference between finding a save
    // and creating an empty folder beside it.
    romPath: await library.launchTarget(installed),
    // The same choice `game:launch` honours, resolved the same way, so the save
    // location and the emulator that wrote it can never disagree — including
    // when the recorded one has since been uninstalled.
    variant: launchOptions(rommix, emulator, installed.system).chosen ?? undefined
  }
}

/** The downloaded copy plus the emulator that is going to run it. */
export async function launchContext(
  rommix: RomMixApp,
  romId: number
): Promise<{ installed: InstalledRom; emulator: EmulatorState }> {
  const { store, library } = rommix
  await rommix.ensureEmulators()

  const installed = library.installedNow(romId)
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
