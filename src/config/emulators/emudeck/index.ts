import { emuDeckSavePaths } from './saves.ts'
import type { DirSpec, EmulatorDescriptor, LaunchVariant, LayoutSource } from '../types.ts'

/**
 * EmuDeck.
 *
 * EmuDeck is not an emulator. It installs and configures a dozen of them —
 * mostly as ordinary Flathub flatpaks — lays out an `Emulation/` folder, and
 * sets up ES-DE. What it gives RomMix is that layout plus a set of launcher
 * scripts in `Emulation/tools/launchers/`, one per emulator, each of which
 * initialises the emulator the way EmuDeck configured it (save symlinks, cloud
 * sync) and then forwards its arguments straight through:
 *
 *     #!/bin/bash
 *     . "$HOME/.config/EmuDeck/backend/functions/all.sh"
 *     emulatorInit "retroarch"
 *     /usr/bin/flatpak run org.libretro.RetroArch $netplayCMD "${@}"
 *     cloud_sync_uploadForced
 *
 * Because the arguments are forwarded verbatim, RomMix has to supply whatever
 * the emulator underneath expects, which is why every entry below carries its
 * own argument list rather than just a ROM path. Those lists, the script names
 * and the libretro cores are taken from EmuDeck's own Steam ROM Manager
 * parsers, which is how EmuDeck itself launches these games.
 *
 * Unlike RetroDECK there is no dispatcher to hand a system to, so RomMix names
 * the script — and where EmuDeck ships more than one way to run a system, it
 * offers the choice rather than picking. Nothing here is guessed: a system with
 * no entry is one RomMix declines to run through EmuDeck.
 */

/** Stands in for the ROM path inside an argument, so `Z:%ROM%` works too. */
export const ROM_PLACEHOLDER = '%ROM%'

/** One way EmuDeck can run a system. */
export interface EmuDeckLauncher extends LaunchVariant {
  /** Script name under `Emulation/tools/launchers/`. */
  script: string
  /** Arguments, with `%ROM%` replaced by the game's path. */
  args: readonly string[]
}

/**
 * One entry in the table below.
 *
 * `requires` is the script itself. EmuDeck writes one launcher per emulator it
 * installs, at the moment it installs it, so the file being there is exactly
 * what says that emulator was set up — which is what makes every row here
 * checkable rather than merely claimed. See `LaunchVariant.requires`.
 */
function launcher(
  id: string,
  label: string,
  note: string,
  script: string,
  args: readonly string[]
): EmuDeckLauncher {
  return { id, label, note, script, requires: script, args }
}

/** `retroarch.sh -L <core>_libretro.so <rom>`, EmuDeck's most common shape. */
function core(id: string, label: string, name: string): EmuDeckLauncher {
  return launcher(id, label, 'RetroArch', 'retroarch.sh', [
    '-L',
    `${name}_libretro.so`,
    ROM_PLACEHOLDER
  ])
}

/**
 * The libretro core a launcher loads, or null for a standalone.
 *
 * Read out of the arguments rather than from the id beside them. The two are
 * the same string for every row above and the argument is the one that runs, so
 * a row whose id is ever written as a label cannot quietly start tagging saves
 * with something no core is called.
 */
export function emuDeckCore(chosen: EmuDeckLauncher): string | null {
  const loaded = chosen.args.find((arg) => arg.endsWith('_libretro.so'))
  return loaded ? loaded.replace(/_libretro\.so$/, '') : null
}

/** A standalone emulator, which EmuDeck gives its own launcher script. */
function standalone(
  id: string,
  label: string,
  script: string,
  args: readonly string[] = [ROM_PLACEHOLDER]
): EmuDeckLauncher {
  return launcher(id, label, 'Standalone', script, args)
}

/**
 * How EmuDeck runs each system, best-known default first.
 *
 * The first entry is what EmuDeck's own default configuration uses. Where a
 * second or third is listed, EmuDeck installs those too and the choice is a
 * real one — Saturn accuracy versus speed, or which of the four Switch
 * emulators a given game actually runs on — so RomMix asks instead of deciding.
 *
 * Nothing here is taken on trust at launch time: every row names the script it
 * needs, and the probe drops the ones whose script is not in the user's
 * `launchers` folder. So this table is EmuDeck's *catalogue* rather than a
 * claim about any particular machine — a user who installed four of its Switch
 * emulators is offered four, and one who installed none is told so.
 */
