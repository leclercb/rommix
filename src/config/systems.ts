/**
 * The platform table: every system RomMix knows, and everything that is true
 * about it independently of the machine RomMix runs on.
 *
 * The ES-DE system name is RomMix's internal identifier for a platform: it
 * names the folder a ROM is installed into, it is what emulators declare
 * support for, and it is the key of the platform -> emulator map in settings.
 * The names come from ES-DE's own `resources/systems/linux/es_systems.xml`.
 * The directory layout is not cosmetic: RetroDECK's `run_game` infers which
 * emulator to use from exactly that path segment, so a correctly placed file
 * launches with no further hints, and ES-DE scrapes the same shape.
 *
 * One table rather than parallel maps: a system is a row, and everything about
 * it is on that row. Split across a set of valid ids, a core lookup and a
 * display code, a system can exist in one and not the others — and the ones it
 * is missing from are found by a screen rendering a blank, not by a test.
 *
 * RomM platform slugs (which follow IGDB's) are a *separate* namespace and are
 * translated by `ROMM_SLUG_TO_ESDE` below.
 */

export interface SystemInfo {
  /** ES-DE system directory name, e.g. 'snes'. RomMix's platform key. */
  id: string
  /** What a person calls it. Shown wherever there is room for a name. */
  label: string
  /** Compact code for badges and dense rows, e.g. 'SNES'. */
  short: string
  /**
   * Icon name in RomM's own platform icon set, served by the RomM server at
   * `/assets/platforms/systematic/<icon>.svg`.
   *
   * The icons are not bundled. RomMix already proxies every other image it
   * shows — covers, screenshots — through the authenticated `rommix-img://`
   * protocol, and RomM ships the complete Systematic console-icon set at a
   * stable URL, so pointing at the server is both fewer megabytes and one less
   * set of art to keep in step with a growing platform list. Nothing breaks
   * when the server is unreachable or predates the icon set: `SystemIcon`
   * falls back to the short code above.
   */
  icon: string
  /**
   * Libretro core (without the `_libretro.so` suffix), when RomMix can name
   * one. Only the standalone RetroArch runner uses it; RetroDECK picks its own
   * emulator per system from its bundled `es_systems.xml`.
   *
   * Its presence is also what defines the set of systems RetroArch declares,
   * so a system with no core here is one RomMix will not route to RetroArch.
   */
  core?: string
}

/** id, label, short, icon, libretro core. */
type Row = readonly [string, string, string, string, string?]

/**
 * Every ES-DE system directory name (195 of them), which is also the set used
 * to validate a fallback guess before trusting it.
 *
 * Systems with no RomM platform behind them are still listed: `resolveSystem`
 * accepts a RomM slug that happens to already be an ES-DE name, and a user
 * override can name any of them.
 */
