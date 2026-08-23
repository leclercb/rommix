import { app, ipcMain, shell } from 'electron'
import type { ConnectPayload } from '@shared/api'
import {
  EMULATORS,
  emulatorById,
  isInstallableAsset,
  launchVariants,
  releaseSource
} from '@config/emulators'
import type {
  BiosPlatform,
  BiosReport,
  BiosSyncResult,
  ConnectionStatus,
  DiagnosticsReport,
  DownloadItem,
  EmulatorAsset,
  EmulatorRelease,
  EmulatorState,
  InstalledRom,
  LaunchChoice,
  LaunchResult,
  LibrarySyncResult,
  RootLocation,
  SaveAsset,
  SavePushPreview,
  SaveSyncResult,
  Settings
} from '@shared/types'
import type { RomMixApp } from './app.ts'
import type { SaveTarget } from './saves.ts'
import { flatpakAvailable, flathubConfigured, installFlatpak, isWritable } from './host.ts'
import { log } from './log.ts'
import { builtForThisMachine, fetchReleases, installAsset } from './releases.ts'
import { defaultRoot, relocateRoot, resolveRoot, rootPaths } from './root.ts'
import { RommError, normaliseBaseUrl } from './romm.ts'

/**
 * IPC surface. Every handler is wrapped so a thrown error crosses the bridge as
 * a readable message rather than Electron's default
 * "Error invoking remote method" wrapper, which hides the cause.
 *
 * The same wrapper announces the failure on `app:error`, so *every* call that
 * fails is reported to the user whether or not the screen that made it thought
 * to catch it. A screen that wants to say something better still can — it just
 * no longer has to, and a call made on a screen's behalf (a refresh, a probe,
 * something started by a keypress two screens ago) can no longer fail in
 * silence and leave the UI quietly showing nothing.
 *
 * It is also where every action the user took is written to the log. One line
 * per call, from the one place every call already passes through, which is what
 * makes the log a record of what was done rather than of what a handful of
 * hand-instrumented handlers remembered to mention.
 */

/**
 * Channels logged only at debug level.
 *
 * These are the ones a screen asks on every render or every few seconds. At
 * info level they would be most of the file, and none of them says anything
 * about what the person in front of the television did.
 */
const CHATTY = new Set([
  'server:status',
  'server:pollPairing',
  'system:settings',
  'downloads:list',
  'library:installed',
  'library:favourite'
])

function handler(report: (message: string) => void) {
  return function handle<Args extends unknown[], Result>(
    channel: string,
    fn: (...args: Args) => Promise<Result> | Result
  ): void {
    ipcMain.handle(channel, async (_event, ...args) => {
      const took = log.since()
      const level = CHATTY.has(channel) ? 'debug' : 'info'
      // Arguments as they were passed: a call that failed is far easier to
      // account for with the id or the query that produced it. `log` scrubs the
      // credentials out of `server:connect` on the way past.
      log[level]('ipc', `→ ${channel}`, args.length > 0 ? { args } : undefined)
      try {
        const result = await fn(...(args as Args))
        log[level]('ipc', `← ${channel}`, { ms: took() })
        return result
      } catch (cause) {
        const message =
          cause instanceof RommError ? cause.message : ((cause as Error).message ?? String(cause))
        log.error('ipc', `✗ ${channel}`, cause, { ms: took() })
        report(message)
        // The message is what crosses the bridge — Electron serialises nothing
        // else — but `cause` keeps the original stack attached on this side, so
        // an unhandled rejection in the main process still names where it came
        // from rather than pointing back at this line.
        throw new Error(message, { cause })
      }
    })
  }
}

