import type { EmulatorDescriptor } from './types.ts'

/**
 * Eden — a Nintendo Switch emulator continuing the Yuzu codebase.
 *
 * Eden is the descriptor that justifies the registry: it breaks every
 * assumption the RetroDECK/RetroArch pair quietly shared.
 *
 *  - It is **not on Flathub**. It ships as an AppImage from its own releases,
 *    so it is found by looking for a file rather than by `flatpak info`.
 *  - It covers **exactly one system**, so a single global "preferred emulator"
 *    can never be the right way to select it — that is what the per-system
 *    pin in `settings.systemEmulators` is for.
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
 * sandboxed. The paths below are resolved from those roots, so the pre-flight
 * check in Settings prints exactly what RomMix concluded: verify them against
 * a real install before trusting the BIOS and save wiring.
 */
export const eden: EmulatorDescriptor = {
  id: 'eden',
  name: 'Eden',
  role: 'standalone',
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
  ownsLibrary: false,
  dirs: {
    saves: { base: 'data', path: 'eden/nand/user/save' },
    // Yuzu-lineage emulators have no separate save-state tree; states live
    // with the rest of the profile data.
    states: { base: 'data', path: 'eden/states' },
    bios: { base: 'data', path: 'eden/keys' }
  },
  saveLayout: 'per-game-dir',
  launch: ({ exec, romPath }) => [...exec, romPath]
}
