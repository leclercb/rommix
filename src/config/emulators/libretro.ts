import { baseName, joinPath, perRom } from './savepaths.ts'
import type { SaveContext, SaveLocation, SavePaths } from './savepaths.ts'

/**
 * Where RetroArch puts saves, worked out the way RetroArch works it out.
 *
 * Three programs in this registry end up running libretro cores — standalone
 * RetroArch, RetroDECK, and EmuDeck through its `retroarch.sh` — and all three
 * inherit whatever the user's `retroarch.cfg` says. That file is the authority
 * and none of it is guessable: RetroDECK ships `sort_savefiles_by_content` on,
 * EmuDeck ships every sort flag off, and stock RetroArch defaults to off but
 * the setting is one menu entry away.
 *
 * The rule is transcribed from `runloop_path_set_redirect()` in RetroArch's
 * `runloop.c`:
 *
 *     dir = savefile_directory
 *         + (sort_savefiles_by_content ? "/" + parent_dir_name(content) : "")
 *         + (sort_savefiles            ? "/" + core.library_name        : "")
 *
 * Two details matter and are easy to get backwards. `content_dir_name` comes
 * from `fill_pathname_parent_dir_name`, so it is the name of the directory the
 * ROM *sits in* — which equals the ES-DE system only because ROMs normally live
 * at `roms/<system>/game.ext`. Install a multi-file game into
 * `roms/<system>/<Game Name>/` and RetroArch writes to `saves/<Game Name>/`
 * instead. And `library_name` is the name the core reports for itself, not its
 * file name: `genesis_plus_gx_libretro.so` calls itself "Genesis Plus GX".
 */

/** Config values that decide where a libretro save lands. */
export interface RetroArchConfig {
  savefileDir: string | null
  savestateDir: string | null
  sortSavefilesByCore: boolean
  sortSavefilesByContent: boolean
  sortSavestatesByCore: boolean
  sortSavestatesByContent: boolean
  savefilesInContentDir: boolean
  savestatesInContentDir: boolean
  /** Core last loaded, from `libretro_path`, without the `_libretro.so`. */
  activeCore: string | null
}

/** What RetroArch assumes when the config says nothing. All sorting is off. */
const RETROARCH_DEFAULTS: RetroArchConfig = {
  savefileDir: null,
  savestateDir: null,
  sortSavefilesByCore: false,
  sortSavefilesByContent: false,
  sortSavestatesByCore: false,
  sortSavestatesByContent: false,
  savefilesInContentDir: false,
  savestatesInContentDir: false,
  activeCore: null
}

const BOOL_KEYS: Readonly<Record<string, keyof RetroArchConfig>> = {
  sort_savefiles_enable: 'sortSavefilesByCore',
  sort_savefiles_by_content_enable: 'sortSavefilesByContent',
  sort_savestates_enable: 'sortSavestatesByCore',
  sort_savestates_by_content_enable: 'sortSavestatesByContent',
  savefiles_in_content_dir: 'savefilesInContentDir',
  savestates_in_content_dir: 'savestatesInContentDir'
}

/**
 * Read the first `retroarch.cfg` that exists out of `candidates`.
 *
 * `retroarch.cfg` is `key = "value"`, one per line. Anything the file does not
 * mention keeps RetroArch's own default rather than becoming null: a config
 * written before a setting existed means "off", which is exactly what RetroArch
 * will do with it.
 */
