import { systemsWithCore } from '../../systems.ts'
import { retroDeckBiosDir } from './bios.ts'
import { retroDeckSavePaths } from './saves.ts'
import type { EmulatorDescriptor } from '../types.ts'

export const RETRODECK_APP_ID = 'net.retrodeck.retrodeck'

/**
 * Where RetroDECK keeps its libretro cores, inside its own sandbox.
 *
 * A path into another application would normally be RomMix's business to read
 * rather than to know, but this one is not being used to find anything — it is
 * handed straight back to RetroDECK, which is where the value came from. See
 * `env` below for why it has to be handed back at all.
 */
const RETRODECK_CORES_DIR = '/app/retrodeck/components/retroarch/rd_extras/cores'

/**
 * Systems RetroDECK covers with a bundled standalone emulator rather than
 * through libretro.
 *
 * Taken from the components it actually ships (verified against 0.10.9b):
 * azahar, cemu, dolphin, duckstation, gzdoom, mame, melonds, openbor, pcsx2,
 * pico-8, ppsspp, primehack, retroarch, rpcs3, ruffle, solarus, vita3k, xemu,
 * xroar.
 *
 * What is *absent* matters as much as what is here. There is no ryubing, eden
 * or yuzu component, so Switch is deliberately not listed: ES-DE's own
 * es_systems.xml does define a `switch` entry, but its only live command
 * resolves to a RetroDECK component that does not exist, and a ROM sent there
 * fails at launch.
 */
const RETRODECK_STANDALONE_SYSTEMS = [
  'n3ds',
  'wiiu',
  'gc',
  'wii',
  'ps2',
  'ps3',
  'psvita',
  'psp',
  'nds',
  'psx',
  'xbox',
  'arcade',
  'mame',
  'doom',
  'pico8',
  'flash',
  'solarus',
  'openbor',
  'dragon32',
  'coco'
]

/**
 * RetroDECK is a library plus a dispatcher rather than an emulator. Its CLI
 *
 *     flatpak run net.retrodeck.retrodeck [-e emulator] -s <system> <game>
 *
 * resolves the emulator from its bundled es_systems.xml, honouring any
 * <altemulator> the user set in ES-DE. Passing the system and letting
 * RetroDECK choose is more faithful to the user's own configuration than
 * naming an emulator here, so RomMix never reaches past it to the emulator
 * underneath — but it still has to know *which* systems RetroDECK can do,
 * because "ask RetroDECK" is not an answer when RetroDECK has nothing to ask.
 *
 * It bundles RetroArch, so it covers everything libretro does, plus the
 * standalone emulators above. The list is curated for the current RetroDECK
 * release; a newer one that adds an emulator is corrected per platform in
 * Settings rather than by waiting for a RomMix update.
 *
 * Its folders cannot be declared as `dirs` templates: the ROM root is
 * user-selectable (internal storage vs SD card), so it is read from
 * RetroDECK's own configuration — see `layout` below.
 */
export const retrodeck: EmulatorDescriptor = {
  id: 'retrodeck',
  name: 'RetroDECK',
  dispatch: 'self',
  frontend: true,
  install: [{ kind: 'flatpak', appId: RETRODECK_APP_ID }],
  homepage: 'https://retrodeck.net',
  systems: [...new Set([...systemsWithCore(), ...RETRODECK_STANDALONE_SYSTEMS])],
  // RetroDECK resolves the emulator per system from its own ES-DE
  // configuration, so RomMix has nothing to offer a choice between.
  variants: undefined,
  ownsLibrary: true,
  dirs: {},
  /**
   * `retrodeck.json`, inside RetroDECK's own flatpak tree — which is what the
   * `config` base resolves to for a flatpak install.
   *
   * The older flat `retrodeck.cfg` is deliberately not read. RetroDECK converts
   * it on startup and renames the original to `retrodeck.bak`, so a `.cfg` only
   * survives on an install that has never been run since that release — and
   * RomMix cannot use RetroDECK before it has been run anyway, because the
   * folders it needs do not exist until then. Reading a file that is renamed
   * away the moment it becomes reachable is a branch that cannot fire.
   */
  layout: {
    sources: [
      {
        file: { base: 'config', path: 'retrodeck/retrodeck.json' },
        format: 'json',
        section: 'paths',
        requires: 'roms',
        keys: {
          home: 'rd_home_path',
          roms: 'roms_path',
          saves: 'saves_path',
          states: 'states_path',
          bios: 'bios_path'
        }
      }
    ],
    // Everything RetroDECK keeps below its library folder, for the user who
    // moved that folder to an SD card and told RomMix where it went.
    relative: { roms: 'roms', saves: 'saves', states: 'states', bios: 'bios' },
    fallback: {
      base: 'home',
      paths: {
        home: 'retrodeck',
        roms: 'retrodeck/roms',
        saves: 'retrodeck/saves',
        states: 'retrodeck/states',
        bios: 'retrodeck/bios'
      }
    }
  },
  // ES-DE scans recursively, and a multi-file game in a folder of its own is
  // what it expects.
  flatLibrary: false,
  /**
   * Resolved per game, because RetroDECK's answer is "wherever the component I
   * chose puts them" — and which component that is comes out of the user's own
   * ES-DE configuration. See `retrodeck-saves.ts`.
   */
  saves: retroDeckSavePaths,
  /**
   * Read out of RetroDECK's own component manifests: the root of `bios/` for
   * almost everything, a subfolder or another tree entirely where the
   * component that runs the system says so. See `bios.ts`.
   */
  bios: retroDeckBiosDir,
  biosStagingNote: undefined,
  // Cores ship inside the RetroDECK flatpak, and which one runs a system is
  // ES-DE's decision rather than RomMix's — there is nothing to install.
  core: undefined,
  // Everything RetroDECK needs it does in its own first-run setup.
  setupNotes: [],
  /**
   * Works around a RetroDECK bug that breaks every libretro launch through its
   * command line — which is the only way in RomMix has.
   *
   * Its `run_game.sh` expands the `%CORE_RETROARCH%` placeholder in the ES-DE
   * command to `$ra_cores_path`, a variable it never assigns. The value is
   * meant to arrive from the `paths` block of `retrodeck.json`, which RetroDECK
   * loads into the environment key by key, but nothing writes that key — so on
   * an install whose config lacks it the placeholder expands to nothing and
   * RetroArch is told to load `/mgba_libretro.so`. It cannot, and RetroDECK
   * exits 0 as though the game had been played.
   *
   * Setting the variable ourselves is the whole fix: the loader only overwrites
   * keys the config actually has, so an install that does define it is left
   * alone. It reaches RetroDECK's sandbox as `flatpak run --env` — see
   * `execPrefix`. Removable once RetroDECK assigns it; harmless until then.
   */
  env: { ra_cores_path: RETRODECK_CORES_DIR },
  // `exec` alone opens RetroDECK's own frontend.
  open: undefined,
  launch: ({ exec, system, romPath }) => [...exec, '-s', system, romPath]
}
