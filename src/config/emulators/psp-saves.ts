import { discRootFile } from './disc.ts'
import { prefixed, shared } from './savepaths.ts'
import type { SaveContext, SaveEnvironment, SavePaths } from './savepaths.ts'

const UMD_DATA = 'UMD_DATA.BIN'
/** Four letters, an optional dash, five digits: `ULUS-10064`. */
const DISC_ID = /^([A-Z]{4})-?(\d{5})$/

/**
 * The disc id a PSP game declares, which PPSSPP names its save folders after.
 *
 * PPSSPP files a game's saves in `PSP/SAVEDATA` under folders that begin with
 * that id — `ULUS10064DATA00` beside `ULUS10064SETTINGS` — and nothing in them
 * is the ROM's name. The id is the first field of `UMD_DATA.BIN`, a small file
 * in the root of the disc's ISO 9660 filesystem, written `ULUS-10064|…`; the
 * folders drop the dash. See `discRootFile` for which images can be read.
 *
 * An id that cannot be read is null rather than a guess — a wrong one is
 * another game's folders archived and sent up under this one.
 */
export function pspGameId(env: SaveEnvironment, romPath: string): string | null {
  const contents = discRootFile(env, romPath, UMD_DATA)
  if (!contents) return null
  const pipe = contents.indexOf('|')
  if (pipe === -1) return null
  const match = DISC_ID.exec(contents.slice(0, pipe).trim())
  return match ? `${match[1]}${match[2]}` : null
}

/**
 * Where PPSSPP keeps this game's saves, given its `SAVEDATA` folder.
 *
 * The folders whose names begin with the id, never the directory itself: that
 * holds every game's, which an archive of it would carry up under this one and
 * back down over theirs. Without an id the directory stays shared.
 *
 * With one, no reason is given, though the states stay shared: PPSSPP names them
 * after the id and the game's version, which nothing matches on. A reason stands
 * in for what a sync that moved nothing would report, and these saves do sync.
 */
export function ppssppSaves(
  ctx: SaveContext,
  dir: string | null
): Pick<SavePaths, 'saves' | 'unsyncableReason'> {
  if (!dir) return { saves: null }
  const id = pspGameId(ctx.env, ctx.romPath)
  if (!id) return { saves: shared(dir), unsyncableReason: 'saves.ppsspp' }
  return { saves: prefixed(dir, id) }
}
