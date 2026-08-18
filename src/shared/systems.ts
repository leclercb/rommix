/**
 * Mapping between RomM platform slugs and ES-DE system directories.
 *
 * The ES-DE system name is RomMix's internal identifier for a platform: it
 * names the folder a ROM is installed into, it is what emulators declare
 * support for, and it is the key of the platform -> emulator map in settings.
 *
 * RomM platform slugs follow IGDB's slugs. The directory layout is not
 * cosmetic either: RetroDECK's `run_game` infers which emulator to use from
 * exactly that path segment, so a correctly placed file launches with no
 * further hints.
 *
 * The ES-DE system names below come from ES-DE's own
 * `resources/systems/linux/es_systems.xml` (195 systems). The RomM-side slugs
 * are the common ones; this map is deliberately not exhaustive. Anything not
 * listed falls back through `resolveSystem()` and can always be corrected by
 * the user via `settings.systemOverrides`.
 */

/** RomM platform slug -> ES-DE system directory name. */
export const ROMM_SLUG_TO_ESDE: Readonly<Record<string, string>> = {
  // Nintendo
  nes: 'nes',
  famicom: 'famicom',
  fds: 'fds',
  snes: 'snes',
  sfam: 'sfc',
  satellaview: 'satellaview',
  'sufami-turbo': 'sufami',
  n64: 'n64',
  '64dd': 'n64dd',
  ngc: 'gc',
  wii: 'wii',
  wiiu: 'wiiu',
  switch: 'switch',
  gb: 'gb',
  gbc: 'gbc',
  gba: 'gba',
  nds: 'nds',
  '3ds': 'n3ds',
  virtualboy: 'virtualboy',
  'pokemon-mini': 'pokemini',
  'game-and-watch': 'gameandwatch',

  // Sega
  sms: 'mastersystem',
  'genesis-slash-megadrive': 'genesis',
  segacd: 'segacd',
  sega32: 'sega32x',
  saturn: 'saturn',
  dc: 'dreamcast',
  gamegear: 'gamegear',
  sg1000: 'sg-1000',
  // Sega Pico deliberately has no mapping: ES-DE ships no system for it, and
  // guessing would install its ROMs somewhere nothing scans.
  naomi: 'naomi',
  atomiswave: 'atomiswave',

  // Sony
  ps: 'psx',
  ps2: 'ps2',
  ps3: 'ps3',
  'ps4--1': 'ps4',
  psp: 'psp',
  psvita: 'psvita',

  // Microsoft
  xbox: 'xbox',
  xbox360: 'xbox360',
  xboxone: 'xboxone',
  win: 'windows',
  dos: 'dos',

  // NEC
  'turbografx16--1': 'pcengine',
  'turbografx-16-slash-pc-engine-cd': 'pcenginecd',
  supergrafx: 'supergrafx',
  'pc-fx': 'pcfx',
  'pc-8800-series': 'pc88',
  'pc-9800-series': 'pc98',

  // SNK
  neogeoaes: 'neogeo',
  neogeomvs: 'neogeo',
  'neo-geo-cd': 'neogeocd',
  ngp: 'ngp',
  ngpc: 'ngpc',

  // Atari
  atari2600: 'atari2600',
  atari5200: 'atari5200',
  atari7800: 'atari7800',
  atari8bit: 'atari800',
  'atari-st': 'atarist',
  jaguar: 'atarijaguar',
  'atari-jaguar-cd': 'atarijaguarcd',
  lynx: 'atarilynx',

  // Commodore / home computers
  amiga: 'amiga',
  'amiga-cd32': 'amigacd32',
  c64: 'c64',
  'vic-20': 'vic20',
  'commodore-plus-slash-4': 'plus4',
  acpc: 'amstradcpc',
  zxs: 'zxspectrum',
  zx81: 'zx81',
  msx: 'msx',
  msx2: 'msx2',
  appleii: 'apple2',
  'apple-iigs': 'apple2gs',
  mac: 'macintosh',
  'acorn-archimedes': 'archimedes',
  'acorn-electron': 'electron',
  bbcmicro: 'bbcmicro',
  'dragon-32-slash-64': 'dragon32',
  oric: 'oric',
  'sam-coupe': 'samcoupe',
  'sharp-x1': 'x1',
  'sharp-x68000': 'x68000',
  'fm-towns': 'fmtowns',
  'trs-80': 'trs-80',
  'ti-99': 'ti99',
  'thomson-mo5': 'moto',

  // Other consoles / handhelds
  '3do': '3do',
  colecovision: 'colecovision',
  intellivision: 'intellivision',
  vectrex: 'vectrex',
  'odyssey-2-slash-videopac-g7000': 'odyssey2',
  'philips-cd-i': 'cdimono1',
  'channel-f': 'channelf',
  astrocade: 'astrocde',
  'arcadia-2001': 'arcadia',
  'watara-slash-quickshot-supervision': 'supervision',
  'game-dot-com': 'gamecom',
  wonderswan: 'wonderswan',
  'wonderswan-color': 'wonderswancolor',
  'mega-duck-slash-cougar-boy': 'megaduck',
  'gamate': 'gamate',
  'super-acan': 'supracan',
  'vsmile': 'vsmile',

  // Arcade / misc
  arcade: 'arcade',
  mame: 'mame',
  daphne: 'daphne',
  scummvm: 'scummvm',
  android: 'android',
  'pico-8': 'pico8',
  'tic-80': 'tic80',
  uzebox: 'uzebox',
  'wasm-4': 'wasm4',
  vircon32: 'vircon32',
  ngage: 'ngage',
  symbian: 'symbian',
  j2me: 'j2me',
  'palm-os': 'palm',
  'quake': 'quake',
  'doom': 'doom'
}

