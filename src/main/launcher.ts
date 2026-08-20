import { spawn } from 'node:child_process'
import { emulatorById } from '@config/emulators'
import type { EmulatorState, LaunchResult, RommRom } from '@shared/types'
import { execPrefix } from './host'
import type { RommClient } from './romm'
import type { SaveSync } from './saves'

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

      const exitError = await this.run(argv, session, emulatorById(emulator.id)?.env)
      const playSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000)

      if (exitError) {
        return { ...failure(exitError, command), playSeconds }
      }

      let uploadedSaves = 0
      let uploadedStates = 0
      let pushError: string | null = null
      try {
        const pushed = await this.saveSync.push(target, since)
        uploadedSaves = pushed.saves
        uploadedStates = pushed.states
      } catch (cause) {
        pushError = (cause as Error).message
      }

      await this.client.reportPlaySession(rom.id, startedAt, playSeconds)

      const warnings = [pullError, pushError].filter(Boolean)
      return {
        ok: true,
        emulator: emulator.id,
        command,
        error: warnings.length ? `Save sync warning: ${warnings.join('; ')}` : null,
        uploadedSaves,
        uploadedStates,
        playSeconds
      }
    } finally {
      // Released only once the saves are back on the server, not when the
      // emulator exits: until then the session still owns the save files.
      this.current = null
    }
  }

  /**
   * Spawn and await the process. Resolves to an error string, or null on
   * success. The session's `kill` is repointed at the process, so `stop`
   * signals it from here on; clearing the session is `launch`'s job.
   */
  private run(
    argv: string[],
    session: { kill: () => void },
    env: Readonly<Record<string, string>> = {}
  ): Promise<string | null> {
    return new Promise((resolvePromise) => {
      const [cmd, ...args] = argv
      const child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: { ...process.env, ...env }
      })

      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        // Keep only the tail; emulators are chatty and we just want the reason.
        stderr = (stderr + chunk.toString()).slice(-4000)
      })

      session.kill = () => child.kill('SIGTERM')

      child.on('error', (err) => {
        resolvePromise(`Could not start the emulator: ${err.message}`)
      })

      child.on('close', (code) => {
        // Emulators exit 0 on a clean quit. A non-zero code with no output
        // usually means the user killed it, which is not an error worth showing.
        if (code === 0 || code === null) return resolvePromise(null)
        const detail = stderr.trim().split('\n').slice(-3).join(' ').trim()
        resolvePromise(detail ? `Emulator exited with code ${code}: ${detail}` : null)
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
