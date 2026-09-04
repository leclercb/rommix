import { baseName, joinPath, perRom } from './savepaths.ts'
import type { SaveContext, SaveLocation, SavePaths } from './savepaths.ts'
import type { RequiredCore } from './types.ts'

/**
 * The libretro layer: where a core keeps its saves, and which core to load.
 *
 * Shared rather than filed under one emulator because more than one program in
 * this registry runs libretro cores, and every one of them inherits the same
 * `retroarch.cfg` and the same rules from it. Putting this in any single
 * emulator's folder would make the other two import from it, which is worse
 * than a shared module: it would say the behaviour belongs to that emulator
 * when it belongs to libretro.
 *
 * So nothing here names an emulator or branches on one. A caller supplies the
 * config files to read and the core to run, and gets back an answer derived
 * only from those — which is what lets three descriptors with three different
 * layouts share it, and what keeps the emulator-specific part in the folder of
 * the emulator it is specific to.
 *
 * The redirect rule is transcribed from `runloop_path_set_redirect()` in
 * libretro's reference frontend (`runloop.c`):
 *
 *     dir = savefile_directory
 *         + (sort_savefiles_by_content ? "/" + parent_dir_name(content) : "")
 *         + (sort_savefiles            ? "/" + core.library_name        : "")
 *
 * Two details matter and are easy to get backwards. `content_dir_name` comes
 * from `fill_pathname_parent_dir_name`, so it is the name of the directory the
 * ROM *sits in* — which equals the ES-DE system only because ROMs normally live
 * at `roms/<system>/game.ext`. Install a multi-file game into
 * `roms/<system>/<Game Name>/` and the save goes to `saves/<Game Name>/`
 * instead. And `library_name` is the name the core reports for itself, not its
 * file name: `genesis_plus_gx_libretro.so` calls itself "Genesis Plus GX".
 */

/** Config values that decide where a libretro save lands. */
export interface LibretroConfig {
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
  /** The directory cores are loaded from, from `libretro_directory`. */
  coresDir: string | null
  /**
   * The buildbot directory new cores come from, with a trailing slash, from
   * `core_updater_buildbot_cores_url`. Written for the platform it is running
   * on, so it already spells out the right architecture.
   */
  buildbotUrl: string | null
}

/** What the config not saying means. All sorting is off. */
const LIBRETRO_DEFAULTS: LibretroConfig = {
  savefileDir: null,
  savestateDir: null,
  sortSavefilesByCore: false,
  sortSavefilesByContent: false,
  sortSavestatesByCore: false,
  sortSavestatesByContent: false,
  savefilesInContentDir: false,
  savestatesInContentDir: false,
  activeCore: null,
  coresDir: null,
  buildbotUrl: null
}

const BOOL_KEYS: Readonly<Record<string, keyof LibretroConfig>> = {
  sort_savefiles_enable: 'sortSavefilesByCore',
  sort_savefiles_by_content_enable: 'sortSavefilesByContent',
  sort_savestates_enable: 'sortSavestatesByCore',
  sort_savestates_by_content_enable: 'sortSavestatesByContent',
  savefiles_in_content_dir: 'savefilesInContentDir',
  savestates_in_content_dir: 'savestatesInContentDir'
}

/**
 * Read the first config that exists out of `candidates`, which the caller names.
 *
 * The format is `key = "value"`, one per line. A key the file omits keeps the
 * default rather than becoming null: a config written before a setting existed
 * means "off", which is what the frontend will do with it.
 */
export function readLibretroConfig(
  env: SaveContext['env'],
  candidates: readonly string[],
  home: string
): LibretroConfig {
  const config: LibretroConfig = { ...LIBRETRO_DEFAULTS }

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
      else if (key === 'libretro_directory') config.coresDir = expandHome(value, home)
      else if (key === 'core_updater_buildbot_cores_url' && value) {
        // A trailing slash so a file name can simply be appended. One is
        // normally written, but the setting is user-editable.
        config.buildbotUrl = value.endsWith('/') ? value : `${value}/`
      } else if (key === 'libretro_path' && value && value !== 'default') {
        config.activeCore = baseName(value)
          .replace(/\.(so|dll|dylib)$/i, '')
          .replace(/_libretro$/, '')
      }
    }
    // The first that exists is the one being read; a second is a different
    // install's, and merging the two would describe neither.
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
 * name" on, which no frontend here ships as its default. A core missing from
 * this table is not a failure: the location falls back to the
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
 * The core file a libretro launch needs, and where it has to be.
 *
 * `libretro_directory` is the authority for the same reason the save settings
 * are: it is the directory the emulator will actually search, and writing the
 * core anywhere else installs it where nothing looks. `fallbackDir` covers an
 * install that has never written a config, where the caller's templated
 * directories are all there is.
 *
 * Null when the config names no directory and there is no fallback either —
 * there is nowhere to put a core, so there is nothing to promise.
 */
export function libretroCore(
  config: LibretroConfig,
  core: string | null,
  fallbackDir: string | null
): RequiredCore | null {
  if (!core) return null
  const dir = config.coresDir ?? fallbackDir
  if (!dir) return null

  return {
    id: core,
    // The core's own name where it is known, which is what its Online Updater
    // entry and its save folder are both called; the file name otherwise.
    name: coreLibraryName(core) ?? core,
    dir,
    fileName: `${core}_libretro.so`,
    buildbotUrl: config.buildbotUrl
  }
}

/**
 * Apply the redirect rule above for one kind of save data.
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
 * `core` is the one the caller named on the command line where it named one;
 * the config's `libretro_path` is the fallback, left behind by a frontend that
 * chose the core itself.
 */
/**
 * What a libretro save used to be tagged with, and still is where the core is
 * unknown.
 *
 * The frontend, which is the one thing about a libretro save that says nothing
 * useful: RetroArch is a shell, and the file's format, its name and whether
 * another program can read it are all the core's doing. RomM's own browser
 * player already records the core — an N64 save it wrote is `mupen64plus_next`
 * — so tagging with the frontend meant RomMix and RomM could not exchange a
 * save for any system either of them ran through libretro.
 *
 * MIGRATION(0.12): every libretro save uploaded up to that version carries this
 * instead of a core, so it stays acceptable on the way in through `alsoAccepts`
 * — see `SavePaths`. Nothing writes it any more except the case below, where
 * the core genuinely could not be resolved.
 */
export const LIBRETRO_TAG = 'retroarch'

export function libretroSavePaths(
  ctx: SaveContext,
  config: LibretroConfig,
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
    }),
    // `core` rather than `chosen`: the fallback above is the core RetroArch
    // loaded last, which is a fair guess at a directory name and no answer at
    // all to what wrote this game's save.
    emulator: core ?? LIBRETRO_TAG,
    alsoAccepts: [LIBRETRO_TAG]
  }
}