/**
 * Every ES-DE system directory name, used to validate a fallback guess before
 * we trust it. Sourced from ES-DE's linux `es_systems.xml`.
 */
export const ESDE_SYSTEMS: ReadonlySet<string> = new Set([
  '3do', 'adam', 'ags', 'amiga', 'amiga1200', 'amiga600', 'amigacd32', 'amstradcpc', 'android',
  'androidapps', 'androidgames', 'apple2', 'apple2gs', 'arcade', 'arcadia', 'archimedes', 'arduboy',
  'astrocde', 'atari2600', 'atari5200', 'atari7800', 'atari800', 'atarijaguar', 'atarijaguarcd',
  'atarilynx', 'atarist', 'atarixe', 'atomiswave', 'bbcmicro', 'c64', 'cdimono1', 'cdtv', 'chailove',
  'channelf', 'coco', 'colecovision', 'consolearcade', 'cps', 'cps1', 'cps2', 'cps3', 'crvision',
  'daphne', 'desktop', 'doom', 'dos', 'dragon32', 'dreamcast', 'easyrpg', 'electron', 'emulators',
  'epic', 'famicom', 'fba', 'fbneo', 'fds', 'flash', 'fm7', 'fmtowns', 'fpinball', 'gamate',
  'gameandwatch', 'gamecom', 'gamegear', 'gb', 'gba', 'gbc', 'gc', 'genesis', 'gmaster', 'gx4000',
  'intellivision', 'j2me', 'kodi', 'laserdisc', 'lcdgames', 'lowresnx', 'lutris', 'lutro',
  'macintosh', 'mame', 'mame-advmame', 'mark3', 'mastersystem', 'megacd', 'megacdjp', 'megadrive',
  'megadrivejp', 'megaduck', 'mess', 'model2', 'model3', 'moto', 'msx', 'msx1', 'msx2', 'msxturbor',
  'mugen', 'multivision', 'n3ds', 'n64', 'n64dd', 'naomi', 'naomi2', 'naomigd', 'nds', 'neogeo',
  'neogeocd', 'neogeocdjp', 'nes', 'ngage', 'ngp', 'ngpc', 'odyssey2', 'openbor', 'oric', 'palm',
  'pc', 'pc88', 'pc98', 'pcarcade', 'pcengine', 'pcenginecd', 'pcfx', 'pico8', 'plus4', 'pokemini',
  'ports', 'ps2', 'ps3', 'ps4', 'psp', 'psvita', 'psx', 'pv1000', 'quake', 'samcoupe', 'satellaview',
  'saturn', 'saturnjp', 'scummvm', 'scv', 'sega32x', 'sega32xjp', 'sega32xna', 'segacd', 'sfc',
  'sg-1000', 'sgb', 'snes', 'snesna', 'solarus', 'spectravideo', 'steam', 'stv', 'sufami',
  'supergrafx', 'supervision', 'supracan', 'switch', 'symbian', 'tanodragon', 'tg16', 'tg-cd',
  'ti99', 'tic80', 'to8', 'triforce', 'trs-80', 'type-x', 'uzebox', 'vectrex', 'vic20', 'videopac',
  'vircon32', 'virtualboy', 'vpinball', 'vsmile', 'wasm4', 'wii', 'wiiu', 'windows', 'windows3x',
  'windows9x', 'wonderswan', 'wonderswancolor', 'x1', 'x68000', 'xbox', 'xbox360', 'xboxone',
  'zmachine', 'zx81', 'zxnext', 'zxspectrum'
])