const TABLE: readonly Row[] = [
  // -- Nintendo -------------------------------------------------------------
  ['nes', 'Nintendo Entertainment System', 'NES', 'nes', 'mesen'],
  ['famicom', 'Nintendo Famicom', 'FC', 'famicom', 'mesen'],
  ['fds', 'Famicom Disk System', 'FDS', 'fds', 'mesen'],
  ['snes', 'Super Nintendo', 'SNES', 'snes', 'snes9x'],
  ['snesna', 'Super Nintendo (North America)', 'SNES', 'snes'],
  ['sfc', 'Super Famicom', 'SFC', 'sfam', 'snes9x'],
  ['sgb', 'Super Game Boy', 'SGB', 'gb'],
  ['satellaview', 'Satellaview', 'BS-X', 'satellaview', 'snes9x'],
  ['sufami', 'Sufami Turbo', 'ST', 'sufami-turbo', 'snes9x'],
  ['n64', 'Nintendo 64', 'N64', 'n64', 'mupen64plus_next'],
  ['n64dd', 'Nintendo 64DD', '64DD', '64dd'],
  ['gc', 'Nintendo GameCube', 'GC', 'ngc', 'dolphin'],
  ['wii', 'Nintendo Wii', 'WII', 'wii', 'dolphin'],
  ['wiiu', 'Nintendo Wii U', 'WIIU', 'wiiu'],
  ['switch', 'Nintendo Switch', 'NSW', 'switch'],
  ['gb', 'Game Boy', 'GB', 'gb', 'gambatte'],
  ['gbc', 'Game Boy Color', 'GBC', 'gbc', 'gambatte'],
  ['gba', 'Game Boy Advance', 'GBA', 'gba', 'mgba'],
  ['nds', 'Nintendo DS', 'NDS', 'nds', 'melonds'],
  ['n3ds', 'Nintendo 3DS', '3DS', '3ds'],
  ['virtualboy', 'Virtual Boy', 'VB', 'virtualboy', 'beetle_vb'],
  ['pokemini', 'Pokémon Mini', 'MINI', 'pokemon-mini', 'pokemini'],
  ['gameandwatch', 'Game & Watch', 'G&W', 'g-and-w'],

  // -- Sega -----------------------------------------------------------------
  ['mastersystem', 'Sega Master System', 'SMS', 'sms', 'genesis_plus_gx'],
  ['mark3', 'Sega Mark III', 'MK3', 'sms'],
  ['genesis', 'Sega Genesis', 'GEN', 'genesis', 'genesis_plus_gx'],
  ['megadrive', 'Sega Mega Drive', 'MD', 'genesis', 'genesis_plus_gx'],
  ['megadrivejp', 'Sega Mega Drive (Japan)', 'MD', 'genesis'],
  ['segacd', 'Sega CD', 'SCD', 'segacd', 'genesis_plus_gx'],
  ['megacd', 'Sega Mega-CD', 'MCD', 'segacd'],
  ['megacdjp', 'Sega Mega-CD (Japan)', 'MCD', 'segacd'],
  ['sega32x', 'Sega 32X', '32X', 'sega32', 'picodrive'],
  ['sega32xjp', 'Sega Super 32X', '32X', 'sega32'],
  ['sega32xna', 'Sega Genesis 32X', '32X', 'sega32'],
  ['saturn', 'Sega Saturn', 'SAT', 'saturn', 'yabasanshiro'],
  ['saturnjp', 'Sega Saturn (Japan)', 'SAT', 'saturn'],
  ['dreamcast', 'Sega Dreamcast', 'DC', 'dc', 'flycast'],
  ['gamegear', 'Sega Game Gear', 'GG', 'gamegear', 'genesis_plus_gx'],
  ['sg-1000', 'Sega SG-1000', 'SG', 'sg1000', 'genesis_plus_gx'],
  ['multivision', 'Othello Multivision', 'OMV', 'sg1000'],
  ['naomi', 'Sega NAOMI', 'NAOMI', 'arcade', 'flycast'],
  ['naomi2', 'Sega NAOMI 2', 'NAOMI', 'arcade'],
  ['naomigd', 'Sega NAOMI GD-ROM', 'NAOMI', 'arcade'],
  ['atomiswave', 'Sammy Atomiswave', 'AW', 'atomiswave', 'flycast'],
  ['model2', 'Sega Model 2', 'M2', 'arcade'],
  ['model3', 'Sega Model 3', 'M3', 'arcade'],
  ['stv', 'Sega Titan Video', 'STV', 'arcade'],
  ['triforce', 'Triforce', 'TRI', 'arcade'],

  // -- Sony -----------------------------------------------------------------
  ['psx', 'PlayStation', 'PS1', 'psx', 'swanstation'],
  ['ps2', 'PlayStation 2', 'PS2', 'ps2', 'pcsx2'],
  ['ps3', 'PlayStation 3', 'PS3', 'ps3'],
  ['ps4', 'PlayStation 4', 'PS4', 'ps4'],
  ['psp', 'PlayStation Portable', 'PSP', 'psp', 'ppsspp'],
  ['psvita', 'PlayStation Vita', 'VITA', 'psvita'],

  // -- Microsoft ------------------------------------------------------------
  ['xbox', 'Xbox', 'XBOX', 'xbox'],
  ['xbox360', 'Xbox 360', 'X360', 'xbox360'],
  ['xboxone', 'Xbox One', 'XONE', 'xboxone'],
  ['windows', 'Windows', 'WIN', 'default'],
  ['windows3x', 'Windows 3.x', 'WIN3', 'default'],
  ['windows9x', 'Windows 9x', 'WIN9', 'default'],
  ['dos', 'DOS', 'DOS', 'dos', 'dosbox_pure'],
  ['pc', 'PC', 'PC', 'default'],

  // -- NEC ------------------------------------------------------------------
  ['pcengine', 'PC Engine', 'PCE', 'pce', 'beetle_pce'],
  ['tg16', 'TurboGrafx-16', 'TG16', 'tg16'],
  ['pcenginecd', 'PC Engine CD', 'PCECD', 'pcecd', 'beetle_pce'],
  ['tg-cd', 'TurboGrafx-CD', 'TGCD', 'turbografx-cd'],
  ['supergrafx', 'SuperGrafx', 'SGFX', 'sgfx', 'beetle_supergrafx'],
  ['pcfx', 'PC-FX', 'PCFX', 'pc-fx', 'beetle_pcfx'],
  ['pc88', 'NEC PC-8800', 'PC88', 'default'],
  ['pc98', 'NEC PC-9800', 'PC98', 'pc-9800-series'],

  // -- SNK ------------------------------------------------------------------
  ['neogeo', 'Neo Geo', 'NEO', 'neogeoaes', 'fbneo'],
  ['neogeocd', 'Neo Geo CD', 'NGCD', 'neo-geo-cd', 'fbneo'],
  ['neogeocdjp', 'Neo Geo CD (Japan)', 'NGCD', 'neo-geo-cd'],
  ['ngp', 'Neo Geo Pocket', 'NGP', 'neo-geo-pocket', 'beetle_ngp'],
  ['ngpc', 'Neo Geo Pocket Color', 'NGPC', 'neo-geo-pocket-color', 'beetle_ngp'],

  // -- Atari ----------------------------------------------------------------
  ['atari2600', 'Atari 2600', '2600', 'atari2600', 'stella'],
  ['atari5200', 'Atari 5200', '5200', 'atari5200', 'a5200'],
  ['atari7800', 'Atari 7800', '7800', 'atari7800', 'prosystem'],
  ['atari800', 'Atari 800', '800', 'atari8bit', 'atari800'],
  ['atarixe', 'Atari XE', 'XE', 'atari8bit'],
  ['atarist', 'Atari ST', 'ST', 'atari-st'],
  ['atarijaguar', 'Atari Jaguar', 'JAG', 'jaguar', 'virtualjaguar'],
  ['atarijaguarcd', 'Atari Jaguar CD', 'JAGCD', 'atari-jaguar-cd'],
  ['atarilynx', 'Atari Lynx', 'LYNX', 'lynx', 'handy'],

  // -- Commodore and home computers ----------------------------------------
  ['amiga', 'Commodore Amiga', 'AMI', 'amiga', 'puae'],
  ['amiga600', 'Commodore Amiga 600', 'A600', 'amiga'],
  ['amiga1200', 'Commodore Amiga 1200', 'A1200', 'amiga'],
  ['amigacd32', 'Commodore Amiga CD32', 'CD32', 'amiga-cd32', 'puae'],
  ['cdtv', 'Commodore CDTV', 'CDTV', 'commodore-cdtv'],
  ['c64', 'Commodore 64', 'C64', 'c64', 'vice_x64'],
  ['vic20', 'Commodore VIC-20', 'VIC20', 'vic-20', 'vice_xvic'],
  ['plus4', 'Commodore Plus/4', 'PLUS4', 'c-plus-4'],
  ['amstradcpc', 'Amstrad CPC', 'CPC', 'acpc', 'cap32'],
  ['gx4000', 'Amstrad GX4000', 'GX', 'acpc'],
  ['zxspectrum', 'Sinclair ZX Spectrum', 'ZX', 'zxs', 'fuse'],
  ['zx81', 'Sinclair ZX81', 'ZX81', 'zx81'],
  ['zxnext', 'ZX Spectrum Next', 'NEXT', 'zx-spectrum-next'],
  ['samcoupe', 'SAM Coupé', 'SAM', 'default'],
  ['msx', 'MSX', 'MSX', 'msx', 'bluemsx'],
  ['msx1', 'MSX1', 'MSX1', 'msx'],
  ['msx2', 'MSX2', 'MSX2', 'msx2', 'bluemsx'],
  ['msxturbor', 'MSX Turbo R', 'MSXR', 'msx2'],
  ['spectravideo', 'Spectravideo', 'SVI', 'spectravideo'],
  ['apple2', 'Apple II', 'A2', 'appleii'],
  ['apple2gs', 'Apple IIGS', 'IIGS', 'apple-iigs'],
  ['macintosh', 'Apple Macintosh', 'MAC', 'mac'],
  ['archimedes', 'Acorn Archimedes', 'ARC', 'acorn-archimedes'],
  ['electron', 'Acorn Electron', 'ELK', 'default'],
  ['bbcmicro', 'BBC Micro', 'BBC', 'bbcmicro'],
  ['adam', 'Coleco Adam', 'ADAM', 'colecoadam'],
  ['coco', 'Tandy Color Computer', 'COCO', 'default'],
  ['trs-80', 'Tandy TRS-80', 'TRS', 'default'],
  ['dragon32', 'Dragon 32', 'DR32', 'default'],
  ['tanodragon', 'Tano Dragon', 'TANO', 'default'],
  ['oric', 'Oric', 'ORIC', 'default'],
  ['x1', 'Sharp X1', 'X1', 'x1'],
  ['x68000', 'Sharp X68000', 'X68K', 'sharp-x68000'],
  ['fm7', 'Fujitsu FM-7', 'FM7', 'fm-7'],
  ['fmtowns', 'Fujitsu FM Towns', 'TOWNS', 'fm-towns'],
  ['ti99', 'Texas Instruments TI-99', 'TI99', 'ti-99'],
  ['moto', 'Thomson MO/TO', 'MOTO', 'thomson-mo5'],
  ['to8', 'Thomson TO8', 'TO8', 'thomson-to'],
  ['desktop', 'Desktop applications', 'APP', 'default'],

  // -- Other consoles and handhelds ----------------------------------------
  ['3do', '3DO Interactive Multiplayer', '3DO', '3do', 'opera'],
  ['colecovision', 'ColecoVision', 'CV', 'colecovision', 'bluemsx'],
  ['intellivision', 'Mattel Intellivision', 'INTV', 'intellivision', 'freeintv'],
  ['vectrex', 'Vectrex', 'VEC', 'vectrex', 'vecx'],
  ['odyssey2', 'Magnavox Odyssey 2', 'O2', 'odyssey-2-slash-videopac-g7000', 'o2em'],
  ['videopac', 'Philips Videopac G7000', 'VP', 'videopac'],
  ['cdimono1', 'Philips CD-i', 'CDI', 'philips-cd-i'],
  ['channelf', 'Fairchild Channel F', 'CHF', 'fairchild-channel-f', 'freechaf'],
  ['astrocde', 'Bally Astrocade', 'ASTRO', 'astrocade'],
  ['arcadia', 'Emerson Arcadia 2001', 'ARC', 'arcadia-2001'],
  ['crvision', 'VTech CreatiVision', 'CV', 'creativision'],
  ['supervision', 'Watara Supervision', 'SV', 'supervision'],
  ['gamecom', 'Tiger Game.com', 'GCOM', 'game-dot-com'],
  ['gmaster', 'Hartung Game Master', 'GM', 'dedicated-handheld'],
  ['wonderswan', 'WonderSwan', 'WS', 'wonderswan', 'beetle_wswan'],
  ['wonderswancolor', 'WonderSwan Color', 'WSC', 'wonderswan-color', 'beetle_wswan'],
  ['megaduck', 'Mega Duck', 'DUCK', 'megaduck'],
  ['gamate', 'Bit Corporation Gamate', 'GMT', 'gamate'],
  ['supracan', 'Super A\'Can', 'ACAN', 'super-acan'],
  ['vsmile', 'VTech V.Smile', 'VS', 'vsmile'],
  ['pv1000', 'Casio PV-1000', 'PV', 'casio-pv-1000'],
  ['scv', 'Epoch Super Cassette Vision', 'SCV', 'epoch-super-cassette-vision'],
  ['arduboy', 'Arduboy', 'ARDU', 'arduboy'],
  ['lcdgames', 'LCD handheld games', 'LCD', 'handheld-electronic-lcd'],
  ['laserdisc', 'LaserDisc games', 'LD', 'laseractive'],

  // -- Arcade ---------------------------------------------------------------
  ['arcade', 'Arcade', 'ARC', 'arcade', 'fbneo'],
  ['mame', 'MAME', 'MAME', 'arcade', 'mame'],
  ['mame-advmame', 'AdvanceMAME', 'ADV', 'arcade'],
  ['mess', 'MESS', 'MESS', 'arcade'],
  ['fba', 'Final Burn Alpha', 'FBA', 'fba2012'],
  ['fbneo', 'FinalBurn Neo', 'FBNEO', 'fbneo'],
  ['cps', 'Capcom Play System', 'CPS', 'cps1'],
  ['cps1', 'Capcom Play System I', 'CPS1', 'cps1'],
  ['cps2', 'Capcom Play System II', 'CPS2', 'cps2'],
  ['cps3', 'Capcom Play System III', 'CPS3', 'cps3'],
  ['daphne', 'Daphne', 'DAPH', 'laseractive'],
  ['consolearcade', 'Console arcade systems', 'CARC', 'arcade'],
  ['pcarcade', 'PC arcade systems', 'PARC', 'arcade'],
  ['type-x', 'Taito Type X', 'TYPEX', 'arcade'],
  ['fpinball', 'Future Pinball', 'FPIN', 'default'],
  ['vpinball', 'Visual Pinball', 'VPIN', 'default'],

  // -- Mobile ---------------------------------------------------------------
  ['android', 'Android', 'DROID', 'default'],
  ['androidapps', 'Android apps', 'APPS', 'default'],
  ['androidgames', 'Android games', 'AGAME', 'default'],
  ['ngage', 'Nokia N-Gage', 'NGAGE', 'ngage'],
  ['symbian', 'Symbian', 'SYM', 'default'],
  ['j2me', 'Java 2 Micro Edition', 'J2ME', 'default'],
  ['palm', 'Palm OS', 'PALM', 'default'],

  // -- Engines, ports and fantasy consoles ---------------------------------
  ['scummvm', 'ScummVM', 'SVM', 'scummvm', 'scummvm'],
  ['doom', 'Doom', 'DOOM', 'doom', 'prboom'],
  ['quake', 'Quake', 'QUAKE', 'default', 'tyrquake'],
  ['ports', 'Ports', 'PORT', 'default'],
  ['openbor', 'OpenBOR', 'BOR', 'default'],
  ['mugen', 'M.U.G.E.N', 'MUGEN', 'default'],
  ['solarus', 'Solarus', 'SOL', 'default'],
  ['easyrpg', 'EasyRPG', 'RPG', 'rpgmaker'],
  ['chailove', 'ChaiLove', 'CHAI', 'default'],
  ['lutro', 'Lutro', 'LUTRO', 'default'],
  ['lowresnx', 'LowRes NX', 'NX', 'default'],
  ['pico8', 'PICO-8', 'PICO8', 'pico', 'retro8'],
  ['tic80', 'TIC-80', 'TIC80', 'tic-80', 'tic80'],
  ['uzebox', 'Uzebox', 'UZE', 'default', 'uzem'],
  ['wasm4', 'WASM-4', 'WASM4', 'wasm-4'],
  ['vircon32', 'Vircon32', 'V32', 'default'],
  ['flash', 'Adobe Flash', 'FLASH', 'default'],
  ['zmachine', 'Infocom Z-machine', 'ZM', 'default'],
  ['ags', 'Adventure Game Studio', 'AGS', 'default'],

  // -- Launchers ------------------------------------------------------------
  ['steam', 'Steam', 'STEAM', 'default'],
  ['epic', 'Epic Games Store', 'EPIC', 'default'],
  ['lutris', 'Lutris', 'LUT', 'default'],
  ['kodi', 'Kodi', 'KODI', 'default'],
  ['emulators', 'Emulators', 'EMU', 'default']
]