export const EMUDECK_LAUNCHERS: Readonly<Record<string, readonly EmuDeckLauncher[]>> = {
  // -- Nintendo -------------------------------------------------------------
  nes: [core('mesen', 'Mesen', 'mesen')],
  famicom: [core('mesen', 'Mesen', 'mesen')],
  fds: [core('mesen', 'Mesen', 'mesen')],
  snes: [core('snes9x', 'Snes9x', 'snes9x')],
  snesna: [core('snes9x', 'Snes9x', 'snes9x')],
  sfc: [core('snes9x', 'Snes9x', 'snes9x')],
  sgb: [core('mesen-s', 'Mesen-S', 'mesen-s')],
  n64: [
    core('mupen64plus_next', 'Mupen64Plus-Next', 'mupen64plus_next'),
    standalone('rmg', "Rosalie's Mupen GUI", 'rosaliesmupengui.sh', [
      '--fullscreen',
      '--nogui',
      '--quit-after-emulation',
      ROM_PLACEHOLDER
    ])
  ],
  gc: [standalone('dolphin', 'Dolphin', 'dolphin-emu.sh', ['-b', '-e', ROM_PLACEHOLDER])],
  wii: [standalone('dolphin', 'Dolphin', 'dolphin-emu.sh', ['-b', '-e', ROM_PLACEHOLDER])],
  wiiu: [standalone('cemu', 'Cemu', 'cemu.sh', ['-f', '-g', ROM_PLACEHOLDER])],
  switch: [
    standalone('eden', 'Eden', 'eden.sh', ['-f', '-g', ROM_PLACEHOLDER]),
    standalone('citron', 'Citron', 'citron.sh', ['-f', '-g', ROM_PLACEHOLDER]),
    standalone('ryujinx', 'Ryujinx', 'ryujinx.sh', ['--fullscreen', ROM_PLACEHOLDER]),
    standalone('yuzu', 'Yuzu', 'yuzu.sh', ['-f', '-g', ROM_PLACEHOLDER])
  ],
  gb: [
    core('gambatte', 'Gambatte', 'gambatte'),
    standalone('mgba', 'mGBA', 'mgba.sh', ['-f', ROM_PLACEHOLDER])
  ],
  gbc: [
    core('gambatte', 'Gambatte', 'gambatte'),
    standalone('mgba', 'mGBA', 'mgba.sh', ['-f', ROM_PLACEHOLDER])
  ],
  gba: [
    core('mgba', 'mGBA', 'mgba'),
    standalone('mgba-standalone', 'mGBA', 'mgba.sh', ['-f', ROM_PLACEHOLDER])
  ],
  nds: [
    core('melondsds', 'melonDS DS', 'melondsds'),
    standalone('melonds', 'melonDS', 'melonds.sh', [ROM_PLACEHOLDER, '-f'])
  ],
  n3ds: [
    standalone('azahar', 'Azahar', 'azahar.sh'),
    standalone('lime3ds', 'Lime3DS', 'lime3ds.sh'),
    standalone('citra', 'Citra', 'citra.sh')
  ],
  virtualboy: [core('mednafen_vb', 'Beetle VB', 'mednafen_vb')],

  // -- Sega -----------------------------------------------------------------
  mastersystem: [core('genesis_plus_gx', 'Genesis Plus GX', 'genesis_plus_gx')],
  genesis: [core('genesis_plus_gx', 'Genesis Plus GX', 'genesis_plus_gx')],
  megadrive: [core('genesis_plus_gx', 'Genesis Plus GX', 'genesis_plus_gx')],
  segacd: [core('genesis_plus_gx', 'Genesis Plus GX', 'genesis_plus_gx')],
  megacd: [core('genesis_plus_gx', 'Genesis Plus GX', 'genesis_plus_gx')],
  gamegear: [core('genesis_plus_gx', 'Genesis Plus GX', 'genesis_plus_gx')],
  sega32x: [core('picodrive', 'PicoDrive', 'picodrive')],
  saturn: [
    core('kronos', 'Kronos', 'kronos'),
    core('mednafen_saturn', 'Beetle Saturn', 'mednafen_saturn'),
    core('yabause', 'Yabause', 'yabause')
  ],
  dreamcast: [
    core('flycast', 'Flycast', 'flycast'),
    standalone('flycast-standalone', 'Flycast', 'flycast.sh')
  ],
  naomi: [
    core('flycast', 'Flycast', 'flycast'),
    standalone('flycast-standalone', 'Flycast', 'flycast.sh')
  ],
  naomi2: [standalone('flycast-standalone', 'Flycast', 'flycast.sh')],
  atomiswave: [standalone('flycast-standalone', 'Flycast', 'flycast.sh')],

  // -- Sony -----------------------------------------------------------------
  psx: [
    standalone('duckstation', 'DuckStation', 'duckstation.sh', [
      '-batch',
      '-fullscreen',
      '-nogui',
      ROM_PLACEHOLDER
    ])
  ],
  ps2: [
    standalone('pcsx2', 'PCSX2', 'pcsx2-qt.sh', [
      '-batch',
      '-fullscreen',
      '-nogui',
      ROM_PLACEHOLDER
    ])
  ],
  ps3: [standalone('rpcs3', 'RPCS3', 'rpcs3.sh', ['--no-gui', ROM_PLACEHOLDER])],
  psp: [standalone('ppsspp', 'PPSSPP', 'ppsspp.sh', ['-f', '-g', ROM_PLACEHOLDER])],

  // -- Microsoft ------------------------------------------------------------
  xbox: [standalone('xemu', 'xemu', 'xemu-emu.sh', ['-full-screen', '-dvd_path', ROM_PLACEHOLDER])],
  // Xenia runs under Proton, so the path it is given has to be a Windows one.
  xbox360: [standalone('xenia', 'Xenia', 'xenia.sh', [`Z:${ROM_PLACEHOLDER}`])],
  dos: [core('dosbox_pure', 'DOSBox Pure', 'dosbox_pure')],

  // -- NEC ------------------------------------------------------------------
  pcengine: [core('mednafen_pce', 'Beetle PCE', 'mednafen_pce')],
  tg16: [core('mednafen_pce', 'Beetle PCE', 'mednafen_pce')],
  pcenginecd: [core('mednafen_pce', 'Beetle PCE', 'mednafen_pce')],
  'tg-cd': [core('mednafen_pce', 'Beetle PCE', 'mednafen_pce')],
  pcfx: [core('mednafen_pcfx', 'Beetle PC-FX', 'mednafen_pcfx')],
  pc98: [core('np2kai', 'NP2kai', 'np2kai')],

  // -- SNK ------------------------------------------------------------------
  neogeo: [core('fbneo', 'FinalBurn Neo', 'fbneo')],
  neogeocd: [core('fbneo', 'FinalBurn Neo', 'fbneo')],
  ngp: [core('mednafen_ngp', 'Beetle NeoPop', 'mednafen_ngp')],
  ngpc: [core('mednafen_ngp', 'Beetle NeoPop', 'mednafen_ngp')],

  // -- Atari ----------------------------------------------------------------
  atari2600: [core('stella', 'Stella', 'stella')],
  atarilynx: [core('mednafen_lynx', 'Beetle Lynx', 'mednafen_lynx')],
  atarijaguar: [
    core('virtualjaguar', 'Virtual Jaguar', 'virtualjaguar'),
    standalone('bigpemu', 'BigPEmu', 'bigpemu.sh')
  ],

  // -- Computers ------------------------------------------------------------
  amiga: [core('puae', 'PUAE', 'puae')],
  amiga600: [core('puae', 'PUAE', 'puae')],
  amiga1200: [core('puae', 'PUAE', 'puae')],
  amigacd32: [core('puae', 'PUAE', 'puae')],
  c64: [core('vice_x64', 'VICE x64', 'vice_x64')],
  vic20: [core('vice_xvic', 'VICE xVIC', 'vice_xvic')],
  plus4: [core('vice_xplus4', 'VICE xPlus4', 'vice_xplus4')],
  amstradcpc: [core('cap32', 'Caprice32', 'cap32')],
  zxspectrum: [core('fuse', 'Fuse', 'fuse')],
  x68000: [core('px68k', 'PX68k', 'px68k')],

  // -- Other ----------------------------------------------------------------
  '3do': [core('opera', 'Opera', 'opera')],
  intellivision: [core('freeintv', 'FreeIntv', 'freeintv')],
  cdimono1: [core('same_cdi', 'SAME CDi', 'same_cdi')],
  wonderswan: [core('mednafen_wswan', 'Beetle WonderSwan', 'mednafen_wswan')],
  wonderswancolor: [core('mednafen_wswan', 'Beetle WonderSwan', 'mednafen_wswan')],

  // -- Arcade ---------------------------------------------------------------
  arcade: [core('fbneo', 'FinalBurn Neo', 'fbneo')],
  fbneo: [core('fbneo', 'FinalBurn Neo', 'fbneo')],
  mame: [core('mame2003_plus', 'MAME 2003-Plus', 'mame2003_plus')],
  model3: [standalone('supermodel', 'Supermodel', 'supermodel.sh')],

  // -- Engines and fantasy consoles -----------------------------------------
  doom: [core('prboom', 'PrBoom', 'prboom')],
  scummvm: [
    standalone('scummvm', 'ScummVM', 'scummvm.sh', [`--path=${ROM_PLACEHOLDER}`, '--auto-detect'])
  ],
  easyrpg: [core('easyrpg', 'EasyRPG', 'easyrpg')],
  pico8: [core('retro8', 'Retro8', 'retro8')],
  tic80: [core('tic80', 'TIC-80', 'tic80')]
}

