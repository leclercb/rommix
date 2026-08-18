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
 * Its folders are not declared here: the ROM root is user-selectable
 * (internal storage vs SD card), so it is read from RetroDECK's own config by
 * `retroDeckPaths()` in src/main/emulators.ts.
 */
export const retrodeck: EmulatorDescriptor = {
  id: 'retrodeck',
  name: 'RetroDECK',
  role: 'frontend',
  install: [{ kind: 'flatpak', appId: RETRODECK_APP_ID }],
  systems: [
    ...new Set([...Object.keys(ESDE_TO_LIBRETRO_CORE), ...RETRODECK_STANDALONE_SYSTEMS])
  ],
  ownsLibrary: true,
  dirs: {},
  saveLayout: 'delegated',
  launch: ({ exec, system, romPath }) => [...exec, '-s', system, romPath]
}
