import { spawn, type ChildProcess } from 'node:child_process'
import { emulatorById } from '@config/emulators'
import type { ResolvedInstall } from '@config/emulators'
import type { CoreProgress } from '@shared/api'
import type { EmulatorState, LaunchResult, RommRom, SavePushPreview } from '@shared/types'
import { installCore, missingCore } from './cores.ts'
import { execPrefix, killFlatpakApp, killProcessTree, stopFlatpakApp } from './host.ts'
import { realHome } from './xdg.ts'
import { log } from './log.ts'
import type { RommClient } from './romm.ts'
import type { SaveSync } from './saves.ts'
import type { Store } from './store.ts'
import { t } from './i18n.ts'

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
   * window to send to; the caller that raised `running:state` is the one that can
   * put this on screen.
   */
  onStage?: (stage: string | null) => void
}

/**
 * How long after the spawn an exit is still read as "it never started".
 *
 * Emulators are not consistent about their exit code on an ordinary quit — a
 * few return non-zero after a perfectly good session, and a launcher that
 * dispatches to one reports its *own* success rather than the emulator's, so
 * zero does not mean a game ran either. RetroDECK is the second kind: asked to
 * start a game it cannot start, it says so on stdout and exits 0.
 *
 * So the exit code cannot decide this on its own. What it can be paired with is
 * the clock: a process that is gone this quickly showed the user nothing,
 * whatever it returned, and a session someone actually played lasted longer
 * than any startup failure does.
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
  if (!progress.totalBytes) return t('launch.installingCore', { core: progress.core })
  return t('launch.installingCorePercent', {
    core: progress.core,
    percent: Math.round((progress.receivedBytes / progress.totalBytes) * 100)
  })
}

/**
 * Ask a running emulator to quit.
 *
 * A flatpak has to be stopped through flatpak: the process spawned here is only
 * a client of it, and signalling that one is what the close button used to do —
 * nothing. Anything else was spawned directly and a signal reaches it.
 *
 * Shared by the two things that can have the screen: a game's session, and an
 * emulator started on its own from the Emulators page.
 */
function askToQuit(child: ChildProcess, install: ResolvedInstall | null): void {
  log.info('emulator', 'asking the emulator to quit', {
    pid: child.pid ?? null,
    install: install?.kind ?? null,
    ref: install?.ref ?? null
  })
  if (install?.kind !== 'flatpak') return void child.kill('SIGTERM')

  void stopFlatpakApp(install.ref).then((stopped) => {
    // No instance was listed — the app is still starting, or it is not running
    // under flatpak's own bookkeeping. Signalling what we spawned is unlikely
    // to reach it, but a close button with one more thing to try beats one that
    // has quietly given up.
    if (!stopped) child.kill('SIGTERM')
  })
}

/**
 * Close it now, whatever state it is in.
 *
 * `askToQuit` sends a request the emulator is free to handle — and free to sit
 * on, which some do: Eden raises its own confirmation dialog, and one opened
 * off-screen or hung never answers it. A direct emulator then had nothing left
 * to try, so RomMix waited on it for as long as it stayed up.
 *
 * The whole tree, not the process that was spawned: an AppImage's runtime and a
 * launcher script both stand between RomMix and the emulator, and killing one
 * of those leaves the emulator exactly where it was — which is what a force
 * close that appeared to do nothing was. See `killProcessTree`.
 *
 * Anything the emulator had not written is lost, which is why nothing calls
 * this until the user has been told so and pressed again.
 *
 * Every way in is tried, rather than the first one that applies. Asking a
 * flatpak to quit already falls back to signalling what RomMix spawned when
 * flatpak lists no instance, and forcing one did not — so the press that was
 * meant to be the last resort had fewer ways to reach the emulator than the
 * polite one before it, and on a flatpak that flatpak had lost track of it did
 * nothing whatsoever.
 */
async function forceQuit(child: ChildProcess, install: ResolvedInstall | null): Promise<void> {
  log.warn('emulator', 'forcing the emulator to close', {
    pid: child.pid ?? null,
    install: install?.kind ?? null,
    ref: install?.ref ?? null
  })
  if (install?.kind === 'flatpak' && (await killFlatpakApp(install.ref))) return
  // No pid means the spawn itself never got off the ground, and there is
  // nothing running to signal.
  if (child.pid) await killProcessTree(child.pid)
}

/**
 * How long an emulator started on its own gets to prove it is running.
 *
 * Shorter than `STARTUP_MS`, because nothing is riding on the answer: this is
 * the Run button in Settings, and the user is watching it. A launch has save
 * files to account for and can afford to be careful; this only has to decide
 * whether to say "started" or to repeat what the emulator complained about.
 */
const OPEN_SETTLE_MS = 2500

