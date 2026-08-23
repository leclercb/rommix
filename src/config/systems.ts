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
 * One table, and everything else here is a question asked of it. A system is a
 * row: its name, its badge, its icon, the RomM slugs that mean it and the
 * libretro core that runs it. Split across parallel maps, a system can exist in
 * one and not the others — and the ones it is missing from are found by a
 * screen rendering a blank, not by a test.
 *
 * RomM platform slugs (which follow IGDB's) are a *separate* namespace, so a
 * system carries the slugs that mean it — several, where RomM splits a console
 * RomMix does not. `ROMM_SLUG_TO_ESDE` is that field inverted, not a second
 * table to keep in step.
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
  /**
   * RomM platform slugs that mean this system. Usually one; more where RomM
   * distinguishes hardware RomMix keeps together, as with the Neo Geo AES and
   * MVS.
   *
   * Always present, empty where RomM has no platform for the system — which is
   * most of the regional variants. A list has a natural zero and `core`, being
   * a single name, does not, which is why that one is optional and this is not:
   * nothing downstream has to think about it being absent.
   */
  slugs: readonly string[]
}

/**
 * Every system RomMix knows: 195 of them, one per row.
 *
 * 118 of them have a RomM platform behind them — 119 slugs, the Neo Geo
 * answering to two — and 69 have a libretro core;
 * the rest carry an empty slug list and no core. They are still listed, because
 * `resolveSystem` accepts a RomM slug that happens to already be an ES-DE name,
 * a user override can name any of them, and `isKnownSystem` is what decides
 * whether a guessed folder is a real one.
 */
