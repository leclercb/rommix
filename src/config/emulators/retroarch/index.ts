import { coreForSystem, systemsWithCore } from '../../systems.ts'
import { libretroCore, libretroSavePaths, readLibretroConfig } from '../libretro.ts'
import { joinPath } from '../savepaths.ts'
import type { CoreContext, EmulatorDescriptor, RequiredCore } from '../types.ts'

const RETROARCH_APP_ID = 'org.libretro.RetroArch'

/**
 * Where standalone RetroArch's config might be.
 *
 * `configDir` is whichever root the probe settled on for the install it found —
 * the flatpak's own tree, or the XDG one for a distro package — so it is the
 * first and usually only candidate. The bare XDG path follows it for the case
 * where RomMix found the flatpak but the user also has a native RetroArch whose
 * config is the populated one.
 */
function configCandidates(ctx: CoreContext): readonly string[] {
  return [
    joinPath(ctx.configDir, 'retroarch', 'retroarch.cfg'),
    joinPath(ctx.home, '.config', 'retroarch', 'retroarch.cfg')
  ].filter((path) => path !== '')
}

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
  frontend: false,
  install: [
    { kind: 'flatpak', appId: RETROARCH_APP_ID },
    { kind: 'binary', names: ['retroarch'] }
  ],
  homepage: 'https://www.retroarch.com',
  systems: systemsWithCore(),
  // One core per system, named by `launch`, so there is nothing to choose.
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    roms: { base: 'rommix', path: 'roms' },
    saves: { base: 'config', path: 'retroarch/saves' },
    states: { base: 'config', path: 'retroarch/states' },
    bios: { base: 'config', path: 'retroarch/system' }
  },
  // RetroArch's folders are fixed by its packaging, so there is no config file
  // to discover them from and no library root to relocate.
  layout: undefined,
  // It reads its ROM folders recursively, so a multi-file game may keep a
  // folder of its own.
  flatLibrary: false,
  /**
   * Straight from `retroarch.cfg`, because every part of the answer lives
   * there: the two roots, whether saves are sorted into a folder per core or
   * per content directory, and whether they go beside the ROM instead. The
   * declared `dirs` above are only the fallback for a RetroArch that has never
   * written a config.
   *
   * The core is the one RomMix names on the command line in `launch`, so the
   * save location and the process that writes it can never disagree.
   */
  saves: (ctx) =>
    libretroSavePaths(
      ctx,
      readLibretroConfig(ctx.env, configCandidates(ctx), ctx.home),
      coreForSystem(ctx.system),
      { saves: ctx.paths.saves, states: ctx.paths.states }
    ),
  // Its system folder takes any firmware file dropped in.
  bios: undefined,
  biosStagingNote: undefined,
  /**
   * The core for this system, and the folder RetroArch will look for it in.
   *
   * From `libretro_directory` rather than the templated `dirs`, because that is
   * the directory RetroArch searches when `launch` names a core by file name —
   * install it anywhere else and the bare name resolves to nothing, which is
   * the fatal "path is not set" this exists to prevent.
   */
  core: (ctx: CoreContext): RequiredCore | null =>
    libretroCore(
      readLibretroConfig(ctx.env, configCandidates(ctx), ctx.home),
      coreForSystem(ctx.system),
      joinPath(ctx.configDir, 'retroarch', 'cores') || null
    ),
  // Nothing: the one setup step RetroArch really needs — a core for the system
  // being played — RomMix now performs itself, from `core` above.
  setupNotes: [],
  env: undefined,
  // `exec` alone starts RetroArch with no content.
  open: undefined,
  launch: ({ exec, system, romPath }) => {
    const core = coreForSystem(system)
    if (!core) return null
    return [...exec, '-L', `${core}_libretro.so`, romPath]
  }
}