export class Launcher {
  /**
   * An emulator started on its own and still up, so the overlay in front of it
   * has something to close. Null while nothing was opened that way.
   *
   * Separate from `current`: that is a session, with saves to account for and a
   * game to report. This is a program someone opened to change a setting in.
   */
  private opened: { name: string; kill: () => void; forceKill: () => void } | null = null

  /**
   * The session in progress, so a second launch can be refused.
   *
   * Claimed for the whole of `launch`, not just the spawn: a session starts by
   * pulling saves down over the network, and leaving the slot free until the
   * process exists would let a second launch run that pull concurrently and
   * open the same save files. `kill` starts as a request to abandon the session
   * before the emulator is spawned, and becomes a signal to it afterwards.
   */
  private current: {
    romId: number
    kill: () => void
    /** Close it outright. Null until there is a process to send it to. */
    forceKill: (() => void) | null
    stopped: boolean
  } | null = null

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

    const failure = (error: string, command = ''): LaunchResult => {
      log.warn('launch', 'launch failed', { romId: rom.id, emulator: emulator.id, error, command })
      return {
        ok: false,
        emulator: emulator.id,
        command,
        error,
        uploadedSaves: 0,
        uploadedStates: 0,
        pendingPush: null,
        playSeconds: 0
      }
    }

    if (this.current) return failure(t('launch.alreadyRunning'))

    const argv = this.buildCommand(options)
    if (!argv) {
      return failure(t('launch.cannotRunSystem', { emulator: emulator.name, system }))
    }
    const command = argv.join(' ')
    // The exact argv, because "it did nothing" is almost always a question
    // about what was actually run, and this is the answer to it.
    log.info('launch', 'starting', {
      romId: rom.id,
      name: rom.name ?? rom.fs_name,
      system,
      emulator: emulator.id,
      install: emulator.install?.kind ?? null,
      installRef: emulator.install?.ref ?? null,
      variant: variant ?? null,
      romPath,
      command
    })

