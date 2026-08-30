import { localize } from '@shared/i18n'
import type { LaunchChoice, LaunchResult } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import { i18n, t } from '../i18n.ts'
import { log } from '../log.ts'
import { RommError } from '../romm.ts'
import { launchContext, launcherKey, launchOptions } from './context.ts'
import type { Handle } from './handler.ts'

/** Starting a game, and stopping the emulator that is running one. */
export function registerGameIpc(rommix: RomMixApp, handle: Handle): void {
  const { store, client, library, launcher } = rommix

  /**
   * What this game can be run with.
   *
   * Asked before launching so the renderer can put the question up front rather
   * than after a failure. An emulator with one way to run the system answers
   * with a single option and nothing is asked.
   */
  handle('game:variants', async (romId: number): Promise<LaunchChoice> => {
    const { installed, emulator } = await launchContext(rommix, romId)
    const { descriptor, options, chosen } = launchOptions(rommix, emulator, installed.system)

    return {
      system: installed.system,
      emulatorId: emulator.id,
      emulatorName: emulator.name,
      // Resolved here, so the renderer is handed sentences rather than keys.
      setupNotes: (descriptor?.setupNotes ?? []).map((note) => localize(note, i18n())),
      options: options.map((option) => ({ ...option })),
      chosen
    }
  })

  handle('game:launch', async (romId: number, variant?: string): Promise<LaunchResult> => {
    const { installed, emulator } = await launchContext(rommix, romId)
    const {
      options,
      chosen: settled,
      noLauncher
    } = launchOptions(rommix, emulator, installed.system)

    // An emulator that claims the system but has no launcher here for it. Said
    // plainly and before the spawn: the alternative is a script that is not
    // there being exec'd, which surfaces as a game that does nothing.
    if (noLauncher) {
      throw new RommError(
        t('launch.launcherMissing', { emulator: emulator.name, system: installed.system })
      )
    }

    // Remembered so the question is asked once per system rather than before
    // every game.
    const key = launcherKey(emulator.id, installed.system)
    // `settled` before the descriptor's own default, and the first *usable*
    // option before neither: passing nothing would let the descriptor fall back
    // to the head of its table, which is the one row this machine may not have.
    const chosen = variant ?? settled ?? options[0]?.id
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

    rommix.send('running:state', { running: true, romId, stage: null })
    try {
      return await launcher.launch({
        rom,
        // Never `installed.path`: for a multi-file game that is the directory,
        // and an emulator can only be given a file.
        romPath: await library.launchTarget(installed),
        system: installed.system,
        emulator,
        variant: chosen,
        // Re-sent as the same "running" state it already is, so the screen has
        // one thing to read rather than two that could disagree about whether a
        // game is up.
        onStage: (stage) => rommix.send('running:state', { running: true, romId, stage })
      })
    } finally {
      rommix.send('running:state', { running: false, romId: null, stage: null })
    }
  })

  handle('running:stop', () => {
    log.info('game', 'stop requested from the interface')
    launcher.stop()
  })

  handle('running:force', () => {
    log.warn('game', 'force close requested from the interface')
    launcher.stop(true)
  })
}
