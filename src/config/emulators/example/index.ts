import { directory, joinPath, perRom, shared } from '../savepaths.ts'
import type { EmulatorDescriptor } from '../types.ts'

/**
 * A worked example of an emulator descriptor: every field, every value it can
 * take, and why you would pick each one.
 *
 * This is documentation that the compiler checks. It is a real
 * `EmulatorDescriptor`, so adding a field to the interface breaks this file
 * along with the four live ones — which is the point. It is deliberately **not**
 * in `EMULATORS`, so nothing here is ever probed, launched or offered to the
 * user; copy it to `src/config/emulators/<your emulator>/index.ts`, delete the
 * branches that do not apply, and add the export to `index.ts`.
 *
 * The registry is loaded by the renderer as well as the main process, so
 * nothing in this directory may import `node:` anything. Whatever needs to look
 * at the machine asks through the `env` handed to `saves()`.
 */
export const example: EmulatorDescriptor = {
  // -- identity -------------------------------------------------------------

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

  // -- finding it -----------------------------------------------------------

  /**
   * How the program might be installed, tried in order; the first hit wins.
   * All four kinds:
   *
   *   { kind: 'flatpak',  appId: 'org.libretro.RetroArch'}
   *       Asked of flatpak itself, so it covers system and user installs.
   *       Also records where the flatpak is deployed, which is how a
   *       descriptor can read configuration the emulator ships.
   *
   *   { kind: 'binary',   names: ['retroarch', 'retroarch-nightly'] }
   *       Looked up on the host's PATH.
   *
   *   { kind: 'appimage', patterns: ['eden*.appimage'] }
   *       A loose file, searched for in the folders people keep AppImages in.
   *       Only `*` is supported in a pattern, and matching is case-insensitive.
   *
   *   { kind: 'scripts',  dir: { from: 'tools', path: 'launchers' } }
   *       A directory of launcher scripts rather than one program, which is
   *       what a configurator like EmuDeck leaves behind. `from` names
   *       something `layout` discovered — a path key or an extra — and `path`
   *       hangs off it. The directory that is found *is* the install.
   */
  install: [
    { kind: 'flatpak', appId: 'org.example.Example' },
    { kind: 'binary', names: ['example'] }
  ],
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
   * True when the emulator owns a folder layout RomMix has to discover rather
   * than create — which also means it is unusable until the emulator has been
   * run once and that layout exists. RetroDECK and EmuDeck are true; a
   * standalone emulator that just needs a folder to read is false.
   */
  ownsLibrary: false,
  // -- where its folders are ------------------------------------------------

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
  // -- saves ----------------------------------------------------------------

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
  // -- installing it --------------------------------------------------------

  /**
   * Set when RomMix can fetch and install this emulator itself. Only
   * Forgejo/Gitea-shaped release APIs are modelled, which is what Eden
   * publishes; a flatpak or distro package needs none of this.
   *
   * ```ts
   * releases: {
   *   api: 'https://git.eden-emu.dev/api/v1/repos/eden-emu/eden/releases',
   *   // An exact suffix, never a substring: Eden ships `.AppImage.zsync`
   *   // update files beside every `.AppImage`, and offering one would be a
   *   // download that cannot run.
   *   assetSuffix: '.AppImage',
   *   homepage: 'https://eden-emu.dev'
   * }
   * ```
   */
  releases: undefined,
  /**
   * Where to get it, for an emulator RomMix cannot install. Shown instead of a
   * button, so "not installed" comes with an answer rather than a dead end.
   * Leave undefined when `releases` is set or the emulator is on Flathub.
   */
  homepage: undefined,
  // -- running it -----------------------------------------------------------

  /**
   * Environment the emulator needs in order to start, merged over RomMix's own.
   * For things the emulator will not do for itself — not for tuning. Eden sets
   * `I_WANT_A_BROKEN_WAYLAND_UI` because without it its AppImage forces X11 and
   * dies on a session with no X server.
   */
  env: undefined,
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
  /**
   * Which firmware files this emulator's BIOS folder will take, matched on the
   * end of the file name. `undefined` means all of them, which is true of every
   * emulator whose BIOS is a set of files dropped in a directory.
   *
   * Eden is the other kind: its keys go in `keys/`, but a firmware dump is
   * hundreds of NCA files that have to be *registered* into the NAND by Eden
   * itself, so it declares `['.keys']`. Anything not accepted is staged in
   * RomMix's own `bios/<system>` folder instead — still fetched, still with a
   * definite home, with RomMix stopping short of the step only the emulator can
   * perform.
   */
  biosAccepts: undefined,
  /**
   * What to tell the user about files that had to be staged rather than
   * installed. Shown on the BIOS screen beside the folder they went to. Only
   * meaningful alongside `biosAccepts`.
   */
  biosStagingNote: undefined,
  /**
   * Steps the user has to perform inside the emulator itself, which RomMix can
   * neither do nor verify from outside. `[]` when there are none.
   *
   * Not documentation for its own sake: each one is a thing that, left undone,
   * makes RomMix look broken — the game is downloaded and RomMix says so, but
   * the emulator's own list is empty. Saying it once, where the game is, is the
   * difference between a setup step and a bug report.
   */
  setupNotes: [],
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
  /**
   * argv to start the emulator on its own, for the Run button beside it in
   * Settings. Only needed where that is not simply `exec` — a launcher
   * directory has no one program, so EmuDeck points this at its frontend.
   *
   * ```ts
   * open: ({ exec, installRef }) => [...exec, `${installRef}/es-de/es-de.sh`]
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
export const SAVE_HELPERS = { perRom, directory, shared, joinPath 
}
