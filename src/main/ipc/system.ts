import { app, shell } from 'electron'
import { EMULATORS } from '@config/emulators'
import type { DiagnosticsReport, RootLocation, Settings } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import { flatpakAvailable, flathubConfigured, isWritable } from '../host.ts'
import { setLanguage, t } from '../i18n.ts'
import { log } from '../log.ts'
import { defaultRoot, relocateRoot, resolveRoot, rootPaths } from '../root.ts'
import { RommError } from '../romm.ts'
import { isWebAddress } from '../weblink.ts'
import type { Handle } from './handler.ts'

/** Settings, the pre-flight check, and the app itself. */
export function registerSystemIpc(rommix: RomMixApp, handle: Handle): void {
  const { store, library } = rommix

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
      // a folder the new one never reads. `library.installed` already hides
      // those; without this the renderer goes on showing its last answer and
      // the games look downloaded when they are, for this emulator, not there.
      rommix.send('library:installed', library.installed)
    }

    // Two settings the main process itself has to act on. The zoom factor lives
    // on the window rather than in the stylesheet; the update policy owns a
    // timer, and turning checks on would otherwise wait for a restart to start
    // checking. Volunteering for release candidates restarts the same timer, so
    // the question is asked again with the new answer rather than in six hours.
    if ('uiScale' in patch) rommix.applyUiScale()
    if ('updates' in patch || 'updatePrereleases' in patch) rommix.updates.schedule()

    // The language, and the one answer the main process has already written in
    // the old one: `EmulatorState.unavailableReason` is a sentence produced by
    // the probe, so without re-running it every emulator row goes on explaining
    // itself in the language the user has just left. Everything else this
    // process says is produced at the moment it is asked for.
    if ('language' in patch) {
      setLanguage(next.language)
      await rommix.refreshEmulators()
    }
    return next
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
      notes.push(t('diagnostics.noFlatpak'))
    } else if (!hasFlathub) {
      // Said rather than left to fail: on a distribution that ships flatpak
      // without remotes, every emulator below reads "not installed" and the
      // line above reads "yes", which points at nothing. RomMix adds the remote
      // when an install is pressed, so this is a heads-up and not a blocker.
      notes.push(t('diagnostics.noFlathub'))
    }
    if (!emulators.some((emulator) => emulator.available)) {
      // Named from the registry rather than written out, so this cannot go on
      // recommending an emulator RomMix has stopped shipping a descriptor for.
      const suggestion = EMULATORS.find((descriptor) => descriptor.dispatch === 'self')
      notes.push(
        suggestion
          ? t('diagnostics.noEmulatorSuggest', { name: suggestion.name })
          : t('diagnostics.noEmulator')
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
      notes.push(t('diagnostics.romsNotWritable', { name: entry.name, path: entry.path }))
    }
    const romsWritable = writable.every((entry) => entry.ok)

    // The one setup step shared storage adds, and the one that makes it look
    // broken when it is skipped: the game downloads, RomMix reports it as
    // installed, and the emulator's own list is empty because nobody told it
    // where to look. Named here rather than in each descriptor's `setupNotes`,
    // which are fixed text and cannot know which way this setting is pointed.
    if (shared && emulators.some((emulator) => emulator.available)) {
      notes.push(t('diagnostics.sharedFolder', { path: rootPaths().roms }))
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

  /** Where RomMix keeps its own files, and where it would by default. */
  handle('system:root', (): RootLocation => ({
    current: resolveRoot(),
    fallback: defaultRoot(),
    fromEnvironment: Boolean(process.env.ROMMIX_HOME?.trim())
  }))

  handle('system:setRoot', (next: string): RootLocation => {
    const target = next.trim()
    if (!target.startsWith('/')) {
      throw new RommError(t('error.rootMustBeAbsolute'))
    }
    // `ROMMIX_HOME` wins over the pointer file — see `resolveRoot` — so writing
    // one here would copy the configuration across, report success, and then be
    // ignored on the next launch. Settings already disables the button; this is
    // the same rule where it is actually enforceable.
    if (process.env.ROMMIX_HOME?.trim()) {
      throw new RommError(t('error.romMixHomeSet'))
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
   * Restricted to http and https by `isWebAddress`, which says why and is the
   * same rule the window's own link handler applies.
   *
   * A companion to the QR code rather than a replacement for it: on the couch
   * there is often no browser to open, and on gamescope there is nowhere for
   * one to appear.
   */
  handle('system:openExternal', async (url: string): Promise<void> => {
    if (!isWebAddress(url)) {
      throw new RommError(t('error.onlyWebAddresses'))
    }
    log.info('app', 'opening a link in the desktop browser', { url })
    await shell.openExternal(url)
  })
}
