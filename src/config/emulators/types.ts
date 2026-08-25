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
 * Every field is required, including the ones that are usually empty. An
 * optional field lets an emulator quietly inherit a default that is written
 * nowhere near it, and the reader of `eden.ts` then has to know what `open`
 * does when absent in order to know what Eden does. Spelling out `open:
 * undefined` costs a line and answers the question in place — and makes adding
 * a field to this interface a compile error in every emulator rather than a
 * silent behaviour change in three of them.
 *
 * A descriptor is pure data plus one argv builder, so it can be unit-tested
 * without touching the filesystem. Anything that has to look at the machine —
 * is it installed, where did it put its config — is the main process's job, in
 * `src/main/emulators.ts`.
 */

import type { Text } from '@shared/i18n'
import type { SaveContext, SaveEnvironment, SavePaths } from './savepaths.ts'

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
 * Where an emulator publishes the builds RomMix can download. Only
 * Forgejo/Gitea-shaped APIs are modelled — Eden's own Forgejo, and GitHub,
 * whose release payload carries the same names.
 */
export interface ReleaseSource {
  /** Endpoint returning the release list. */
  api: string
  /**
   * Matches the file name of a usable download, and nothing else on the
   * release page. Anchor it: Eden ships `.AppImage.zsync` update files beside
   * every `.AppImage`, and shadPS4 ships macOS and Windows zips beside the
   * Linux one.
   */
  asset: RegExp
}

/**
 * How the program might be installed. Tried in order, first hit wins.
 *
 * Each entry answers both halves of "can this emulator be here": how to
 * recognise an install of that kind, and how to obtain one. They are the same
 * question — where a program comes from is what decides how it is found — and
 * splitting them once meant an emulator both on Flathub and published as an
 * AppImage could only offer whichever half the screen happened to check.
 *
 * What "obtain" means follows the kind, so a descriptor cannot describe a
 * route RomMix has no way to take:
 *
 *  - `flatpak`   installed from Flathub by app id.
 *  - `appimage`  downloaded from the project's own releases. A loose file in a
 *                download folder rather than something on PATH, so it is also
 *                looked for by name — both the copy RomMix fetched and one the
 *                user put there themselves.
 *  - `binary`    found on PATH. Whatever put it there — a distro package, a
 *                build — is not something RomMix can drive.
 *  - `scripts`   a directory of launchers rather than one program, which is
 *                what a configurator like EmuDeck leaves behind. Its location
 *                comes out of the emulator's own configuration, so it is named
 *                relative to something `layout` discovered: `from` is a path
 *                key or extra, `path` hangs off it.
 *
 * An emulator whose every route is `binary` or `scripts` is one the user
 * installs themselves, and the Settings screen says exactly that rather than
 * offering a button that cannot work.
 */
export type InstallSpec =
  | { kind: 'flatpak'; appId: string }
  | { kind: 'appimage'; patterns: readonly string[]; release: ReleaseSource }
  | { kind: 'binary'; names: readonly string[] }
  | { kind: 'scripts'; dir: { from: string; path: string } }

/**
 * An install that was actually found. `ref` is a flatpak app id, the path of a
 * program, or — for `scripts` — the directory the launchers live in.
 */
