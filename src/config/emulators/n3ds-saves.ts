import { directory, joinPath } from './savepaths.ts'
import type { SaveContext, SaveEnvironment, SavePaths } from './savepaths.ts'

/**
 * Finding one game's saves in a Citra-lineage emulator's emulated SD card.
 *
 * Azahar, Lime3DS and Citra keep a 3DS game's save data in the same tree a
 * console would write to its SD card:
 *
 *     <sdmc>/Nintendo 3DS/<id0>/<id1>/title/<high 8>/<low 8>/data/
 *
 * Nothing in that path is the ROM's name, and the title id is declared by the
 * game itself, so it is read out of the ROM rather than guessed from where it
 * was filed. Only the front of the file is needed, and it is never encrypted:
 * an NCSD or NCCH header is plain even on a dump whose contents are not.
 *
 * A title id that cannot be resolved is no title id at all rather than a guess.
 * Writing a pulled save under the wrong one would put another game's data where
 * this game looks for its own.
 */

/** A console id or a user id: a raw 128-bit id, no separators. */
const ID_DIR = /^[0-9A-Fa-f]{32}$/
/** Where the tree starts under the emulated SD card. */
const CONSOLE_DIR = 'Nintendo 3DS'
/**
 * The ids an emulator writes under on a clean install, which are all zeros.
 *
 * Used when neither level exists yet, since a save restored before the first
 * launch is the ordinary case on a new machine and the emulator will create
 * exactly these.
 */
const DEFAULT_ID = '0'.repeat(32)

/**
 * How much of the ROM is read to find the id.
 *
 * Both an NCSD and an NCCH carry the id inside their first 0x200 bytes. A CIA
 * keeps it in the TMD, which sits behind a header, a certificate chain and a
 * ticket, so that is read in a second, exact, step instead.
 */
const HEADER_BYTES = 0x200

/** Where the container's own magic is, in both an NCSD and an NCCH. */
const MAGIC_OFFSET = 0x100
/** The media id of an NCSD, which is the title id of the game it holds. */
const NCSD_ID_OFFSET = 0x108
/** The program id of an NCCH: the title id of the application it carries. */
const NCCH_ID_OFFSET = 0x118

/** The CIA header's fields, and the alignment its sections are laid out on. */
const CIA_HEADER_BYTES = 0x2020
const CIA_ALIGNMENT = 0x40
const CIA_CERTS_SIZE = 0x08
const CIA_TICKET_SIZE = 0x0c
const CIA_TMD_SIZE = 0x10

/** The title id's place within a TMD, past the signature and the fields before it. */
const TMD_ID_OFFSET = 0x4c
/** What a TMD's signature takes, by its type: the signature itself, then padding. */
const SIGNATURE_BYTES: Readonly<Record<number, number>> = {
  0x010000: 0x200 + 0x3c,
  0x010001: 0x100 + 0x3c,
  0x010002: 0x3c + 0x40,
  0x010003: 0x200 + 0x3c,
  0x010004: 0x100 + 0x3c,
  0x010005: 0x3c + 0x40
}

/** A TMD's fixed header, which holds the title id at `TMD_ID_OFFSET`. */
const TMD_HEADER_BYTES = 0xc4

/**
 * The top half of a title id, which says what kind of title it is.
 *
 * Only an application has save data under its own id. A patch's saves are the
 * application's, so it is mapped to the application it patches; DLC and system
 * titles are not games, and a download-play child or demo keeps its own.
 */
const APPLICATION = '00040000'
const DOWNLOAD_PLAY = '00040001'
const DEMO = '00040002'
const PATCH = '0004000E'

const SAVING_KINDS: ReadonlySet<string> = new Set([APPLICATION, DOWNLOAD_PLAY, DEMO])

/** Containers an id is read out of, by the extension that names them. */
const CONTAINERS: readonly string[] = ['.3ds', '.cci', '.cxi', '.app', '.cia']

/**
 * The title id this ROM declares, as `<high 8><low 8>` in upper-case hex, or
 * null.
 *
 * Three formats carry one: an NCSD (`.3ds`, `.cci`), a bare NCCH (`.cxi`,
 * `.app`) and a CIA. A `.3dsx` is homebrew, which has no title id and keeps no
 * save in the tree. A patch's id is reduced to its application's — the save is
 * the game's, and an update dumped beside it resolves to the same folder.
 */
export function n3dsTitleId(env: SaveEnvironment, romPath: string): string | null {
  const lower = romPath.toLowerCase()
  if (!CONTAINERS.some((extension) => lower.endsWith(extension))) return null

  const header = env.head(romPath, HEADER_BYTES)
  if (!header || header.length < HEADER_BYTES) return ciaTitleId(env, romPath, header)

  const magic = header.slice(MAGIC_OFFSET, MAGIC_OFFSET + 4)
  if (magic === 'NCSD') return savingId(littleEndianId(header, NCSD_ID_OFFSET))
  if (magic === 'NCCH') return savingId(littleEndianId(header, NCCH_ID_OFFSET))
  return ciaTitleId(env, romPath, header)
}

