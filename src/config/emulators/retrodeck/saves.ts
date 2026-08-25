import type { Text } from '@shared/i18n'
import { coreForSystem } from '../../systems.ts'
import { libretroSavePaths, readLibretroConfig } from '../libretro.ts'
import { baseName, directory, joinPath, perRom, shared } from '../savepaths.ts'
import type { SaveContext, SaveLocation, SavePaths } from '../savepaths.ts'

/**
 * Where RetroDECK's bundled emulators keep their saves.
 *
 * RetroDECK is a dispatcher, so "where does RetroDECK put saves" has no single
 * answer — it puts them wherever the component it chose puts them, and it moves
 * each component's directory into its own tree during setup. Every path below
 * is taken from the `component_prepare.sh` that performs that move, in
 * RetroDECK's own components repository, and verified against a live
 * `~/retrodeck`.
 *
 * The shape is *mostly* `<saves>/<system>/<component>/…`, and the exceptions
 * are what made the old single `system-nested` flag wrong: Dolphin and
 * PrimeHack put their states at `<states>/<component>` with no system at all,
 * MAME uses `mame-sa` in place of a system, PPSSPP's folder is `PSP` in capitals
 * where the ES-DE system is `psp`, and XRoar inverts the two.
 */

/** How a component arranges one game's data, given the discovered roots. */
type ComponentSaves = (ctx: SaveContext) => SavePaths

const savesRoot = (ctx: SaveContext): string | null => ctx.paths.saves
const statesRoot = (ctx: SaveContext): string | null => ctx.paths.states

/** `<root>/<segments…>`, or null when the root was never discovered. */
function under(root: string | null, ...segments: readonly string[]): string | null {
  return root ? joinPath(root, ...segments) : null
}

/** A location, or null when its root is missing. */
function at(path: string | null, make: (dir: string) => SaveLocation): SaveLocation | null {
  return path ? make(path) : null
}

/**
 * The memory-card emulators.
 *
 * PCSX2 and DuckStation are both configured by RetroDECK with *shared* cards —
 * `shared_card_1.mcd`, `Mcd001.ps2` — rather than one per game. Their save
 * states are per-game and are synced; the cards are not, because a card holds
 * every PS1 or PS2 game the user has played and uploading it under one game's
 * id would attach the lot to that game.
 */
function cardEmulator(component: string, reason: Text): ComponentSaves {
  return (ctx) => ({
    saves: at(under(savesRoot(ctx), ctx.system, component, 'memcards'), shared),
    states: at(under(statesRoot(ctx), ctx.system, component), (dir) => perRom(dir)),
    unsyncableReason: reason
  })
}