/**
 * ES-DE system -> libretro core name (without the `_libretro.so` suffix).
 * Only used for the standalone RetroArch runner; RetroDECK picks its own
 * emulator per system from its bundled `es_systems.xml`.
 */
export const ESDE_TO_LIBRETRO_CORE: Readonly<Record<string, string>> = {
  nes: 'mesen',
  famicom: 'mesen',
  fds: 'mesen',
  snes: 'snes9x',
  sfc: 'snes9x',
  satellaview: 'snes9x',
  sufami: 'snes9x',
  n64: 'mupen64plus_next',
  gb: 'gambatte',
  gbc: 'gambatte',
  gba: 'mgba',
  nds: 'melonds',
  virtualboy: 'beetle_vb',
  pokemini: 'pokemini',
  gc: 'dolphin',
  wii: 'dolphin',
  mastersystem: 'genesis_plus_gx',
  genesis: 'genesis_plus_gx',
  megadrive: 'genesis_plus_gx',
  segacd: 'genesis_plus_gx',
  sega32x: 'picodrive',
  gamegear: 'genesis_plus_gx',
  'sg-1000': 'genesis_plus_gx',
  saturn: 'yabasanshiro',
  dreamcast: 'flycast',
  naomi: 'flycast',
  atomiswave: 'flycast',
  psx: 'swanstation',
  ps2: 'pcsx2',
  psp: 'ppsspp',
  pcengine: 'beetle_pce',
  pcenginecd: 'beetle_pce',
  supergrafx: 'beetle_supergrafx',
  pcfx: 'beetle_pcfx',
  neogeo: 'fbneo',
  neogeocd: 'fbneo',
  ngp: 'beetle_ngp',
  ngpc: 'beetle_ngp',
  arcade: 'fbneo',
  mame: 'mame',
  atari2600: 'stella',
  atari5200: 'a5200',
  atari7800: 'prosystem',
  atari800: 'atari800',
  atarilynx: 'handy',
  atarijaguar: 'virtualjaguar',
  '3do': 'opera',
  colecovision: 'bluemsx',
  intellivision: 'freeintv',
  vectrex: 'vecx',
  odyssey2: 'o2em',
  channelf: 'freechaf',
  wonderswan: 'beetle_wswan',
  wonderswancolor: 'beetle_wswan',
  msx: 'bluemsx',
  msx2: 'bluemsx',
  c64: 'vice_x64',
  vic20: 'vice_xvic',
  amiga: 'puae',
  amigacd32: 'puae',
  zxspectrum: 'fuse',
  amstradcpc: 'cap32',
  dos: 'dosbox_pure',
  scummvm: 'scummvm',
  pico8: 'retro8',
  tic80: 'tic80',
  uzebox: 'uzem',
  doom: 'prboom',
  quake: 'tyrquake'
}

/**
 * Work out which ES-DE system directory a RomM ROM belongs in.
 *
 * Resolution order, first hit wins:
 *   1. an explicit user override for the platform slug
 *   2. the curated slug map above
 *   3. the RomM platform slug, if it happens to already be an ES-DE name
 *   4. the RomM filesystem slug (the folder name on the RomM server), same check
 *
 * Returns `null` when nothing matched, which the UI surfaces as "unmapped
 * platform" so the user can pick a folder instead of us guessing wrong and
 * silently installing a ROM somewhere RetroDECK will never look.
 */
export function resolveSystem(
  platformSlug: string,
  platformFsSlug: string,
  overrides: Record<string, string> = {}
): string | null {
  const override = overrides[platformSlug]
  if (override) return override

  const mapped = ROMM_SLUG_TO_ESDE[platformSlug]
  if (mapped) return mapped

  if (ESDE_SYSTEMS.has(platformSlug)) return platformSlug
  if (ESDE_SYSTEMS.has(platformFsSlug)) return platformFsSlug

  return null
}

/** Libretro core for an ES-DE system, or null if we do not have a mapping. */
export function coreForSystem(system: string): string | null {
  return ESDE_TO_LIBRETRO_CORE[system] ?? null
}
