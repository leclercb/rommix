import { ESDE_TO_LIBRETRO_CORE, coreForSystem } from '../systems.ts'
import type { EmulatorDescriptor } from './types.ts'

export const RETROARCH_APP_ID = 'org.libretro.RetroArch'

/**
 * Standalone RetroArch.
 *
 * Unlike RetroDECK it has no system resolution of its own, so RomMix maps the
 * ES-DE system to a libretro core explicitly — which makes the set of systems
 * it can run exactly the set that has a core mapping. Declaring `systems` from
 * the mapping rather than by hand keeps the two from drifting apart.
 *
 * RetroArch has no ROM root of its own, so RomMix keeps one in the user's home
 * and lets RetroArch's own history handle the rest.
 */
export const retroarch: EmulatorDescriptor = {
  id: 'retroarch',
  name: 'RetroArch',
  role: 'standalone',
  install: [
    { kind: 'flatpak', appId: RETROARCH_APP_ID },
    { kind: 'binary', names: ['retroarch'] }
  ],
  systems: Object.keys(ESDE_TO_LIBRETRO_CORE),
  ownsLibrary: false,
  dirs: {
    roms: { base: 'home', path: 'roms' },
    saves: { base: 'config', path: 'retroarch/saves' },
    states: { base: 'config', path: 'retroarch/states' },
    bios: { base: 'config', path: 'retroarch/system' }
  },
  saveLayout: 'per-game-file',
  launch: ({ exec, system, romPath }) => {
    const core = coreForSystem(system)
    if (!core) return null
    return [...exec, '-L', `${core}_libretro.so`, romPath]
  }
}
