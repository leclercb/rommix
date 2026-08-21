import { spawn } from 'node:child_process'
import { emulatorById } from '@config/emulators'
import type { ResolvedInstall } from '@config/emulators'
import type { CoreProgress } from '@shared/api'
import type { EmulatorState, LaunchResult, RommRom, SavePushPreview } from '@shared/types'
import { installCore, missingCore } from './cores'
import { execPrefix, stopFlatpakApp } from './host'
import type { RommClient } from './romm'
import type { SaveSync } from './saves'
import type { Store } from './store'

/**
 * Launches a downloaded ROM and waits for it to exit.
 *
 * How to start a given emulator is the descriptor's business: this only
 * resolves the install into an argv prefix and hands it over. Everything
 * around the spawn — pulling saves down first, diffing the save directory
 * afterwards, reporting the session — is the same whichever emulator ran.
 */

interface LaunchOptions {
  rom: RommRom
  romPath: string
  system: string
  emulator: EmulatorState
  /** Which of the emulator's launch variants to use, when it offers several. */
  variant?: string
  /**
   * Told what the launch is doing while the emulator is not up yet.
   *
   * A callback rather than an event sent from here, because the launcher has no
   * window to send to; the caller that raised `game:state` is the one that can
   * put this on screen.
   */
  onStage?: (stage: string | null) => void
}

/**
 * How long after the spawn a non-zero exit is still read as "it never started".
 *
 * Emulators are not consistent about their exit code on an ordinary quit — a
 * few return non-zero after a perfectly good session — so a bare exit code
 * cannot decide this on its own. What it can be paired with is the clock: a
 * process that is gone this quickly showed the user nothing, whatever it
 * returned, and a session someone actually played lasted longer than any
 * startup failure does.
 */
const STARTUP_MS = 5000

/**
 * How the emulator's process ended.
 *
 * Two answers rather than one string, because they lead to opposite handling
 * and conflating them is what makes either one dangerous. An emulator that
 * never started has no session to account for and the launch failed. An
 * emulator that ran and then exited oddly has written save files, and treating
 * its parting complaint as a failure would abandon them unsent — the exit code
 * would cost the user the very session it was reporting on.
 */
interface ExitReport {
  /** Why the emulator never got going, or null when it ran. */
  startupError: string | null
  /** Something it complained about, worth repeating but not worth failing on. */
  warning: string | null
}

/**
 * The lines an emulator marked as its own errors, or null when it marked none.
 *
 * Emulators log their whole run, so the tail is usually shader compilation and
 * audio device names — true, and no use to anyone reading a notification. The
 * lines that say what went wrong announce themselves, and the ones here all use
 * the same few words to do it.
 */
function flaggedLines(output: string): string | null {
  const flagged = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /\berror\b|\bfatal\b/i.test(line))
    .slice(-3)
  return flagged.length ? flagged.join(' ') : null
}

/** The last of whatever the emulator said, for one that flags nothing. */
function tailOf(output: string): string | null {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
  return lines.length ? lines.join(' ') : null
}

/** The core download, as a line to put under the Play button. */
function stageFor(progress: CoreProgress): string {
  const done = `Installing the ${progress.core} core`
  if (!progress.totalBytes) return `${done}…`
  return `${done}… ${Math.round((progress.receivedBytes / progress.totalBytes) * 100)}%`
}

export class Launcher {
  /**
   * The session in progress, so a second launch can be refused.
   *
   * Claimed for the whole of `launch`, not just the spawn: a session starts by
   * pulling saves down over the network, and leaving the slot free until the
   * process exists would let a second launch run that pull concurrently and
   * open the same save files. `kill` starts as a request to abandon the session
   * before the emulator is spawned, and becomes a signal to it afterwards.
   */
  private current: { romId: number; kill: () => void; stopped: boolean } | null = null

  constructor(
    private readonly store: Store,
    private readonly client: RommClient,
    private readonly saveSync: SaveSync
  ) {}

  /** Build the argv for an emulator, or null when it cannot run this system. */
  buildCommand(options: LaunchOptions): string[] | null {
    const { emulator, system, romPath, variant } = options
    const descriptor = emulatorById(emulator.id)
    if (!descriptor || !emulator.install) return null
    return descriptor.launch({
      exec: execPrefix(emulator.install, descriptor.env),
      installRef: emulator.install.ref,
      system,
      romPath,
      variant
    })
  }

