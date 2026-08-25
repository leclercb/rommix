import { emulatorById, isInstallableAsset, releaseSource } from '@config/emulators'
import type { EmulatorAsset, EmulatorRelease } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import { installFlatpak } from '../host.ts'
import { log } from '../log.ts'
import { builtForThisMachine, fetchReleases, installAsset } from '../releases.ts'
import { RommError } from '../romm.ts'
import { t } from '../i18n.ts'
import type { Handle } from './handler.ts'

/** Putting an emulator on the machine, and running one on its own. */
export function registerEmulatorIpc(rommix: RomMixApp, handle: Handle): void {
  const { store, launcher } = rommix

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
    return launcher.runEmulator(state)
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
    await rommix.refreshEmulators()
    log.info('emulator', 'flatpak installed', { emulator: id, appId: spec.appId })
  })
}
