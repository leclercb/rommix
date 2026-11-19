import { chmod, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import { emulatorById, isInstallableAsset, locatable, releaseSource } from '@config/emulators'
import type { EmulatorAsset, EmulatorRelease, EmulatorState } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import { prepareRomFolders } from '../emulators.ts'
import { installFlatpak } from '../host.ts'
import { log } from '../log.ts'
import { realHome } from '../xdg.ts'
import { builtForThisMachine, fetchReleases, installAsset, recordRelease } from '../releases.ts'
import { RommError } from '../romm/index.ts'
import { t } from '../i18n.ts'
import type { Handle } from './handler.ts'

/**
 * Re-probe, then make the folders the emulator that has just arrived will look
 * for games in.
 *
 * In that order and not the other: where its folders are is part of what the
 * probe works out, and before it has run there is nothing to make them under.
 * See `prepareRomFolders`.
 */
async function settleRomFolders(rommix: RomMixApp, id: string): Promise<void> {
  const states = await rommix.refreshEmulators()
  const state = states.find((emulator) => emulator.id === id)
  if (state) await prepareRomFolders(state)
}

/** Putting an emulator on the machine, and running one on its own. */
export function registerEmulatorIpc(rommix: RomMixApp, handle: Handle): void {
  const { store, launcher } = rommix

  /**
   * What the last probe found, without re-running it.
   *
   * Separate from `system:diagnostics`, which probes afresh and asks the host
   * about flatpak and about every ROM folder it can write to. A screen that
   * only wants to know whether anything here can run a platform would be
   * paying for all of that every time a game is opened.
   */
  handle('emulators:states', (): Promise<EmulatorState[]> => rommix.ensureEmulators())

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
    if (!state) throw new RommError(t('error.unknownEmulator', { id }))
    if (!state.install) throw new RommError(t('error.emulatorNotInstalled', { name: state.name }))
    // Announced as "something has the screen", the same state a launch raises:
    // the emulator opens fullscreen over RomMix, and without the overlay the
    // user is inside it with no way back. Sent after it has survived long
    // enough to count as started — before that, `runEmulator` rejects and there
    // is nothing to be in front of.
    const command = await launcher.runEmulator(state, () =>
      rommix.send('running:state', { running: false, romId: null, emulator: null, stage: null })
    )
    rommix.send('running:state', { running: true, romId: null, emulator: state.name, stage: null })
    return command
  })

  /** Releases RomMix could install for this emulator, newest first. */
  handle('emulators:releases', async (id: string): Promise<EmulatorRelease[]> => {
    const descriptor = emulatorById(id)
    const source = descriptor ? releaseSource(descriptor) : null
    if (!source) {
      throw new RommError(t('error.cannotInstall', { name: descriptor?.name ?? id }))
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
      throw new RommError(t('error.cannotInstall', { name: descriptor?.name ?? id }))
    }
    if (!isInstallableAsset(asset.name, source)) {
      throw new RommError(t('error.assetNotRunnable', { asset: asset.name }))
    }
    // Re-checked rather than trusted: the list this came from was filtered, but
    // an emulator installed for the wrong architecture is recorded in settings
    // and then reports itself present, so the failure surfaces at every launch
    // instead of here.
    if (!builtForThisMachine(asset.name)) {
      throw new RommError(t('error.assetWrongArch', { asset: asset.name, arch: process.arch }))
    }

    /**
     * The asset is looked up again rather than taken as sent.
     *
     * Everything that arrives on this channel is renderer input, and all three
     * fields decide something the machine then does: the name becomes a path
     * under the managed directory, the URL decides which host the bytes come
     * from, and the digest is the only thing standing between those bytes and
     * a file this process makes executable. A null digest skips the check
     * altogether.
     *
     * Re-listing costs one request on a button press that is about to download
     * an emulator, and it makes the release source — not the renderer — the
     * authority on all three.
     */
    const release = (await fetchReleases(source)).find((candidate) =>
      candidate.assets.some((listed) => listed.name === asset.name)
    )
    const listed = release?.assets.find((candidate) => candidate.name === asset.name)
    if (!release || !listed) {
      throw new RommError(t('error.assetNotRunnable', { asset: asset.name }))
    }

    log.info('emulator', 'installing a release asset', {
      emulator: id,
      asset: listed.name,
      url: listed.url,
      sizeBytes: listed.sizeBytes
    })
    const path = await installAsset(id, listed, (progress) =>
      rommix.send('emulators:progress', progress)
    )
    await recordRelease(id, release.tag)
    store.updateSettings({
      emulatorPaths: { ...store.settings.emulatorPaths, [id]: path }
    })
    await settleRomFolders(rommix, id)
    log.info('emulator', 'installed', { emulator: id, path })
    return path
  })

  /**
   * Adopt an AppImage the user already has, picked in a file dialog.
   *
   * The dialog runs here rather than in the renderer, so the path recorded is
   * one the user chose and never one a page sent. Resolves to null when the
   * dialog is cancelled.
   */
  handle('emulators:locate', async (id: string): Promise<string | null> => {
    const descriptor = emulatorById(id)
    if (!descriptor || !locatable(descriptor)) {
      throw new RommError(t('error.cannotInstall', { name: descriptor?.name ?? id }))
    }
    const options: OpenDialogOptions = {
      title: t('emulator.locateTitle', { name: descriptor.name }),
      defaultPath: realHome(),
      properties: ['openFile'],
      filters: [{ name: 'AppImage', extensions: ['AppImage', 'appimage'] }]
    }
    const parent = BrowserWindow.getFocusedWindow()
    const picked = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    const path = picked.filePaths[0]
    if (picked.canceled || !path) return null

    // The filter is a suggestion the dialog lets the user switch off, and
    // `resolveInstall` only takes a configured path as an AppImage by its name.
    if (!path.toLowerCase().endsWith('.appimage')) {
      throw new RommError(t('error.assetNotRunnable', { asset: basename(path) }))
    }
    // A browser download arrives without the execute bit, and an AppImage
    // without it fails at launch with nothing on screen saying why.
    const { mode } = await stat(path)
    if ((mode & 0o100) === 0) await chmod(path, mode | 0o100)

    store.updateSettings({
      emulatorPaths: { ...store.settings.emulatorPaths, [id]: path }
    })
    await settleRomFolders(rommix, id)
    log.info('emulator', 'located', { emulator: id, path })
    return path
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
      throw new RommError(t('error.notAFlatpak', { name: descriptor?.name ?? id }))
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
    await settleRomFolders(rommix, id)
    log.info('emulator', 'flatpak installed', { emulator: id, appId: spec.appId })
  })
}
