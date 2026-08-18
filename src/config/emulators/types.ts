/**
 * The shape of an emulator entry.
 *
 * Everything RomMix needs to drive an emulator is declared here rather than
 * decided in the code that uses it: where ROMs are written, which process is
 * spawned, where saves and BIOS files live, and how the save tree is laid out.
 * Those have different natural keys — ROMs belong to a *platform*, a process to
 * a *platform + emulator* pair, and BIOS layout to the emulator alone — so a
 * single "which emulator" preference cannot express them.
 *
 * A descriptor is pure data plus one argv builder, so it can be unit-tested
 * without touching the filesystem. Anything that has to look at the machine —
 * is it installed, where did it put its config — is the main process's job, in
 * `src/main/emulators.ts`.
 */

/** Stable identifier for an emulator, e.g. 'retrodeck'. Persisted in settings. */
export type EmulatorId = string

/**
 * Who decides which emulator core actually runs a game.
 *
 * `self` means the program is handed the system and resolves the emulator from
 * its own configuration — RetroDECK reading its es_systems.xml. `rommix` means
 * RomMix names it, as with RetroArch, where the libretro core is chosen here
 * and passed on the command line.
 *
 * The distinction is *who chooses*, not how the program markets itself:
 * RetroArch is plainly a frontend for libretro cores, yet it belongs on the
 * `rommix` side because RomMix picks the core.
 */
export type EmulatorDispatch = 'self' | 'rommix'

/**
 * How the program might be installed. Tried in order, first hit wins.
 *
 * `appimage` exists because not every emulator ships on Flathub — Eden is
 * AppImage-only — and an AppImage is a loose file in a download folder rather
 * than something on PATH, so it has to be looked for by name.
 */
export type InstallSpec =
  | { kind: 'flatpak'; appId: string }
  | { kind: 'binary'; names: readonly string[] }
  | { kind: 'appimage'; patterns: readonly string[] }

/**
 * Where an emulator's own releases can be listed, for emulators RomMix can
 * install itself. Only Forgejo/Gitea-shaped APIs are modelled, which is what
 * Eden publishes; a distro package or flatpak needs none of this.
 */
export interface ReleaseSource {
  /** Endpoint returning the release list. */
  api: string
  /**
   * Exact filename suffix of a usable download. An exact suffix rather than a
   * substring on purpose: Eden ships `.AppImage.zsync` update files beside
   * every `.AppImage`, and offering one as an emulator would be a download
   * that cannot run.
   */
  assetSuffix: string
  /** Human-readable home page, shown next to the picker. */
  homepage: string
}

/** An install that was actually found. `ref` is a flatpak app id or a path. */
export interface ResolvedInstall {
  kind: 'flatpak' | 'binary' | 'appimage'
  ref: string
}

/**
 * Base directory a path template hangs off. `config` and `data` follow the
 * install kind: a flatpak keeps them under ~/.var/app/<app id>/, a native
 * install under the XDG roots. `rommix` is RomMix's own folder, for emulators
 * that have nowhere of their own to keep ROMs.
 */
export type DirBase = 'home' | 'config' | 'data' | 'rommix'

export interface DirSpec {
  base: DirBase
  /** Relative to the base; '' means the base directory itself. */
  path: string
}

export interface EmulationPaths {
  home: string | null
  roms: string | null
  saves: string | null
  states: string | null
  bios: string | null
}

/**
 * How the emulator stores per-game save data, which decides how much of it
 * RomMix can meaningfully sync to RomM:
 *
 *  - `per-game-file`  one file named after the ROM (libretro `.srm`). Synced.
 *  - `per-game-dir`   a directory per title, keyed by a title id rather than by
 *                     the ROM filename. Nothing here can be matched to a ROM,
 *                     so RomMix skips it rather than syncing the wrong game's
 *                     data.
 *  - `shared-device`  one memory card shared by every game (PCSX2, Dolphin).
 *                     Per-game sync is not expressible, so RomMix skips it.
 *  - `delegated`      a frontend's tree, whose layout depends on whichever
 *                     emulator the frontend chose. Walked heuristically.
 */
export type SaveLayout = 'per-game-file' | 'per-game-dir' | 'shared-device' | 'delegated'

/**
 * How the save and state directories are arranged beneath their roots.
 *
 * `system-nested` is a frontend's convention: `<saves>/<es-de system>/…`, with
 * standalone emulators one directory further down. `flat` is an emulator that
 * writes into the root itself, which is what RetroArch does — walking a system
 * subdirectory there would find nothing and, worse, *write* a pulled save into
 * a folder the emulator never reads.
 */
export type SaveTree = 'system-nested' | 'flat'

/** Extensions and patterns that identify save data on disk. */
export interface SaveFileConventions {
  /** Battery-save extensions, lowercase and including the dot. */
  saveExtensions: readonly string[]
  /** Matches a save state; libretro numbers them `.state1`, `.state2`, … */
  statePattern: RegExp
  /** How deep below a save root to look before giving up. */
  maxDepth: number
}

export interface LaunchContext {
  /** argv prefix that starts the program, already wrapped for the sandbox. */
  exec: readonly string[]
  /** ES-DE system directory name, e.g. 'snes'. */
  system: string
  romPath: string
}

export interface EmulatorDescriptor {
  readonly id: EmulatorId
  readonly name: string
  readonly dispatch: EmulatorDispatch
  readonly install: readonly InstallSpec[]
  /**
   * ES-DE systems this emulator runs.
   *
   * Always a concrete list, even for a frontend that resolves the emulator
   * itself: "it decides for itself" reads as "everything", and RetroDECK ships
   * no Switch emulator, so a Switch ROM sent to it fails at launch. A list that
   * can be wrong and corrected beats a claim that cannot be checked.
   */
  readonly systems: readonly string[]
  /**
   * True when the emulator owns a folder layout that RomMix has to discover
   * rather than create — which also means it is unusable until the emulator
   * has been run at least once and that layout exists.
   */
  readonly ownsLibrary: boolean
  /**
   * Path templates, resolved against whichever install was found.
   *
   * `roms` is where this emulator's games are written, and every emulator
   * declares one — the same rule saves follow. It is deliberately not a single
   * shared library: a game placed in the tree its emulator already scans is
   * still there when that emulator is started on its own, which a central
   * RomMix-only folder would quietly prevent.
   */
  readonly dirs: Partial<Record<keyof EmulationPaths, DirSpec>>
  readonly saveLayout: SaveLayout
  /** Arrangement below `dirs.saves` and `dirs.states`. */
  readonly saveTree: SaveTree
  /** Set when RomMix can fetch and install this emulator itself. */
  readonly releases?: ReleaseSource
  /**
   * Environment the emulator needs in order to start, merged over RomMix's own.
   * For things the emulator will not do for itself — not for tuning.
   */
  readonly env?: Readonly<Record<string, string>>
  /** argv to start this game, or null when the emulator cannot run the system. */
  launch(ctx: LaunchContext): string[] | null
}

/** A descriptor plus what probing the machine found out about it. */
export interface EmulatorState {
  id: EmulatorId
  name: string
  dispatch: EmulatorDispatch
  saveLayout: SaveLayout
  saveTree: SaveTree
  /** Installed, and usable right now. */
  available: boolean
  install: ResolvedInstall | null
  paths: EmulationPaths
  /** Why it is not available, phrased for the diagnostics panel. */
  unavailableReason: string | null
}