  /**
   * Sync saves down, run the game, wait for exit, then sync saves back up.
   *
   * The whole thing resolves only once the emulator has quit, which is what
   * lets us diff the save directory by modification time.
   */
  async launch(options: LaunchOptions): Promise<LaunchResult> {
    const { rom, emulator, system, romPath, variant } = options
    // Everything save sync needs to ask the descriptor where this game's data
    // lives — including which variant is running, since that is what decides
    // the answer for a frontend that offers several.
    const target = { rom, emulator, system, romPath, variant }

    const failure = (error: string, command = ''): LaunchResult => ({
      ok: false,
      emulator: emulator.id,
      command,
      error,
      uploadedSaves: 0,
      uploadedStates: 0,
      pendingPush: null,
      playSeconds: 0
    })

    if (this.current) return failure('A game is already running')

    const argv = this.buildCommand(options)
    if (!argv) {
      return failure(
        `${emulator.name} cannot run "${system}". Choose a different emulator for this ` +
          `platform in Settings, or install one that covers it.`
      )
    }
    const command = argv.join(' ')

    // Claimed before the first await, so a second launch is refused for the
    // whole session rather than only once the emulator is up. Until there is a
    // process, stopping can only be recorded as an intention.
    const session = {
      romId: rom.id,
      kill: (): void => {
        session.stopped = true
      },
      stopped: false
    }
    this.current = session

    try {
      /**
       * Install the core the emulator is about to be told to load.
       *
       * Before the save pull rather than after, because a launch that cannot
       * happen should not have moved the save files first — and this is the one
       * step that fails outright: an emulator handed a core that is not there
       * dies before it opens a window, which is not a state worth reaching on
       * purpose.
       */
      try {
        const core = await missingCore(emulator, system)
        if (core) {
          options.onStage?.(`Installing the ${core.name} core…`)
          await installCore(core, (progress: CoreProgress) => options.onStage?.(stageFor(progress)))
        }
      } catch (cause) {
        return failure((cause as Error).message, command)
      } finally {
        options.onStage?.(null)
      }

      if (session.stopped) return failure('Stopped before the game started', command)

      // Pull remote saves before the emulator opens them. A failure here is
      // reported but does not block play — the local save is still valid.
      let pullError: string | null = null
      try {
        await this.saveSync.pull(target)
      } catch (cause) {
        pullError = (cause as Error).message
      }

      // Stopped while the saves were coming down: there is no process to
      // signal, so the request has to be honoured here instead.
      if (session.stopped) return failure('Stopped before the game started', command)

      const startedAt = new Date()
      // Anything the emulator writes after this instant is part of this
      // session. One second of slack absorbs clock/filesystem timestamp
      // granularity.
      const since = startedAt.getTime() - 1000

      const exit = await this.run(argv, session, emulator.install, emulatorById(emulator.id)?.env)
      const playSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000)

      // Only a failure to start ends the launch here. An emulator that ran and
      // then exited badly still wrote save files, and returning before the push
      // would lose the session in the course of reporting on it.
      if (exit.startupError) {
        return { ...failure(exit.startupError, command), playSeconds }
      }

      let uploadedSaves = 0
      let uploadedStates = 0
      let pushError: string | null = null
      /**
       * What the session wrote, when the user has asked to see it first.
       *
       * The upload is not started here in that case. It cannot be: the answer
       * comes from a window this process is not allowed to block on, and a
       * dialog raised from the main process that nobody is there to answer
       * would hold the session open indefinitely. So the list travels back with
       * the launch result — the renderer is already awaiting it, which puts the
       * question on screen at the moment the emulator closes — and the
       * confirmed files are sent by `saves:pushSelected`.
       *
       * Nothing is lost by declining: the files stay where the emulator wrote
       * them, and Push saves sends everything on disk whenever it is pressed.
       */
      let pendingPush: SavePushPreview | null = null

      if (this.store.settings.syncSavesUp && this.store.settings.confirmSavePush) {
        try {
          pendingPush = await this.saveSync.previewPush(target, since)
        } catch (cause) {
          // Reported as a sync warning, the same as a failed upload: the files
          // are still on disk, but nobody has been told they are unsent.
          pushError = (cause as Error).message
        }
      } else {
        try {
          const pushed = await this.saveSync.push(target, since)
          uploadedSaves = pushed.saves
          uploadedStates = pushed.states
        } catch (cause) {
          pushError = (cause as Error).message
        }
      }

      await this.client.reportPlaySession(rom.id, startedAt, playSeconds)

      // The emulator's own complaint and the sync's are separate subjects, so
      // they are said separately rather than run together under one heading
      // that would only fit one of them.
      const syncWarnings = [pullError, pushError].filter(Boolean)
      const notes = [
        exit.warning,
        syncWarnings.length ? `Save sync warning: ${syncWarnings.join('; ')}` : null
      ].filter(Boolean)

      return {
        ok: true,
        emulator: emulator.id,
        command,
        error: notes.length ? notes.join(' ') : null,
        uploadedSaves,
        uploadedStates,
        pendingPush: pendingPush && pendingPush.files.length > 0 ? pendingPush : null,
        playSeconds
      }
    } finally {
      // Released only once the saves are back on the server, not when the
      // emulator exits: until then the session still owns the save files.
      this.current = null
    }
  }

  /**
   * Spawn and await the process, and say how it ended. The session's `kill` is
   * repointed at the process, so `stop` signals it from here on; clearing the
   * session is `launch`'s job.
   */
  private run(
    argv: string[],
    session: { kill: () => void },
    install: ResolvedInstall | null,
    env: Readonly<Record<string, string>> = {}
  ): Promise<ExitReport> {
    return new Promise((resolvePromise) => {
      const [cmd, ...args] = argv
      const child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: { ...process.env, ...env }
      })

      /**
       * Both streams, because which one carries the reason is not something
       * the emulator agrees with us about: RetroArch logs its whole run —
       * including the `[ERROR]` line naming the fatal problem — to stdout, and
       * reading stderr alone means watching it die and reporting nothing.
       */
      let output = ''
      const collect = (chunk: Buffer): void => {
        // Keep only the tail; emulators are chatty and we just want the reason.
        output = (output + chunk.toString()).slice(-8000)
      }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)

      const startedAt = Date.now()
      let signalled = false
      session.kill = () => {
        signalled = true
        // A flatpak has to be stopped through flatpak: the process spawned here
        // is only a client of it, and signalling that one is what the close
        // button used to do — nothing. Anything else was spawned directly and a
        // signal reaches it.
        if (install?.kind === 'flatpak') void stopFlatpakApp(install.ref)
        else child.kill('SIGTERM')
      }

      child.on('error', (err) => {
        resolvePromise({
          startupError: `Could not start the emulator: ${err.message}`,
          warning: null
        })
      })

      child.on('close', (code, signal) => {
        const clean = { startupError: null, warning: null }
        if (code === 0) return resolvePromise(clean)
        // Stopped from RomMix, or killed from outside. Either way somebody
        // asked for this and it is not a failure to report back to them.
        if (signalled || signal) return resolvePromise(clean)

        // Long enough to have been a session, so whatever the code meant, the
        // emulator ran and may have written saves. Anything it flagged is worth
        // passing on; it is not worth throwing the session away over.
        if (Date.now() - startedAt >= STARTUP_MS) {
          const flagged = flaggedLines(output)
          return resolvePromise({
            startupError: null,
            warning: flagged ? `The emulator reported: ${flagged}` : null
          })
        }

        // Gone before it could have shown the user anything. This is the launch
        // that silently did nothing — a missing libretro core is exactly this
        // shape — so it is reported even when the emulator explained nothing.
        const detail = flaggedLines(output) ?? tailOf(output)
        return resolvePromise({
          startupError: detail
            ? `The emulator quit immediately: ${detail}`
            : `The emulator quit immediately (code ${code}).`,
          warning: null
        })
      })
    })
  }

  /** Ask the running game to quit. */
  stop(): void {
    this.current?.kill()
  }

  /**
   * Start an emulator with no game, from the button beside it in Settings.
   *
   * Detached and unwaited, unlike a launch: this is for the setup work that
   * only the emulator itself can do — running RetroDECK once so it creates its
   * folders, adding a ROM directory in Eden, installing cores in RetroArch —
   * and RomMix has no business blocking, syncing saves, or claiming a game is
   * running while that happens. `unref` means quitting RomMix does not take
   * the emulator with it.
   */
  runEmulator(emulator: EmulatorState): string {
    const descriptor = emulatorById(emulator.id)
    if (!descriptor || !emulator.install) {
      throw new Error(`${emulator.name} is not installed`)
    }

    const prefix = execPrefix(emulator.install, descriptor.env)
    const argv = descriptor.open
      ? descriptor.open({ exec: prefix, installRef: emulator.install.ref })
      : prefix
    const [cmd, ...args] = argv
    const child = spawn(cmd, args, {
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, ...(descriptor.env ?? {}) }
    })
    child.on('error', () => undefined)
    child.unref()
    return argv.join(' ')
  }
}
