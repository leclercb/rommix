import { coreForSystem } from '../../systems.ts'
import { libretroSavePaths, readRetroArchConfig } from '../libretro.ts'
import { joinPath, perRom, shared } from '../savepaths.ts'
import { switchSavePaths } from '../switch-saves.ts'
import type { SaveContext, SaveLocation, SavePaths } from '../savepaths.ts'

/**
 * Where EmuDeck's emulators keep their saves.
 *
 * EmuDeck's arrangement is the tidiest of the three and the old flags described
 * it worst. It gathers every emulator under one root:
 *
 *     Emulation/saves/<emulator>/saves
 *     Emulation/saves/<emulator>/states
 *
 * making each of those a symlink into wherever the emulator really writes, so
 * the tree is uniform however the underlying programs are packaged. Note what
 * is *not* there: EmuDeck has no states root of its own. States live under
 * `savesPath` beside the saves, which is why the descriptor discovers no
 * `states` path and this module builds both out of `paths.saves`.
 *
 * Paths below come from EmuDeck's own `linkToSaveFolder` calls and the config
 * writes in `functions/EmuScripts/`.
 */

/** The folder under `Emulation/saves/` a launcher script's emulator uses. */
const SAVE_FOLDER_BY_SCRIPT: Readonly<Record<string, string>> = {
  'rosaliesmupengui.sh': 'RMG',
  'dolphin-emu.sh': 'dolphin',
  'pcsx2-qt.sh': 'pcsx2',
  'xemu-emu.sh': 'xemu',
  'cemu.sh': 'Cemu',
  'vita3k.sh': 'Vita3K',
  'bigpemu.sh': 'BigPEmu'
}

/**
 * The emulator folder a launcher writes into.
 *
 * Every libretro entry runs through EmuDeck's `retroarch.sh` and shares one
 * folder; a standalone gets its own, named after the program rather than after
 * the script, which is the same only most of the time.
 */
export function emuDeckSaveFolder(script: string): string {
  return SAVE_FOLDER_BY_SCRIPT[script] ?? script.replace(/\.sh$/, '')
}

/** Emulators whose per-game data is a title-id folder in a Switch NAND. */
const SWITCH_FOLDERS: Readonly<Record<string, string>> = {
  eden: 'Eden',
  citron: 'Citron',
  ryujinx: 'Ryujinx',
  yuzu: 'Yuzu',
  suyu: 'Suyu'
}

/** How each emulator arranges what is under its folder. */
type FolderSaves = (ctx: SaveContext, root: string) => SavePaths

/** The common shape: files named after the ROM, in `saves/` and `states/`. */
function standard(root: string): SavePaths {
  return {
    saves: perRom(joinPath(root, 'saves'), [root]),
    states: perRom(joinPath(root, 'states'), [root])
  }
}

/** A memory-card emulator: states are per-game, the card is not. */
function cards(root: string, reason: string): SavePaths {
  return {
    saves: shared(joinPath(root, 'saves')),
    states: perRom(joinPath(root, 'states'), [root]),
    unsyncableReason: reason
  }
}