/** The id a CIA's TMD states, or null where the file is not a CIA that parses. */
function ciaTitleId(env: SaveEnvironment, path: string, header: string | null): string | null {
  if (!header || header.length < CIA_TMD_SIZE + 4 || u32(header, 0) !== CIA_HEADER_BYTES) {
    return null
  }

  if (u32(header, CIA_TMD_SIZE) < TMD_HEADER_BYTES) return null

  const certs = u32(header, CIA_CERTS_SIZE)
  const ticket = u32(header, CIA_TICKET_SIZE)
  const tmdAt = align(align(CIA_HEADER_BYTES) + align(certs) + ticket)

  const signed = env.read(path, tmdAt, 4)
  const signature = signed?.length === 4 ? SIGNATURE_BYTES[bigEndian32(signed, 0)] : undefined
  if (signature === undefined) return null

  const at = tmdAt + 4 + signature + TMD_ID_OFFSET
  const id = env.read(path, at, 8)
  return id?.length === 8 ? savingId(bigEndianId(id, 0)) : null
}

function align(value: number): number {
  return Math.ceil(value / CIA_ALIGNMENT) * CIA_ALIGNMENT
}

/** The id to file saves under, or null for a title that has no saves of its own. */
function savingId(id: string): string | null {
  const high = id.slice(0, 8)
  const kind = high === PATCH ? APPLICATION : high
  if (!SAVING_KINDS.has(kind)) return null
  return `${kind}${id.slice(8)}`
}

function u32(bytes: string, at: number): number {
  return (
    (bytes.charCodeAt(at) |
      (bytes.charCodeAt(at + 1) << 8) |
      (bytes.charCodeAt(at + 2) << 16) |
      (bytes.charCodeAt(at + 3) << 24)) >>>
    0
  )
}

function bigEndian32(bytes: string, at: number): number {
  return (
    ((bytes.charCodeAt(at) << 24) |
      (bytes.charCodeAt(at + 1) << 16) |
      (bytes.charCodeAt(at + 2) << 8) |
      bytes.charCodeAt(at + 3)) >>>
    0
  )
}

/** Eight bytes as an id, the last byte first: how an NCSD and an NCCH store it. */
function littleEndianId(bytes: string, at: number): string {
  const half = (offset: number): string => u32(bytes, offset).toString(16).padStart(8, '0')
  return `${half(at + 4)}${half(at)}`.toUpperCase()
}

/** Eight bytes as an id in the order written: how a TMD stores it. */
function bigEndianId(bytes: string, at: number): string {
  const half = (offset: number): string => bigEndian32(bytes, offset).toString(16).padStart(8, '0')
  return `${half(at)}${half(at + 4)}`.toUpperCase()
}

/**
 * The `<id0>/<id1>` directory holding this title's saves.
 *
 * One candidate is the answer. Of several, one that already has this title
 * beats the "most recently written" heuristic outright: a tree imported from a
 * console can hold more than one, and the most recently played would be the
 * wrong one for a game that has never been run under it. Where no console has
 * been written yet, the default ids stand.
 */
function userDir(env: SaveEnvironment, sdmc: string, titleId: string): string {
  const root = joinPath(sdmc, CONSOLE_DIR)
  const candidates = env
    .dirs(root)
    .filter((name) => ID_DIR.test(name))
    .flatMap((id0) =>
      env
        .dirs(joinPath(root, id0))
        .filter((name) => ID_DIR.test(name))
        .map((id1) => joinPath(root, id0, id1))
    )
  if (candidates.length === 0) return joinPath(root, DEFAULT_ID, DEFAULT_ID)
  if (candidates.length === 1) return candidates[0]

  const owning = candidates.filter((dir) => env.exists(titleDir(dir, titleId)))
  return newest(env, owning.length > 0 ? owning : candidates)
}

function newest(env: SaveEnvironment, dirs: readonly string[]): string {
  let best = dirs[0]
  let bestTime = -1
  for (const dir of dirs) {
    const time = env.newest(dir)
    if (time > bestTime) {
      bestTime = time
      best = dir
    }
  }
  return best
}

/** `title/<high>/<low>` for an id, the folder the console files a title's data under. */
function titleDir(user: string, titleId: string): string {
  return joinPath(user, 'title', titleId.slice(0, 8).toLowerCase(), titleId.slice(8).toLowerCase())
}

/**
 * Save paths for one game under a Citra-lineage emulator.
 *
 * `sdmc` is the emulator's emulated SD card. The `data` folder under the
 * title's own is the unit of save data and is synced whole: its files carry no
 * name that ties them to a game. There are no save states here, because a
 * state is the emulator's own file and not part of this tree.
 *
 * Extra data — `extdata`, which a minority of games keep their progress in
 * instead — is keyed by an id the ROM does not declare, so it is left alone
 * rather than guessed at.
 */
export function n3dsSavePaths(
  ctx: SaveContext,
  sdmc: string | null,
  emulatorName: string
): Pick<SavePaths, 'saves' | 'unsyncableReason'> {
  if (!sdmc) return { saves: null }

  const titleId = n3dsTitleId(ctx.env, ctx.romPath)
  if (!titleId) {
    return {
      saves: null,
      unsyncableReason: { key: 'saves.n3dsNoTitleId', params: { emulator: emulatorName } }
    }
  }

  return { saves: directory(joinPath(titleDir(userDir(ctx.env, sdmc, titleId), titleId), 'data')) }
}