    // Claimed before the first await, so a second launch is refused for the
    // whole session rather than only once the emulator is up. Until there is a
    // process, stopping can only be recorded as an intention.
    const session = {
      romId: rom.id,
      kill: (): void => {
        session.stopped = true
      },
      // Assigned once there is a process. Before that there is nothing to
      // force: `kill` above only marks the session abandoned.
      forceKill: null,
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
          options.onStage?.(t('launch.installingCore', { core: core.name }))
          await installCore(core, (progress: CoreProgress) => options.onStage?.(stageFor(progress)))
        }
      } catch (cause) {
        return failure((cause as Error).message, command)
      } finally {
        options.onStage?.(null)
      }

      if (session.stopped) return failure(t('launch.stoppedBeforeStart'), command)

      // Pull remote saves before the emulator opens them. A failure here is
      // reported but does not block play — the local save is still valid.
      let pullError: string | null = null
      try {
        const pulled = await this.saveSync.pull(target)
        log.info('launch', 'saves pulled before start', { romId: rom.id, written: pulled })
      } catch (cause) {
        pullError = (cause as Error).message
        log.error('launch', 'save pull failed, starting anyway', cause, { romId: rom.id })
      }

      // Stopped while the saves were coming down: there is no process to
      // signal, so the request has to be honoured here instead.
      if (session.stopped) return failure(t('launch.stoppedBeforeStart'), command)

      const startedAt = new Date()
      // Anything the emulator writes after this instant is part of this
      // session. One second of slack absorbs clock/filesystem timestamp
      // granularity.
      const since = startedAt.getTime() - 1000

      const exit = await this.run(argv, session, emulator.install, emulatorById(emulator.id)?.env)
      const playSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000)

      // Nothing returns early on a bad exit, however it is classified. The push
      // below only sends what was written after `since`, so an emulator that
      // truly never started has nothing to send and loses nothing by being
      // asked — whereas a session misjudged as a failed start would have its
      // saves abandoned unsent. Getting the classification wrong should cost a
      // wrong message, not a lost save.
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
          log.info('launch', 'session saves awaiting confirmation', {
            romId: rom.id,
            files: pendingPush.files.length
          })
        } catch (cause) {
          // Reported as a sync warning, the same as a failed upload: the files
          // are still on disk, but nobody has been told they are unsent.
          pushError = (cause as Error).message
          log.error('launch', 'could not list what the session wrote', cause, { romId: rom.id })
        }
      } else {
        try {
          const pushed = await this.saveSync.push(target, since)
          uploadedSaves = pushed.saves
          uploadedStates = pushed.states
          log.info('launch', 'session saves pushed', {
            romId: rom.id,
            saves: uploadedSaves,
            states: uploadedStates
          })
        } catch (cause) {
          pushError = (cause as Error).message
          log.error('launch', 'save push failed; the files are still on disk', cause, {
            romId: rom.id
          })
        }
      }

      // Not for a launch that never became a session: a zero-second entry in
      // the play history is noise about something that did not happen.
      if (!exit.startupError) {
        await this.client.reportPlaySession(rom.id, startedAt, playSeconds)
      }

      log.info('launch', exit.startupError ? 'launch did not become a session' : 'session ended', {
        romId: rom.id,
        emulator: emulator.id,
        playSeconds,
        uploadedSaves,
        uploadedStates,
        startupError: exit.startupError,
        warning: exit.warning,
        pullError,
        pushError
      })

      // The emulator's own complaint and the sync's are separate subjects, so
      // they are said separately rather than run together under one heading
      // that would only fit one of them.
      const syncWarnings = [pullError, pushError].filter(Boolean)
      const notes = [
        exit.warning,
        syncWarnings.length ? t('launch.syncWarning', { details: syncWarnings.join('; ') }) : null
      ].filter(Boolean)

      return {
        ok: exit.startupError == null,
        emulator: emulator.id,
        command,
        // The startup failure is the headline when there is one; the warnings
        // follow it rather than replacing it.
        error: [exit.startupError, ...notes].filter(Boolean).join(' ') || null,
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
    session: { kill: () => void; forceKill: (() => void) | null },
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

      log.info('emulator', 'process spawned', { pid: child.pid ?? null, command: argv.join(' ') })

      const startedAt = Date.now()
      let signalled = false
      session.kill = () => {
        signalled = true
        askToQuit(child, install)
      }
      session.forceKill = () => void forceQuit(child, install)

      child.on('error', (err) => {
        log.error('emulator', 'the process could not be started', err, { command: argv.join(' ') })
        resolvePromise({
          startupError: t('launch.couldNotStartEmulator', { reason: err.message }),
          warning: null
        })
      })

      child.on('close', (code, signal) => {
        const ranMs = Date.now() - startedAt
        // The exit itself, before any of it is interpreted: the code and the
        // signal are what an emulator's own bug tracker asks for, and the
        // classification below deliberately discards most of that distinction.
        const exit = { pid: child.pid ?? null, code, signal, ms: ranMs, signalled }

        const clean = { startupError: null, warning: null }
        // Stopped from RomMix, or killed from outside. Either way somebody
        // asked for this and it is not a failure to report back to them.
        if (signalled || signal) {
          log.info('emulator', 'exited after being asked to stop', exit)
          return resolvePromise(clean)
        }

        // Long enough to have been a session, so whatever the code meant, the
        // emulator ran and may have written saves.
        if (ranMs >= STARTUP_MS) {
          if (code === 0) {
            log.info('emulator', 'exited cleanly', exit)
            return resolvePromise(clean)
          }
          // Anything it flagged is worth passing on; it is not worth throwing
          // the session away over.
          const flagged = flaggedLines(output)
          log.warn('emulator', 'exited non-zero after a real session', { ...exit, flagged })
          return resolvePromise({
            startupError: null,
            warning: flagged ? t('launch.emulatorReported', { detail: flagged }) : null
          })
        }

        // Gone before it could have shown the user anything. This is the launch
        // that silently did nothing — a missing libretro core is exactly this
        // shape — so it is reported even when the emulator explained nothing.
        const detail = flaggedLines(output) ?? tailOf(output)
        // The one case where the emulator's own output is worth keeping in
        // full: nothing was shown on screen, so this is the only account of
        // why. Trimmed to the tail, which is where a program that is about to
        // die says so.
        log.error('emulator', 'quit immediately — treated as a crash', undefined, {
          ...exit,
          detail,
          output: output.slice(-2000)
        })
        return resolvePromise({
          startupError: detail
            ? t('launch.quitImmediatelyDetail', { detail })
            : code === 0
              ? // Zero is the least informative thing an exit can say, and
                // quoting it invites the reply that nothing went wrong.
                t('launch.quitImmediately')
              : t('launch.quitImmediatelyCode', { code: code ?? 0 }),
          warning: null
        })
      })
    })
  }

  /**
   * Ask whatever has the screen to quit.
   *
   * A game's session first: it is the one with something at stake, and an
   * emulator opened on its own cannot be running at the same time as a launch
   * — `launch` refuses a second one, and the Run button is on a screen that a
   * running game covers.
   */
  stop(force = false): void {
    if (this.current) {
      log.info('launch', force ? 'forcing the running game closed' : 'stopping the running game', {
        romId: this.current.romId
      })
      // A session that has not spawned anything yet has nothing to signal, and
      // a force press that quietly does nothing is the worst answer available:
      // abandoning the session is what closing means while a core is still
      // downloading. See the session set up in `launch`.
      if (force && this.current.forceKill) this.current.forceKill()
      else this.current.kill()
      return
    }
    if (this.opened) {
      log.info('launch', force ? 'forcing the emulator closed' : 'closing the emulator', {
        name: this.opened.name
      })
      if (force) this.opened.forceKill()
      else this.opened.kill()
      return
    }
    log.debug('launch', 'stop asked for with nothing running')
  }

  /**
   * Start an emulator with no game, from the button beside it in Settings.
   *
   * Detached, unlike a launch: this is for the setup work that only the
   * emulator itself can do — running RetroDECK once so it creates its folders,
   * adding a ROM directory in Eden, installing cores in RetroArch — and RomMix
   * has no business syncing saves or claiming a game is running while that
   * happens. `unref` means quitting RomMix does not take the emulator with it.
   *
   * It is not, however, unwatched. It used to be spawned with its output thrown
   * away and nothing but an `error` listener, which fires only when the process
   * could not be created at all — so an emulator that started and immediately
   * died said nothing whatsoever, and Settings went on reporting "Eden started"
   * over a window that never appeared. Anything that fails inside
   * `OPEN_SETTLE_MS` is therefore reported, using the emulator's own words; the
   * process is released as soon as it has survived that long.
   */
  async runEmulator(emulator: EmulatorState, onExit?: () => void): Promise<string> {
    const descriptor = emulatorById(emulator.id)
    if (!descriptor || !emulator.install) {
      throw new Error(t('error.emulatorNotInstalled', { name: emulator.name }))
    }

    const prefix = execPrefix(emulator.install, descriptor.env)
    const argv = descriptor.open
      ? descriptor.open({ exec: prefix, installRef: emulator.install.ref, home: realHome() })
      : prefix
    const command = argv.join(' ')
    log.info('emulator', 'starting on its own, with no game', { emulator: emulator.id, command })

    const [cmd, ...args] = argv
    const child = spawn(cmd, args, {
      // Piped rather than ignored: the two lines saying why it died are the
      // whole point of watching, and they go to these streams.
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, ...(descriptor.env ?? {}) }
    })

    let output = ''
    const collect = (chunk: Buffer): void => {
      output = (output + chunk.toString()).slice(-8000)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)

    return new Promise<string>((resolvePromise, rejectPromise) => {
      // Cleared by whichever of the three outcomes happens first, so a settled
      // promise cannot be settled again by a later one.
      let settled = false
      const settle = (finish: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        finish()
      }

      const timer = setTimeout(
        () =>
          settle(() => {
            // Still up, so it is the emulator's window now, and `unref` stops
            // it holding RomMix open.
            //
            // The output goes on being read, though, and deliberately: an
            // emulator's stdout is a pipe with a 64KB kernel buffer, and a
            // reader that walks away leaves the emulator blocking on a write
            // partway through a session. `collect` keeps only the tail, so
            // draining it for hours costs nothing.
            child.unref()

            // Kept, now that it has the screen: it is not a session — there is
            // no game and nothing to sync — but it is the thing in front of
            // RomMix, and the overlay that says so needs a way to close it.
            // `unref` above still stands, so quitting RomMix leaves it running.
            const opened = {
              name: emulator.name,
              kill: () => askToQuit(child, emulator.install),
              forceKill: () => void forceQuit(child, emulator.install)
            }
            this.opened = opened
            child.on('close', () => {
              // Only if it is still the one in front: opening a second
              // emulator replaces this entry, and the first one exiting must
              // not clear the second's.
              if (this.opened === opened) this.opened = null
              onExit?.()
            })
            resolvePromise(command)
          }),
        OPEN_SETTLE_MS
      )

      child.on('error', (err) =>
        settle(() => {
          log.error('emulator', 'could not be started on its own', err, {
            emulator: emulator.id,
            command
          })
          rejectPromise(
            new Error(t('launch.couldNotStartNamed', { name: emulator.name, reason: err.message }))
          )
        })
      )

      child.on('close', (code, signal) =>
        settle(() => {
          // The same reading as a launch that quit immediately: whatever it
          // flagged, or failing that the last thing it said. An emulator that
          // exits this fast showed the user nothing, whatever its exit code —
          // RetroDECK reports its own success rather than the game's.
          const detail = flaggedLines(output) ?? tailOf(output)
          log.error('emulator', 'quit immediately when started on its own', undefined, {
            emulator: emulator.id,
            command,
            code,
            signal,
            detail,
            output: output.slice(-2000)
          })
          rejectPromise(
            new Error(
              detail
                ? t('launch.emulatorQuitDetail', { name: emulator.name, detail })
                : t('launch.emulatorQuitCode', { name: emulator.name, code: code ?? 0 })
            )
          )
        })
      )
    })
  }
}
