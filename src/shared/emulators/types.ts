/**
 * The shape of an emulator entry.
 *
 * RomMix used to model emulators as a closed union of two "runners", and a
 * single global preference picked one for the whole app. That one choice then
 * decided four unrelated things at once: where ROMs are written, which process
 * is spawned, where saves live, and where BIOS files go. A third emulator
 * breaks all four, because those decisions have different natural keys — ROMs
 * belong to a *platform*, a process belongs to a *platform + emulator* pair,
 * and BIOS layout belongs to the emulator alone.
 *
 * A descriptor is therefore pure data plus one argv builder. It lives in
 * `shared` so it can be unit-tested without touching the filesystem; anything
 * that has to look at the machine — is it installed, where did it put its
 * config — is the main process's job, in `src/main/emulators.ts`.
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
 * "Frontend vs standalone" was the earlier name and it read wrong: RetroArch is
 * plainly a frontend for libretro cores, yet it belongs on the `rommix` side
 * because RomMix picks the core. The distinction that matters is *who chooses*,
 * not how the program markets itself.
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
 * install under the XDG roots.
 */
export type DirBase = 'home' | 'config' | 'data'

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
 *  - `per-game-file`  one file named after the ROM (libretro `.srm`). Syncable.
 *  - `per-game-dir`   a directory per title, usually keyed by a title id rather
 *                     than the filename. Syncable, but as an archive.
 *  - `shared-device`  one memory card shared by every game (PCSX2, Dolphin).
 *                     Per-game sync is not expressible, so RomMix skips it.
 *  - `delegated`      a frontend's tree, whose layout depends on whichever
 *                     emulator the frontend chose. Walked heuristically.
 */
export type SaveLayout = 'per-game-file' | 'per-game-dir' | 'shared-device' | 'delegated'

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
   * Always a concrete list, even for a frontend. An earlier design let a
   * frontend declare 'delegated' — "it decides for itself" — which read as
   * "everything" and was simply untrue: RetroDECK ships no Switch emulator, so
   * Switch ROMs were routed to it and failed at launch. A list that can be
   * wrong and corrected beats a claim that cannot be checked.
   */
  readonly systems: readonly string[]
  /**
   * True when the emulator owns a folder layout that RomMix has to discover
   * rather than create — which also means it is unusable until the emulator
   * has been run at least once and that layout exists.
   */
  readonly ownsLibrary: boolean
  /** Path templates, resolved against whichever install was found. */
  readonly dirs: Partial<Record<keyof EmulationPaths, DirSpec>>
  readonly saveLayout: SaveLayout
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
  /** Installed, and usable right now. */
  available: boolean
  install: ResolvedInstall | null
  paths: EmulationPaths
  /** Why it is not available, phrased for the diagnostics panel. */
  unavailableReason: string | null
}
