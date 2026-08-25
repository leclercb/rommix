import { switchSavePaths } from '../switch-saves.ts'
import type { EmulatorDescriptor } from '../types.ts'

/**
 * Eden — a Nintendo Switch emulator continuing the Yuzu codebase.
 *
 *  - It is **not on Flathub**. It ships as an AppImage from its own releases,
 *    so it is found by looking for a file rather than by `flatpak info`.
 *  - It covers **exactly one system**, which is what the per-system pin in
 *    `settings.systemEmulators` is for.
 *  - Its "BIOS" is **not a file you drop in a folder**. It needs `prod.keys`
 *    in the keys directory and a firmware *dump* under `nand/`, which is not a
 *    copy RomMix can perform. `dirs.bios` therefore points at the keys
 *    directory so the pre-flight check can show it, and nothing is placed
 *    automatically.
 *  - Its saves live under `nand/user/save/…` keyed by **title id**, not by ROM
 *    filename. The id is read from the ROM's own metadata and the profile
 *    folder from disk, so the folder *is* findable — see `switch-saves.ts` —
 *    and it is synced whole. Where the id cannot be read, nothing is synced
 *    rather than something wrong being synced.
 *
 * Being Yuzu-derived it follows the usual XDG layout — `~/.config/eden` and
 * `~/.local/share/eden` — which an AppImage uses directly, since it is not
 * sandboxed.
 */
export const eden: EmulatorDescriptor = {
  id: 'eden',
  name: 'Eden',
  dispatch: 'rommix',
  frontend: false,
  install: [
    // Listed first so a packaged build is preferred if one ever appears; today
    // only the AppImage pattern matches anything.
    { kind: 'binary', names: ['eden'] },
    {
      kind: 'appimage',
      patterns: ['eden*.appimage'],
      /**
       * Eden's own Forgejo instance, not a GitHub mirror: the
       * github.com/eden-emulator/Releases repository answers HTTP 451, having
       * been blocked following a DMCA notice, so anything built against it
       * would be dead on arrival. This endpoint needs no authentication.
       */
      release: {
        api: 'https://git.eden-emu.dev/api/v1/repos/eden-emu/eden/releases',
        // Anchored, so the `.AppImage.zsync` update manifest beside every
        // build is not offered as a download that cannot run.
        asset: /\.AppImage$/i
      }
    }
  ],
  homepage: 'https://eden-emu.dev',
  systems: ['switch'],
  // One Switch emulator, one way to run a game.
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    // Eden ships no ROM folder at all: `Paths\romsPath` is empty and its game
    // list is the virtual SDMC/NAND entries plus directories the user adds.
    // RomMix's own folder is therefore the honest answer, and it is one the
    // user can add under Eden's Game Directories to see them there too.
    roms: { base: 'rommix', path: 'roms' },
    saves: { base: 'data', path: 'eden/nand/user/save' },
    // No `states`: Yuzu-lineage emulators keep save states inside the profile
    // data rather than in a tree of their own, and naming a directory that does
    // not exist would only make the diagnostics panel print a fiction.
    bios: { base: 'data', path: 'eden/keys' }
  },
  // Eden's folders follow the XDG layout, with nothing user-selectable and no
  // configuration file to read them from.
  layout: undefined,
  /**
   * Eden's game list is the directories it has been given, read one level
   * deep. A game unpacked into a folder of its own would never appear in it,
   * so a multi-file title is put loose beside everything else — which is also
   * what makes its updates and DLC apply, since Eden takes external content
   * from the game directories rather than needing it installed to the NAND.
   */
  flatLibrary: true,
  /**
   * `nand/user/save/<space>/<profile>/<title id>/`, resolved per game.
   *
   * The title id is read out of the ROM's own metadata entry and the profile
   * off disk — see `switch-saves.ts`. That folder is the unit of save data, so
   * it is synced as one archive: the files inside it carry no name that ties
   * them to a game, and uploading them individually would produce a pile of
   * `01.dat`s on the server belonging to nothing in particular.
   */
  saves: (ctx) => switchSavePaths(ctx, ctx.paths.saves, 'Eden'),
  /**
   * `dirs.bios` is already `keys/`, so a key file needs no subdirectory of its
   * own. Everything else is refused: a firmware dump is hundreds of NCAs that
   * Eden has to register into its own NAND — dropping them into the tree leaves
   * a NAND that looks populated and is not — so those are staged in RomMix's
   * `bios/switch` for the user to install from.
   */
  bios: ({ fileName, paths }) => (fileName.toLowerCase().endsWith('.keys') ? paths.bios : null),
  biosStagingNote: 'setup.edenStaging',
  // Eden is one emulator, not a core loader.
  core: undefined,
  /**
   * What is left for the user once RomMix has done what it can — kept to two
   * lines, since the BIOS screen already explains for every Switch emulator
   * that keys and firmware come from a console dump.
   *
   * Eden ships no ROM folder, so `dirs.roms` points into RomMix's own, which
   * Eden knows nothing about until it is added. Firmware then has to be
   * registered into its NAND by Eden itself. Updates and DLC need no note at
   * all: `flatLibrary` puts them beside the game, which is where Eden's *Use
   * external content from game directories* already looks.
   */
  setupNotes: ['setup.edenRoms', 'setup.edenFirmware'],
  /**
   * Set by the AppImage's own `wayland-is-broken.hook`, not by Eden itself.
   * Unset, the hook forces the process onto X11 — `QT_QPA_PLATFORM=xcb`,
   * `SDL_VIDEO_DRIVER=x11`, `GDK_BACKEND=x11`, and it unsets WAYLAND_DISPLAY —
   * which fails outright on a session with no X server, i.e. a plain Wayland
   * desktop or the gamescope sessions RomMix targets.
   *
   * Set to 1 the hook does nothing at all: it does not select Wayland, it just
   * stops overriding, leaving Qt and SDL to auto-detect. So on pure X11 this is
   * a no-op. The one case it changes is a Wayland session that *also* has
   * Xwayland, where Eden would otherwise have taken the xcb path upstream
   * considers more stable — remove this if you prefer that.
   */
  env: { I_WANT_A_BROKEN_WAYLAND_UI: '1' },
  // `exec` alone opens Eden with no game.
  open: undefined,
  /**
   * `-f` for fullscreen and `-g` to name the game — yuzu's own options, which
   * Eden inherits, and the same pair EmuDeck's `eden.sh` passes.
   *
   * Without `-f` Eden restores whatever window geometry its config remembers,
   * which on a first run is a small window opening on top of RomMix's own
   * fullscreen one: a game started from the couch lands in a corner of the
   * television. The flag wins over the config for that session only, so a user
   * who prefers windowed play still has it the moment they start Eden itself.
   *
   * `-g` rather than the bare positional path both take: yuzu's positional
   * argument is parsed only after getopt is done with the rest, so a ROM whose
   * filename begins with a dash is read as an option and the launch fails.
   */
  launch: ({ exec, romPath }) => [...exec, '-f', '-g', romPath]
}
