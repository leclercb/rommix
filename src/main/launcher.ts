import { spawn } from 'node:child_process'
import { coreForSystem } from '@shared/systems'
import type { LaunchResult, RommRom, RunnerInfo } from '@shared/types'
import type { RommClient } from './romm'
import { RETROARCH_APP_ID, RETRODECK_APP_ID, hostCommand } from './runners'
import type { SaveSync } from './saves'

/**
 * Launches a downloaded ROM in RetroDECK or RetroArch and waits for it to exit.
 *
 * RetroDECK exposes a `run_game` entry point on its CLI:
 *
 *     flatpak run net.retrodeck.retrodeck [-e emulator] [-s system] <game>
 *
 * It resolves the emulator from its bundled es_systems.xml, honouring any
 * <altemulator> the user set in ES-DE, so passing the system and letting
 * RetroDECK choose is both simpler and more faithful to the user's config than
 * picking a core ourselves.
 *
 * RetroArch has no such resolution, so there we map the system to a libretro
 * core explicitly.
 */

export interface LaunchOptions {
  rom: RommRom
  romPath: string
  system: string
  runner: RunnerInfo
}

export class Launcher {
  /** Set while a game is running, so the UI can block a second launch. */
  private current: { romId: number; kill: () => void } | null = null

  constructor(
    private readonly client: RommClient,
    private readonly saveSync: SaveSync
  ) {}

  get isRunning(): boolean {
    return this.current !== null
  }

  get runningRomId(): number | null {
    return this.current?.romId ?? null
  }

  /** Build the argv for a runner, or null when we cannot work out how. */
  buildCommand(options: LaunchOptions): string[] | null {
    const { runner, system, romPath } = options

    if (runner.kind === 'retrodeck') {
      return hostCommand(['flatpak', 'run', RETRODECK_APP_ID, '-s', system, romPath])
    }

    const core = coreForSystem(system)
    if (!core) return null
    return hostCommand([
      'flatpak',
      'run',
      RETROARCH_APP_ID,
      '-L',
      `${core}_libretro.so`,
      romPath
    ])
  }

  /**
   * Sync saves down, run the game, wait for exit, then sync saves back up.
   *
   * The whole thing resolves only once the emulator has quit, which is what
   * lets us diff the save directory by modification time.
   */
  async launch(options: LaunchOptions): Promise<LaunchResult> {
    const { rom, runner, system } = options

    const failure = (error: string, command = ''): LaunchResult => ({
      ok: false,
      runner: runner.kind,
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
        `No libretro core is mapped for "${system}". Use RetroDECK for this system, ` +
          `or add a core mapping in Settings.`
      )
    }
    const command = argv.join(' ')

    // Pull remote saves before the emulator opens them. A failure here is
    // reported but does not block play — the local save is still valid.
    let pullError: string | null = null
    try {
      await this.saveSync.pull(rom, runner, system)
    } catch (cause) {
      pullError = (cause as Error).message
    }

    const startedAt = new Date()
    // Anything the emulator writes after this instant is part of this session.
    // One second of slack absorbs clock/filesystem timestamp granularity.
    const since = startedAt.getTime() - 1000

    const exitError = await this.run(argv, rom.id)
    const playSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000)

    if (exitError) {
      return { ...failure(exitError, command), playSeconds }
    }

    let uploadedSaves = 0
    let uploadedStates = 0
    let pushError: string | null = null
    try {
      const pushed = await this.saveSync.push(rom, runner, system, since)
      uploadedSaves = pushed.saves
      uploadedStates = pushed.states
    } catch (cause) {
      pushError = (cause as Error).message
    }

    await this.client.reportPlaySession(rom.id, startedAt, playSeconds)

    const warnings = [pullError, pushError].filter(Boolean)
    return {
      ok: true,
      runner: runner.kind,
      command,
      error: warnings.length ? `Save sync warning: ${warnings.join('; ')}` : null,
      uploadedSaves,
      uploadedStates,
      playSeconds
    }
  }

  /** Spawn and await the process. Resolves to an error string, or null on success. */
  private run(argv: string[], romId: number): Promise<string | null> {
    return new Promise((resolvePromise) => {
      const [cmd, ...args] = argv
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false })

      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        // Keep only the tail; emulators are chatty and we just want the reason.
        stderr = (stderr + chunk.toString()).slice(-4000)
      })

      this.current = { romId, kill: () => child.kill('SIGTERM') }

      child.on('error', (err) => {
        this.current = null
        resolvePromise(`Could not start the emulator: ${err.message}`)
      })

      child.on('close', (code) => {
        this.current = null
        // RetroDECK and RetroArch both exit 0 on a clean quit. A non-zero code
        // with no output usually means the user killed it, which is not an error
        // worth showing.
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

  /** Which flatpak would we invoke, for the diagnostics panel. */
  static describeRunner(runner: RunnerInfo): string {
    return runner.kind === 'retrodeck' ? RETRODECK_APP_ID : RETROARCH_APP_ID
  }
}
