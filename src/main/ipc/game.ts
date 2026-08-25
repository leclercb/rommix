import { emulatorById, launchVariants } from '@config/emulators'
import { localize } from '@shared/i18n'
import type { LaunchChoice, LaunchResult } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import { i18n } from '../i18n.ts'
import { log } from '../log.ts'
import { launchContext, launcherKey } from './context.ts'
import type { Handle } from './handler.ts'

/** Starting a game, and stopping the emulator that is running one. */
export function registerGameIpc(rommix: RomMixApp, handle: Handle): void {
  const { store, client, downloads, launcher } = rommix

  /**
   * What this game can be run with.
   *
   * Asked before launching so the renderer can put the question up front rather
   * than after a failure. An emulator with one way to run the system answers
   * with a single option and nothing is asked.
   */
  handle('game:variants', async (romId: number): Promise<LaunchChoice> => {
    const { installed, emulator } = await launchContext(rommix, romId)
    const descriptor = emulatorById(emulator.id)
    const options = descriptor ? launchVariants(descriptor, installed.system) : []
    const recorded = store.settings.systemLaunchers[launcherKey(emulator.id, installed.system)]

    return {
      system: installed.system,
      emulatorId: emulator.id,
      emulatorName: emulator.name,
      // Resolved here, so the renderer is handed sentences rather than keys.
      setupNotes: (descriptor?.setupNotes ?? []).map((note) => localize(note, i18n())),
      options: options.map((option) => ({ ...option })),
      // A recorded choice that no longer exists is reported as unanswered, so
      // the user is asked again rather than being launched into something else.
      chosen: options.some((option) => option.id === recorded) ? recorded : null
    }
  })

  handle('game:launch', async (romId: number, variant?: string): Promise<LaunchResult> => {
    const { installed, emulator } = await launchContext(rommix, romId)

    // Remembered so the question is asked once per system rather than before
    // every game.
    const key = launcherKey(emulator.id, installed.system)
    const chosen = variant ?? store.settings.systemLaunchers[key]
    if (variant && variant !== store.settings.systemLaunchers[key]) {
      store.updateSettings({
        systemLaunchers: { ...store.settings.systemLaunchers, [key]: variant }
      })
    }

    const rom = await client.rom(romId)

    log.info('game', 'launch requested', {
      romId,
      name: rom.name ?? rom.fs_name,
      system: installed.system,
      emulator: emulator.id,
      variant: chosen ?? null
    })

    rommix.send('game:state', { running: true, romId, stage: null })
    try {
      return await launcher.launch({
        rom,
        // Never `installed.path`: for a multi-file game that is the directory,
        // and an emulator can only be given a file.
        romPath: await downloads.launchTarget(installed),
        system: installed.system,
        emulator,
        variant: chosen,
        // Re-sent as the same "running" state it already is, so the screen has
        // one thing to read rather than two that could disagree about whether a
        // game is up.
        onStage: (stage) => rommix.send('game:state', { running: true, romId, stage })
      })
    } finally {
      rommix.send('game:state', { running: false, romId: null, stage: null })
    }
  })

  handle('game:stop', () => {
    log.info('game', 'stop requested from the interface')
    launcher.stop()
  })
}
