import type { Text } from '@shared/i18n'
import { discRootFile } from './disc.ts'
import { joinPath, prefixed, shared } from './savepaths.ts'
import type { SaveContext, SaveEnvironment, SavePaths } from './savepaths.ts'

const SYSTEM_CNF = 'SYSTEM.CNF'
/** `BOOT2 = cdrom0:\SLUS_203.12;1`: the executable a PS2 disc boots, named after its serial. */
const BOOT_LINE = /^\s*BOOT2\s*=\s*cdrom0?:\\?([A-Z]{4})_(\d{3})\.(\d{2})/im
/** A PCSX2 folder card keeps the extension a file card has. */
const CARD = /\.ps2$/i
/**
 * The letter after the `B` a PS2 save folder begins with is the region the game
 * was released for, which the disc says nothing exact about. Any letter is
 * taken: what follows it is the serial, which is the game's own.
 */
const REGIONS = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ')

/**
 * The serial a PS2 disc declares, as its save folders spell it: `SLUS-20312`.
 *
 * Read from `SYSTEM.CNF` in the root of the disc, whose `BOOT2` line names the
 * executable after the serial — `SLUS_203.12`. See `discRootFile` for which
 * images can be read. Null rather than a guess: a wrong serial is another
 * game's folders archived and sent up under this one.
 */
export function ps2Serial(env: SaveEnvironment, romPath: string): string | null {
  const contents = discRootFile(env, romPath, SYSTEM_CNF)
  if (!contents) return null
  const match = BOOT_LINE.exec(contents)
  return match ? `${match[1].toUpperCase()}-${match[2]}${match[3]}` : null
}

/**
 * Where PCSX2 keeps this game's saves, given its memory card folder.
 *
 * A card kept as one file holds every game's saves, and stays shared. A folder
 * card is a directory with the same name, holding one folder per game named
 * after its serial — `BASLUS-20312…` — and those folders are this game's.
 *
 * With several folder cards, the one already holding this game's folders is
 * the one it writes to. Where that is not exactly one card, nothing says which
 * the game will use, so the folder stays shared.
 */
export function pcsx2Saves(
  ctx: SaveContext,
  dir: string | null,
  reason: Text
): Pick<SavePaths, 'saves' | 'unsyncableReason'> {
  if (!dir) return { saves: null }
  const cards = ctx.env
    .dirs(dir)
    .filter((name) => CARD.test(name))
    .sort()
  if (cards.length === 0) return { saves: shared(dir), unsyncableReason: reason }

  const serial = ps2Serial(ctx.env, ctx.romPath)
  if (!serial) return { saves: shared(dir), unsyncableReason: 'saves.pcsx2NoSerial' }

  const prefixes = REGIONS.map((region) => `B${region}${serial}`)
  const holding = cards.filter((card) =>
    ctx.env
      .dirs(joinPath(dir, card))
      .some((name) => prefixes.some((prefix) => name.startsWith(prefix)))
  )
  const candidates = holding.length > 0 ? holding : cards
  if (candidates.length !== 1) {
    return { saves: shared(dir), unsyncableReason: 'saves.pcsx2Cards' }
  }
  return { saves: prefixed(joinPath(dir, candidates[0]), ...prefixes) }
}