export function readRetroArchConfig(
  env: SaveContext['env'],
  candidates: readonly string[],
  home: string
): RetroArchConfig {
  const config: RetroArchConfig = { ...RETROARCH_DEFAULTS }

  for (const candidate of candidates) {
    const text = env.text(candidate)
    if (text == null) continue

    for (const line of text.split('\n')) {
      const match = /^\s*([a-z_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line)
      if (!match) continue
      const [, key, raw] = match
      const value = raw.trim()

      const boolKey = BOOL_KEYS[key]
      if (boolKey) {
        // A cast because every mapped key names a boolean field; the map is
        // what keeps that true.
        ;(config as unknown as Record<string, boolean>)[boolKey] = value.toLowerCase() === 'true'
        continue
      }
      if (key === 'savefile_directory') config.savefileDir = expandHome(value, home)
      else if (key === 'savestate_directory') config.savestateDir = expandHome(value, home)
      else if (key === 'libretro_path' && value && value !== 'default') {
        config.activeCore = baseName(value).replace(/\.(so|dll|dylib)$/i, '').replace(/_libretro$/, '')
      }
    }
    // The first config that exists is the one RetroArch reads; a second is a
    // different install's, and merging the two would describe neither.
    return config
  }
  return config
}

function expandHome(value: string, home: string): string | null {
  if (!value) return null
  if (value.startsWith('~')) return joinPath(home, value.slice(1))
  return value
}

/**
 * The display name a core reports as `library_name`, keyed by the core file
 * name RomMix uses in `systems.ts`.
 *
 * Only consulted when the user has turned "sort saves into folders by core
 * name" on, which is neither RetroArch's default nor RetroDECK's nor EmuDeck's.
 * A core missing from here is not a failure: the location falls back to the
 * unsorted directory and keeps the sorted one as a search path, so a save that
 * is really in a folder named after the core is still found on push — it just
 * is not created by a pull, which is the right way round. Writing a save into a
 * folder named by a guess is how a game starts without it.
 */
const CORE_LIBRARY_NAMES: Readonly<Record<string, string>> = {
  a5200: 'a5200',
  atari800: 'Atari800',
  beetle_ngp: 'Beetle NeoPop',
  beetle_pce: 'Beetle PCE',
  beetle_pcfx: 'Beetle PC-FX',
  beetle_supergrafx: 'Beetle SuperGrafx',
  beetle_vb: 'Beetle VB',
  beetle_wswan: 'Beetle WonderSwan',
  bluemsx: 'blueMSX',
  cap32: 'Caprice32',
  dolphin: 'dolphin',
  dosbox_pure: 'DOSBox-pure',
  fbneo: 'FinalBurn Neo',
  flycast: 'Flycast',
  freechaf: 'FreeChaF',
  freeintv: 'FreeIntv',
  fuse: 'fuse',
  gambatte: 'Gambatte',
  genesis_plus_gx: 'Genesis Plus GX',
  handy: 'Handy',
  mame: 'MAME',
  melonds: 'melonDS',
  mesen: 'Mesen',
  mgba: 'mGBA',
  mupen64plus_next: 'Mupen64Plus-Next',
  o2em: 'O2EM',
  opera: 'Opera',
  pcsx2: 'LRPS2',
  picodrive: 'PicoDrive',
  pokemini: 'PokeMini',
  ppsspp: 'PPSSPP',
  prboom: 'PrBoom',
  prosystem: 'ProSystem',
  puae: 'PUAE',
  retro8: 'Retro8',
  scummvm: 'ScummVM',
  snes9x: 'Snes9x',
  stella: 'Stella',
  swanstation: 'SwanStation',
  tic80: 'TIC-80',
  tyrquake: 'TyrQuake',
  uzem: 'uzem',
  vecx: 'VecX',
  vice_x64: 'VICE x64',
  vice_xvic: 'VICE xvic',
  virtualjaguar: 'Virtual Jaguar',
  yabasanshiro: 'YabaSanshiro'
}

/** The folder name a core sorts its saves into, or null when unknown. */
export function coreLibraryName(core: string | null): string | null {
  if (!core) return null
  return CORE_LIBRARY_NAMES[core] ?? null
}

/**
 * Apply RetroArch's redirect rule for one kind of save data.
 *
 * `canonical` is where a pull writes and a push looks first; `search` carries
 * the alternative that exists only because the core folder name may be wrong.
 */
function locate(
  root: string | null,
  ctx: SaveContext,
  options: { inContentDir: boolean; byContent: boolean; byCore: boolean; core: string | null }
): SaveLocation | null {
  const base = options.inContentDir ? ctx.romDir : root
  if (!base) return null

  const contentDir = options.byContent ? baseName(ctx.romDir) : null
  const sorted = joinPath(base, contentDir)

  if (!options.byCore) return perRom(sorted)

  const library = coreLibraryName(options.core)
  // Sorting by core is on but the core's own name for itself is not something
  // RomMix can know. The unsorted directory is the safe write target and the
  // one place a save is certainly readable from; anything already filed under a
  // core folder is still found, because every one of them is searched.
  if (!library) return perRom(sorted, [sorted])
  return perRom(joinPath(sorted, library), [sorted])
}

/**
 * Both save locations for a libretro run, from a config that has already been
 * read.
 *
 * `core` is the core RomMix named on the command line where it names one; the
 * config's `libretro_path` is the fallback, which is what RetroDECK and EmuDeck
 * leave behind after a launch they made themselves.
 */
export function libretroSavePaths(
  ctx: SaveContext,
  config: RetroArchConfig,
  core: string | null,
  fallback: { saves: string | null; states: string | null }
): SavePaths {
  const chosen = core ?? config.activeCore

  return {
    saves: locate(config.savefileDir ?? fallback.saves, ctx, {
      inContentDir: config.savefilesInContentDir,
      byContent: config.sortSavefilesByContent,
      byCore: config.sortSavefilesByCore,
      core: chosen
    }),
    states: locate(config.savestateDir ?? fallback.states, ctx, {
      inContentDir: config.savestatesInContentDir,
      byContent: config.sortSavestatesByContent,
      byCore: config.sortSavestatesByCore,
      core: chosen
    })
  }
}
