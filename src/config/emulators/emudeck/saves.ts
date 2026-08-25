import type { Text } from '@shared/i18n'
import { coreForSystem } from '../../systems.ts'
import { libretroSavePaths, readLibretroConfig } from '../libretro.ts'
import { joinPath, perRom, shared } from '../savepaths.ts'
import { switchSavePaths } from '../switch-saves.ts'
import type { SaveContext, SavePaths } from '../savepaths.ts'

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
function cards(root: string, reason: Text): SavePaths {
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
      readLibretroConfig(
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

  pcsx2: (_ctx, root) => cards(root, 'saves.pcsx2'),

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
    unsyncableReason: 'saves.dolphin'
  }),
  primehack: (_ctx, root) => ({
    saves: shared(joinPath(root, 'GC')),
    states: perRom(joinPath(root, 'StateSaves'), [root]),
    unsyncableReason: 'saves.primehack'
  }),

  ppsspp: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: shared(joinPath(root, 'states')),
    unsyncableReason: 'saves.ppsspp'
  }),
  rpcs3: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: null,
    unsyncableReason: 'saves.rpcs3'
  }),
  Cemu: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: null,
    unsyncableReason: 'saves.cemu'
  }),
  Vita3K: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: null,
    unsyncableReason: 'saves.vita3k'
  }),
  azahar: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: perRom(joinPath(root, 'states'), [root]),
    unsyncableReason: 'saves.azaharStates'
  }),
  xemu: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: null,
    unsyncableReason: 'saves.xemu'
  }),
  xenia: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: null,
    unsyncableReason: 'saves.xenia'
  }),

  /**
   * Flycast's VMU images are named after the slot rather than the game, so a
   * pair of them holds every Dreamcast save the user has. Its states are named
   * after the ROM and are synced.
   */
  flycast: (_ctx, root) => ({
    saves: shared(joinPath(root, 'saves')),
    states: perRom(joinPath(root, 'states'), [root]),
    unsyncableReason: 'saves.flycast'
  })
}

/** Where this EmuDeck launcher's emulator keeps the game's saves. */
export function emuDeckSavePaths(ctx: SaveContext, script: string): SavePaths {
  if (!ctx.paths.saves) return { saves: null, states: null }

  const folder = emuDeckSaveFolder(script)
  const root = joinPath(ctx.paths.saves, folder)

  // Tagged with the emulator underneath, not with EmuDeck: the file is a
  // Dolphin or DuckStation save and stays readable as one. Lowercased because
  // the folder is not: `Cemu` and `Vita3K` are spelled as EmuDeck spells them,
  // and a tag is compared against what the other ways of running that emulator
  // send.
  const emulator = folder.toLowerCase()

  const switchName = SWITCH_FOLDERS[folder]
  // The Yuzu-lineage emulators keep a NAND rather than a save folder, and
  // EmuDeck links `<folder>/saves` straight at its `nand/user/save`.
  if (switchName) {
    return { ...switchSavePaths(ctx, joinPath(root, 'saves'), switchName), emulator }
  }

  const known = FOLDERS[folder]
  const paths = known ? known(ctx, root) : standard(root)
  return { ...paths, emulator }
}
