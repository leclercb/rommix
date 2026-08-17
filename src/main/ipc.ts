import { app, ipcMain } from 'electron'
import type { ConnectPayload } from '@shared/api'
import type {
  ConnectionStatus,
  DiagnosticsReport,
  DownloadItem,
  LaunchResult,
  Settings
} from '@shared/types'
import type { RommixApp } from './app'
import { RommError, normaliseBaseUrl } from './romm'
import { canSpawnHost, inFlatpak, isWritable } from './runners'

/**
 * IPC surface. Every handler is wrapped so a thrown error crosses the bridge as
 * a readable message rather than Electron's default
 * "Error invoking remote method" wrapper, which hides the cause.
 */

function handle<Args extends unknown[], Result>(
  channel: string,
  fn: (...args: Args) => Promise<Result> | Result
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as Args))
    } catch (cause) {
      const message =
        cause instanceof RommError ? cause.message : ((cause as Error).message ?? String(cause))
      throw new Error(message)
    }
  })
}

export function registerIpc(rommix: RommixApp): void {
  const { store, client, downloads, launcher } = rommix

  /** Current connection state, including who we are signed in as. */
  const status = async (): Promise<ConnectionStatus> => {
    const server = store.server
    const creds = store.credentials
    if (!server || (!creds.accessToken && !creds.clientToken)) {
      return { connected: false, baseUrl: server?.baseUrl ?? null, user: null, serverVersion: null, error: null }
    }
    try {
      const [user, beat] = await Promise.all([client.me(), client.heartbeat()])
      return {
        connected: true,
        baseUrl: server.baseUrl,
        user,
        serverVersion: beat.version,
        error: null
      }
    } catch (cause) {
      return {
        connected: false,
        baseUrl: server.baseUrl,
        user: null,
        serverVersion: null,
        error: (cause as Error).message
      }
    }
  }

  // -- server ---------------------------------------------------------------

  handle('server:status', status)

  handle('server:connect', async (payload: ConnectPayload): Promise<ConnectionStatus> => {
    const baseUrl = normaliseBaseUrl(payload.baseUrl)
    const previousServer = store.server

    // Confirm it is a RomM instance before we store anything.
    await client.heartbeat(baseUrl)
    store.setServer({ baseUrl, authMode: payload.mode, username: payload.username })

    try {
      if (payload.mode === 'password') {
        if (!payload.username || !payload.password) {
          throw new RommError('Username and password are required')
        }
        await client.loginWithPassword(payload.username, payload.password, baseUrl)
      } else if (payload.mode === 'token') {
        if (!payload.token) throw new RommError('An API token is required')
        client.setClientToken(payload.token)
      }
      // 'device' mode has already stored its token via pollPairing.

      const result = await status()
      if (!result.connected) throw new RommError(result.error ?? 'Could not sign in')
      await rommix.refreshRunners()
      return result
    } catch (cause) {
      // Leave the app as we found it rather than half-connected.
      store.setServer(previousServer)
      store.clearCredentials()
      throw cause
    }
  })

  handle('server:disconnect', async () => {
    store.clearCredentials()
    store.setServer(null)
  })

  handle('server:startPairing', async (baseUrl: string) => {
    const normalised = normaliseBaseUrl(baseUrl)
    await client.heartbeat(normalised)
    store.setServer({ baseUrl: normalised, authMode: 'device' })
    return client.startDevicePairing(normalised)
  })

  handle('server:pollPairing', async (deviceCode: string, baseUrl: string) =>
    client.pollDevicePairing(deviceCode, normaliseBaseUrl(baseUrl))
  )

  // -- library --------------------------------------------------------------

  handle('library:platforms', () => client.platforms())
  handle('library:collections', () => client.collections())
  handle('library:roms', (query) => client.roms(query ?? {}))
  handle('library:rom', (id: number) => client.rom(id))
  handle('library:installed', () => store.installed)

  // -- downloads ------------------------------------------------------------

  handle('downloads:list', () => downloads.items)

  handle('downloads:start', async (romId: number): Promise<DownloadItem> => {
    // Refresh the runner probe so a RetroDECK installed since startup is seen.
    if (!rommix.activeRunner()) await rommix.refreshRunners()
    const rom = await client.rom(romId)
    return downloads.enqueue(rom)
  })

  handle('downloads:cancel', (romId: number) => downloads.cancel(romId))
  handle('downloads:clearFinished', () => downloads.clearFinished())
  handle('downloads:uninstall', (romId: number) => downloads.uninstall(romId))

  // -- launching ------------------------------------------------------------

  handle('game:launch', async (romId: number): Promise<LaunchResult> => {
    const installed = store.getInstalled(romId)
    if (!installed) {
      throw new RommError('That ROM is not downloaded yet')
    }

    if (!rommix.activeRunner()) await rommix.refreshRunners()
    const runner = rommix.activeRunner()
    if (!runner) {
      throw new RommError('Neither RetroDECK nor RetroArch is installed')
    }

    const rom = await client.rom(romId)

    rommix.send('game:state', { running: true, romId })
    try {
      return await launcher.launch({
        rom,
        romPath: installed.path,
        system: installed.system,
        runner
      })
    } finally {
      rommix.send('game:state', { running: false, romId: null })
    }
  })

  handle('game:stop', () => launcher.stop())

  // -- system ---------------------------------------------------------------

  handle('system:settings', () => store.settings)

  handle('system:updateSettings', async (patch: Partial<Settings>) => {
    const next = store.updateSettings(patch)
    // Path or runner changes invalidate the probe.
    await rommix.refreshRunners()
    return next
  })

  handle('system:runners', () => rommix.refreshRunners())

  handle('system:diagnostics', async (): Promise<DiagnosticsReport> => {
    const runners = await rommix.refreshRunners()
    const active = rommix.activeRunner()
    const spawn = await canSpawnHost()
    const notes: string[] = []

    if (inFlatpak() && !spawn) {
      notes.push(
        'flatpak-spawn cannot reach the host. Rommix needs --talk-name=org.freedesktop.Flatpak ' +
          'to start RetroDECK; grant it with Flatseal.'
      )
    }
    if (!runners.some((r) => r.available)) {
      notes.push('No emulator found. Install RetroDECK (net.retrodeck.retrodeck) from Flathub.')
    }
    const retrodeck = runners.find((r) => r.kind === 'retrodeck')
    if (retrodeck && !retrodeck.paths.roms) {
      notes.push('RetroDECK has not been run yet, so its ROM folder does not exist.')
    }

    const romsWritable = await isWritable(active?.paths.roms ?? null)
    if (active && !romsWritable) {
      notes.push(
        `The ROM folder ${active.paths.roms} is not writable. Grant Rommix access to it ` +
          '(--filesystem=home, or the SD card path) with Flatseal.'
      )
    }

    return {
      inFlatpak: inFlatpak(),
      canSpawnHost: spawn,
      runners,
      activeRunner: active?.kind ?? null,
      romsWritable,
      notes
    }
  })

  handle('system:toggleFullscreen', () => rommix.toggleFullscreen())
  handle('system:quit', () => app.quit())
}