// One line per system is the point: the columns line up, and a reader compares
// rows rather than reading 195 six-line objects. Hence the exemption below —
// which has to be the last comment before the table, and carry no other text.
// prettier-ignore
const TABLE: readonly SystemInfo[] = [
  // -- Nintendo -------------------------------------------------------------
  { id: 'nes', label: 'Nintendo Entertainment System', short: 'NES', icon: 'nes', slugs: ['nes'], core: 'mesen' },
  { id: 'famicom', label: 'Nintendo Famicom', short: 'FC', icon: 'famicom', slugs: ['famicom'], core: 'mesen' },
  { id: 'fds', label: 'Famicom Disk System', short: 'FDS', icon: 'fds', slugs: ['fds'], core: 'mesen' },
  { id: 'snes', label: 'Super Nintendo', short: 'SNES', icon: 'snes', slugs: ['snes'], core: 'snes9x' },
  { id: 'snesna', label: 'Super Nintendo (North America)', short: 'SNES', icon: 'snes', slugs: [] },
  { id: 'sfc', label: 'Super Famicom', short: 'SFC', icon: 'sfam', slugs: ['sfam'], core: 'snes9x' },
  { id: 'sgb', label: 'Super Game Boy', short: 'SGB', icon: 'gb', slugs: [] },
  { id: 'satellaview', label: 'Satellaview', short: 'BS-X', icon: 'satellaview', slugs: ['satellaview'], core: 'snes9x' },
  { id: 'sufami', label: 'Sufami Turbo', short: 'ST', icon: 'sufami-turbo', slugs: ['sufami-turbo'], core: 'snes9x' },
  { id: 'n64', label: 'Nintendo 64', short: 'N64', icon: 'n64', slugs: ['n64'], core: 'mupen64plus_next' },
  { id: 'n64dd', label: 'Nintendo 64DD', short: '64DD', icon: '64dd', slugs: ['64dd'] },
  { id: 'gc', label: 'Nintendo GameCube', short: 'GC', icon: 'ngc', slugs: ['ngc'], core: 'dolphin' },
  { id: 'wii', label: 'Nintendo Wii', short: 'WII', icon: 'wii', slugs: ['wii'], core: 'dolphin' },
  { id: 'wiiu', label: 'Nintendo Wii U', short: 'WIIU', icon: 'wiiu', slugs: ['wiiu'] },
  { id: 'switch', label: 'Nintendo Switch', short: 'NSW', icon: 'switch', slugs: ['switch'] },
  { id: 'gb', label: 'Game Boy', short: 'GB', icon: 'gb', slugs: ['gb'], core: 'gambatte' },
  { id: 'gbc', label: 'Game Boy Color', short: 'GBC', icon: 'gbc', slugs: ['gbc'], core: 'gambatte' },
  { id: 'gba', label: 'Game Boy Advance', short: 'GBA', icon: 'gba', slugs: ['gba'], core: 'mgba' },
  { id: 'nds', label: 'Nintendo DS', short: 'NDS', icon: 'nds', slugs: ['nds'], core: 'melonds' },
  { id: 'n3ds', label: 'Nintendo 3DS', short: '3DS', icon: '3ds', slugs: ['3ds'] },
  { id: 'virtualboy', label: 'Virtual Boy', short: 'VB', icon: 'virtualboy', slugs: ['virtualboy'], core: 'beetle_vb' },
  { id: 'pokemini', label: 'Pokémon Mini', short: 'MINI', icon: 'pokemon-mini', slugs: ['pokemon-mini'], core: 'pokemini' },
  { id: 'gameandwatch', label: 'Game & Watch', short: 'G&W', icon: 'g-and-w', slugs: ['game-and-watch'] },

  // -- Sega -----------------------------------------------------------------
  { id: 'mastersystem', label: 'Sega Master System', short: 'SMS', icon: 'sms', slugs: ['sms'], core: 'genesis_plus_gx' },
  { id: 'mark3', label: 'Sega Mark III', short: 'MK3', icon: 'sms', slugs: [] },
  { id: 'genesis', label: 'Sega Genesis', short: 'GEN', icon: 'genesis', slugs: ['genesis-slash-megadrive'], core: 'genesis_plus_gx' },
  { id: 'megadrive', label: 'Sega Mega Drive', short: 'MD', icon: 'genesis', slugs: [], core: 'genesis_plus_gx' },
  { id: 'megadrivejp', label: 'Sega Mega Drive (Japan)', short: 'MD', icon: 'genesis', slugs: [] },
  { id: 'segacd', label: 'Sega CD', short: 'SCD', icon: 'segacd', slugs: ['segacd'], core: 'genesis_plus_gx' },
  { id: 'megacd', label: 'Sega Mega-CD', short: 'MCD', icon: 'segacd', slugs: [] },
  { id: 'megacdjp', label: 'Sega Mega-CD (Japan)', short: 'MCD', icon: 'segacd', slugs: [] },
  { id: 'sega32x', label: 'Sega 32X', short: '32X', icon: 'sega32', slugs: ['sega32'], core: 'picodrive' },
  { id: 'sega32xjp', label: 'Sega Super 32X', short: '32X', icon: 'sega32', slugs: [] },
  { id: 'sega32xna', label: 'Sega Genesis 32X', short: '32X', icon: 'sega32', slugs: [] },
  { id: 'saturn', label: 'Sega Saturn', short: 'SAT', icon: 'saturn', slugs: ['saturn'], core: 'yabasanshiro' },
  { id: 'saturnjp', label: 'Sega Saturn (Japan)', short: 'SAT', icon: 'saturn', slugs: [] },
  { id: 'dreamcast', label: 'Sega Dreamcast', short: 'DC', icon: 'dc', slugs: ['dc'], core: 'flycast' },
  { id: 'gamegear', label: 'Sega Game Gear', short: 'GG', icon: 'gamegear', slugs: ['gamegear'], core: 'genesis_plus_gx' },
  { id: 'sg-1000', label: 'Sega SG-1000', short: 'SG', icon: 'sg1000', slugs: ['sg1000'], core: 'genesis_plus_gx' },
  { id: 'multivision', label: 'Othello Multivision', short: 'OMV', icon: 'sg1000', slugs: [] },
  { id: 'naomi', label: 'Sega NAOMI', short: 'NAOMI', icon: 'arcade', slugs: ['naomi'], core: 'flycast' },
  { id: 'naomi2', label: 'Sega NAOMI 2', short: 'NAOMI', icon: 'arcade', slugs: [] },
  { id: 'naomigd', label: 'Sega NAOMI GD-ROM', short: 'NAOMI', icon: 'arcade', slugs: [] },
  { id: 'atomiswave', label: 'Sammy Atomiswave', short: 'AW', icon: 'atomiswave', slugs: ['atomiswave'], core: 'flycast' },
  { id: 'model2', label: 'Sega Model 2', short: 'M2', icon: 'arcade', slugs: [] },
  { id: 'model3', label: 'Sega Model 3', short: 'M3', icon: 'arcade', slugs: [] },
  { id: 'stv', label: 'Sega Titan Video', short: 'STV', icon: 'arcade', slugs: [] },
  { id: 'triforce', label: 'Triforce', short: 'TRI', icon: 'arcade', slugs: [] },

  // -- Sony -----------------------------------------------------------------
  { id: 'psx', label: 'PlayStation', short: 'PS1', icon: 'psx', slugs: ['ps'], core: 'swanstation' },
  { id: 'ps2', label: 'PlayStation 2', short: 'PS2', icon: 'ps2', slugs: ['ps2'], core: 'pcsx2' },
  { id: 'ps3', label: 'PlayStation 3', short: 'PS3', icon: 'ps3', slugs: ['ps3'] },
  { id: 'ps4', label: 'PlayStation 4', short: 'PS4', icon: 'ps4', slugs: ['ps4--1'] },
  { id: 'psp', label: 'PlayStation Portable', short: 'PSP', icon: 'psp', slugs: ['psp'], core: 'ppsspp' },
  { id: 'psvita', label: 'PlayStation Vita', short: 'VITA', icon: 'psvita', slugs: ['psvita'] },

  // -- Microsoft ------------------------------------------------------------
  { id: 'xbox', label: 'Xbox', short: 'XBOX', icon: 'xbox', slugs: ['xbox'] },
  { id: 'xbox360', label: 'Xbox 360', short: 'X360', icon: 'xbox360', slugs: ['xbox360'] },
  { id: 'xboxone', label: 'Xbox One', short: 'XONE', icon: 'xboxone', slugs: ['xboxone'] },
  { id: 'windows', label: 'Windows', short: 'WIN', icon: 'default', slugs: ['win'] },
  { id: 'windows3x', label: 'Windows 3.x', short: 'WIN3', icon: 'default', slugs: [] },
  { id: 'windows9x', label: 'Windows 9x', short: 'WIN9', icon: 'default', slugs: [] },
  { id: 'dos', label: 'DOS', short: 'DOS', icon: 'dos', slugs: ['dos'], core: 'dosbox_pure' },
  { id: 'pc', label: 'PC', short: 'PC', icon: 'default', slugs: [] },

  // -- NEC ------------------------------------------------------------------
  { id: 'pcengine', label: 'PC Engine', short: 'PCE', icon: 'pce', slugs: ['turbografx16--1'], core: 'beetle_pce' },
  { id: 'tg16', label: 'TurboGrafx-16', short: 'TG16', icon: 'tg16', slugs: [] },
  { id: 'pcenginecd', label: 'PC Engine CD', short: 'PCECD', icon: 'pcecd', slugs: ['turbografx-16-slash-pc-engine-cd'], core: 'beetle_pce' },
  { id: 'tg-cd', label: 'TurboGrafx-CD', short: 'TGCD', icon: 'turbografx-cd', slugs: [] },
  { id: 'supergrafx', label: 'SuperGrafx', short: 'SGFX', icon: 'sgfx', slugs: ['supergrafx'], core: 'beetle_supergrafx' },
  { id: 'pcfx', label: 'PC-FX', short: 'PCFX', icon: 'pc-fx', slugs: ['pc-fx'], core: 'beetle_pcfx' },
  { id: 'pc88', label: 'NEC PC-8800', short: 'PC88', icon: 'default', slugs: ['pc-8800-series'] },
  { id: 'pc98', label: 'NEC PC-9800', short: 'PC98', icon: 'pc-9800-series', slugs: ['pc-9800-series'] },

  // -- SNK ------------------------------------------------------------------
  { id: 'neogeo', label: 'Neo Geo', short: 'NEO', icon: 'neogeoaes', slugs: ['neogeoaes', 'neogeomvs'], core: 'fbneo' },
  { id: 'neogeocd', label: 'Neo Geo CD', short: 'NGCD', icon: 'neo-geo-cd', slugs: ['neo-geo-cd'], core: 'fbneo' },
  { id: 'neogeocdjp', label: 'Neo Geo CD (Japan)', short: 'NGCD', icon: 'neo-geo-cd', slugs: [] },
  { id: 'ngp', label: 'Neo Geo Pocket', short: 'NGP', icon: 'neo-geo-pocket', slugs: ['ngp'], core: 'beetle_ngp' },
  { id: 'ngpc', label: 'Neo Geo Pocket Color', short: 'NGPC', icon: 'neo-geo-pocket-color', slugs: ['ngpc'], core: 'beetle_ngp' },

  // -- Atari ----------------------------------------------------------------
  { id: 'atari2600', label: 'Atari 2600', short: '2600', icon: 'atari2600', slugs: ['atari2600'], core: 'stella' },
  { id: 'atari5200', label: 'Atari 5200', short: '5200', icon: 'atari5200', slugs: ['atari5200'], core: 'a5200' },
  { id: 'atari7800', label: 'Atari 7800', short: '7800', icon: 'atari7800', slugs: ['atari7800'], core: 'prosystem' },
  { id: 'atari800', label: 'Atari 800', short: '800', icon: 'atari8bit', slugs: ['atari8bit'], core: 'atari800' },
  { id: 'atarixe', label: 'Atari XE', short: 'XE', icon: 'atari8bit', slugs: [] },
  { id: 'atarist', label: 'Atari ST', short: 'ST', icon: 'atari-st', slugs: ['atari-st'] },
  { id: 'atarijaguar', label: 'Atari Jaguar', short: 'JAG', icon: 'jaguar', slugs: ['jaguar'], core: 'virtualjaguar' },
  { id: 'atarijaguarcd', label: 'Atari Jaguar CD', short: 'JAGCD', icon: 'atari-jaguar-cd', slugs: ['atari-jaguar-cd'] },
  { id: 'atarilynx', label: 'Atari Lynx', short: 'LYNX', icon: 'lynx', slugs: ['lynx'], core: 'handy' },

  // -- Commodore and home computers ----------------------------------------
  { id: 'amiga', label: 'Commodore Amiga', short: 'AMI', icon: 'amiga', slugs: ['amiga'], core: 'puae' },
  { id: 'amiga600', label: 'Commodore Amiga 600', short: 'A600', icon: 'amiga', slugs: [] },
  { id: 'amiga1200', label: 'Commodore Amiga 1200', short: 'A1200', icon: 'amiga', slugs: [] },
  { id: 'amigacd32', label: 'Commodore Amiga CD32', short: 'CD32', icon: 'amiga-cd32', slugs: ['amiga-cd32'], core: 'puae' },
  { id: 'cdtv', label: 'Commodore CDTV', short: 'CDTV', icon: 'commodore-cdtv', slugs: [] },
  { id: 'c64', label: 'Commodore 64', short: 'C64', icon: 'c64', slugs: ['c64'], core: 'vice_x64' },
  { id: 'vic20', label: 'Commodore VIC-20', short: 'VIC20', icon: 'vic-20', slugs: ['vic-20'], core: 'vice_xvic' },
  { id: 'plus4', label: 'Commodore Plus/4', short: 'PLUS4', icon: 'c-plus-4', slugs: ['commodore-plus-slash-4'] },
  { id: 'amstradcpc', label: 'Amstrad CPC', short: 'CPC', icon: 'acpc', slugs: ['acpc'], core: 'cap32' },
  { id: 'gx4000', label: 'Amstrad GX4000', short: 'GX', icon: 'acpc', slugs: [] },
  { id: 'zxspectrum', label: 'Sinclair ZX Spectrum', short: 'ZX', icon: 'zxs', slugs: ['zxs'], core: 'fuse' },
  { id: 'zx81', label: 'Sinclair ZX81', short: 'ZX81', icon: 'zx81', slugs: ['zx81'] },
  { id: 'zxnext', label: 'ZX Spectrum Next', short: 'NEXT', icon: 'zx-spectrum-next', slugs: [] },
  { id: 'samcoupe', label: 'SAM Coupé', short: 'SAM', icon: 'default', slugs: ['sam-coupe'] },
  { id: 'msx', label: 'MSX', short: 'MSX', icon: 'msx', slugs: ['msx'], core: 'bluemsx' },
  { id: 'msx1', label: 'MSX1', short: 'MSX1', icon: 'msx', slugs: [] },
  { id: 'msx2', label: 'MSX2', short: 'MSX2', icon: 'msx2', slugs: ['msx2'], core: 'bluemsx' },
  { id: 'msxturbor', label: 'MSX Turbo R', short: 'MSXR', icon: 'msx2', slugs: [] },
  { id: 'spectravideo', label: 'Spectravideo', short: 'SVI', icon: 'spectravideo', slugs: [] },
  { id: 'apple2', label: 'Apple II', short: 'A2', icon: 'appleii', slugs: ['appleii'] },
  { id: 'apple2gs', label: 'Apple IIGS', short: 'IIGS', icon: 'apple-iigs', slugs: ['apple-iigs'] },
  { id: 'macintosh', label: 'Apple Macintosh', short: 'MAC', icon: 'mac', slugs: ['mac'] },
  { id: 'archimedes', label: 'Acorn Archimedes', short: 'ARC', icon: 'acorn-archimedes', slugs: ['acorn-archimedes'] },
  { id: 'electron', label: 'Acorn Electron', short: 'ELK', icon: 'default', slugs: ['acorn-electron'] },
  { id: 'bbcmicro', label: 'BBC Micro', short: 'BBC', icon: 'bbcmicro', slugs: ['bbcmicro'] },
  { id: 'adam', label: 'Coleco Adam', short: 'ADAM', icon: 'colecoadam', slugs: [] },
  { id: 'coco', label: 'Tandy Color Computer', short: 'COCO', icon: 'default', slugs: [] },
  { id: 'trs-80', label: 'Tandy TRS-80', short: 'TRS', icon: 'default', slugs: ['trs-80'] },
  { id: 'dragon32', label: 'Dragon 32', short: 'DR32', icon: 'default', slugs: ['dragon-32-slash-64'] },
  { id: 'tanodragon', label: 'Tano Dragon', short: 'TANO', icon: 'default', slugs: [] },
  { id: 'oric', label: 'Oric', short: 'ORIC', icon: 'default', slugs: ['oric'] },
  { id: 'x1', label: 'Sharp X1', short: 'X1', icon: 'x1', slugs: ['sharp-x1'] },
  { id: 'x68000', label: 'Sharp X68000', short: 'X68K', icon: 'sharp-x68000', slugs: ['sharp-x68000'] },
  { id: 'fm7', label: 'Fujitsu FM-7', short: 'FM7', icon: 'fm-7', slugs: [] },
  { id: 'fmtowns', label: 'Fujitsu FM Towns', short: 'TOWNS', icon: 'fm-towns', slugs: ['fm-towns'] },
  { id: 'ti99', label: 'Texas Instruments TI-99', short: 'TI99', icon: 'ti-99', slugs: ['ti-99'] },
  { id: 'moto', label: 'Thomson MO/TO', short: 'MOTO', icon: 'thomson-mo5', slugs: ['thomson-mo5'] },
  { id: 'to8', label: 'Thomson TO8', short: 'TO8', icon: 'thomson-to', slugs: [] },
  { id: 'desktop', label: 'Desktop applications', short: 'APP', icon: 'default', slugs: [] },

  // -- Other consoles and handhelds ----------------------------------------
  { id: '3do', label: '3DO Interactive Multiplayer', short: '3DO', icon: '3do', slugs: ['3do'], core: 'opera' },
  { id: 'colecovision', label: 'ColecoVision', short: 'CV', icon: 'colecovision', slugs: ['colecovision'], core: 'bluemsx' },
  { id: 'intellivision', label: 'Mattel Intellivision', short: 'INTV', icon: 'intellivision', slugs: ['intellivision'], core: 'freeintv' },
  { id: 'vectrex', label: 'Vectrex', short: 'VEC', icon: 'vectrex', slugs: ['vectrex'], core: 'vecx' },
  { id: 'odyssey2', label: 'Magnavox Odyssey 2', short: 'O2', icon: 'odyssey-2-slash-videopac-g7000', slugs: ['odyssey-2-slash-videopac-g7000'], core: 'o2em' },
  { id: 'videopac', label: 'Philips Videopac G7000', short: 'VP', icon: 'videopac', slugs: [] },
  { id: 'cdimono1', label: 'Philips CD-i', short: 'CDI', icon: 'philips-cd-i', slugs: ['philips-cd-i'] },
  { id: 'channelf', label: 'Fairchild Channel F', short: 'CHF', icon: 'fairchild-channel-f', slugs: ['channel-f'], core: 'freechaf' },
  { id: 'astrocde', label: 'Bally Astrocade', short: 'ASTRO', icon: 'astrocade', slugs: ['astrocade'] },
  { id: 'arcadia', label: 'Emerson Arcadia 2001', short: 'ARC', icon: 'arcadia-2001', slugs: ['arcadia-2001'] },
  { id: 'crvision', label: 'VTech CreatiVision', short: 'CV', icon: 'creativision', slugs: [] },
  { id: 'supervision', label: 'Watara Supervision', short: 'SV', icon: 'supervision', slugs: ['watara-slash-quickshot-supervision'] },
  { id: 'gamecom', label: 'Tiger Game.com', short: 'GCOM', icon: 'game-dot-com', slugs: ['game-dot-com'] },
  { id: 'gmaster', label: 'Hartung Game Master', short: 'GM', icon: 'dedicated-handheld', slugs: [] },
  { id: 'wonderswan', label: 'WonderSwan', short: 'WS', icon: 'wonderswan', slugs: ['wonderswan'], core: 'beetle_wswan' },
  { id: 'wonderswancolor', label: 'WonderSwan Color', short: 'WSC', icon: 'wonderswan-color', slugs: ['wonderswan-color'], core: 'beetle_wswan' },
  { id: 'megaduck', label: 'Mega Duck', short: 'DUCK', icon: 'megaduck', slugs: ['mega-duck-slash-cougar-boy'] },
  { id: 'gamate', label: 'Bit Corporation Gamate', short: 'GMT', icon: 'gamate', slugs: ['gamate'] },
  { id: 'supracan', label: 'Super A\'Can', short: 'ACAN', icon: 'super-acan', slugs: ['super-acan'] },
  { id: 'vsmile', label: 'VTech V.Smile', short: 'VS', icon: 'vsmile', slugs: ['vsmile'] },
  { id: 'pv1000', label: 'Casio PV-1000', short: 'PV', icon: 'casio-pv-1000', slugs: [] },
  { id: 'scv', label: 'Epoch Super Cassette Vision', short: 'SCV', icon: 'epoch-super-cassette-vision', slugs: [] },
  { id: 'arduboy', label: 'Arduboy', short: 'ARDU', icon: 'arduboy', slugs: [] },
  { id: 'lcdgames', label: 'LCD handheld games', short: 'LCD', icon: 'handheld-electronic-lcd', slugs: [] },
  { id: 'laserdisc', label: 'LaserDisc games', short: 'LD', icon: 'laseractive', slugs: [] },

  // -- Arcade ---------------------------------------------------------------
  { id: 'arcade', label: 'Arcade', short: 'ARC', icon: 'arcade', slugs: ['arcade'], core: 'fbneo' },
  { id: 'mame', label: 'MAME', short: 'MAME', icon: 'arcade', slugs: ['mame'], core: 'mame' },
  { id: 'mame-advmame', label: 'AdvanceMAME', short: 'ADV', icon: 'arcade', slugs: [] },
  { id: 'mess', label: 'MESS', short: 'MESS', icon: 'arcade', slugs: [] },
  { id: 'fba', label: 'Final Burn Alpha', short: 'FBA', icon: 'fba2012', slugs: [] },
  { id: 'fbneo', label: 'FinalBurn Neo', short: 'FBNEO', icon: 'fbneo', slugs: [] },
  { id: 'cps', label: 'Capcom Play System', short: 'CPS', icon: 'cps1', slugs: [] },
  { id: 'cps1', label: 'Capcom Play System I', short: 'CPS1', icon: 'cps1', slugs: [] },
  { id: 'cps2', label: 'Capcom Play System II', short: 'CPS2', icon: 'cps2', slugs: [] },
  { id: 'cps3', label: 'Capcom Play System III', short: 'CPS3', icon: 'cps3', slugs: [] },
  { id: 'daphne', label: 'Daphne', short: 'DAPH', icon: 'laseractive', slugs: ['daphne'] },
  { id: 'consolearcade', label: 'Console arcade systems', short: 'CARC', icon: 'arcade', slugs: [] },
  { id: 'pcarcade', label: 'PC arcade systems', short: 'PARC', icon: 'arcade', slugs: [] },
  { id: 'type-x', label: 'Taito Type X', short: 'TYPEX', icon: 'arcade', slugs: [] },
  { id: 'fpinball', label: 'Future Pinball', short: 'FPIN', icon: 'default', slugs: [] },
  { id: 'vpinball', label: 'Visual Pinball', short: 'VPIN', icon: 'default', slugs: [] },

  // -- Mobile ---------------------------------------------------------------
  { id: 'android', label: 'Android', short: 'DROID', icon: 'default', slugs: ['android'] },
  { id: 'androidapps', label: 'Android apps', short: 'APPS', icon: 'default', slugs: [] },
  { id: 'androidgames', label: 'Android games', short: 'AGAME', icon: 'default', slugs: [] },
  { id: 'ngage', label: 'Nokia N-Gage', short: 'NGAGE', icon: 'ngage', slugs: ['ngage'] },
  { id: 'symbian', label: 'Symbian', short: 'SYM', icon: 'default', slugs: ['symbian'] },
  { id: 'j2me', label: 'Java 2 Micro Edition', short: 'J2ME', icon: 'default', slugs: ['j2me'] },
  { id: 'palm', label: 'Palm OS', short: 'PALM', icon: 'default', slugs: ['palm-os'] },

  // -- Engines, ports and fantasy consoles ---------------------------------
  { id: 'scummvm', label: 'ScummVM', short: 'SVM', icon: 'scummvm', slugs: ['scummvm'], core: 'scummvm' },
  { id: 'doom', label: 'Doom', short: 'DOOM', icon: 'doom', slugs: ['doom'], core: 'prboom' },
  { id: 'quake', label: 'Quake', short: 'QUAKE', icon: 'default', slugs: ['quake'], core: 'tyrquake' },
  { id: 'ports', label: 'Ports', short: 'PORT', icon: 'default', slugs: [] },
  { id: 'openbor', label: 'OpenBOR', short: 'BOR', icon: 'default', slugs: [] },
  { id: 'mugen', label: 'M.U.G.E.N', short: 'MUGEN', icon: 'default', slugs: [] },
  { id: 'solarus', label: 'Solarus', short: 'SOL', icon: 'default', slugs: [] },
  { id: 'easyrpg', label: 'EasyRPG', short: 'RPG', icon: 'rpgmaker', slugs: [] },
  { id: 'chailove', label: 'ChaiLove', short: 'CHAI', icon: 'default', slugs: [] },
  { id: 'lutro', label: 'Lutro', short: 'LUTRO', icon: 'default', slugs: [] },
  { id: 'lowresnx', label: 'LowRes NX', short: 'NX', icon: 'default', slugs: [] },
  { id: 'pico8', label: 'PICO-8', short: 'PICO8', icon: 'pico', slugs: ['pico-8'], core: 'retro8' },
  { id: 'tic80', label: 'TIC-80', short: 'TIC80', icon: 'tic-80', slugs: ['tic-80'], core: 'tic80' },
  { id: 'uzebox', label: 'Uzebox', short: 'UZE', icon: 'default', slugs: ['uzebox'], core: 'uzem' },
  { id: 'wasm4', label: 'WASM-4', short: 'WASM4', icon: 'wasm-4', slugs: ['wasm-4'] },
  { id: 'vircon32', label: 'Vircon32', short: 'V32', icon: 'default', slugs: ['vircon32'] },
  { id: 'flash', label: 'Adobe Flash', short: 'FLASH', icon: 'default', slugs: [] },
  { id: 'zmachine', label: 'Infocom Z-machine', short: 'ZM', icon: 'default', slugs: [] },
  { id: 'ags', label: 'Adventure Game Studio', short: 'AGS', icon: 'default', slugs: [] },

  // -- Launchers ------------------------------------------------------------
  { id: 'steam', label: 'Steam', short: 'STEAM', icon: 'default', slugs: [] },
  { id: 'epic', label: 'Epic Games Store', short: 'EPIC', icon: 'default', slugs: [] },
  { id: 'lutris', label: 'Lutris', short: 'LUT', icon: 'default', slugs: [] },
  { id: 'kodi', label: 'Kodi', short: 'KODI', icon: 'default', slugs: [] },
  { id: 'emulators', label: 'Emulators', short: 'EMU', icon: 'default', slugs: [] }
]

