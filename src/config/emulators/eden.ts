import type { EmulatorDescriptor } from './types.ts'

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
 *    filename, so `per-game-dir` marks them as outside what the filename-stem
 *    matcher in save sync can handle. Nothing is synced rather than something
 *    wrong being synced.
 *
 * Being Yuzu-derived it follows the usual XDG layout — `~/.config/eden` and
 * `~/.local/share/eden` — which an AppImage uses directly, since it is not
 * sandboxed.
 */
export const eden: EmulatorDescriptor = {
  id: 'eden',
  name: 'Eden',
  dispatch: 'rommix',
  install: [
    // Listed first so a packaged build is preferred if one ever appears; today
    // only the AppImage pattern matches anything.
    { kind: 'binary', names: ['eden'] },
    { kind: 'appimage', patterns: ['eden*.appimage'] }
  ],
  systems: ['switch'],
  /**
   * Eden's own Forgejo instance, not a GitHub mirror: the
   * github.com/eden-emulator/Releases repository answers HTTP 451, having been
   * blocked following a DMCA notice, so anything built against it would be
   * dead on arrival. This endpoint needs no authentication.
   */
  releases: {
    api: 'https://git.eden-emu.dev/api/v1/repos/eden-emu/eden/releases',
    assetSuffix: '.AppImage',
    homepage: 'https://eden-emu.dev'
  },
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
  saveLayout: 'per-game-dir',
  saveTree: 'flat',
  /**
   * Eden's game list is the directories it has been given, read one level
   * deep. A game unpacked into a folder of its own would never appear in it,
   * so a multi-file title is put loose beside everything else — which is also
   * how updates and DLC have to sit for its NAND installer to find them.
   */
  flatLibrary: true,
  /**
   * Only the key files belong in `keys/`. A firmware dump is hundreds of NCAs
   * that Eden has to register into its own NAND — dropping them into the tree
   * leaves a NAND that looks populated and is not — so those are staged in
   * RomMix's `bios/switch` for the user to install from.
   */
  biosAccepts: ['.keys'],
  biosStagingNote:
    'Firmware cannot be put in place by RomMix: Eden has to register it into its own NAND. ' +
    'RomMix has downloaded it to the folder below — install it from Eden with ' +
    'Tools → Install Firmware, pointing it at that folder.',
  /**
   * Both of these are consequences of the descriptor above, and both look like
   * RomMix failing when they are not done.
   *
   * Eden ships no ROM folder, so `dirs.roms` points into RomMix's own — a
   * directory Eden knows nothing about until it is added under Game
   * Directories. And updates and DLC are installed into the NAND through Eden's
   * own installer rather than being files beside the game, so a downloaded
   * update sitting in the ROM folder does nothing at all.
   */
  setupNotes: [
    'Add RomMix\'s ROM folder to Eden under File → Game Directories, or your downloads will not appear in Eden\'s own game list.',
    'Game updates and DLC have to be installed into Eden\'s NAND from File → Install Files to NAND. A patch downloaded next to the game is not applied on its own.'
  ],
  launch: ({ exec, romPath }) => [...exec, romPath]
}
