import { localize } from '@shared/i18n'
import { rommPlayers } from '@config/rommplayer'
import type { LaunchChoice, LaunchResult, RommPlayer, RommPlayers, RommRom } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import { i18n, t } from '../i18n.ts'
import { log } from '../log.ts'
import { RommError } from '../romm/index.ts'
import { shouldRefreshAchievements } from '../retroachievements.ts'
import { launchContext, launcherKey, launchOptions, romFor } from '../gamecontext.ts'
import type { Handle } from './handler.ts'

/** Starting a game, and stopping the emulator that is running one. */
export function registerGameIpc(rommix: RomMixApp, handle: Handle): void {
  const { store, library, launcher } = rommix

  /**
   * What this game can be run with.
   *
   * Asked before launching so the renderer can put the question up front rather
   * than after a failure. An emulator with one way to run the system answers
   * with a single option and nothing is asked.
   */
  handle('game:variants', async (romId: number): Promise<LaunchChoice> => {
    const { installed, emulator } = await launchContext(rommix, romId)
    const { descriptor, options, chosen, ask } = launchOptions(rommix, emulator, installed.system)

    return {
      system: installed.system,
      emulatorId: emulator.id,
      emulatorName: emulator.name,
      // Resolved here, so the renderer is handed sentences rather than keys.
      setupNotes: (descriptor?.setupNotes ?? []).map((note) => localize(note, i18n())),
      options: options.map((option) => ({ ...option })),
      chosen,
      ask
    }
  })

  handle('game:launch', async (romId: number, variant?: string): Promise<LaunchResult> => {
    const { installed, emulator } = await launchContext(rommix, romId)
    const { effective, noLauncher } = launchOptions(rommix, emulator, installed.system)

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
    // What was asked for, then what a launch resolves to by itself — which is
    // the recorded choice, or the first *usable* option. Passing nothing would
    // let the descriptor fall back to the head of its table, the one row this
    // machine may not have. `saveContext` reads the same field.
    const chosen = variant ?? effective
    if (variant && variant !== store.settings.systemLaunchers[key]) {
      store.updateSettings({
        systemLaunchers: { ...store.settings.systemLaunchers, [key]: variant }
      })
    }

    const rom = await romFor(rommix, romId)

    log.info('game', 'launch requested', {
      romId,
      name: rom.name ?? rom.fs_name,
      system: installed.system,
      emulator: emulator.id,
      variant: chosen ?? null
    })

    rommix.send('running:state', { running: true, romId, stage: null })
    try {
      const result = await launcher.launch({
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

      await refreshAchievements(rommix, rom)
      return result
    } finally {
      rommix.send('running:state', { running: false, romId: null, stage: null })
    }
  })

  /**
   * Which of RomM's own players can run this game, for the buttons beside Play.
   *
   * Nothing offered where the server cannot be asked: a button that opens a
   * page RomM is not there to serve is a dead end, and so is one for a player
   * the server switched off.
   */
  handle('game:rommPlayers', async (platformSlug: string): Promise<RommPlayers> => {
    if (typeof platformSlug !== 'string') return { browser: false, stream: false }
    const [emulation, streaming] = await Promise.all([
      rommix.client.emulation().catch(unanswered('emulation')),
      rommix.client.streamingConfig().catch(unanswered('streaming'))
    ])
    return rommPlayers(platformSlug, emulation, streaming)
  })

  /**
   * Play on RomM rather than here: its in-browser player, or a stream from an
   * emulator the server runs. Announced as a running game, so the overlay
   * behind the player is the way back — see `RommPlayerWindow`.
   */
  handle('game:playOnRomm', async (romId: number, player: RommPlayer): Promise<void> => {
    // Renderer input, narrowed rather than trusted: it decides which page opens.
    const kind: RommPlayer = player === 'stream' ? 'stream' : 'browser'
    rommix.send('running:state', { running: true, romId, stage: null })
    try {
      await rommix.player.play(romId, kind)
    } finally {
      rommix.send('running:state', { running: false, romId: null, stage: null })
    }
  })

  handle('running:stop', () => {
    log.info('game', 'stop requested from the interface')
    if (rommix.player.isOpen) rommix.player.leave()
    else launcher.stop()
  })

  handle('running:force', () => {
    log.warn('game', 'force close requested from the interface')
    if (rommix.player.isOpen) rommix.player.forceClose()
    else launcher.stop(true)
  })
}

/**
 * Have RomM look at RetroAchievements again, now that a session has ended.
 *
 * Here rather than in `Launcher`, which accounts for the session itself and
 * knows nothing about who is signed in — and the answer has to reach the
 * screen, which is this side of the bridge.
 *
 * The new status is pushed rather than left for the watch to find: `settle`
 * announces a change of *shape* — connected, offline, configured — and what
 * changed here is inside a status that still says exactly what it said before.
 *
 * Best effort throughout, like the play session it follows. Nothing here is
 * worth failing a launch that has already happened over, and a server that
 * refused is a tab that is as right as it was a minute ago.
 */
async function refreshAchievements(rommix: RomMixApp, rom: RommRom): Promise<void> {
  const user = rommix.connection.current?.user ?? null
  if (!user || !shouldRefreshAchievements(rom, user)) return

  try {
    await rommix.client.refreshAchievements(user.id)
    rommix.send('server:status', await rommix.connection.refresh())
  } catch (cause) {
    log.warn('game', 'could not refresh RetroAchievements', {
      romId: rom.id,
      reason: (cause as Error).message
    })
  }
}

/** A question the server did not answer, logged and taken as "nothing offered". */
function unanswered(subject: string): (cause: unknown) => null {
  return (cause) => {
    log.info('game', `could not ask RomM about ${subject}`, { reason: (cause as Error).message })
    return null
  }
}
