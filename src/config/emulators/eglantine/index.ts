import { joinPath } from '../savepaths.ts'
import { switchSavePaths } from '../switch-saves.ts'
import type { EmulatorDescriptor } from '../types.ts'

/** Its save tree, under the XDG data root. */
const SAVES = 'eglantine/nand/user/save'

/** The same tree in builds made before the folder was renamed — Eden's own. */
const PRE_RENAME_SAVES = 'eden/nand/user/save'

/** The pre-rename tree beside `saves`, the resolved current one. */
function preRenameSaves(saves: string | null): string[] {
  if (!saves?.endsWith(`/${SAVES}`)) return []
  return [joinPath(saves.slice(0, -SAVES.length), PRE_RENAME_SAVES)]
}

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
 *    out of the `.nup` itself, chosen as Eglantine chooses it — see
 *    `nupTitleId` — and a game whose title id cannot be found is reported as
 *    unsyncable rather than synced somewhere wrong.
 *
 * Being Eden-derived it follows the XDG layout, which an AppImage uses directly
 * since it is not sandboxed — under its own name in current builds (`EDEN_DIR`
 * in its `common/fs/fs_paths.h`), and under Eden's in builds made before that
 * folder was renamed. Its releases are rebuilt in place, so both are in use at
 * once, and its saves are looked for under either — see `switchSavePaths`.
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
    saves: { base: 'data', path: SAVES }
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
   * synced whole for the same reason — see `switch-saves.ts`. The pre-rename
   * tree is Eden's, so it is used only where it already holds Switch 2 saves.
   */
  saves: (ctx) =>
    switchSavePaths(ctx, ctx.paths.saves, 'Eglantine', preRenameSaves(ctx.paths.saves)),
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
  // Unlike Eden's, its AppImage is built with linuxdeploy and carries Qt's
  // Wayland plugins, with no hook forcing X11 — so nothing to switch off.
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
