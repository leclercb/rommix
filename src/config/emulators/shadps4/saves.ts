import { baseName, dirName, directory, joinPath } from '../savepaths.ts'
import type { SaveContext, SavePaths } from '../savepaths.ts'

/**
 * Finding one PlayStation 4 game's saves in shadPS4.
 *
 *     <shadPS4 data>/home/<user id>/savedata/<title id>/<save dir>/
 *
 * `home` is shadPS4's own folder of emulated PS4 users, not `/home`.
 *
 * Nothing in that path is the ROM's name. Both unknowns are findable without
 * the emulator running, and neither is guessed:
 *
 *  - the **title id** is the CUSA serial the game states in its own
 *    `sce_sys/param.sfo`, which sits beside `eboot.bin` in every dumped game.
 *    Where the file cannot be read the name is asked instead, since a dump is
 *    conventionally named for its serial.
 *  - the **user id** is the one shadPS4's `users.json` gives to player one,
 *    unless another user already holds a save for this game. Ids are shadPS4's
 *    to assign, so they are read rather than assumed.
 *
 * A serial that cannot be resolved returns no location rather than a guess:
 * writing a pulled save under the wrong serial puts another game's data where
 * this game looks for its own.
 */

/** A PS4 title id: the four-letter category and five digits, e.g. CUSA12345. */
const SERIAL = /\b(CUSA|PCAS|PCKS|PLAS|PPSA)\d{5}\b/i

/** The metadata file every dumped game carries, below the game's directory. */
const PARAM_SFO = ['sce_sys', 'param.sfo']

/**
 * How much of `param.sfo` to read.
 *
 * It is a small key/value table — a few kilobytes in full — and the serial sits
 * in its string block. Reading the whole of a generous cap costs one short read
 * and removes any question of where in the table it landed.
 */
const SFO_BYTES = 65536

/**
 * The serial this game declares, or null.
 *
 * The file first, because it is the game speaking for itself; the path second,
 * because a dump is conventionally named `CUSA12345` or `Title [CUSA12345]`.
 * The launch file is normally `eboot.bin` at the root of the game directory, so
 * both that directory and the one above it are asked — a game unpacked into a
 * folder of its own carries the serial on the outer one.
 */
export function ps4Serial(ctx: SaveContext): string | null {
  const gameDir = dirName(ctx.romPath)
  const declared = ctx.env.head(joinPath(gameDir, ...PARAM_SFO), SFO_BYTES)
  const stated = declared ? SERIAL.exec(declared) : null
  if (stated) return stated[0].toUpperCase()

  for (const name of [baseName(gameDir), baseName(dirName(gameDir)), ctx.romStem]) {
    const match = name ? SERIAL.exec(name) : null
    if (match) return match[0].toUpperCase()
  }
  return null
}

/**
 * The user id shadPS4 gives player one on a fresh install: the answer before
 * it has written `users.json` or a user directory.
 */
const FIRST_USER = '1000'

/**
 * shadPS4's user data directory.
 *
 * The declared path is where every build seen puts it, but the folder is
 * created by the emulator rather than by RomMix, so one that is actually there
 * wins over one that is merely named — a difference of case in the directory
 * name would otherwise cost every save on the system.
 */
function userDataRoot(ctx: SaveContext): string | null {
  const home = ctx.paths.saves
  const declared = home ? dirName(home) : null
  if (declared && ctx.env.exists(declared)) return declared

  const data = ctx.dataDir
  const found = data ? ctx.env.dirs(data).find((dir) => dir.toLowerCase() === 'shadps4') : null
  return found && data ? joinPath(data, found) : declared
}

/** The user id `users.json` gives player one, or null when it does not say. */
function playerOne(ctx: SaveContext, root: string): string | null {
  const text = ctx.env.text(joinPath(root, 'users.json'))
  if (!text) return null
  try {
    const users: unknown = JSON.parse(text)
    const list = (users as { Users?: { user?: unknown } }).Users?.user
    if (!Array.isArray(list)) return null
    const first = list.find((user) => user?.player_index === 1)
    return typeof first?.user_id === 'number' ? String(first.user_id) : null
  } catch {
    return null
  }
}

/**
 * The directory holding this game's saves.
 *
 * The user that already holds a save for this serial is the answer. Failing
 * that — a game that has never been played — player one, then the only user
 * there is, then the one a fresh install creates.
 */
function saveDir(ctx: SaveContext, root: string, serial: string): string {
  const home = joinPath(root, 'home')
  const users = ctx.env.dirs(home)
  const holding = users.find((user) => ctx.env.exists(joinPath(home, user, 'savedata', serial)))
  const only = users.length === 1 ? users[0] : null
  const user = holding ?? playerOne(ctx, root) ?? only ?? FIRST_USER
  return joinPath(home, user, 'savedata', serial)
}

export function shadPs4SavePaths(ctx: SaveContext): SavePaths {
  const root = userDataRoot(ctx)
  if (!root) {
    return {
      saves: null,
      states: null,
      unsyncableReason: 'saves.shadps4NoData'
    }
  }

  const serial = ps4Serial(ctx)
  if (!serial) {
    return {
      saves: null,
      states: null,
      unsyncableReason: 'saves.shadps4NoSerial'
    }
  }

  return {
    // The folder is the unit of save data: the files inside are named by the
    // game's own save slots and carry nothing tying them to a ROM.
    saves: directory(saveDir(ctx, root, serial)),
    // shadPS4 has no save states.
    states: null
  }
}
