import { baseName, dirName, joinPath } from '../savepaths.ts'
import type { EmulatorDescriptor } from '../types.ts'
import { shadPs4SavePaths } from './saves.ts'

/**
 * shadPS4 — a PlayStation 4 emulator.
 *
 *  - It covers **exactly one system**, which is what the per-system pin in
 *    `settings.systemEmulators` is for.
 *  - A PS4 game is a **directory**, not a file: `eboot.bin` at its root, the
 *    metadata in `sce_sys/`, and the rest of the game beside them. What is
 *    launched is that `eboot.bin`, which is also what ES-DE's own `ps4` entry
 *    passes.
 *  - It needs **no BIOS**: it reimplements the system rather than running a
 *    dump, so there is no firmware for RomMix to place and `dirs.bios` names
 *    nothing. Games needing dumped system modules are shadPS4's own business.
 *  - Its saves are keyed by the game's **CUSA serial** rather than by the ROM
 *    name — see `saves.ts`, which reads the serial out of the game's own
 *    metadata.
 *
 * On Flathub as `net.shadps4.shadPS4` and published as a zipped AppImage
 * besides, so RomMix offers both and the user picks. It follows the usual XDG
 * layout, which the flatpak build takes inside its own tree.
 */
export const shadps4: EmulatorDescriptor = {
  id: 'shadps4',
  name: 'shadPS4',
  dispatch: 'rommix',
  frontend: false,
  install: [
    { kind: 'flatpak', appId: 'net.shadps4.shadPS4' },
    { kind: 'binary', names: ['shadps4'] },
    {
      kind: 'appimage',
      // The image inside the archive is `Shadps4-sdl.AppImage`; patterns match
      // case-insensitively, so this finds that as readily as a copy the user
      // renamed and dropped in their own AppImage folder.
      patterns: ['shadps4*.appimage'],
      release: {
        api: 'https://api.github.com/repos/shadps4-emu/shadPS4/releases',
        // `shadps4-linux-sdl-<version>.zip`, holding one AppImage that the
        // installer unpacks. Named in full because the macOS and Windows
        // builds are zips too.
        asset: /^shadps4-linux-.*\.zip$/i
      }
    }
  ],
  homepage: 'https://shadps4.net',
  systems: ['ps4'],
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    // shadPS4 has no ROM folder of its own: its game list is the directories
    // the user adds to it. RomMix's own folder is the honest answer, and one
    // the user can add there to see the games in shadPS4 too.
    roms: { base: 'rommix', path: 'roms' },
    saves: { base: 'data', path: 'shadps4/savedata' }
    // No `states`: shadPS4 has no save states. No `bios`: it needs no firmware
    // dump, and naming a directory that holds nothing would only make the
    // BIOS screen print a fiction.
  },
  // Fixed by the XDG layout, with nothing user-selectable and no configuration
  // file to read them from.
  layout: undefined,
  /**
   * A PS4 game *is* a directory — `eboot.bin` beside `sce_sys/` and the game's
   * data — so it keeps one, as ES-DE and every dump expect.
   */
  flatLibrary: false,
  saves: shadPs4SavePaths,
  bios: undefined,
  biosStagingNote: undefined,
  // shadPS4 is one emulator, not a core loader.
  core: undefined,
  /**
   * shadPS4 scans folders it has been told about, and RomMix's is not one of
   * them until the user says so.
   */
  setupNotes: ["Add RomMix's ROM folder to shadPS4, so its game list finds what you download."],
  env: undefined,
  // `exec` alone opens shadPS4's game list.
  open: undefined,
  /**
   * The executable inside the game directory, not whatever file happened to be
   * the largest.
   *
   * `chooseLaunchFile` ranks by descriptor extension and then by size, which
   * across ~195 systems is right; for a PS4 game it is not, because the entry
   * point is a small file with a fixed name sitting beside multi-gigabyte data
   * files. A `.pkg` is passed through untouched — that is a package for
   * shadPS4 to install rather than a game directory to run.
   */
  launch: ({ exec, romPath }) => {
    const name = baseName(romPath).toLowerCase()
    const game =
      name === 'eboot.bin' || name.endsWith('.pkg')
        ? romPath
        : joinPath(dirName(romPath), 'eboot.bin')
    // `-f true`, not a bare `-f`: shadPS4's fullscreen option takes an explicit
    // `true`/`false` rather than being a switch, unlike RetroArch's and Eden's.
    // Worth knowing if a future release changes it — a value where none is
    // expected becomes a second positional argument, and the launch fails.
    return [...exec, '-f', 'true', game]
  }
}