const RETRODECK_COMPONENTS: Readonly<Record<string, ComponentSaves>> = {
  pcsx2: cardEmulator('pcsx2', 'saves.retrodeckPcsx2'),
  duckstation: cardEmulator('duckstation', 'saves.retrodeckDuckstation'),

  /**
   * Dolphin keeps GameCube memory cards under a region folder and the Wii NAND
   * as one tree, neither of which is per-game. Its states are, and they sit at
   * `<states>/dolphin` — no system component, which is exactly the kind of
   * exception the old flag could not express.
   */
  dolphin: (ctx) => ({
    saves: at(under(savesRoot(ctx), ctx.system, 'dolphin'), shared),
    states: at(under(statesRoot(ctx), 'dolphin'), (dir) => perRom(dir)),
    unsyncableReason: 'saves.dolphin'
  }),
  primehack: (ctx) => ({
    saves: at(under(savesRoot(ctx), ctx.system, 'primehack'), shared),
    states: at(under(statesRoot(ctx), 'primehack'), (dir) => perRom(dir)),
    unsyncableReason: 'saves.primehack'
  }),

  /** melonDS names both its `.sav` and its states after the ROM. */
  melonds: (ctx) => ({
    saves: at(under(savesRoot(ctx), ctx.system, 'melonds'), (dir) => perRom(dir)),
    states: at(under(statesRoot(ctx), ctx.system, 'melonds'), (dir) => perRom(dir))
  }),

  /**
   * MAME files its nvram under the ROM's own short name, which is what a MAME
   * set is called — and is exactly the ROM file's stem. `mame-sa` stands where
   * a system would.
   */
  mame: (ctx) => ({
    saves: at(under(savesRoot(ctx), 'mame-sa', 'nvram'), (dir) => perRom(dir)),
    states: at(under(statesRoot(ctx), 'mame-sa'), (dir) => perRom(dir))
  }),

  ruffle: (ctx) => ({
    saves: at(under(savesRoot(ctx), ctx.system, 'ruffle'), (dir) => perRom(dir)),
    states: null
  }),

  /**
   * PPSSPP keeps one directory per game *id*, read out of the ISO's PARAM.SFO
   * rather than from the file name, and its states are named after that id too.
   * Neither can be tied to a ROM from outside the emulator.
   */
  ppsspp: (ctx) => ({
    saves: at(under(savesRoot(ctx), 'PSP', 'PPSSPP-SA'), shared),
    states: at(under(statesRoot(ctx), 'PSP', 'PPSSPP-SA'), shared),
    unsyncableReason: 'saves.ppsspp'
  }),
  rpcs3: (ctx) => ({
    saves: at(under(savesRoot(ctx), ctx.system, 'rpcs3'), shared),
    states: at(under(statesRoot(ctx), ctx.system, 'rpcs3'), shared),
    unsyncableReason: 'saves.rpcs3'
  }),
  cemu: (ctx) => ({
    saves: at(under(savesRoot(ctx), ctx.system, 'cemu'), shared),
    states: null,
    unsyncableReason: 'saves.cemu'
  }),
  vita3k: (ctx) => ({
    saves: at(under(savesRoot(ctx), ctx.system, 'vita3k'), shared),
    states: null,
    unsyncableReason: 'saves.vita3k'
  }),
  azahar: (ctx) => ({
    saves: at(under(savesRoot(ctx), ctx.system, 'azahar', 'sdmc'), shared),
    states: null,
    unsyncableReason: 'saves.azahar'
  }),
  xemu: (ctx) => ({
    saves: at(under(savesRoot(ctx), ctx.system, 'xemu'), shared),
    states: null,
    unsyncableReason: 'saves.xemu'
  }),
  xroar: (ctx) => ({
    saves: null,
    states: at(under(statesRoot(ctx), 'xroar', ctx.system), (dir) => perRom(dir)),
    unsyncableReason: 'saves.xroar'
  }),
  solarus: (ctx) => ({
    saves: at(under(savesRoot(ctx), ctx.system, 'solarus'), directory),
    states: null
  }),
  gzdoom: (ctx) => ({
    saves: at(under(savesRoot(ctx), ctx.system, 'gzdoom'), (dir) => perRom(dir)),
    states: null
  })
}

/**
 * Where RetroDECK keeps the ES-DE system list, below its deploy directory.
 *
 * The same file `run_game.sh` consults: its `component_functions.sh` sets
 * `es_systems` to exactly this path inside the sandbox, and `installDir` is
 * where that sandbox's files are on the host.
 */
const ES_SYSTEMS =
  'files/retrodeck/components/es-de/share/es-de/resources/systems/linux/es_systems.xml'

/**
 * The label of the first `<command>` ES-DE lists for a system.
 *
 * This is RetroDECK's own last resort — "no altemulator set, so use the first
 * one" — and reading it means RomMix agrees with RetroDECK by construction
 * rather than by a table that has to be revised every time RetroDECK changes a
 * default.
 *
 * The system blocks are matched one at a time rather than with a single
 * expression spanning `<name>` and `<command>`, because a greedy match across
 * a file of two hundred systems would happily pair one system's name with
 * another's command.
 */
function defaultCommandLabel(
  env: SaveContext['env'],
  installDir: string,
  system: string
): string | null {
  const xml = env.text(joinPath(installDir, ES_SYSTEMS))
  if (!xml) return null

  for (const [, block] of xml.matchAll(/<system>([\s\S]*?)<\/system>/g)) {
    const name = /<name>\s*([\s\S]*?)\s*<\/name>/.exec(block)?.[1]
    if (name !== system) continue
    return /<command\s+label="([^"]*)"/.exec(block)?.[1] ?? null
  }
  return null
}