export interface ResolvedInstall {
  kind: 'flatpak' | 'binary' | 'appimage' | 'scripts'
  ref: string
  /**
   * Where the application's own files are, for the emulators that ship
   * configuration RomMix has to read — RetroDECK's bundled ES-DE system list is
   * the one that matters. Only a flatpak has one; asking flatpak for it covers
   * system and user installs, either architecture, and any branch.
   */
  location?: string
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
   * Names below the library root, for when the user points RomMix at one.
   *
   * An emulator that owns its library keeps that library in one relocatable
   * tree — the whole point of RetroDECK's SD-card option and EmuDeck's
   * `Emulation` folder. Told where that tree is, RomMix derives the rest from
   * these names rather than asking for four paths and letting them drift apart.
   *
   * A user-set root is believed outright: the configuration files are not read
   * at all for that emulator, because "the answer is on disk" and "the user
   * corrected us" cannot both win, and the correction is the newer fact.
   */
  readonly relative?: Readonly<Record<string, string>>
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
   * argv prefix that starts the program. Empty for a `scripts` install, where
   * the launcher to run depends on the system and the descriptor names it.
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

/**
 * Everything a descriptor is told about one BIOS file it might be given.
 *
 * Deliberately the same shape as `SaveContext` minus the game: the two
 * questions turn out to need the same facts, because both are answered by
 * whichever emulator a frontend dispatches the system to, and that is read off
 * disk rather than declared.
 */
export interface BiosContext {
  /** ES-DE system the file belongs to, e.g. 'dreamcast'. */
  system: string
  /** The file exactly as RomM holds it, e.g. 'dc_boot.bin'. */
  fileName: string
  /** The roots the probe discovered for this emulator. */
  paths: EmulationPaths
  /** The emulator's own config and data roots, as `saves` is given them. */
  configDir: string | null
  dataDir: string | null
  /**
   * Where the emulator's *own* files were deployed, when RomMix knows.
   *
   * The interesting one for a frontend: RetroDECK ships a manifest per bundled
   * component listing every BIOS file it knows about and where that component
   * wants it, which beats any table RomMix could keep of its conclusions.
   */
  installDir: string | null
  /** The user's real home directory. */
  home: string
  env: SaveEnvironment
}

/**
 * The directory one BIOS file is to be copied into — absolute, and usually
 * inside `paths.bios` but not necessarily: RetroDECK files a GameCube IPL
 * under its *saves* tree, because that is where Dolphin reads it from.
 *
 * `null` means this emulator cannot be given the file at all, and it goes to
 * RomMix's own `bios/<system>` folder instead, where the user can point the
 * emulator's own installer at it — Eden's firmware is a few hundred NCA files
 * that have to be *registered* into the NAND by Eden itself, and copying them
 * into the tree by hand produces a NAND it does not believe in. The file is
 * still fetched from RomM and still has a definite home; RomMix simply stops
 * short of the step only the emulator can perform.
 */
export type BiosTarget = string | null

/** What a descriptor is told in order to name the core a launch needs. */
export type CoreContext = Pick<SaveContext, 'system' | 'home' | 'configDir' | 'env'>

/**
 * A libretro core a launch needs and the install does not ship.
 *
 * RetroArch's packages contain no cores at all — its flatpak carries 291 core
 * *info* files and not one `.so` — and a missing core is not fetched on demand
 * either: `-L` naming a core that is not on disk is a fatal error, not a
 * download. The only thing that installs one is a user walking RetroArch's
 * Online Updater menu, which is exactly the trip to a second program that a
 * Big Picture front end exists to avoid. So RomMix installs the core itself,
 * and this is what it needs to know to do it.
 */
export interface RequiredCore {
  /** Core file base name without `_libretro.so` — e.g. `mupen64plus_next`. */
  readonly id: string
  /** What the core calls itself, for messages — e.g. `Mupen64Plus-Next`. */
  readonly name: string
  /** The directory the emulator loads cores from. */
  readonly dir: string
  /** The file inside it, which is `<id>_libretro.so`. */
  readonly fileName: string
  /**
   * Where the libretro buildbot publishes builds for this machine, with a
   * trailing slash; `<buildbotUrl><fileName>.zip` is the archive.
   *
   * Read from `core_updater_buildbot_cores_url`, which RetroArch writes for the
   * platform it is running on and is therefore already correct. Null when no
   * config has been written yet, and the installer supplies a default — this
   * module is loaded by the renderer, which has no `process.arch` to build one
   * from.
   */
  readonly buildbotUrl: string | null
}

export interface EmulatorDescriptor {
  // -- identity ------------------------------------------------------------------

  readonly id: EmulatorId
  readonly name: string
  readonly dispatch: EmulatorDispatch
  /**
   * True when this program runs games through other emulators rather than
   * emulating anything itself.
   *
   * What it decides is whose saves are readable. A standalone emulator accepts
   * only saves tagged with its own name; a frontend accepts any tag, because
   * the emulator underneath is what will open the file.
   *
   * Not derivable from `dispatch`, which answers a different question — who
   * picks the emulator, not whether there is one underneath. RetroDECK picks
   * for itself and EmuDeck lets RomMix pick, and both are frontends.
   */
  readonly frontend: boolean

  // -- finding and installing it -------------------------------------------------

  readonly install: readonly InstallSpec[]
  /**
   * The project's own page: where the program comes from, what it is, and how
   * to set it up by hand.
   *
   * Carried by every emulator, not only the ones RomMix cannot install. For
   * those it is the whole answer — "not installed" with an address beats "not
   * installed" and a dead end — and for the rest it is still the one thing a
   * settings row can offer someone who wants to know what they are looking at.
   */
  readonly homepage: string | undefined

  // -- what it runs --------------------------------------------------------------

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
   * The ways this emulator can run a system. Absent, or one entry, means there
   * is nothing to ask about.
   */
  variants: ((system: string) => readonly LaunchVariant[]) | undefined