/**
 * EmuDeck's configurator, below the user's home.
 *
 * A fixed location rather than something discovered: `install.sh` curls it to
 * exactly this path, chmods it and runs it, and everything else EmuDeck sets up
 * happens afterwards from inside it.
 *
 * `--no-sandbox` because it is an Electron application, and Ubuntu restricts
 * the unprivileged user namespaces Chromium's sandbox needs
 * (`kernel.apparmor_restrict_unprivileged_userns=1` since 24.04), so without
 * the flag it exits during startup rather than opening a window. Not RomMix's
 * own opinion about sandboxing: EmuDeck's installer passes it on Ubuntu and
 * writes it into the desktop entry it creates, so this is the same command the
 * user's own menu entry runs.
 */
const EMUDECK_APP = 'Applications/EmuDeck.AppImage'

/**
 * EmuDeck's `settings.sh`, wherever it is being kept.
 *
 * One description of the file rather than two copies of it: the same
 * `key=value` shell with the same names, and only its location has moved.
 */
function settingsSource(file: DirSpec): LayoutSource {
  return {
    file,
    format: 'shell',
    requires: 'home',
    keys: {
      home: 'emulationPath',
      roms: 'romsPath',
      saves: 'savesPath',
      bios: 'biosPath'
    },
    // Where the launcher scripts live, which is also how EmuDeck is detected at
    // all.
    extras: { tools: 'toolsPath' },
    defaults: { roms: 'roms', saves: 'saves', bios: 'bios', tools: 'tools' }
  }
}