/**
 * The component ES-DE hands a system to, when ES-DE's own list cannot be read.
 *
 * A copy of the first `<command>` of each system in the `es_systems.xml`
 * RetroDECK bundles, kept only for the case where the deploy directory is not
 * where RomMix could look — a RetroDECK installed some way flatpak does not
 * report. Every system absent from here defaults to a core inside RetroArch,
 * which is the large majority of them and needs no entry.
 */
const RETRODECK_DEFAULT_COMPONENT: Readonly<Record<string, string>> = {
  gc: 'dolphin',
  wii: 'dolphin',
  triforce: 'dolphin',
  primehack: 'primehack',
  ps2: 'pcsx2',
  ps3: 'rpcs3',
  psp: 'ppsspp',
  psvita: 'vita3k',
  n3ds: 'azahar',
  wiiu: 'cemu',
  xbox: 'xemu',
  flash: 'ruffle',
  doom: 'gzdoom',
  solarus: 'solarus',
  coco: 'xroar',
  dragon32: 'xroar',
  tanodragon: 'xroar'
}

/**
 * ES-DE command labels that name a standalone component rather than a core.
 *
 * ES-DE labels a standalone command "<Name> (Standalone)" by convention, so the
 * suffix alone tells a core from a program; what it does not give is the
 * directory RetroDECK moved that program's saves into, which is what this maps
 * to. A label RomMix does not recognise falls back to RetroArch, because every
 * unrecognised label in practice *is* a core — there are hundreds of those and
 * a fixed handful of components.
 */
const COMPONENT_BY_LABEL: Readonly<Record<string, string>> = {
  pcsx2: 'pcsx2',
  duckstation: 'duckstation',
  dolphin: 'dolphin',
  primehack: 'primehack',
  ppsspp: 'ppsspp',
  rpcs3: 'rpcs3',
  'rpcs3 shortcut': 'rpcs3',
  vita3k: 'vita3k',
  azahar: 'azahar',
  cemu: 'cemu',
  xemu: 'xemu',
  ruffle: 'ruffle',
  gzdoom: 'gzdoom',
  solarus: 'solarus',
  melonds: 'melonds',
  mame: 'mame',
  xroar: 'xroar'
}

/**
 * Standalone programs ES-DE does not mark with the usual suffix.
 *
 * A short list on purpose — it is the exception to the rule below, and every
 * entry has to be checked against ES-DE's own list rather than guessed.
 */
const UNSUFFIXED_STANDALONES = new Set(['bigpemu', 'portmaster'])

/**
 * Reduce an ES-DE command label to the component it names, or null for a core.
 *
 * ES-DE labels a standalone command "<Name> (Standalone)" and a libretro core
 * by the core's own name, and that suffix is the only thing separating the two.
 * Ignoring it gets arcade badly wrong: the default there is "MAME - Current",
 * which is `mame_libretro.so` inside RetroArch — matching it on the word "MAME"
 * would send save sync to the standalone's `saves/mame-sa/nvram` tree, which
 * the core never writes to.
 *
 * Whatever survives the suffix still carries qualifiers the component name does
 * not — "MAME [Diskette] (Standalone)", "XRoar CoCo 2 NTSC (Standalone)" — so
 * the bracketed parts come off and the leading words are what is matched.
 */
function componentForLabel(label: string): string | null {
  const bare = label
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim()
    .toLowerCase()
  if (!bare) return null

  const standalone = /\(standalone\)/i.test(label) || UNSUFFIXED_STANDALONES.has(bare)
  if (!standalone) return null

  if (COMPONENT_BY_LABEL[bare]) return COMPONENT_BY_LABEL[bare]
  // "XRoar CoCo 2 NTSC" and friends: the program is the first word.
  return COMPONENT_BY_LABEL[bare.split(/\s+/)[0]] ?? null
}

/**
 * What resolving a component needs, which is less than a whole `SaveContext`.
 *
 * Named separately so BIOS placement can ask the same question: a BIOS file
 * belongs to a system rather than to a game, so there is no ROM to look up a
 * per-game override with, and everything below the first step still applies.
 */
export interface ComponentContext {
  paths: { home: string | null }
  system: string
  /** The game being launched, or null when the question is about a system. */
  romPath: string | null
  installDir: string | null
  env: SaveContext['env']
}