  // -- where its files go --------------------------------------------------------

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
  readonly layout: LayoutDiscovery | undefined
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
  readonly flatLibrary: boolean

  // -- saves ---------------------------------------------------------------------

  /**
   * Where this emulator keeps the save data for one game.
   *
   * A question rather than a declaration, because the answer depends on things
   * a table cannot hold: which core RetroArch last loaded, which of RetroDECK's
   * bundled emulators ES-DE will hand the system to, which Switch profile owns
   * a save. See `savepaths.ts` for what the answer means and what the
   * descriptor is allowed to look at while producing it.
   */
  saves(ctx: SaveContext): SavePaths

  // -- bios ----------------------------------------------------------------------

  /**
   * Where this emulator wants one BIOS file copied — see `BiosTarget`.
   *
   * Absent means `paths.bios` itself takes everything, which is what a BIOS
   * folder normally is and is why most descriptors leave it undefined. Asked
   * per file rather than declared per emulator because the answer varies
   * within one: Eden takes `prod.keys` into its `keys/` folder and cannot take
   * a firmware dump at all, and RetroDECK's answer depends on which of its
   * bundled components ES-DE hands the system to — `bios/` for a libretro core,
   * `bios/dc/` for Flycast, `saves/gc/dolphin/EU/` for a GameCube IPL.
   *
   * A question rather than a table for the same reason `saves` is one: the
   * answer is in the emulator's own data, and a copy of its conclusions here
   * goes stale on its next release.
   */
  readonly bios: ((ctx: BiosContext) => BiosTarget) | undefined
  /**
   * What to tell the user about files that had to be staged rather than
   * installed. Shown on the BIOS screen beside the folder they went to.
   *
   * A catalogue key, not a sentence — see `Text` in `@shared/i18n`. A descriptor
   * is a pure function of an install and has no language to write one in.
   */
  readonly biosStagingNote: Text | undefined

  // -- cores ---------------------------------------------------------------------

  /**
   * The core this game needs, for an emulator that loads its emulation rather
   * than containing it.
   *
   * Beside `bios` because it is the same kind of obligation — a file that has
   * to be in place before the game will start — and the same kind of answer: a
   * question per game, because which core runs a system is not something a
   * single value per emulator can hold.
   *
   * Only standalone RetroArch answers. RetroDECK and EmuDeck run libretro cores
   * too, but both ship the cores with the distribution, so there is never one
   * missing for RomMix to fetch. Null means no core is mapped to this system —
   * the same condition `launch` returns null for.
   */
  readonly core: ((ctx: CoreContext) => RequiredCore | null) | undefined

  // -- what the user has to do themselves ----------------------------------------

  /**
   * Steps the user has to perform inside the emulator itself, which RomMix can
   * neither do nor verify from outside.
   *
   * Not documentation for its own sake: each one is a thing that, left undone,
   * makes RomMix look broken — the game is downloaded and RomMix says so, but
   * the emulator's own list is empty, or the game starts unpatched. Saying so
   * once, where the game is, is the difference between a setup step and a bug
   * report.
   *
   * Catalogue keys, as `biosStagingNote` is.
   */
  readonly setupNotes: readonly Text[]

  // -- running it ----------------------------------------------------------------

  /**
   * Environment the emulator needs in order to start, merged over RomMix's own.
   * For things the emulator will not do for itself — not for tuning.
   */
  readonly env: Readonly<Record<string, string>> | undefined
  /**
   * argv to start the emulator on its own, for the Run button. Only needed
   * where that is not simply `exec` — a launcher directory has no one program,
   * so EmuDeck points this at its frontend.
   */
  open: ((ctx: { exec: readonly string[]; installRef: string }) => string[]) | undefined
  /** argv to start this game, or null when the emulator cannot run the system. */
  launch(ctx: LaunchContext): string[] | null
}

/** A descriptor plus what probing the machine found out about it. */
export interface EmulatorState {
  id: EmulatorId
  name: string
  dispatch: EmulatorDispatch
  /** Installed, and usable right now. */
  available: boolean
  install: ResolvedInstall | null
  paths: EmulationPaths
  /**
   * The emulator's own config and data roots for the install that was found —
   * inside `~/.var/app/<id>/` for a flatpak, the XDG roots otherwise.
   *
   * Not part of `paths`, which holds the emulation directories a frontend
   * records for itself. Save resolution needs both and neither implies the
   * other: RetroDECK keeps its library at `~/retrodeck` and the `retroarch.cfg`
   * governing where libretro saves land inside its flatpak tree.
   */
  configDir: string | null
  dataDir: string | null
  /** Why it is not available, phrased for the diagnostics panel. */
  unavailableReason: string | null
}