/** The ways EmuDeck can run this system, EmuDeck's own default first. */
export function emuDeckLaunchers(system: string): readonly EmuDeckLauncher[] {
  return EMUDECK_LAUNCHERS[system] ?? []
}

export const emudeck: EmulatorDescriptor = {
  id: 'emudeck',
  name: 'EmuDeck',
  dispatch: 'rommix',
  // What "EmuDeck is installed" means: the launcher scripts are there. Not that
  // the Emulation folder exists — that is created early in setup and left
  // behind by an uninstall, whereas the launchers are what RomMix actually
  // runs. Where they are comes from the tools directory `layout` reads.
  install: [{ kind: 'scripts', dir: { from: 'tools', path: 'launchers' } }],
  // Only a homepage, because RomMix cannot install EmuDeck: its own installer
  // sets up a dozen emulators and asks a page of questions about how they
  // should be configured.
  homepage: 'https://www.emudeck.com',
  systems: Object.keys(EMUDECK_LAUNCHERS),
  variants: emuDeckLaunchers,
  // EmuDeck builds the Emulation folder during its own setup, and until that
  // has happened there is nowhere to install a ROM to.
  ownsLibrary: true,
  // Discovered from EmuDeck's settings rather than declared: every one of them
  // is a path the user chose, and an SD card is the usual reason.
  dirs: {},
  layout: {
    // Both places EmuDeck has kept that file. `~/emudeck/settings.sh` is the
    // path its own scripts source and the one to prefer; on a current install
    // it is a symlink to the copy under `~/.config/EmuDeck`, which is where the
    // real file now lives — so the second entry is what answers if a version
    // ever stops leaving the symlink behind.
    sources: [
      settingsSource({ base: 'home', path: 'emudeck/settings.sh' }),
      settingsSource({ base: 'config', path: 'EmuDeck/settings.sh' })
    ],
    // What EmuDeck keeps below its Emulation folder. `tools` is here too: it is
    // where the launcher scripts live, and therefore what "EmuDeck is
    // installed" means at all.
    relative: { roms: 'roms', saves: 'saves', bios: 'bios', tools: 'tools' },
    fallback: {
      base: 'home',
      paths: {
        home: 'Emulation',
        roms: 'Emulation/roms',
        saves: 'Emulation/saves',
        bios: 'Emulation/bios',
        tools: 'Emulation/tools'
      }
    }
  },
  // ES-DE scans recursively, so a multi-file game keeps its own folder.
  flatLibrary: false,
  // Its own Emulation tree has a folder per system already.
  needsRomFolders: false,
  /**
   * EmuDeck files saves per emulator under `Emulation/saves`, symlinking each
   * emulator's own directory into it — so what is there depends on which
   * emulator ran the game rather than on the ES-DE system.
   *
   * Which emulator that was is not a guess: it is the launcher the user already
   * chose, recorded in `settings.systemLaunchers` and handed back here as
   * `variant`. Absent, it is EmuDeck's own default for the system — the one
   * `launch` would run. Unrecognised, it is nothing at all, for the reason
   * `launch` gives: a recorded choice that no longer exists is not a licence to
   * answer with some other emulator's folders.
   */
  saves: (ctx) => {
    const options = emuDeckLaunchers(ctx.system)
    const chosen = ctx.variant ? options.find((option) => option.id === ctx.variant) : options[0]
    if (!chosen) return { saves: null, states: null }
    return emuDeckSavePaths(ctx, chosen.script, emuDeckCore(chosen))
  },
  // Its Emulation/bios folder takes any firmware file, at the root.
  bios: undefined,
  biosStagingNote: undefined,
  // Its installer downloads the cores along with RetroArch, so a system it
  // claims to run is never a system whose core is missing.
  core: undefined,
  setupNotes: [],
  env: undefined,
  // EmuDeck itself, not ES-DE. The button is for the setup only the program can
  // do — installing another emulator, moving the library to an SD card — and
  // RomMix is already the frontend the user is looking at, so handing them a
  // second one is not what "Run EmuDeck" means.
  open: ({ home }) => [`${home}/${EMUDECK_APP}`, '--no-sandbox'],
  launch: ({ exec, installRef, system, romPath, variant }) => {
    const options = emuDeckLaunchers(system)
    if (options.length === 0) return null
    // An unknown variant is not silently downgraded to the default: it means a
    // recorded choice no longer exists, and running a game on a different
    // emulator than the one asked for is how a save ends up in the wrong place.
    const chosen = variant ? options.find((option) => option.id === variant) : options[0]
    if (!chosen) return null
    return [
      ...exec,
      `${installRef}/${chosen.script}`,
      ...chosen.args.map((arg) => arg.replace(ROM_PLACEHOLDER, romPath))
    ]
  }
}
