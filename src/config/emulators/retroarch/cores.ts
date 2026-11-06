import { coreForSystem } from '../../systems.ts'
import { coreLibraryName } from '../libretro.ts'
import type { LaunchVariant } from '../types.ts'

/**
 * Cores worth offering beside the built-in one, by the systems they run.
 *
 * RomMix names the core on RetroArch's command line, and a core named there
 * wins over everything set in RetroArch itself — so a player whose other
 * devices run `gpsp` has no way to match them unless RomMix offers it. Their
 * states are refused here otherwise, because a state only loads in the core
 * that wrote it.
 *
 * Kept to the cores people actually pick between, each one a core the buildbot
 * ships for Linux. The built-in core from `systems.ts` always comes first and
 * is not repeated here.
 *
 * The label is for the screen only. The save folder a sorted core writes to is
 * `coreLibraryName`'s business, and a core missing there falls back safely —
 * see `CORE_LIBRARY_NAMES`.
 */
const ALTERNATIVES: readonly { systems: readonly string[]; cores: Record<string, string> }[] = [
  {
    systems: ['nes', 'famicom', 'fds'],
    cores: { nestopia: 'Nestopia', fceumm: 'FCEUmm' }
  },
  {
    systems: ['snes', 'snesna', 'sfc', 'satellaview', 'sufami'],
    cores: { bsnes: 'bsnes', 'mesen-s': 'Mesen-S' }
  },
  { systems: ['n64'], cores: { parallel_n64: 'ParaLLEl N64' } },
  { systems: ['gb', 'gbc'], cores: { sameboy: 'SameBoy', mgba: 'mGBA' } },
  { systems: ['gba'], cores: { gpsp: 'gpSP', vba_next: 'VBA Next' } },
  { systems: ['nds'], cores: { desmume: 'DeSmuME' } },
  {
    systems: [
      'mastersystem',
      'gamegear',
      'genesis',
      'megadrive',
      'megadrivejp',
      'segacd',
      'megacd'
    ],
    cores: { picodrive: 'PicoDrive' }
  },
  {
    systems: ['psx'],
    cores: { mednafen_psx_hw: 'Beetle PSX HW', pcsx_rearmed: 'PCSX ReARMed' }
  },
  { systems: ['saturn'], cores: { mednafen_saturn: 'Beetle Saturn', kronos: 'Kronos' } },
  {
    systems: ['pcengine', 'tg16', 'pcenginecd'],
    cores: { mednafen_pce_fast: 'Beetle PCE Fast' }
  },
  { systems: ['arcade', 'neogeo'], cores: { mame: 'MAME' } }
]

/**
 * The cores RetroArch can run a system with, as launch variants.
 *
 * The built-in core is first and marked `default`, so nobody is asked before
 * their first game: most players never think about cores, and the choice is
 * there behind "Run with" for the ones who do.
 */
export function retroArchCores(system: string): LaunchVariant[] {
  const builtIn = coreForSystem(system)
  if (!builtIn) return []

  const others = ALTERNATIVES.find((group) => group.systems.includes(system))?.cores ?? {}
  return [
    { id: builtIn, label: coreLibraryName(builtIn) ?? builtIn, default: true },
    ...Object.entries(others)
      .filter(([core]) => core !== builtIn)
      .map(([core, label]) => ({ id: core, label }))
  ]
}

/**
 * The core this launch runs: the variant chosen, where it is one of this
 * system's cores, and the built-in one otherwise.
 *
 * One function for `launch`, `core` and `saves`, because the three have to
 * agree — a save looked for under one core's folder while another core writes
 * it is a save nothing syncs.
 */
export function retroArchCore(system: string, variant: string | undefined): string | null {
  const offered = retroArchCores(system)
  return offered.find((core) => core.id === variant)?.id ?? offered[0]?.id ?? null
}