const FOLDERS: Readonly<Record<string, FolderSaves>> = {
  /**
   * EmuDeck ships every RetroArch sort flag off, so saves land flat in
   * `retroarch/saves`. Read from the config all the same rather than assumed —
   * the flags are one menu entry away from being changed, and the config is
   * where the answer actually is.
   */
  retroarch: (ctx, root) =>
    libretroSavePaths(
      ctx,
      readRetroArchConfig(
        ctx.env,
        [
          joinPath(
            ctx.home,
            '.var',
            'app',
            'org.libretro.RetroArch',
            'config',
            'retroarch',
            'retroarch.cfg'
          )
        ],
        ctx.home
      ),
      coreForSystem(ctx.system),
      { saves: joinPath(root, 'saves'), states: joinPath(root, 'states') }
    ),

  pcsx2: (_ctx, root) =>
    cards(
      root,
      'PCSX2 keeps one memory card shared by every PS2 game, so there is no save file that ' +
        'belongs to this one. Save states are synced.'
    ),

  /**
   * DuckStation names its cards after the game — `Suikoden II_1.mcd` — which is
   * per-game and matchable, unlike the shared card RetroDECK configures it
   * with. The stem matcher strips region tags, which is what lets a multi-disc
   * `.m3u` find the card written under the bare title.
   */
  duckstation: (_ctx, root) => standard(root),

  dolphin: (_ctx, root) => ({
    saves: shared(joinPath(root, 'GC')),
    states: perRom(joinPath(root, 'StateSaves'), [root]),
    unsyncableReason:
      'Dolphin keeps one GameCube memory card per region and one Wii NAND for every game, so ' +
      'there is no save file that belongs to this one. Save states are synced.'
  }),
  primehack: (_ctx, root) => ({
    saves: shared(joinPath(root, 'GC')),
    states: perRom(joinPath(root, 'StateSaves'), [root]),
    unsyncableReason:
      'PrimeHack keeps one memory card for every game, so there is no save file that belongs ' +
      'to this one. Save states are synced.'
  }),

  ppsspp: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: shared(joinPath(root, 'states')),
    unsyncableReason:
      'PPSSPP files saves under the game id printed inside the disc image rather than under the ' +
      'ROM name, which RomMix cannot read from outside the emulator.'
  }),
  rpcs3: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: null,
    unsyncableReason:
      'RPCS3 files saves under the PS3 title id rather than the ROM name, which RomMix cannot ' +
      'match to this game.'
  }),
  Cemu: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: null,
    unsyncableReason:
      'Cemu files saves under the Wii U title id rather than the ROM name, which RomMix cannot ' +
      'match to this game.'
  }),
  Vita3K: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: null,
    unsyncableReason:
      'Vita3K files saves under the Vita title id rather than the ROM name, which RomMix cannot ' +
      'match to this game.'
  }),
  azahar: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: perRom(joinPath(root, 'states'), [root]),
    unsyncableReason:
      'Azahar keeps saves inside an emulated SD card tree keyed by title id, which RomMix ' +
      'cannot match to this game. Save states are synced.'
  }),
  xemu: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: null,
    unsyncableReason:
      'xemu keeps one emulated Xbox hard disk for every game, so there is no save file that ' +
      'belongs to this one.'
  }),
  xenia: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: null,
    unsyncableReason:
      'Xenia files saves under the Xbox 360 title id rather than the ROM name, which RomMix ' +
      'cannot match to this game.'
  }),

  /**
   * Flycast's VMU images are named after the slot rather than the game, so a
   * pair of them holds every Dreamcast save the user has. Its states are named
   * after the ROM and are synced.
   */
  flycast: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: perRom(joinPath(root, 'states'), [root]),
    unsyncableReason:
      'Flycast keeps two VMU memory cards shared by every Dreamcast game, so there is no save ' +
      'file that belongs to this one. Save states are synced.'
  })
}

/** Where this EmuDeck launcher's emulator keeps the game's saves. */
export function emuDeckSavePaths(ctx: SaveContext, script: string): SavePaths {
  if (!ctx.paths.saves) return { saves: null, states: null }

  const folder = emuDeckSaveFolder(script)
  const root = joinPath(ctx.paths.saves, folder)

  const switchName = SWITCH_FOLDERS[folder]
  // The Yuzu-lineage emulators keep a NAND rather than a save folder, and
  // EmuDeck links `<folder>/saves` straight at its `nand/user/save`.
  if (switchName) {
    return { ...switchSavePaths(ctx, joinPath(root, 'saves'), switchName), emulator: folder }
  }

  const known = FOLDERS[folder]
  const paths = known ? known(ctx, root) : standard(root)
  // Tagged with the emulator underneath, not with EmuDeck: the file is a
  // Dolphin or DuckStation save and stays readable as one.
  return { ...paths, emulator: folder.toLowerCase() }
}

/** Exported for the registry test, which checks every launcher resolves. */
export function emuDeckSaveRoots(
  saves: string,
  script: string
): {
  root: string
  saves: SaveLocation | null
} {
  const root = joinPath(saves, emuDeckSaveFolder(script))
  return { root, saves: perRom(joinPath(root, 'saves')) }
}
