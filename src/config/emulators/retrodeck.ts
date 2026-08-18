import { ESDE_TO_LIBRETRO_CORE } from '../systems.ts'
import type { EmulatorDescriptor } from './types.ts'

export const RETRODECK_APP_ID = 'net.retrodeck.retrodeck'

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
 * RetroDECK's own configuration. Where that configuration lives and what its
 * keys are called is `RETRODECK_CONFIG` below; the reading of it is
 * `src/main/emulators.ts`.
 */
export const retrodeck: EmulatorDescriptor = {
  id: 'retrodeck',
  name: 'RetroDECK',
  dispatch: 'self',
  install: [{ kind: 'flatpak', appId: RETRODECK_APP_ID }],
  systems: [
    ...new Set([...Object.keys(ESDE_TO_LIBRETRO_CORE), ...RETRODECK_STANDALONE_SYSTEMS])
  ],
  ownsLibrary: true,
  dirs: {},
  saveLayout: 'delegated',
  saveTree: 'system-nested',
  launch: ({ exec, system, romPath }) => [...exec, '-s', system, romPath]
}

/**
 * Where RetroDECK records the folder layout the user chose, and what it calls
 * each path.
 *
 * Two formats: current builds keep everything in `retrodeck.json`, older ones
 * in a flat `key=value` `retrodeck.cfg`. Both are described because an install
 * may predate the migration. The legacy file records only the home directory
 * reliably, hence the subdirectory names to hang off it.
 */
export const RETRODECK_CONFIG = {
  /** Relative to the flatpak's per-app tree, `~/.var/app/<app id>/`. */
  configDir: ['config', 'retrodeck'],
  json: {
    file: 'retrodeck.json',
    keys: {
      home: 'rd_home_path',
      roms: 'roms_path',
      saves: 'saves_path',
      states: 'states_path',
      bios: 'bios_path'
    }
  },
  legacy: {
    file: 'retrodeck.cfg',
    homeKey: 'rdhome',
    keys: {
      roms: 'roms_folder',
      saves: 'saves_folder',
      states: 'states_folder',
      bios: 'bios_folder'
    }
  },
  /** Used only when neither file can be read, and only if it really exists. */
  fallback: {
    home: 'retrodeck',
    roms: 'roms',
    saves: 'saves',
    states: 'states',
    bios: 'bios'
  }
} as const