export function registerIpc(rommix: RomMixApp): void {
  const { store, client, downloads, launcher, bios, saveSync } = rommix
  const handle = handler((message) => rommix.send('app:error', message))

  /** Key under which a per-system launch choice is remembered. */
  const launcherKey = (emulatorId: string, system: string): string => `${emulatorId}:${system}`

  /**
   * The ROM plus everything needed to sync its saves.
   *
   * Both save buttons on the detail screen need the same four things, and each
   * of the three ways this can fail — not downloaded, no emulator, emulator
   * changed — has its own message.
   */
  const saveContext = async (romId: number): Promise<SaveTarget> => {
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
    return {
      rom: await client.rom(romId),
      emulator,
      system: installed.system,
      // The file the emulator is handed, never the game directory: RetroArch
      // names its save folder after the directory the *ROM* sits in, so the
      // difference between the two is the difference between finding a save
      // and creating an empty folder beside it.
      romPath: await downloads.launchTarget(installed),
      // The same recorded choice `game:launch` honours, so the save location
      // and the emulator that wrote it can never disagree.
      variant: store.settings.systemLaunchers[launcherKey(emulator.id, installed.system)]
    }
  }

  /** Current connection state, including who we are signed in as. */
  const status = async (): Promise<ConnectionStatus> => {
    const server = store.server
    const creds = store.credentials
    if (!server || (!creds.accessToken && !creds.clientToken)) {
      return {
        connected: false,
        baseUrl: server?.baseUrl ?? null,
        user: null,
        serverVersion: null,
        error: null
      }
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
      log.warn('server', 'not connected', {
        baseUrl: server.baseUrl,
        reason: (cause as Error).message
      })
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
      log.info('server', 'connected', {
        baseUrl,
        mode: payload.mode,
        user: result.user?.username ?? null,
        serverVersion: result.serverVersion
      })
      return result
    } catch (cause) {
      // Leave the app as we found it rather than half-connected.
      log.error('server', 'sign-in failed, rolling back to the previous server', cause, {
        baseUrl,
        mode: payload.mode
      })
      store.setServer(previousServer)
      store.clearCredentials()
      throw cause
    }
  })

  handle('server:disconnect', async () => {
    log.info('server', 'signed out', { baseUrl: store.server?.baseUrl ?? null })
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
  handle('library:favourite', (romId: number) => client.isFavourite(romId))
  handle('library:setFavourite', (romId: number, favourite: boolean) =>
    client.setFavourite(romId, favourite)
  )
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
    const took = log.since()
    const result = await downloads.sync((checked, total) =>
      rommix.send('library:syncProgress', { checked, total })
    )
    rommix.send('library:installed', downloads.installed)
    log.info('library', 'full sync finished', { ...result, ms: took() })
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

  /** The downloaded copy plus the emulator that is going to run it. */
  const launchContext = async (
    romId: number
  ): Promise<{ installed: InstalledRom; emulator: EmulatorState }> => {
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
    return { installed, emulator }
  }

  /**
   * What this game can be run with.
   *
   * Asked before launching so the renderer can put the question up front rather
   * than after a failure. An emulator with one way to run the system answers
   * with a single option and nothing is asked.
   */
  handle('game:variants', async (romId: number): Promise<LaunchChoice> => {
    const { installed, emulator } = await launchContext(romId)
    const descriptor = emulatorById(emulator.id)
    const options = descriptor ? launchVariants(descriptor, installed.system) : []
    const recorded = store.settings.systemLaunchers[launcherKey(emulator.id, installed.system)]

    return {
      system: installed.system,
      emulatorId: emulator.id,
      emulatorName: emulator.name,
      setupNotes: [...(descriptor?.setupNotes ?? [])],
      options: options.map((option) => ({ ...option })),
      // A recorded choice that no longer exists is reported as unanswered, so
      // the user is asked again rather than being launched into something else.
      chosen: options.some((option) => option.id === recorded) ? recorded : null
    }
  })

  handle('game:launch', async (romId: number, variant?: string): Promise<LaunchResult> => {
    const { installed, emulator } = await launchContext(romId)

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

  // -- saves ----------------------------------------------------------------

  /**
   * Both ends of this ROM's saves, for the detail screen's list.
   *
   * The context is optional here where every other save call requires it: a
   * game that is not downloaded still has saves worth looking at, it simply has
   * none of them on this device — and without a context there is no save tree
   * to scan, so every row comes back as the server's alone.
   */
  handle('saves:list', async (romId: number): Promise<SaveAsset[]> => {
    const local = await saveContext(romId).catch(() => null)
    return saveSync.listAssets(romId, local ?? undefined)
  })

  handle('saves:pull', async (romId: number): Promise<SaveSyncResult> =>
    saveSync.pullNow(await saveContext(romId))
  )

  handle('saves:push', async (romId: number): Promise<SaveSyncResult> =>
    saveSync.pushNow(await saveContext(romId))
  )

  /**
   * What a push would send, for the confirmation dialog.
   *
   * A separate call rather than a flag on `saves:push`: the dialog has to be
   * answered between the two, and a push that returned "here is what I would
   * have done" would leave the renderer holding a decision the main process has
   * already half-made.
   */
  handle('saves:pushPreview', async (romId: number): Promise<SavePushPreview> =>
    saveSync.previewPush(await saveContext(romId))
  )

  /**
   * Send the files a confirmation dialog just approved.
   *
   * Named by path, and `pushSelected` intersects them with its own scan rather
   * than uploading what it is handed — the list came from this process in the
   * first place, and a path is not something the renderer gets to invent.
   */
  handle('saves:pushSelected', async (romId: number, paths: string[]): Promise<SaveSyncResult> =>
    saveSync.pushSelected(await saveContext(romId), paths)
  )

  /**
   * Delete one save or state from every end that has it.
   *
   * Both ends, because one alone does not stay deleted: RomMix uploads what a
   * session wrote, so a save removed only from the server comes back the next
   * time the game is played. `id` is null for a file only this device has,
   * which has no server copy to remove and is named instead.
   */
  handle(
    'saves:delete',
    async (
      romId: number,
      kind: 'save' | 'state',
      id: number | null,
      fileName: string
    ): Promise<void> => {
      const local = await saveContext(romId).catch(() => null)
      await saveSync.deleteAsset(romId, kind, id, fileName, local ?? undefined)
    }
  )

  // -- BIOS -----------------------------------------------------------------

  handle('bios:list', async (): Promise<BiosReport> => {
    await rommix.ensureEmulators()
    return bios.report()
  })

  /** One platform's BIOS situation, for the warning on a game's page. */
  handle('bios:platform', async (platformId: number): Promise<BiosPlatform | null> => {
    await rommix.ensureEmulators()
    return bios.platformReport(platformId)
  })

  handle('bios:install', async (firmwareId: number): Promise<string> => {
    await rommix.ensureEmulators()
    return bios.install(firmwareId)
  })

  handle('bios:syncAll', async (platformId?: number | null): Promise<BiosSyncResult> => {
    await rommix.ensureEmulators()
    return bios.syncAll(platformId, (done, total) => rommix.send('bios:progress', { done, total }))
  })

  // -- system ---------------------------------------------------------------

  handle('system:settings', () => store.settings)

  handle('system:updateSettings', async (patch: Partial<Settings>) => {
    log.info('settings', 'changed', { patch })
    const next = store.updateSettings(patch)

    // Only a hand-written executable path or library folder changes what
    // probing the machine would find. Re-running it for a save-sync toggle would mean a `flatpak
    // info` and a PATH search per emulator every time a switch is flipped.
    // Both change which emulator answers for a platform: one by moving where
    // they are, the other by moving which comes first.
    if ('emulatorPaths' in patch || 'emulatorPriority' in patch || 'emulatorRoots' in patch) {
      await rommix.refreshEmulators()
    }

    // Repointing a platform at another emulator — or remapping one to a
    // different folder — changes which downloads count as present, so the
    // renderer's copy of the list is stale the moment this returns.
    if (
      'emulatorPaths' in patch ||
      'emulatorPriority' in patch ||
      'emulatorRoots' in patch ||
      'systemEmulators' in patch ||
      'systemOverrides' in patch ||
      // Moving the whole library between the emulators' trees and RomMix's own
      // changes where every game is looked for, so every entry's answer to "is
      // this here" is decided afresh.
      'romStorage' in patch
    ) {
      // Reordering counts: the emulator now in charge of a platform keeps its
      // games in its own tree, so a copy downloaded for the previous one is in
      // a folder the new one never reads. `downloads.installed` already hides
      // those; without this the renderer goes on showing its last answer and
      // the games look downloaded when they are, for this emulator, not there.
      rommix.send('library:installed', downloads.installed)
    }

    // The only setting the main process itself has to act on: the zoom factor
    // lives on the window, not in the stylesheet.
    if ('uiScale' in patch) rommix.applyUiScale()
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
    const source = descriptor ? releaseSource(descriptor) : null
    if (!source) {
      throw new RommError(`RomMix cannot install ${descriptor?.name ?? id} for you`)
    }
    return fetchReleases(source)
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
    const source = descriptor ? releaseSource(descriptor) : null
    if (!source) {
      throw new RommError(`RomMix cannot install ${descriptor?.name ?? id} for you`)
    }
    if (!isInstallableAsset(asset.name, source)) {
      throw new RommError(`${asset.name} is not something RomMix can run`)
    }
    // Re-checked rather than trusted: the list this came from was filtered, but
    // an emulator installed for the wrong architecture is recorded in settings
    // and then reports itself present, so the failure surfaces at every launch
    // instead of here.
    if (!builtForThisMachine(asset.name)) {
      throw new RommError(`${asset.name} is not built for this machine (${process.arch})`)
    }

    log.info('emulator', 'installing a release asset', {
      emulator: id,
      asset: asset.name,
      url: asset.url,
      sizeBytes: asset.sizeBytes
    })
    const path = await installAsset(id, asset, (progress) =>
      rommix.send('emulators:progress', progress)
    )
    store.updateSettings({
      emulatorPaths: { ...store.settings.emulatorPaths, [id]: path }
    })
    await rommix.refreshEmulators()
    log.info('emulator', 'installed', { emulator: id, path })
    return path
  })

  handle('system:diagnostics', async (): Promise<DiagnosticsReport> => {
    const emulators = await rommix.refreshEmulators()
    const hasFlatpak = await flatpakAvailable()
    // Only worth asking when there is a flatpak to ask: without the command the
    // answer is no for a reason the line above already gives.
    const hasFlathub = hasFlatpak ? await flathubConfigured() : false
    const notes: string[] = []

    // Said before "no emulator found", which is what it causes: RetroDECK,
    // RetroArch and shadPS4 are all flatpaks, so without the command none of
    // them can be found or installed, and every row below says "not installed"
    // for a reason that is nowhere on the screen.
    if (!hasFlatpak) {
      notes.push(
        'flatpak is not installed, so RomMix cannot find or install the emulators that are ' +
          'distributed that way. Install it from your distribution, then re-run this check.'
      )
    } else if (!hasFlathub) {
      // Said rather than left to fail: on a distribution that ships flatpak
      // without remotes, every emulator below reads "not installed" and the
      // line above reads "yes", which points at nothing. RomMix adds the remote
      // when an install is pressed, so this is a heads-up and not a blocker.
      notes.push(
        'Flathub is not set up for your user, so there is nowhere to install the flatpak ' +
          'emulators from yet. RomMix adds it the first time you install one, or you can add ' +
          'it yourself with: flatpak remote-add --user --if-not-exists flathub ' +
          'https://dl.flathub.org/repo/flathub.flatpakrepo'
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

    // Whichever tree downloads actually go to. With shared storage that is one
    // folder for the lot; otherwise it is one per emulator, and each is checked
    // separately — one unwritable folder is a real failure even when the others
    // are fine, and naming it is the difference between a fixable message and
    // "download failed".
    const shared = store.settings.romStorage === 'rommix'
    const romRoots = shared
      ? [{ name: 'RomMix', path: rootPaths().roms }]
      : emulators
          .filter((emulator) => emulator.available && emulator.paths.roms)
          .map((emulator) => ({ name: emulator.name, path: emulator.paths.roms as string }))

    const writable = await Promise.all(
      romRoots.map(async (root) => ({ ...root, ok: await isWritable(root.path) }))
    )
    for (const entry of writable.filter((e) => !e.ok)) {
      notes.push(
        `${entry.name}'s ROM folder ${entry.path} is not writable. Check its permissions, or ` +
          'that the drive it is on is mounted.'
      )
    }
    const romsWritable = writable.every((entry) => entry.ok)

    // The one setup step shared storage adds, and the one that makes it look
    // broken when it is skipped: the game downloads, RomMix reports it as
    // installed, and the emulator's own list is empty because nobody told it
    // where to look. Named here rather than in each descriptor's `setupNotes`,
    // which are fixed text and cannot know which way this setting is pointed.
    if (shared && emulators.some((emulator) => emulator.available)) {
      notes.push(
        `Games are downloaded to ${rootPaths().roms}. Add that folder to each emulator's own ` +
          'game directories, or they will not list what RomMix has downloaded.'
      )
    }

    // The whole picture in one place, since this is the report a person is
    // looking at when they decide the log is worth reading.
    log.info('diagnostics', 'pre-flight check', {
      flatpakAvailable: hasFlatpak,
      flathubConfigured: hasFlathub,
      available: emulators.filter((emulator) => emulator.available).map((emulator) => emulator.id),
      romsWritable,
      notes
    })

    return {
      flatpakAvailable: hasFlatpak,
      flathubConfigured: hasFlathub,
      emulators,
      romsWritable,
      logPath: log.path(),
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
    log.info('emulator', 'installing a flatpak from flathub', {
      emulator: id,
      appId: spec.appId
    })
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
    log.info('emulator', 'flatpak installed', { emulator: id, appId: spec.appId })
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
    // `ROMMIX_HOME` wins over the pointer file — see `resolveRoot` — so writing
    // one here would copy the configuration across, report success, and then be
    // ignored on the next launch. Settings already disables the button; this is
    // the same rule where it is actually enforceable.
    if (process.env.ROMMIX_HOME?.trim()) {
      throw new RommError(
        'ROMMIX_HOME is set, and it overrides the folder chosen here. Unset it and restart ' +
          'RomMix to move the folder from Settings.'
      )
    }
    // Copies the configuration across and repoints; the move only takes effect
    // once Electron restarts, since userData is fixed before the app starts.
    log.info('root', 'moving the RomMix folder', { from: resolveRoot(), to: target })
    relocateRoot(target)
    // Said here rather than after the restart: the next run's log is in the new
    // folder, so this line is the only record of where the old one went.
    log.info('root', 'moved; the log continues in the new folder after a restart')
    return { current: target, fallback: defaultRoot(), fromEnvironment: false }
  })

  handle('system:restart', () => {
    log.info('app', "restarting at the interface's request")
    app.relaunch()
    app.exit(0)
  })

  handle('system:toggleFullscreen', () => rommix.toggleFullscreen())
  handle('system:quit', () => app.quit())

  /**
   * Hand a web address to whatever the desktop opens links with.
   *
   * Restricted to http and https: this is a hole from the renderer straight out
   * to the desktop's URL handlers, and those cover a great deal more than the
   * web — `file:`, `.desktop` actions, anything a scheme has been registered
   * for. The renderer only ever passes RomMix's own constants, so a scheme
   * check costs nothing and stops the call being useful to anything else.
   *
   * A companion to the QR code rather than a replacement for it: on the couch
   * there is often no browser to open, and on gamescope there is nowhere for
   * one to appear.
   */
  handle('system:openExternal', async (url: string): Promise<void> => {
    if (!/^https?:\/\//i.test(url)) {
      throw new RommError('RomMix only opens web addresses')
    }
    log.info('app', 'opening a link in the desktop browser', { url })
    await shell.openExternal(url)
  })
}
