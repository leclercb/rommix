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
   * A directory of launcher scripts rather than one program, which is what a
   * configurator like EmuDeck leaves behind. Its location comes out of the
   * emulator's own configuration, so it is named relative to something
   * `layout` discovered: `from` is a path key or extra, `path` hangs off it.
   */
  | { kind: 'scripts'; dir: { from: string; path: string } }

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

/**
 * An install that was actually found. `ref` is a flatpak app id, the path of a
 * program, or — for `scripts` — the directory the launchers live in.
 */
export interface ResolvedInstall {
  kind: 'flatpak' | 'binary' | 'appimage' | 'scripts'
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
 * One configuration file an emulator records its folder layout in.
 *
 * Emulators that let the user choose where their library lives — RetroDECK's
 * SD card, EmuDeck's Emulation folder — cannot have their paths written as
 * templates, because the answer is on the user's disk rather than in this
 * table. What *is* a fixed fact is where they write that answer down and what
 * they call each key, so that is what a descriptor declares; reading the file
 * is the main process's job and knows nothing about which emulator it is.
 */
export interface LayoutSource {
  /** Where the file is, resolved like any other path template. */
  file: DirSpec
  /** `key=value` shell, as EmuDeck writes, or JSON, as RetroDECK does. */
  format: 'shell' | 'json'
  /** For JSON, the property holding the values, e.g. RetroDECK's `paths`. */
  section?: string
  /** Our path names -> what this file calls them. */
  keys: Partial<Record<keyof EmulationPaths, string>>
  /**
   * Other values worth reading out, for things that are not one of our paths —
   * EmuDeck's tools directory, which is where its launchers live.
   */
  extras?: Readonly<Record<string, string>>
  /**
   * The name that has to be present for this file to count as usable. An older
   * format that happens to exist but says nothing is skipped rather than
   * believed.
   */
  requires: string
  /**
   * Names this file may leave out, resolved below the `home` it does carry.
   * A library on an SD card would otherwise fall back to one in the home
   * directory.
   */
  defaults?: Readonly<Record<string, string>>
}

export interface LayoutDiscovery {
  /** Tried in order; the first that carries its `requires` name wins. */
  readonly sources: readonly LayoutSource[]
  /**
   * Where things are when no configuration file says.
   *
   * Applied only to paths that actually exist: a guessed location that happens
   * to be right is useful, and one that is merely plausible is worse than
   * admitting the layout is unknown — it turns "this has never been set up"
   * into a silent install into a folder nothing reads.
   */
  readonly fallback?: {
    base: DirBase
    paths: Readonly<Record<string, string>>
  }
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

/**
 * One of several ways an emulator can run a system.
 *
 * Some emulators offer a real choice for a platform — three Saturn cores of
 * differing accuracy, four Switch emulators of which only some run a given
 * game. Picking silently would be a guess, so a descriptor that has more than
 * one option says so and RomMix asks before the first launch.
 */
export interface LaunchVariant {
  /** Stable id, persisted in settings once the user has chosen. */
  id: string
  /** What to call it on screen, e.g. 'Kronos'. */
  label: string
  /** Short qualifier shown beside the label, e.g. 'RetroArch'. */
  note?: string
}

export interface LaunchContext {
  /**
   * argv prefix that starts the program, already wrapped for the sandbox. For
   * a `scripts` install this is the wrapping alone, with no program in it.
   */
  exec: readonly string[]
  /** What the probe resolved: an app id, a program, or a launcher directory. */
  installRef: string
  /** ES-DE system directory name, e.g. 'snes'. */
  system: string
  romPath: string
  /** The chosen `LaunchVariant`, when the emulator offers more than one. */
  variant?: string
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
  /**
   * Set instead of `dirs` when the emulator records its own layout because the
   * user chose it. Templates cannot express a path that lives on the disk.
   */
  readonly layout?: LayoutDiscovery
  readonly saveLayout: SaveLayout
  /** Arrangement below `dirs.saves` and `dirs.states`. */
  readonly saveTree: SaveTree
  /** Set when RomMix can fetch and install this emulator itself. */
  readonly releases?: ReleaseSource
  /**
   * Where to get it, for emulators RomMix cannot install — shown instead of a
   * button, so "not installed" comes with an answer rather than a dead end.
   */
  readonly homepage?: string
  /**
   * Environment the emulator needs in order to start, merged over RomMix's own.
   * For things the emulator will not do for itself — not for tuning.
   */
  readonly env?: Readonly<Record<string, string>>
  /**
   * True when this emulator's game list reads one directory and does not
   * descend into it.
   *
   * A multi-file game is normally unpacked into a folder of its own, which
   * keeps a disc set together and is what ES-DE and RetroDECK expect. Eden
   * scans its game directories flat, so a game in a subfolder is simply not
   * there as far as it is concerned — the same failure as the missing
   * extension, and just as invisible from RomMix, which would go on reporting
   * the game as downloaded and playable.
   *
   * Such an emulator gets every file loose in the system folder instead.
   */
  readonly flatLibrary?: boolean
  /**
   * Which firmware files this emulator's own BIOS folder will take, matched on
   * the end of the file name.
   *
   * Absent means "all of them", which is true of every emulator whose BIOS is
   * a set of files dropped in a directory. Eden is the other kind: its keys go
   * in `keys/`, but a firmware dump is a few hundred NCA files that have to be
   * *registered* into the NAND by Eden itself, and copying them into the tree
   * by hand produces a NAND the emulator does not believe in.
   *
   * Anything not accepted here is put in RomMix's own `bios/<system>` folder
   * instead, where the user can point the emulator's installer at it. The file
   * is still fetched from RomM and still has a definite home — RomMix simply
   * stops short of the step only the emulator can perform.
   */
  readonly biosAccepts?: readonly string[]
  /**
   * What to tell the user about files that had to be staged rather than
   * installed. Shown on the BIOS screen beside the folder they went to.
   */
  readonly biosStagingNote?: string
  /**
   * Steps the user has to perform inside the emulator itself, which RomMix can
   * neither do nor verify from outside.
   *
   * Not documentation for its own sake: each one is a thing that, left undone,
   * makes RomMix look broken — the game is downloaded and RomMix says so, but
   * the emulator's own list is empty, or the game starts unpatched. Saying so
   * once, where the game is, is the difference between a setup step and a bug
   * report.
   */
  readonly setupNotes?: readonly string[]
  /**
   * The ways this emulator can run a system. Absent, or one entry, means there
   * is nothing to ask about.
   */
  variants?(system: string): readonly LaunchVariant[]
  /**
   * argv to start the emulator on its own, for the Run button. Only needed
   * where that is not simply `exec` — a launcher directory has no one program,
   * so EmuDeck points this at its frontend.
   */
  open?(ctx: { exec: readonly string[]; installRef: string }): string[]
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
