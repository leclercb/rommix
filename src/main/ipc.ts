import { app, ipcMain } from 'electron'
import type { ConnectPayload } from '@shared/api'
import { EMULATORS, emulatorById } from '@config/emulators'
import type {
  BiosReport,
  BiosSyncResult,
  ConnectionStatus,
  DiagnosticsReport,
  DownloadItem,
  EmulatorAsset,
  EmulatorRelease,
  EmulatorState,
  LaunchResult,
  LibrarySyncResult,
  RemoteAsset,
  RommRom,
  RootLocation,
  SaveSyncResult,
  Settings
} from '@shared/types'
import type { RomMixApp } from './app'
import { canSpawnHost, inFlatpak, installFlatpak, isWritable } from './host'
import { fetchReleases, installAsset } from './releases'
import { defaultRoot, relocateRoot, resolveRoot } from './root'
import { RommError, normaliseBaseUrl } from './romm'

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

export function registerIpc(rommix: RomMixApp): void {
  const { store, client, downloads, launcher, bios, saveSync } = rommix

  /**
   * The ROM plus everything needed to sync its saves.
   *
   * Both save buttons on the detail screen need the same four things, and each
   * of the three ways this can fail — not downloaded, no emulator, emulator
   * changed — has its own message.
   */
  const saveContext = async (
    romId: number
  ): Promise<{ rom: RommRom; emulator: EmulatorState; system: string }> => {
    // Before `installedNow`, not after: whether an entry belongs to the
    // emulator currently in charge is a question about the probe, and an
    // unprobed RomMix would answer "yes" to all of them.
    await rommix.ensureEmulators()
    const installed = downloads.installedNow(romId)
    if (!installed) {
      throw new RommError('That ROM is not downloaded for the emulator this platform uses')
    }
    const emulator = rommix.activeEmulator(installed.system)
    if (!emulator) {
      throw new RommError(`No installed emulator can run "${installed.system}"`)
    }
    return { rom: await client.rom(romId), emulator, system: installed.system }
  }

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
      await rommix.refreshEmulators()
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
  /**
   * The library, reconciled with the disk on the way past.
   *
   * A ROM already sitting where RomMix would install it counts as downloaded
   * even if nothing in the index says so — which is what keeps moving the
   * RomMix folder, or restoring it, from making a full library look empty.
   */
  handle('library:roms', async (query) => {
    await rommix.ensureEmulators()
    const page = await client.roms(query ?? {})
    await downloads.adopt(page.items)
    return page
  })

  handle('library:rom', async (id: number) => {
    await rommix.ensureEmulators()
    const rom = await client.rom(id)
    await downloads.adopt([rom])
    return rom
  })
  handle('library:installed', async () => {
    // The probe decides which entries belong to the emulator now in charge, so
    // answering before it has run would report every stale copy as present —
    // which is exactly what this call is asked first, on startup.
    await rommix.ensureEmulators()
    return downloads.installed
  })

  /**
   * Check the whole library against the disk, rather than only the ROMs a
   * screen has loaded. Reports progress because a large library takes a while
   * and a frozen button is indistinguishable from a broken one.
   */
  handle('library:sync', async (): Promise<LibrarySyncResult> => {
    await rommix.ensureEmulators()
    const result = await downloads.sync((checked, total) =>
      rommix.send('library:syncProgress', { checked, total })
    )
    rommix.send('library:installed', downloads.installed)
    return result
  })

  // -- downloads ------------------------------------------------------------

  handle('downloads:list', () => downloads.items)

  handle('downloads:start', async (romId: number): Promise<DownloadItem> => {
    // Probe first so an emulator installed since startup is seen.
    await rommix.ensureEmulators()
    const rom = await client.rom(romId)

    // Check the disk before queueing anything. Without this, a game RomMix has
    // simply not noticed yet gets downloaded again over the copy already there.
    await downloads.adopt([rom])
    // Deliberately the emulator-aware view: a copy downloaded for an emulator
    // this platform no longer uses is not one the user can play, so it must
    // not short-circuit the download that would put a copy where it now goes.
    const existing = downloads.installedNow(romId)
    if (existing) {
      return {
        romId,
        name: rom.name ?? rom.fs_name,
        coverPath: rom.path_cover_small ?? rom.path_cover_large,
        system: existing.system,
        platformName: rom.platform_display_name,
        state: 'done',
        receivedBytes: existing.sizeBytes,
        totalBytes: existing.sizeBytes,
        error: null,
        targetPath: existing.path
      }
    }

    return downloads.enqueue(rom)
  })

  handle('downloads:cancel', (romId: number) => downloads.cancel(romId))
  handle('downloads:clearFinished', () => downloads.clearFinished())
  handle('downloads:uninstall', (romId: number) => downloads.uninstall(romId))

  // -- launching ------------------------------------------------------------

  handle('game:launch', async (romId: number): Promise<LaunchResult> => {
    await rommix.ensureEmulators()

    const installed = downloads.installedNow(romId)
    if (!installed) {
      throw new RommError(
        store.getInstalled(romId)
          ? 'This copy was downloaded for a different emulator. Download it again for the one ' +
            'this platform now uses.'
          : 'That ROM is not downloaded yet'
      )
    }

    const emulator = rommix.activeEmulator(installed.system)
    if (!emulator) {
      throw new RommError(`No installed emulator can run "${installed.system}"`)
    }

    const rom = await client.rom(romId)

    rommix.send('game:state', { running: true, romId })
    try {
      return await launcher.launch({
        rom,
        // Never `installed.path`: for a multi-file game that is the directory,
        // and an emulator can only be given a file.
        romPath: await downloads.launchTarget(installed),
        system: installed.system,
        emulator
      })
    } finally {
      rommix.send('game:state', { running: false, romId: null })
    }
  })

  handle('game:stop', () => launcher.stop())

  // -- saves ----------------------------------------------------------------

  /** Everything RomM holds for this ROM, so the detail screen can list it. */
  handle('saves:list', (romId: number): Promise<RemoteAsset[]> => saveSync.remoteAssets(romId))

  handle('saves:pull', async (romId: number): Promise<SaveSyncResult> => {
    const { rom, emulator, system } = await saveContext(romId)
    return saveSync.pullNow(rom, emulator, system)
  })

  handle('saves:push', async (romId: number): Promise<SaveSyncResult> => {
    const { rom, emulator, system } = await saveContext(romId)
    return saveSync.pushNow(rom, emulator, system)
  })

  // -- BIOS -----------------------------------------------------------------

  handle('bios:list', async (): Promise<BiosReport> => {
    await rommix.ensureEmulators()
    return bios.report()
  })

  handle('bios:install', async (firmwareId: number): Promise<string> => {
    await rommix.ensureEmulators()
    return bios.install(firmwareId)
  })

  handle('bios:syncAll', async (): Promise<BiosSyncResult> => {
    await rommix.ensureEmulators()
    return bios.syncAll((done, total) => rommix.send('bios:progress', { done, total }))
  })

  // -- system ---------------------------------------------------------------

  handle('system:settings', () => store.settings)

  handle('system:updateSettings', async (patch: Partial<Settings>) => {
    const next = store.updateSettings(patch)
    // Path or emulator changes invalidate the probe.
    await rommix.refreshEmulators()
    // Repointing a platform at another emulator changes which downloads count
    // as present, so the renderer's copy of the list is stale the moment this
    // returns.
    rommix.send('library:installed', downloads.installed)
    return next
  })

  /**
   * Start an emulator on its own, with no game.
   *
   * The way out of "RetroDECK has not been run yet, so its folders do not
   * exist": the pre-flight check names the problem, and the fix is one button
   * beside it rather than a trip to the desktop.
   */
  handle('emulators:run', async (id: string): Promise<string> => {
    const states = await rommix.ensureEmulators()
    const state = states.find((emulator) => emulator.id === id)
    if (!state) throw new RommError(`RomMix does not know an emulator called ${id}`)
    if (!state.install) throw new RommError(`${state.name} is not installed`)
    return launcher.runEmulator(state)
  })

  /** Releases RomMix could install for this emulator, newest first. */
  handle('emulators:releases', async (id: string): Promise<EmulatorRelease[]> => {
    const descriptor = emulatorById(id)
    if (!descriptor?.releases) {
      throw new RommError(`RomMix cannot install ${descriptor?.name ?? id} for you`)
    }
    return fetchReleases(descriptor.releases)
  })

  /**
   * Download an asset and adopt it as this emulator's executable.
   *
   * The path is recorded in settings rather than left to auto-discovery: the
   * managed directory is deliberately not one of the folders scanned for a
   * stray AppImage, so what RomMix installed is always explicit.
   */
  handle('emulators:install', async (id: string, asset: EmulatorAsset): Promise<string> => {
    const descriptor = emulatorById(id)
    if (!descriptor?.releases) {
      throw new RommError(`RomMix cannot install ${descriptor?.name ?? id} for you`)
    }
    if (!asset.name.endsWith(descriptor.releases.assetSuffix)) {
      throw new RommError(`${asset.name} is not something RomMix can run`)
    }

    const path = await installAsset(id, asset, (progress) =>
      rommix.send('emulators:progress', progress)
    )
    store.updateSettings({
      emulatorPaths: { ...store.settings.emulatorPaths, [id]: path }
    })
    await rommix.refreshEmulators()
    return path
  })

  handle('system:diagnostics', async (): Promise<DiagnosticsReport> => {
    const emulators = await rommix.refreshEmulators()
    const spawn = await canSpawnHost()
    const notes: string[] = []

    if (inFlatpak() && !spawn) {
      notes.push(
        'flatpak-spawn cannot reach the host. RomMix needs --talk-name=org.freedesktop.Flatpak ' +
          'to start an emulator; grant it with Flatseal.'
      )
    }
    if (!emulators.some((emulator) => emulator.available)) {
      // Named from the registry rather than written out, so this cannot go on
      // recommending an emulator RomMix has stopped shipping a descriptor for.
      const suggestion = EMULATORS.find((descriptor) => descriptor.dispatch === 'self')
      notes.push(
        suggestion
          ? `No emulator found. Install ${suggestion.name}, which covers most systems, from the ` +
            'Emulators section above.'
          : 'No emulator found. Install one from the Emulators section above.'
      )
    } else {
      // Each descriptor already phrases its own problem; a half-usable install
      // is worth naming even when something else is available.
      for (const emulator of emulators) {
        if (emulator.install && emulator.unavailableReason) notes.push(emulator.unavailableReason)
      }
    }

    // Each emulator keeps its games in its own tree, so writability is checked
    // per emulator — one unwritable folder is a real failure even when the
    // others are fine, and naming it is the difference between a fixable
    // message and "download failed".
    const writable = await Promise.all(
      emulators
        .filter((emulator) => emulator.available && emulator.paths.roms)
        .map(async (emulator) => ({
          name: emulator.name,
          path: emulator.paths.roms as string,
          ok: await isWritable(emulator.paths.roms)
        }))
    )
    for (const entry of writable.filter((e) => !e.ok)) {
      notes.push(
        `${entry.name}'s ROM folder ${entry.path} is not writable. Grant RomMix access to it ` +
          '(--filesystem=home, or the SD card path) with Flatseal.'
      )
    }
    const romsWritable = writable.every((entry) => entry.ok)

    return {
      inFlatpak: inFlatpak(),
      canSpawnHost: spawn,
      emulators,
      romsWritable,
      notes
    }
  })

  /**
   * Install an emulator that ships as a flatpak.
   *
   * Separate from `emulators:install`, which downloads a release asset: here
   * the package manager owns the bytes, so there is nothing to place and no
   * path to record — a re-probe simply finds it.
   */
  handle('emulators:installFlatpak', async (id: string): Promise<void> => {
    const descriptor = emulatorById(id)
    const spec = descriptor?.install.find((entry) => entry.kind === 'flatpak')
    if (!descriptor || !spec || spec.kind !== 'flatpak') {
      throw new RommError(`${descriptor?.name ?? id} is not distributed as a flatpak`)
    }
    await installFlatpak(spec.appId, (line) =>
      rommix.send('emulators:progress', {
        emulatorId: id,
        assetName: spec.appId,
        receivedBytes: 0,
        totalBytes: 0,
        message: line
      })
    )
    await rommix.refreshEmulators()
  })

  /** Where RomMix keeps its own files, and where it would by default. */
  handle('system:root', (): RootLocation => ({
    current: resolveRoot(),
    fallback: defaultRoot(),
    fromEnvironment: Boolean(process.env.ROMMIX_HOME?.trim())
  }))

  handle('system:setRoot', (next: string): RootLocation => {
    const target = next.trim()
    if (!target.startsWith('/')) {
      throw new RommError('The RomMix folder must be an absolute path')
    }
    // Copies the configuration across and repoints; the move only takes effect
    // once Electron restarts, since userData is fixed before the app starts.
    relocateRoot(target)
    return { current: target, fallback: defaultRoot(), fromEnvironment: false }
  })

  handle('system:restart', () => {
    app.relaunch()
    app.exit(0)
  })

  handle('system:toggleFullscreen', () => rommix.toggleFullscreen())
  handle('system:quit', () => app.quit())
}
