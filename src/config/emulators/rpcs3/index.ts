import { dirName, joinPath, shared } from '../savepaths.ts'
import type { SaveEnvironment } from '../savepaths.ts'
import type { EmulatorDescriptor } from '../types.ts'

/**
 * RPCS3 — a PlayStation 3 emulator.
 *
 *  - It covers **exactly one system**, which is what the per-system pin in
 *    `settings.systemEmulators` is for.
 *  - A disc dump is a **directory**: `PS3_GAME/USRDIR/EBOOT.BIN` is the entry
 *    point, beside gigabytes of data. A PSN game drops the `PS3_GAME` level.
 *    An `.iso` is opened as it is.
 *  - Its firmware is **installed by RPCS3 itself** from Sony's `.PUP`, into its
 *    own `dev_flash`, so there is nothing for RomMix to place and `dirs.bios`
 *    names nothing.
 *  - Its saves are keyed by the **PS3 title id** rather than by the ROM name,
 *    so the save tree is reported as shared, the same answer RetroDECK's and
 *    EmuDeck's RPCS3 give.
 *
 * On Flathub as `net.rpcs3.RPCS3` and published as an AppImage besides. It
 * keeps everything under `$XDG_CONFIG_HOME/rpcs3`, which the flatpak build
 * takes inside its own tree.
 */
export const rpcs3: EmulatorDescriptor = {
  id: 'rpcs3',
  name: 'RPCS3',
  dispatch: 'rommix',
  install: [
    { kind: 'flatpak', appId: 'net.rpcs3.RPCS3' },
    { kind: 'binary', names: ['rpcs3'] },
    {
      kind: 'appimage',
      patterns: ['rpcs3*.appimage'],
      release: {
        // `latest` rather than the list: every release in this repository
        // carries the same creation date, so the list comes back in an order
        // that says nothing about which build is newest.
        api: 'https://api.github.com/repos/RPCS3/rpcs3-binaries-linux/releases/latest',
        // `rpcs3-v<version>-<build>-<sha>_linux64.AppImage`. The ARM build is
        // published from another repository.
        asset: /^rpcs3-.*_linux64\.AppImage$/i
      }
    }
  ],
  homepage: 'https://rpcs3.net',
  systems: ['ps3'],
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    // RPCS3 has no ROM folder of its own: its game list is the directories the
    // user adds to it. RomMix's own folder is the honest answer.
    roms: { base: 'rommix', path: 'roms' },
    saves: { base: 'config', path: 'rpcs3/dev_hdd0/home/00000001/savedata' },
    states: { base: 'config', path: 'rpcs3/savestates' }
    // No `bios`: the firmware is installed through RPCS3's own menu.
  },
  // Fixed by the XDG layout. The emulated user is RPCS3's first, which is the
  // only one most installs ever have.
  layout: undefined,
  /** A disc dump is a directory — `PS3_GAME/` beside `PS3_DISC.SFB` — so it keeps one. */
  flatLibrary: false,
  // RPCS3 is handed each game by path.
  needsRomFolders: false,
  /**
   * `savedata/<title id><suffix>/`, one folder per save beside every other
   * game's. The title id is in the game's `PARAM.SFO`, which nothing here
   * reads, so the tree is skipped rather than uploaded under one game's id.
   */
  saves: (ctx) => ({
    saves: ctx.paths.saves ? shared(ctx.paths.saves) : null,
    states: ctx.paths.states ? shared(ctx.paths.states) : null,
    unsyncableReason: 'saves.rpcs3'
  }),
  bios: undefined,
  biosStagingNote: undefined,
  // RPCS3 is one emulator, not a core loader.
  core: undefined,
  setupNotes: [],
  env: undefined,
  // `exec` alone opens RPCS3's game list.
  open: undefined,
  /**
   * The game's `EBOOT.BIN`, not whatever file happened to be the largest.
   *
   * `chooseLaunchFile` nominates the largest file, which in a disc dump is a
   * data file somewhere under `PS3_GAME/USRDIR/`, or the firmware update in
   * `PS3_UPDATE/`. RPCS3 boots the executable, so it is looked for above the
   * file that was chosen. An `.iso`, or anything with no executable above it,
   * is passed as it is.
   */
  launch: ({ exec, romPath, env }) => [...exec, '--no-gui', ps3Executable(env, romPath)]
}

/** How far above the chosen file a game's root is looked for. */
const MAX_DEPTH = 6

/** The `EBOOT.BIN` of the game holding `romPath`, or `romPath` when there is none. */
export function ps3Executable(env: SaveEnvironment, romPath: string): string {
  let dir = dirName(romPath)
  for (let depth = 0; depth < MAX_DEPTH && dir !== '/'; depth += 1) {
    for (const candidate of [
      joinPath(dir, 'PS3_GAME', 'USRDIR', 'EBOOT.BIN'),
      joinPath(dir, 'USRDIR', 'EBOOT.BIN')
    ]) {
      if (env.exists(candidate)) return candidate
    }
    dir = dirName(dir)
  }
  return romPath
}