export const SYSTEMS: Readonly<Record<string, SystemInfo>> = Object.fromEntries(
  TABLE.map(([id, label, short, icon, core]) => [id, { id, label, short, icon, core }])
)

/** Every ES-DE system directory name, for validating a fallback guess. */
export const ESDE_SYSTEMS: ReadonlySet<string> = new Set(Object.keys(SYSTEMS))

/**
 * ES-DE system -> libretro core name (without the `_libretro.so` suffix).
 * Derived from the table so the two cannot drift apart.
 */
export const ESDE_TO_LIBRETRO_CORE: Readonly<Record<string, string>> = Object.fromEntries(
  TABLE.filter((row): row is readonly [string, string, string, string, string] => row[4] != null).map(
    ([id, , , , core]) => [id, core]
  )
)

/**
 * What RomMix knows about a system, invented from the id when it is one ES-DE
 * defines but this table does not.
 *
 * Never null: every screen that shows a platform has something to show, and a
 * system RomMix has not been taught about degrades to its own name rather than
 * to a blank.
 */
export function systemInfo(system: string): SystemInfo {
  return (
    SYSTEMS[system] ?? {
      id: system,
      label: system,
      short: system.slice(0, 5).toUpperCase(),
      icon: 'default'
    }
  )
}

/** Human-readable name for an ES-DE system. */
export function systemLabel(system: string): string {
  return systemInfo(system).label
}

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
  gamate: 'gamate',
  'super-acan': 'supracan',
  vsmile: 'vsmile',

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
  quake: 'quake',
  doom: 'doom'
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
  return SYSTEMS[system]?.core ?? null
}
