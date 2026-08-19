import { coreForSystem, systemsWithCore } from '../systems.ts'
import type { EmulatorDescriptor } from './types.ts'

const RETROARCH_APP_ID = 'org.libretro.RetroArch'

/**
 * Standalone RetroArch.
 *
 * Unlike RetroDECK it has no system resolution of its own, so RomMix maps the
 * ES-DE system to a libretro core explicitly — which makes the set of systems
 * it can run exactly the set that has a core mapping. Declaring `systems` from
 * the mapping rather than by hand keeps the two from drifting apart.
 *
 * RetroArch has no ROM root of its own either, so its games go in RomMix's
 * folder alongside the other emulators that have nowhere natural to put them,
 * and RetroArch's own history handles the rest.
 */
export const retroarch: EmulatorDescriptor = {
  id: 'retroarch',
  name: 'RetroArch',
  dispatch: 'rommix',
  install: [
    { kind: 'flatpak', appId: RETROARCH_APP_ID },
    { kind: 'binary', names: ['retroarch'] }
  ],
  systems: systemsWithCore(),
  ownsLibrary: false,
  dirs: {
    roms: { base: 'rommix', path: 'roms' },
    saves: { base: 'config', path: 'retroarch/saves' },
    states: { base: 'config', path: 'retroarch/states' },
    bios: { base: 'config', path: 'retroarch/system' }
  },
  saveLayout: 'per-game-file',
  // RetroArch writes `<rom name>.srm` into the save directory itself. There is
  // no per-system subdirectory to descend into, and pulling a save down into
  // one would put it somewhere RetroArch never looks.
  saveTree: 'flat',
  launch: ({ exec, system, romPath }) => {
    const core = coreForSystem(system)
    if (!core) return null
    return [...exec, '-L', `${core}_libretro.so`, romPath]
  }
}