/**
 * The table as a lookup, and the only structure built from it.
 *
 * Everything else here is a question asked of this — is that a real system,
 * which systems have a core, what does that slug mean — rather than another
 * copy of the same rows under a different shape.
 */
export const SYSTEMS: Readonly<Record<string, SystemInfo>> = Object.fromEntries(
  TABLE.map((row) => [row.id, row])
)

/** Is this a system RomMix knows, and therefore a folder it may install into? */
export function isKnownSystem(system: string): boolean {
  return system in SYSTEMS
}

/** Every system RomMix knows, in table order. */
export function allSystems(): SystemInfo[] {
  return Object.values(SYSTEMS)
}

/**
 * The systems a libretro core is named for, which is exactly the set RetroArch
 * can be asked to run.
 */
export function systemsWithCore(): string[] {
  return TABLE.filter((row) => row.core != null).map((row) => row.id)
}

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
      icon: 'default',
      // No RomM platform maps to a system this table has never heard of.
      slugs: []
    }
  )
}

/** Human-readable name for an ES-DE system. */
export function systemLabel(system: string): string {
  return systemInfo(system).label
}

/**
 * RomM platform slug -> ES-DE system directory name.
 *
 * The `slugs` column inverted. Several slugs can name the same system, so this
 * is many-to-one; building it from the table is what stops the two disagreeing.
 */
export const ROMM_SLUG_TO_ESDE: Readonly<Record<string, string>> = Object.fromEntries(
  TABLE.flatMap((row) => row.slugs.map((slug) => [slug, row.id]))
)

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

  if (isKnownSystem(platformSlug)) return platformSlug
  if (isKnownSystem(platformFsSlug)) return platformFsSlug

  return null
}

/**
 * Where RomM serves a platform's icon, tried in order.
 *
 * `{name}` is a RomM platform slug or the `icon` from the table above. The
 * Systematic set comes first so a screen of platforms is one visual family
 * rather than a mix of monochrome glyphs and coloured brand logos; the second
 * is what an older RomM has. Nothing is bundled — these go over the same
 * authenticated protocol as cover art.
 */
export const PLATFORM_ICON_PATHS: readonly string[] = [
  '/assets/platforms/systematic/{name}.svg',
  '/assets/platforms/{name}.svg'
]

/** Libretro core for an ES-DE system, or null if we do not have a mapping. */
export function coreForSystem(system: string): string | null {
  return SYSTEMS[system]?.core ?? null
}
