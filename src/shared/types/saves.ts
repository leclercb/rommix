/**
 * Save files and save states on either side of the sync.
 *
 * The most careful part of RomMix's state, and it shows here: several of these
 * exist only to keep "this device has never asked the server" distinguishable
 * from "the server does not have it", because a push made on the wrong one of
 * those overwrites something nobody can get back.
 */

/**
 * Where one save file exists, and whether the two ends agree.
 *
 * Named for what a person would do about it: the three states that are not
 * `synced` are each a candidate for one of the two buttons.
 */
export type SaveSyncState =
  /** Both ends hold it and neither is ahead. Nothing to do. */
  | 'synced'
  /** On disk and on RomM, but played since the upload — push candidate. */
  | 'local-newer'
  /** On RomM more recently than here — pull candidate. */
  | 'remote-newer'
  /** Only on this device. Never uploaded — push candidate. */
  | 'local-only'
  /** Only on RomM. Another device's, or deleted here — pull candidate. */
  | 'remote-only'
  /**
   * On this device, and the server was never asked.
   *
   * Deliberately not `local-only`, which is a claim about both ends: it says
   * RomM has never been given this file, and a screen that says so about a
   * server nobody could reach invites a push that would overwrite whatever is
   * actually up there. This one says only what is known.
   */
  | 'unchecked'

/**
 * Which end a delete clears.
 *
 * One end at a time, never both at once. Clearing both is the safe default
 * only if a save has one meaning; in practice the two ends are two copies a
 * person compares, and the useful actions are on one of them — throw away a
 * corrupt local file and pull RomM's back, or drop a stale server copy and
 * push the one that has been played. A single "delete everywhere" can express
 * neither, and anyone who does want both ends gone can press twice.
 */
export type SaveDeleteScope = 'local' | 'remote'

/**
 * A save or save state belonging to a game, on either side of the sync.
 *
 * One row per file *name*, not per copy: a save the server and this device both
 * hold is a single entry whose `sync` says how they compare. Listing the two
 * ends separately would show a synced save twice and make the interesting
 * case — the file only one side has — look the same as the boring one.
 */
export interface SaveAsset {
  /** RomM's id for it, or null for a file only this device has. */
  id: number | null
  kind: 'save' | 'state'
  fileName: string
  /** The server's size where it has one, the file's own size otherwise. */
  sizeBytes: number
  /**
   * The emulator tag: what RomM recorded as having written it, or — for a file
   * only this device has — the tag it would be uploaded under.
   */
  emulator: string | null
  /**
   * RomM's tag names an emulator this game would not run under, so a pull will
   * leave this row where it is.
   *
   * Only ever true of a state or a directory save: a battery save comes down
   * whatever wrote it — `pullKind` draws that line and `tagDecides` is the one
   * place either side asks about it. Decided in the main process because the
   * renderer knows neither what this device uploads under nor what a pull still
   * accepts, and two answers is how a screen promises a fetch that will not
   * happen.
   *
   * Not a permanent verdict. The tag is compared against the emulator this game
   * is *set* to run under, so changing that changes the answer — which is why
   * the row says "another emulator" rather than anything about being unusable.
   */
  forAnotherEmulator: boolean
  /** The file in the emulator's save tree, when this device has one. */
  localPath: string | null
  /** Its modification time on this device, ISO. Null when only RomM has it. */
  localModifiedAt: string | null
  /**
   * Whether this device uploaded it — null when RomM did not record an origin,
   * which is every state and anything uploaded through the web UI.
   *
   * Also what makes `synced` distinguishable from `remote-newer`: a server copy
   * that is newer than the local file *and* came from here is that same file
   * after its upload, not a change from somewhere else.
   */
  fromThisDevice: boolean | null
  /**
   * What that device is called, when the server still lists it.
   *
   * Null wherever `fromThisDevice` is, and null again for an origin RomM no
   * longer knows — a device since removed, or one that uploaded under an
   * identifier no row carries. "Another device" is what a row falls back to,
   * so the name is an improvement on the answer, never the whole of it.
   */
  originName: string | null
  /** When RomM last saw it change, ISO. Null when only this device has it. */
  updatedAt: string | null
  sync: SaveSyncState
}