/**
 * The emulator RetroDECK will actually run this game with.
 *
 * Replicates `run_game.sh`'s own resolution, in its order: the per-game
 * `<altemulator>` recorded in ES-DE's gamelist, then the per-system
 * `<alternativeEmulator>` header in the same file, then the bundled default.
 * Reading it rather than choosing it is deliberate — RomMix launches RetroDECK
 * by system precisely so the user's own ES-DE configuration decides, and a save
 * path that disagreed with that choice would be a save written where nothing
 * looks.
 */
export function retroDeckComponent(ctx: ComponentContext): string {
  const gamelist = ctx.paths.home
    ? ctx.env.text(joinPath(ctx.paths.home, 'ES-DE', 'gamelists', ctx.system, 'gamelist.xml'))
    : null

  if (gamelist) {
    const label = altEmulatorFor(gamelist, ctx.romPath ? baseName(ctx.romPath) : null)
    const component = label ? componentForLabel(label) : null
    // A recognised label wins; an unrecognised one still means "a core", which
    // is what the RetroArch fallback below already is.
    if (component) return component
    if (label) return 'retroarch'
  }

  // Nothing overrides it, so ES-DE takes the first command it lists — read from
  // the very file RetroDECK reads rather than from a copy of its conclusions.
  if (ctx.installDir) {
    const label = defaultCommandLabel(ctx.env, ctx.installDir, ctx.system)
    if (label) return componentForLabel(label) ?? 'retroarch'
  }

  return RETRODECK_DEFAULT_COMPONENT[ctx.system] ?? 'retroarch'
}

/**
 * The `<altemulator>` that applies to one game, or the system-wide
 * `<alternativeEmulator>` when the game has none.
 *
 * ES-DE writes the per-game override inside the `<game>` block whose `<path>`
 * is `./<file name>`, and the system-wide one in an `<alternativeEmulator>`
 * header before the entries. Parsed with regular expressions rather than an XML
 * parser: these are two named elements in a file that can hold thousands of
 * games, and pulling in a parser to read two strings would cost more than it
 * explains.
 */
function altEmulatorFor(gamelist: string, romFileName: string | null): string | null {
  const games = romFileName ? gamelist.matchAll(/<game>([\s\S]*?)<\/game>/g) : []
  for (const [, block] of games) {
    const path = /<path>\s*([\s\S]*?)\s*<\/path>/.exec(block)?.[1]
    if (!path) continue
    if (baseName(path) !== romFileName) continue
    const alt = /<altemulator>\s*([\s\S]*?)\s*<\/altemulator>/.exec(block)?.[1]
    if (alt) return alt
    // The game is listed and names no override, so the system-wide one applies.
    break
  }
  return (
    /<alternativeEmulator>[\s\S]*?<label>\s*([\s\S]*?)\s*<\/label>[\s\S]*?<\/alternativeEmulator>/.exec(
      gamelist
    )?.[1] ?? null
  )
}

/** Where RetroDECK's chosen component keeps this game's saves. */
export function retroDeckSavePaths(ctx: SaveContext): SavePaths {
  const component = retroDeckComponent(ctx)

  const known = RETRODECK_COMPONENTS[component]
  // `emulator` is the component rather than "retrodeck": a save written by
  // RetroDECK's PCSX2 is a PCSX2 save, and tagging it with the frontend would
  // make it unreadable to anyone running PCSX2 any other way.
  if (known) return { ...known(ctx), emulator: component }

  /**
   * A libretro core, inside the RetroArch RetroDECK bundles.
   *
   * Its config is the one RetroDECK wrote during setup, which is why this is
   * not simply `<saves>/<system>`: RetroDECK turns *sort by content directory*
   * on and leaves *sort by core* off, so the folder is named after the
   * directory the ROM sits in. That equals the system for an ordinary loose
   * ROM and does not for a multi-file game installed into a folder of its own —
   * the difference between finding a save and creating an empty directory
   * beside it.
   */
  const config = readLibretroConfig(
    ctx.env,
    ctx.configDir ? [joinPath(ctx.configDir, 'retroarch', 'retroarch.cfg')] : [],
    ctx.home
  )
  return {
    ...libretroSavePaths(ctx, config, coreForSystem(ctx.system), {
      saves: ctx.paths.saves,
      states: ctx.paths.states
    }),
    emulator: 'retroarch'
  }
}
