import { directory, joinPath, perRom, shared } from '../savepaths.ts'
import type { EmulatorDescriptor } from '../types.ts'

/**
 * A worked example of an emulator descriptor: every field, every value it can
 * take, and why you would pick each one.
 *
 * This is documentation that the compiler checks. It is a real
 * `EmulatorDescriptor`, so adding a field to the interface breaks this file
 * along with the five live ones — which is the point. It is deliberately **not**
 * in `EMULATORS`, so nothing here is ever probed, launched or offered to the
 * user; copy it to `src/config/emulators/<your emulator>/index.ts`, delete the
 * branches that do not apply, and add the export to `index.ts`.
 *
 * The registry is loaded by the renderer as well as the main process, so
 * nothing in this directory may import `node:` anything. Whatever needs to look
 * at the machine asks through the `env` handed to `saves()`.
 */
export const example: EmulatorDescriptor = {
  // -- identity ------------------------------------------------------------------

  /**
   * Stable id, lowercase, no spaces. Persisted in settings — as the key of the
   * per-platform emulator map, of the launch-variant map and of the library
   * folder override — so renaming one silently discards the user's choices.
   */
  id: 'example',
  /** What to call it on screen. Free text; used in messages to the user. */
  name: 'Example',
  /**
   * Who decides which emulator core actually runs a game.
   *
   *   'rommix' — RomMix names it, on the command line. RetroArch (RomMix picks
   *              the libretro core) and Eden (there is only one) are both this.
   *   'self'   — the program is handed the system and resolves the emulator
   *              from its own configuration. RetroDECK reading its ES-DE
   *              es_systems.xml is the only case today.
   *
   * The distinction is *who chooses*, not how the program describes itself:
   * RetroArch is plainly a frontend for cores, and is still 'rommix'.
   */
  dispatch: 'rommix',
  /**
   * True when this program runs games through other emulators instead of
   * emulating anything itself — RetroDECK and EmuDeck, and nothing else today.
   *
   * It decides whose saves this program is allowed to load: a frontend accepts
   * a save tagged with any emulator, because one of them is what will open it.
   * Answer it here rather than anywhere else having to keep a list.
   */
  frontend: false,

  // -- finding and installing it -------------------------------------------------

  /**
   * How the program might be installed, tried in order; the first hit wins.
   *
   * Each entry says both how to recognise an install of that kind and how to
   * obtain one, so an emulator that is on Flathub *and* published as an
   * AppImage offers the user both and RomMix installs whichever they press.
   * All four kinds:
   *
   *   { kind: 'flatpak',  appId: 'org.libretro.RetroArch'}
   *       Asked of flatpak itself, so it covers system and user installs.
   *       Also records where the flatpak is deployed, which is how a
   *       descriptor can read configuration the emulator ships. Installed
   *       from Flathub by that id.
   *
   *   { kind: 'appimage', patterns: ['eden*.appimage'], release: {…} }
   *       A loose file, searched for in the folders people keep AppImages in
   *       and in the one RomMix downloads into. Only `*` is supported in a
   *       pattern, and matching is case-insensitive. `release` is where the
   *       project publishes its builds, and is required — an AppImage RomMix
   *       cannot fetch is one the user drops in a folder themselves, which is
   *       what `binary` already describes:
   *
   *         release: {
   *           api: 'https://git.eden-emu.dev/api/v1/repos/eden-emu/eden/releases',
   *           // Anchored: Eden ships `.AppImage.zsync` update files beside
   *           // every `.AppImage`, and shadPS4 gives Windows and macOS the
   *           // same `.zip` as Linux. A zip is unpacked after download.
   *           asset: /\.AppImage$/i
   *         }
   *
   *   { kind: 'binary',   names: ['retroarch', 'retroarch-nightly'] }
   *       Looked up on PATH. Whatever put it there — a distro
   *       package, a build — is not something RomMix can drive, so an
   *       emulator with only this is one the user installs themselves.
   *
   *   { kind: 'scripts',  dir: { from: 'tools', path: 'launchers' } }
   *       A directory of launcher scripts rather than one program, which is
   *       what a configurator like EmuDeck leaves behind. `from` names
   *       something `layout` discovered — a path key or an extra — and `path`
   *       hangs off it. The directory that is found *is* the install, and
   *       like `binary` it is the user's to create.
   */
  install: [
    { kind: 'flatpak', appId: 'org.example.Example' },
    { kind: 'binary', names: ['example'] }
  ],
  /**
   * The project's own page. Carried by every emulator: for one RomMix cannot
   * install it is the whole answer, and for the rest it is what the settings
   * row and the release picker point at.
   */
  homepage: 'https://example.test',

  // -- what it runs --------------------------------------------------------------

  /**
   * ES-DE systems this emulator runs, by folder name — the keys of the table in
   * `src/config/systems.ts`. Always a concrete list, even for a program that
   * resolves the emulator itself: "it decides for itself" reads as
   * "everything", and a ROM sent to a system it has no emulator for fails at
   * launch with nothing to explain it.
   *
   * `systemsWithCore()` from `../../systems.ts` gives every system with a
   * libretro core, which is the right list for anything RetroArch-based.
   */
  systems: ['snes', 'nes'],
  /**
   * The ways this emulator can run a system, best-known default first.
   * `undefined`, or a function returning fewer than two entries, means there is
   * nothing to ask about and RomMix asks nothing.
   *
   * Where a real choice exists — three Saturn cores of differing accuracy, four
   * Switch emulators of which only some run a given game — RomMix asks before
   * the first launch and remembers the answer per emulator and system. That
   * recorded answer is handed back as `ctx.variant` in `saves()`, so the save
   * location can never disagree with what actually ran.
   *
   * ```ts
   * variants: (system) => system === 'saturn'
   *   ? [
   *       { id: 'kronos', label: 'Kronos', note: 'RetroArch' },
   *       { id: 'beetle', label: 'Beetle Saturn', note: 'RetroArch' }
   *     ]
   *   : []
   * ```
   */
  variants: undefined,

  // -- where its files go --------------------------------------------------------

  /**
   * True when the emulator owns a folder layout RomMix has to discover rather
   * than create — which also means it is unusable until the emulator has been
   * run once and that layout exists. RetroDECK and EmuDeck are true; a
   * standalone emulator that just needs a folder to read is false.
   */
  ownsLibrary: false,
  /**
   * Fixed path templates. Set these *or* `layout`, never both — the registry
   * test enforces it.
   *
   * `base` is one of:
   *   'home'    the user's home directory
   *   'config'  the emulator's config root: inside `~/.var/app/<id>/config` for
   *             a flatpak, `~/.config` otherwise
   *   'data'    the same, for `~/.local/share`
   *   'rommix'  RomMix's own folder, for an emulator with nowhere of its own to
   *             keep ROMs
   *
   * Declare only what the emulator really has. A path that does not exist is
   * worse than an absent one: the pre-flight check prints it as fact, and save
   * sync reports "nothing found" for a tree that was never there.
   */
  dirs: {
    roms: { base: 'rommix', path: 'roms' },
    saves: { base: 'config', path: 'example/saves' },
    states: { base: 'config', path: 'example/states' },
    bios: { base: 'config', path: 'example/system' }
  },
  /**
   * Set instead of `dirs` when the emulator records its own folders because the
   * user chose them — an SD card, a second drive. Templates cannot express a
   * path that lives on the user's disk, but *where the emulator writes that
   * path down* is a fixed fact, and that is what goes here.
   *
   * ```ts
   * layout: {
   *   sources: [
   *     {
   *       file: { base: 'home', path: 'emudeck/settings.sh' },
   *       // 'shell' for `key=value`, 'json' for a JSON object
   *       format: 'shell',
   *       // For JSON only: the property holding the values, e.g. 'paths'
   *       section: undefined,
   *       // The name that must be present for the file to count as usable, so
   *       // an older half-written format is skipped rather than believed
   *       requires: 'home',
   *       // Our names -> what this file calls them
   *       keys: { home: 'emulationPath', roms: 'romsPath', saves: 'savesPath' },
   *       // Values that are not one of our paths, for an install spec to name
   *       extras: { tools: 'toolsPath' },
   *       // Names the file may leave out, resolved below the home it does give
   *       defaults: { roms: 'roms', saves: 'saves' }
   *     }
   *   ],
   *   // Names below the library root, used when the user sets one in Settings
   *   relative: { roms: 'roms', saves: 'saves', states: 'states', bios: 'bios' },
   *   // Where things are when no configuration file says. Applied only to
   *   // paths that actually exist: a plausible-but-wrong guess turns "never
   *   // set up" into a silent install into a folder nothing reads.
   *   fallback: { base: 'home', paths: { home: 'Emulation', roms: 'Emulation/roms' } }
   * }
   * ```
   */
  layout: undefined,
  /**
   * True when this emulator's game list reads one directory and does not
   * descend into it.
   *
   * A multi-file game is normally unpacked into a folder of its own, which is
   * what ES-DE expects. An emulator that scans flat cannot see into that
   * folder, so the game is simply not there as far as it is concerned — and
   * RomMix would go on reporting it as downloaded and playable. Such an
   * emulator gets every file loose in the system folder instead.
   */
  flatLibrary: false,

  // -- saves ---------------------------------------------------------------------

  /**
   * Where this emulator keeps one game's save data.
   *
   * A function rather than a table because the answer depends on things no
   * table holds: which core was loaded, which of a frontend's emulators ran the
   * game, which profile owns a title. `ctx` carries the discovered roots, the
   * game, the chosen variant, and `ctx.env` — a read-only view of the disk with
   * `exists`, `dirs`, `files`, `text`, `head` and `newest`.
   *
   * Return a location per kind, or null where there is none. `match` is the
   * important part:
   *
   *   perRom(dir, search?)  files named after the ROM — libretro `.srm`, and
   *                         most standalone emulators. `search` lists extra
   *                         directories a push may look in but a pull never
   *                         writes to, for when the emulator's own naming is
   *                         not fully knowable from outside.
   *   directory(dir)        the folder *is* this game's data, keyed by a title
   *                         or game id. Synced as one archive, because the
   *                         files inside carry no name tying them to a ROM.
   *   shared(dir)           a memory card, NAND or nvram every game writes to.
   *                         Skipped rather than uploaded under one game's id.
   *
   * `emulator` overrides the tag RomM records against the save, and should be
   * set by a frontend to the emulator it dispatched to — a save written by
   * RetroDECK's PCSX2 is a PCSX2 save. `unsyncableReason` is shown by the Pull
   * and Push buttons when they moved nothing; set it for a genuine "this
   * emulator has no per-game save", never for a directory that merely does not
   * exist yet, which is the normal state of a game nobody has played.
   */
  saves: (ctx) => ({
    saves: ctx.paths.saves ? perRom(ctx.paths.saves) : null,
    states: ctx.paths.states ? perRom(ctx.paths.states) : null,
    emulator: undefined,
    unsyncableReason: undefined
  }),

  // -- bios ----------------------------------------------------------------------

  /**
   * The directory one BIOS file is to be copied into. `undefined` means
   * `paths.bios` takes everything, which is true of every emulator whose BIOS
   * is a set of files dropped in a directory.
   *
   * Answer with a directory for anything else — a subfolder, or another tree
   * entirely — and `null` for a file this emulator cannot be given at all:
   *
   *   bios: ({ fileName, paths }) =>
   *     fileName.toLowerCase().endsWith('.keys')
   *       ? paths.bios
   *       : null
   *
   * A refused file is staged in RomMix's own `bios/<system>` folder instead —
   * still fetched, still with a definite home, with RomMix stopping short of
   * the step only the emulator can perform, as with a Switch firmware dump the
   * emulator has to register into its NAND itself.
   *
   * The context carries `installDir` and the same read-only `env` as `saves`,
   * because for a frontend this is not knowledge to be typed out: RetroDECK
   * ships a manifest of every BIOS file its bundled components want and where,
   * and `retrodeck/bios.ts` reads it rather than keeping a copy of it here.
   */
  bios: undefined,
  /**
   * What to tell the user about files that had to be staged rather than
   * installed. Shown on the BIOS screen beside the folder they went to. Only
   * meaningful for an emulator whose `bios` refuses something.
   *
   * A catalogue key, as `setupNotes` are.
   */
  biosStagingNote: undefined,

  // -- cores ---------------------------------------------------------------------

  /**
   * The core this game needs, for an emulator that loads its emulation from a
   * plugin rather than containing it. `undefined` for almost everything: only
   * standalone RetroArch has cores that its own install does not ship, and
   * RomMix downloads the missing one before the game starts rather than letting
   * the emulator die on a core that is not there.
   *
   * Answer with the file, the directory the emulator will search for it, and
   * where builds for this machine are published — see `libretroCore`.
   */
  core: undefined,

  // -- what the user has to do themselves ----------------------------------------

  /**
   * Steps the user has to perform inside the emulator itself, which RomMix can
   * neither do nor verify from outside. `[]` when there are none.
   *
   * Not documentation for its own sake: each one is a thing that, left undone,
   * makes RomMix look broken — the game is downloaded and RomMix says so, but
   * the emulator's own list is empty. Saying it once, where the game is, is the
   * difference between a setup step and a bug report.
   *
   * Catalogue keys — `['setup.edenRoms']`, not the sentence itself. A descriptor
   * has no language to write one in; `src/shared/i18n/` has all four.
   */
  setupNotes: [],

  // -- running it ----------------------------------------------------------------

  /**
   * Environment the emulator needs in order to start, merged over RomMix's own.
   * For things the emulator will not do for itself — not for tuning. Eden sets
   * `I_WANT_A_BROKEN_WAYLAND_UI` because without it its AppImage forces X11 and
   * dies on a session with no X server.
   */
  env: undefined,
  /**
   * argv to start the emulator on its own, for the Run button beside it in
   * Settings. Only needed where that is not simply `exec` — a launcher
   * directory has no one program, so EmuDeck points this at the configurator
   * that installed them, which `home` is given for.
   *
   * ```ts
   * open: ({ home }) => [`${home}/Applications/EmuDeck.AppImage`, '--no-sandbox']
   * ```
   */
  open: undefined,
  /**
   * argv to start this game, or null when the emulator cannot run the system —
   * null rather than a guess, so an unsupported platform is reported instead of
   * failing inside an emulator that was never going to work.
   *
   * `ctx.exec` is the argv prefix that starts the program, already wrapped for
   * the sandbox; for a `scripts` install it is the wrapping alone with no
   * program in it, so whatever the descriptor names must land *after* it.
   * `ctx.installRef` is what the probe resolved: an app id, a program path, or
   * a launcher directory.
   */
  launch: ({ exec, system, romPath }) => {
    if (system === 'nes') return [...exec, '--nes', romPath]
    if (system === 'snes') return [...exec, romPath]
    return null
  }
}

/**
 * Unused imports kept deliberately, so the example names every save helper the
 * `saves` field can return. Referencing them here rather than only in a comment
 * means a rename breaks this file instead of leaving the documentation wrong.
 */
export const SAVE_HELPERS = { perRom, directory, shared, joinPath }
