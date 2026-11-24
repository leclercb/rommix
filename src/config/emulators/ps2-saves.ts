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
/** The two memory card slots a PS2 has, as PCSX2.ini numbers them. */
const SLOTS = [1, 2]
/** What PCSX2 puts in the slots where its configuration says nothing. */
const SLOT_DEFAULTS: Readonly<Record<string, string>> = {
  Slot1_Enable: 'true',
  Slot1_Filename: 'Mcd001.ps2',
  Slot2_Enable: 'true',
  Slot2_Filename: 'Mcd002.ps2'
}

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
 * Where PCSX2 keeps this game's saves, given its memory card folder and the
 * folders its configuration may be in.
 *
 * A card kept as one file holds every game's saves, and stays shared. A folder
 * card is a directory with the same name, holding one folder per game named
 * after its serial — `BASLUS-20312…` — and those folders are this game's.
 *
 * The game writes to the cards in its slots, which the configuration names —
 * see `slotCards`. Where it cannot be read, or names no card that is there yet,
 * any folder card may be one of them.
 * Of several, the one already holding this game's folders is the one it writes
 * to. Where that is not exactly one card, nothing says which the game will use,
 * so the folder stays shared.
 */
export function pcsx2Saves(
  ctx: SaveContext,
  dir: string | null,
  reason: Text,
  configDirs: readonly string[]
): Pick<SavePaths, 'saves' | 'unsyncableReason'> {
  if (!dir) return { saves: null }
  let cards = ctx.env
    .dirs(dir)
    .filter((name) => CARD.test(name))
    .sort()
  if (cards.length === 0) return { saves: shared(dir), unsyncableReason: reason }

  const serial = ps2Serial(ctx.env, ctx.romPath)
  if (!serial) return { saves: shared(dir), unsyncableReason: 'saves.pcsx2NoSerial' }

  const slotted = slotCards(ctx.env, configDirs, serial)
  if (slotted) {
    const inSlots = cards.filter((card) => slotted.includes(card))
    const files = ctx.env.files(dir)
    if (inSlots.length > 0) {
      cards = inSlots
    } else if (slotted.some((card) => files.includes(card))) {
      // The game's cards are kept as files, whatever folder cards sit beside them.
      return { saves: shared(dir), unsyncableReason: reason }
    }
  }

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

/**
 * The cards in this game's enabled slots, by file name: `[MemoryCards]` in
 * `inis/PCSX2.ini`, PCSX2's defaults where it says nothing, under what the
 * game's own settings in `gamesettings/` change.
 *
 * Those are named after the serial and the executable's CRC, which the disc
 * does not give up as cheaply, so every file for the serial is read, and where
 * they disagree the answer is null. A file kept for one revision of a game is
 * taken for every revision of that serial.
 *
 * Null too where no configuration is found, or more than one is and nothing
 * says which install runs, or the slots are all off.
 */
function slotCards(
  env: SaveEnvironment,
  configDirs: readonly string[],
  serial: string
): string[] | null {
  const found = configDirs.filter((dir) => env.exists(joinPath(dir, 'inis', 'PCSX2.ini')))
  if (found.length !== 1) return null
  const [configDir] = found
  const main = env.text(joinPath(configDir, 'inis', 'PCSX2.ini'))
  if (main === null) return null
  const base = { ...SLOT_DEFAULTS, ...iniSection(main, 'MemoryCards') }

  const settings = joinPath(configDir, 'gamesettings')
  const answers = new Set<string>()
  for (const name of env.files(settings)) {
    if (!name.startsWith(`${serial}_`) || !name.toLowerCase().endsWith('.ini')) continue
    const own = env.text(joinPath(settings, name))
    if (own === null) return null
    answers.add(JSON.stringify(enabled({ ...base, ...iniSection(own, 'MemoryCards') })))
  }
  if (answers.size > 1) return null
  const [answer] = answers
  const cards = answer === undefined ? enabled(base) : (JSON.parse(answer) as string[])
  return cards.length > 0 ? cards : null
}

function enabled(section: Record<string, string>): string[] {
  return SLOTS.filter((slot) => section[`Slot${slot}_Enable`]?.toLowerCase() === 'true')
    .map((slot) => section[`Slot${slot}_Filename`])
    .filter((name): name is string => Boolean(name))
}

/** The `key = value` lines under `[section]` of an INI file. */
function iniSection(text: string, section: string): Record<string, string> {
  const values: Record<string, string> = {}
  let inside = false
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[(.*)\]\s*$/.exec(line)
    if (header) {
      inside = header[1].trim() === section
      continue
    }
    const pair = /^\s*([^=;#]+?)\s*=\s*(.*?)\s*$/.exec(line)
    if (inside && pair) values[pair[1]] = pair[2]
  }
  return values
}
