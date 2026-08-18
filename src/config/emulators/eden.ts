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
  launch: ({ exec, romPath }) => [...exec, romPath]
}
