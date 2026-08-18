import type { EmulatorDescriptor } from './types.ts'

export const RETRODECK_APP_ID = 'net.retrodeck.retrodeck'

/**
 * RetroDECK is not an emulator — it is a library plus a dispatcher. Its CLI
 *
 *     flatpak run net.retrodeck.retrodeck [-e emulator] -s <system> <game>
 *
 * resolves the emulator from its bundled es_systems.xml, honouring any
 * <altemulator> the user set in ES-DE. Passing the system and letting
 * RetroDECK choose is both simpler and more faithful to the user's own
 * configuration than picking an emulator here, which is why `systems` is
 * 'delegated' and RomMix never reaches past it to the emulator underneath.
 * Enumerating what RetroDECK bundles would duplicate configuration we do not
 * own and desync on every RetroDECK release.
 *
 * Its folders are not declared here either: the ROM root is user-selectable
 * (internal storage vs SD card), so it is read from RetroDECK's own config by
 * `retroDeckPaths()` in src/main/emulators.ts.
 */
export const retrodeck: EmulatorDescriptor = {
  id: 'retrodeck',
  name: 'RetroDECK',
  role: 'frontend',
  install: [{ kind: 'flatpak', appId: RETRODECK_APP_ID }],
  systems: 'delegated',
  ownsLibrary: true,
  dirs: {},
  saveLayout: 'delegated',
  launch: ({ exec, system, romPath }) => [...exec, '-s', system, romPath]
}