/**
 * A game whose saves this device has and RomM has not been given.
 *
 * Written when a session's push fails because the server was not there, and
 * cleared as each game's files go up. Deliberately two fields: what is on the
 * disk is on the disk, and re-reading it when there is a server again is both
 * cheaper and more honest than a list of file names captured in the dark — a
 * save written after the push failed belongs to the same session and would
 * otherwise be missed.
 */
export interface UnsentSaves {
  romId: number
  /**
   * The moment the earliest session in question started, in epoch millis.
   *
   * The same `since` the failed push used, which is what makes the drain send
   * exactly what that push would have: everything the emulator wrote after this
   * instant, and nothing that was already up there before it.
   */
  since: number
}

/**
 * A game with saves still on this device, and why they have not gone up.
 *
 * Two reasons, and they read differently to the person answering: one is RomMix
 * refusing to overwrite something it did not put there, the other is a setting
 * saying every push is a decision. Both can be true of the same game at once,
 * for different files.
 */
export interface SavesWaiting {
  romId: number
  /** Files RomM holds a copy of that this device did not put there. */
  conflicts: number
  /** Files that could go unasked, held back because sending asks first. */
  ready: number
}

/** Result of an explicit save pull or push from the game screen. */
export interface SaveSyncResult {
  saves: number
  states: number
  /**
   * Files the server would not take, on a push.
   *
   * Uploading keeps going past a file that fails — a partial sync beats
   * abandoning the rest — so a count of what arrived cannot be read as a count
   * of what was tried. Anything that decides a save is now safely on RomM has
   * to look here as well, or it will decide it about a file still only on this
   * disk. Always zero for a pull, which has no such half-state.
   */
  failed: number
  /** Set when the emulator's save layout is not one RomMix can sync per game. */
  skippedReason: string | null
}

/**
 * One file an imminent push would send.
 *
 * Everything here is what the *upload* will do, not what is on disk: the name
 * is the one the server will file it under and the emulator is the tag RomM
 * will record, which for a directory save means a single archive standing for a
 * folder of files that have no names of their own.
 */
export interface PendingSave {
  kind: 'save' | 'state'
  /** Name it will carry on RomM. */
  fileName: string
  /** Where it is read from on this device. */
  path: string
  sizeBytes: number
  /** Local modification time, ISO — how you tell a stale save from a fresh one. */
  modifiedAt: string
  /** The emulator tag the upload will carry. */
  emulator: string
  /** True when `path` is a folder that gets zipped into one asset. */
  isDirectory: boolean
  /**
   * The asset already on RomM under this name, when there is one.
   *
   * The point of showing it: RomM keeps both, but the newer of the two is what
   * a later pull brings back — so a push of an older local file is the one case
   * where confirming is worth the interruption.
   */
  replaces: {
    sizeBytes: number
    updatedAt: string
    emulator: string | null
    /** Whether this device uploaded it; null when RomM recorded no origin. */
    fromThisDevice: boolean | null
    /** What that device is called — see `SaveAsset.originName`. */
    originName: string | null
    /**
     * Whether RomM's copy is a change this file does not have.
     *
     * Not the two timestamps compared: `updated_at` is when the copy was
     * uploaded, which is later than the mtime of the very file it was uploaded
     * from, so a push of an untouched save would warn about replacing itself.
     * Decided by the same judgement as `SaveAsset.sync`, which is also what
     * keeps the dialog and the game screen from disagreeing about one pair.
     */
    isNewer: boolean
  } | null
}

/** What `saves.push` would send, asked before it is sent. */
export interface SavePushPreview {
  files: PendingSave[]
  /**
   * Local files left out of `files` because RomM already holds the same copy.
   *
   * What tells an empty list apart from an empty save folder: nothing to send
   * because everything has been sent is not the same answer as nothing to send
   * because there is nothing here.
   */
  inSync: number
  /** Set when this emulator's save layout is not one RomMix can sync per game. */
  skippedReason: string | null
  /** The device name RomM will record against the upload. */
  deviceName: string
}
