import { switchSavePaths } from '../switch-saves.ts'
import type { EmulatorDescriptor } from '../types.ts'

/**
 * Eglantine — a Nintendo Switch 2 emulator forked from Eden
 * (github.com/Djihads80/Eglantine).
 *
 *  - It runs **only the Switch 2**. Eden stays the Switch emulator, so the two
 *    never compete for a system.
 *  - It is **found, never installed**. Every release is a prerelease whose tag
 *    is deleted and made again with each build, so there is no feed stable
 *    enough to download from, and the AppImage route names no release.
 *  - It needs **no BIOS step**: `.nup` content is not encrypted, so there are
 *    no keys to place and no firmware to register.
 *  - Its saves follow Eden's NAND tree, keyed by **title id**. The id is read
 *    through the Switch save layout, which does not read a `.nup` — so a game
 *    whose title id it cannot find is reported as unsyncable rather than synced
 *    somewhere wrong.
 *
 * Being Eden-derived it follows the XDG layout under its own name —
 * `EDEN_DIR` is `eglantine` in its `common/fs/fs_paths.h` — which an AppImage
 * uses directly, since it is not sandboxed.
 */
export const eglantine: EmulatorDescriptor = {
  id: 'eglantine',
  name: 'Eglantine',
  dispatch: 'rommix',
  install: [
    { kind: 'binary', names: ['eglantine'] },
    // Its builds are named `eglantine-linux-<arch>[-pgo].AppImage`.
    { kind: 'appimage', patterns: ['eglantine*.appimage'], release: null }
  ],
  homepage: 'https://github.com/Djihads80/Eglantine',
  systems: ['switch2'],
  // One Switch 2 emulator, one way to run a game.
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    // Like Eden it ships no ROM folder of its own and lists the directories it
    // is given, so RomMix's folder is the one to add there.
    roms: { base: 'rommix', path: 'roms' },
    saves: { base: 'data', path: 'eglantine/nand/user/save' }
    // No `states`: the Yuzu lineage keeps save states inside the profile data.
    // No `bios`: nothing in a `.nup` is encrypted, so there is nothing to place.
  },
  // Its folders follow the XDG layout, with nothing user-selectable.
  layout: undefined,
  // Its game list reads the directories it is given one level deep, as Eden's.
  flatLibrary: true,
  // It opens with an empty game list, and the first setup note says to add
  // RomMix's folder.
  needsRomFolders: true,
  /**
   * `nand/user/save/<space>/<profile>/<title id>/`, the same tree as Eden, and
   * synced whole for the same reason — see `switch-saves.ts`.
   */
  saves: (ctx) => switchSavePaths(ctx, ctx.paths.saves, 'Eglantine'),
  bios: undefined,
  biosStagingNote: undefined,
  // Eglantine is one emulator, not a core loader.
  core: undefined,
  /**
   * In the order they are met: get games listed, get past the first start, be
   * able to play, be able to stop.
   *
   * The migration dialog is raised on the first start whenever another Yuzu-
   * lineage install — Eden's above all — is on the machine, and it blocks until
   * answered. Started by RomMix, that is a launch that never reaches the game
   * while RomMix waits on it, so it is answered once by hand.
   *
   * Eglantine keeps Eden's confirm-on-exit (`confirm_before_stopping`, asked in
   * `MainWindow::ConfirmClose`), so the SIGTERM sent by Close the emulator
   * raises a dialog rather than closing it. None of this is done for the user:
   * RomMix does not write into another program's configuration.
   */
  setupNotes: [
    'setup.eglantineRoms',
    'setup.eglantineMigration',
    'setup.eglantineControls',
    'setup.eglantineExitConfirm'
  ],
  env: undefined,
  // `exec` alone opens Eglantine with no game.
  open: undefined,
  /**
   * `-f` and `-g`, the options Eden inherits from yuzu and Eglantine from Eden:
   * fullscreen over RomMix's own window rather than a remembered small one, and
   * the game named by option so a file name starting with a dash is not read
   * as one.
   */
  launch: ({ exec, system, romPath }) =>
    system === 'switch2' ? [...exec, '-f', '-g', romPath] : null
}
