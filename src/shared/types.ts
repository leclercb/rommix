/**
 * Types mirroring the RomM 5.1.0 API (verified against a live instance's
 * /openapi.json) plus RomMix's own local state.
 *
 * Only the fields RomMix actually uses are modelled; RomM returns a great
 * deal more per ROM (per-provider metadata blobs, sibling roms, ...).
 */

import type { DateFormat } from './i18n/dates.ts'
import type { LanguageChoice } from './i18n/locales.ts'

// ---------------------------------------------------------------------------
// RomM API
// ---------------------------------------------------------------------------

/** POST /api/token response (`TokenResponse`). */
export interface RommTokenResponse {
  access_token: string
  token_type: string
  expires: number
  refresh_token?: string
  refresh_expires?: number
}

/** POST /api/auth/device/init response (`DeviceAuthInitResponse`). */
export interface RommDeviceAuthInit {
  device_code: string
  user_code: string
  verification_path: string
  verification_path_complete: string
  expires_in: number
  interval: number
}

/** POST /api/auth/device/token response (`DeviceAuthTokenResponse`). */
export interface RommDeviceAuthToken {
  access_token: string
  device_id: string
  scopes: string[]
  expires_at: string | null
}

/**
 * GET /api/devices (`DeviceSchema`), pared to the fields RomMix reads.
 *
 * Two identifiers, and a save's `origin_device_id` can be either: `id` is what
 * RomM issues at pairing and hands back with the token, while
 * `client_device_identifier` is the one the client chose for itself and sent
 * *to* pairing — which is what an unpaired RomMix uploads under. Matching both
 * is what lets a save name the machine it came from in either case.
 */
export interface RommDevice {
  id: string
  name: string | null
  hostname: string | null
  client_device_identifier: string | null
}

/** GET /api/users/me (`UserSchema`). */
export interface RommUser {
  id: number
  username: string
  email: string | null
  enabled: boolean
  role: string
  oauth_scopes: string[]
  avatar_path: string
}

/** GET /api/platforms (`PlatformSchema`). */
export interface RommPlatform {
  id: number
  slug: string
  fs_slug: string
  name: string
  display_name: string
  custom_name: string | null
  rom_count: number
  fs_size_bytes: number
  url_logo: string | null
  missing_from_fs: boolean
}

/** Element of `SimpleRomSchema.files` (`RomFileSchema`). */
export interface RommRomFile {
  id: number
  rom_id: number
  file_name: string
  file_path: string
  file_size_bytes: number
  full_path: string
  category: string | null
  /**
   * What RomM recorded this file hashing to, per file rather than per game.
   *
   * The hashes on the ROM itself answer for a game held as one file and for
   * nothing else — a game of several is fetched a file at a time, and these are
   * what say each one arrived intact. Null where RomM has not scanned the file.
   */
  crc_hash: string | null
  md5_hash: string | null
  sha1_hash: string | null
}

/**
 * How far through a game the user says they are.
 *
 * RomM's own five, by the names it stores them under. Set from the game screen
 * and kept on the server, so the answer is the same in a browser and on another
 * device — which is the whole reason it is not a RomMix-local flag.
 */
export type RomUserStatus =
  'incomplete' | 'finished' | 'completed_100' | 'retired' | 'never_playing'

/** `RomUserSchema` — the per-user overlay on a ROM. */
export interface RommRomUser {
  id: number
  rom_id: number
  last_played: string | null
  now_playing: boolean
  backlogged: boolean
  hidden: boolean
  rating: number
  difficulty: number
  completion: number
  /** Null until somebody has said. See `RomUserStatus`. */
  status: RomUserStatus | null
}

/** `RomMetadataSchema` — merged metadata across providers. */
export interface RommRomMetadata {
  genres: string[]
  franchises: string[]
  companies: string[]
  game_modes: string[]
  age_ratings: string[]
  player_count: string
  /**
   * When the game came out, in epoch milliseconds — not the seconds IGDB
   * returns, which RomM multiplies on the way into this merged view. See its
   * `0045_roms_metadata_update` migration, which does it for every provider.
   */
  first_release_date: number | null
  average_rating: number | null
}

/** GET /api/roms items (`SimpleRomSchema`) and GET /api/roms/{id} (`DetailedRomSchema`). */
export interface RommRom {
  id: number
  name: string | null
  slug: string | null
  summary: string | null

  platform_id: number
  platform_slug: string
  platform_fs_slug: string
  platform_display_name: string

  fs_name: string
  fs_name_no_ext: string
  fs_name_no_tags: string
  fs_extension: string
  fs_path: string
  fs_size_bytes: number

  path_cover_small: string | null
  path_cover_large: string | null
  url_cover: string | null
  path_video: string | null

  regions: string[]
  languages: string[]
  tags: string[]
  revision: string | null

  crc_hash: string | null
  md5_hash: string | null
  sha1_hash: string | null

  has_simple_single_file: boolean
  has_nested_single_file: boolean
  has_multiple_files: boolean
  missing_from_fs: boolean

  metadatum: RommRomMetadata
  rom_user: RommRomUser
  files: RommRomFile[]
  merged_screenshots: string[]

  created_at: string
  updated_at: string
}

/** GET /api/roms envelope (`CustomLimitOffsetPage_SimpleRomSchema_`). */
export interface RommRomPage {
  items: RommRom[]
  total: number
  limit: number
  offset: number
}

/**
 * What every kind of collection has in common (`BaseCollectionSchema`).
 *
 * RomM has two, on two endpoints, and they differ in one field that matters:
 * a collection somebody made has an integer id and can be written to, and one
 * RomM derived has a string id like `genre/platform` and cannot.
 */
export interface RommCollectionBase {
  name: string
  description: string
  /** Every ROM in it. Present on the list response, not only on one collection. */
  rom_ids: number[]
  rom_count: number
  /** Artwork uploaded for the collection itself, if any. */
  path_cover_small: string | null
  path_cover_large: string | null
  /**
   * Covers of the first few games on it, which is what RomM draws a shelf with
   * when nobody uploaded artwork for it. Empty for a collection with none.
   */
  path_covers_small: string[]
  path_covers_large: string[]
  is_virtual: boolean
  is_favorite: boolean
}

/** GET /api/collections (`CollectionSchema`) — the ones the user made. */
export interface RommCollection extends RommCollectionBase {
  id: number
}

/**
 * GET /api/collections/virtual (`VirtualCollectionSchema`) — the ones RomM
 * derives from metadata: one per genre, franchise, company, play mode.
 *
 * The id is a string, and it goes to `/api/roms` as `virtual_collection_id`
 * rather than `collection_id`. Nothing can be added to one by hand, which is
 * the whole of why the two are separate types rather than one with a flag.
 */
export interface RommVirtualCollection extends RommCollectionBase {
  id: string
  /** What it was derived from: `genre`, `franchise`, `company`, `mode`. */
  type: string
}

/** GET /api/saves (`SaveSchema`). */
export interface RommSave {
  id: number
  rom_id: number
  user_id: number
  file_name: string
  file_name_no_ext: string
  file_extension: string
  file_size_bytes: number
  download_path: string
  emulator: string | null
  slot: string | null
  /** The RomM device that uploaded it, when the upload named one. */
  origin_device_id?: string | null
  created_at: string
  updated_at: string
}

/** GET /api/states (`StateSchema`). */
export interface RommState {
  id: number
  rom_id: number
  user_id: number
  file_name: string
  file_name_no_ext: string
  file_extension: string
  file_size_bytes: number
  download_path: string
  emulator: string | null
  created_at: string
  updated_at: string
}

/**
 * GET /api/firmware (`FirmwareSchema`) — the BIOS files held by the server.
 *
 * Note the absence of a platform id: RomM stores one on the row but does not
 * put it in the response, so which platform a file belongs to is only knowable
 * from the `?platform_id=` used to ask. That is why RomMix queries firmware per
 * platform rather than fetching the lot and grouping it.
 */
export interface RommFirmware {
  id: number
  file_name: string
  file_name_no_ext: string
  file_extension: string
  file_size_bytes: number
  /** True once RomM has matched the file against its known-good hashes. */
  is_verified: boolean
  /** Null until RomM has scanned the file, the same as every other hash here. */
  md5_hash: string | null
  missing_from_fs: boolean
  created_at: string
  updated_at: string
}

/** Query parameters RomMix passes to GET /api/roms. */
export interface RomQuery {
  search_term?: string
  platform_ids?: number[]
  collection_id?: number
  /** A collection RomM derived. Its id is a string — see `RommVirtualCollection`. */
  virtual_collection_id?: string
  favorite?: boolean
  last_played?: boolean
  order_by?: string
  order_dir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

// ---------------------------------------------------------------------------
// RomMix local state
// ---------------------------------------------------------------------------

export type AuthMode = 'password' | 'device' | 'token'

export interface ServerConfig {
  /** Base URL with no trailing slash, e.g. https://romm.example.org */
  baseUrl: string
  authMode: AuthMode
  username?: string
}

export interface ConnectionStatus {
  connected: boolean
  /**
   * A server is stored and so are credentials for it, whatever it answered.
   *
   * What separates a fresh installation from one that has simply lost its
   * server: the first has nowhere to go but the sign-in screen, the second has
   * a disk full of games and no reason to be asked to sign in again.
   */
  configured: boolean
  /**
   * Signed in as far as this device knows, and nothing answered.
   *
   * The state the rest of the interface changes shape for — see the games
   * screen. Deliberately not simply `!connected`: credentials RomM refuses are
   * an answer, and the only thing that fixes them is the sign-in screen, so a
   * refusal is never offline however unreachable it feels.
   */
  offline: boolean
  baseUrl: string | null
  user: RommUser | null
  /** RomM version reported by /api/heartbeat, when available. */
  serverVersion: string | null
  error: string | null
}

/**
 * Emulators are described by the registry in `@config/emulators`, not by a
 * union here; these are re-exported so the rest of the app has one import for
 * "RomMix's types".
 */
export type {
  BiosContext,
  BiosTarget,
  EmulationPaths,
  EmulatorDescriptor,
  EmulatorDispatch,
  EmulatorId,
  EmulatorState,
  ResolvedInstall
} from '../config/emulators/types.ts'
export type { SaveEnvironment } from '../config/emulators/savepaths.ts'

import type { EmulatorId, EmulatorState } from '../config/emulators/types.ts'

/**
 * Where downloaded games are written.
 *
 * `emulator` puts each game in the ROM folder of whichever emulator runs its
 * platform. That is what makes a download visible in the emulator's own game
 * list when it is started outside RomMix, and it is why a platform pointed at a
 * different emulator stops counting as downloaded — the file is still there,
 * in a tree the new emulator never reads.
 *
 * `rommix` puts everything in one tree inside RomMix's folder, which the user
 * adds to each emulator's game directories once. It costs that setup step and
 * buys two things back: changing which emulator runs a platform moves nothing
 * and re-downloads nothing, and a game can be fetched for a platform that has
 * no emulator installed at all — a Switch library is worth having on disk
 * before Eden is.
 *
 * `rommix` is the default. The setup step is a one-off that the pre-flight
 * check spells out; the re-download `emulator` costs is paid every time somebody
 * changes their mind about which emulator runs a platform, which is a thing
 * Settings actively invites.
 */
export type RomStorage = 'emulator' | 'rommix'

/**
 * The `InstalledRom.emulatorId` recorded for a game in RomMix's shared tree.
 *
 * Not an emulator, on purpose: with shared storage there may not be one — the
 * whole point is that a Switch game can be downloaded before Eden is installed.
 * A sentinel rather than an empty string so the index has something to compare
 * against when the setting changes, and the game screen has something to
 * print.
 */
export const SHARED_LIBRARY = 'rommix:shared'

export interface Settings {
  /**
   * ES-DE system -> emulator id: which emulator runs each platform.
   *
   * Only systems the user has actually chosen for are stored; anything absent
   * uses `defaultEmulatorFor()`. A recorded choice is honoured strictly — an
   * emulator that is not installed is reported rather than silently swapped.
   */
  systemEmulators: Record<string, EmulatorId>
  /**
   * Emulator id -> absolute path of its executable, when auto-discovery cannot
   * find it. AppImages in particular live wherever the user put them.
   */
  emulatorPaths: Record<EmulatorId, string>
  /**
   * Emulator id -> the folder holding that emulator's library, when the user
   * has moved it somewhere RomMix does not find on its own.
   *
   * One root rather than four paths: RetroDECK and EmuDeck each keep roms,
   * saves, states and BIOS in one relocatable tree, and the reason to set this
   * — the library lives on an SD card or a second drive — moves all of them at
   * once. The names below it come from the descriptor's `layout.relative`.
   */
  emulatorRoots: Record<EmulatorId, string>
  /**
   * `<emulator id>:<es-de system>` -> launch variant id.
   *
   * For emulators that offer more than one way to run a system — EmuDeck's
   * three Saturn cores, its four Switch emulators. Recorded the first time the
   * user is asked, so the question is not repeated before every game.
   */
  systemLaunchers: Record<string, string>
  /** RomM platform slug -> ES-DE system folder name. Overrides the built-in map. */
  systemOverrides: Record<string, string>
  /**
   * Emulator ids, most preferred first.
   *
   * The order decides which emulator runs a platform when that platform has no
   * choice of its own: the first one in this list that is installed and covers
   * it. Empty means the registry's own order, and any emulator missing from the
   * list keeps its registry position behind those named here — so a list
   * written before an emulator existed does not hide it.
   */
  emulatorPriority: EmulatorId[]
  /** Where downloaded games are written. See `RomStorage`. */
  romStorage: RomStorage
  /**
   * True once the first-run wizard has been completed.
   *
   * Separate from "is there a server configured", which is what the connect
   * screen used to infer this from. Signing out clears the server and would
   * otherwise put someone who has been using RomMix for months back through a
   * page asking how big they would like the text — the wizard is about choices
   * made once, not about being disconnected.
   */
  setupComplete: boolean
  /** Pull newer saves down from RomM before launching. */
  syncSavesDown: boolean
  /** Push saves/states back to RomM after the game exits. */
  syncSavesUp: boolean
  /**
   * A quiet click as focus moves, and when something is chosen or left.
   *
   * On by default: RomMix is driven from a sofa, where the highlight is often
   * on the far side of the screen from what is being looked at, and the click
   * is what says a press landed. Off is for a room where it would be heard by
   * somebody who is not playing. See `playCue`.
   */
  navigationSounds: boolean
  /** Ask for confirmation before deleting a downloaded game. */
  confirmUninstall: boolean
  /**
   * Ask before anything is sent to RomM — both the Push saves button and the
   * automatic upload when a game exits.
   *
   * On by default, not because pushing is destructive — RomM keeps every
   * version — but because this dialog is the only place RomMix says what it is
   * about to put on the server under this game's id. Where the saves came from
   * was resolved per emulator, partly by heuristic, and a wrong answer is worth
   * catching here rather than on another device that pulls it down. It costs
   * one press, and that press can be `Send and don't ask again`.
   *
   * The two pushes ask the same question from different sides. The button knows
   * its answer before it does anything; the automatic one has already run, so
   * the launch hands its file list back as `LaunchResult.pendingPush` and
   * uploads nothing until the renderer sends the approved paths to
   * `saves:pushSelected`. Declining costs nothing either way — the files stay
   * where the emulator wrote them, and the button sends everything on disk.
   */
  confirmSavePush: boolean
  /**
   * Notices the user has said they do not want again, by key.
   *
   * Kept as a list of opaque keys rather than a flag per notice so that adding
   * one later needs no migration: an unknown key simply means "not dismissed".
   */
  dismissedNotices: string[]
  /**
   * How much larger than its drawn size the interface is rendered, or 0 for
   * "match the screen".
   *
   * The stylesheet is written in CSS pixels for a 1080p television, so on a 4K
   * one — which hands Chromium 3840x2160 CSS pixels rather than scaling
   * anything itself — every size in it comes out half as large as it was drawn
   * to be. 0 measures the screen and picks the factor; a number states it,
   * for a panel whose reported size does not match how far away it is sat from.
   */
  uiScale: number
  /**
   * Which language the interface is drawn in, or `auto` to follow the desktop.
   *
   * One setting for both processes: the main process translates its own
   * messages — a failed launch, a BIOS that cannot be placed — before they
   * cross IPC, so an error and the screen it lands on are never in two
   * different languages. See `LanguageChoice`.
   */
  language: LanguageChoice
  /**
   * How every date and time RomMix shows is written. See `DATE_FORMATS`.
   *
   * Separate from `language`, because the two answer different questions: one
   * is what RomMix speaks, the other is what a date is expected to look like,
   * and plenty of people read an interface in one language and dates in the
   * order another writes them.
   */
  dateFormat: DateFormat
  /**
   * What RomMix does about a new version of itself. See `UpdatePolicy`.
   *
   * `auto` by default. RomMix ships as an AppImage, which nothing on the
   * machine updates for you: without this, a copy downloaded once stays at that
   * version until its owner happens to look at the releases page again.
   */
  updates: UpdatePolicy
  /**
   * Whether a release published for testing counts as a new version.
   *
   * Off. A candidate is tagged with a suffix — `0.9.0-rc.1` — and marked as a
   * pre-release on GitHub, which is what keeps it out of the release the
   * updater asks for by default; turning this on is how somebody volunteers to
   * run one. See `Updater.check`.
   */
  updatePrereleases: boolean
  /** Stable identifier reported to RomM as this device. */
  deviceId: string
  deviceName: string
}

/** A ROM that exists on local disk. */
export interface InstalledRom {
  romId: number
  /** Absolute path to the file (or the game directory for multi-file ROMs). */
  path: string
  /**
   * The file to hand an emulator. Equal to `path` for a single file; for a
   * multi-file game it is the disc descriptor or playlist inside the
   * directory, because emulators cannot be given a directory.
   */
  launchPath: string
  /**
   * The game's name as RomM knows it. Recorded at install time because the
   * Downloads screen has only this index to work from — it never fetches the
   * library — and a filename is a poor substitute for a title.
   */
  name: string
  /** RomM cover path, for the same reason. Null when the game has no artwork. */
  coverPath: string | null
  /**
   * Every file the game is made of, relative to `path` where that is a
   * directory, and one entry for an ordinary single ROM.
   *
   * Recorded by whatever put the game there — see `unpack` and `adopt` — rather
   * than read back off the folder afterwards. A listing taken later is a
   * listing of whatever is in there now, which for a game RomMix installed is
   * the same thing only for as long as nothing else writes beside it.
   */
  files: string[]
  /** ES-DE system id — the folder name, and RomMix's internal platform key. */
  system: string
  /** RomM's display name for the platform, e.g. "Sega Mega Drive". */
  platformName: string
  sizeBytes: number
  installedAt: string
  /** Set when the ROM was installed as an extracted directory. */
  isDirectory: boolean
  /**
   * The emulator whose library this copy was written into.
   *
   * Each emulator keeps its games in its own tree, so a ROM downloaded for
   * RetroDECK is simply not present for Eden. Recording which emulator was
   * current at install time is what lets RomMix stop claiming a game is
   * downloaded after the platform has been pointed at a different emulator —
   * the file is still on disk, but not where the emulator now in charge looks.
   *
   */
  emulatorId: EmulatorId
}

export type DownloadState =
  | 'queued'
  | 'downloading'
  | 'extracting'
  /**
   * Interrupted, with what has arrived so far still on disk.
   *
   * Not an error: a transfer RomMix could not finish is a transfer to pick up
   * again, and on a television that is usually a matter of the network coming
   * back rather than of anything the user has to fix. It stays in the list —
   * across restarts, see `PendingDownload` — until it finishes or is cancelled.
   */
  | 'paused'
  /**
   * Stopped because nothing answered, rather than because anybody asked.
   *
   * What makes a queue survive a network going away: the transfer that was on
   * the wire and every one waiting behind it stop for the same reason, and none
   * of them needs a person to press anything to carry on — see
   * `DownloadManager.resumeAfterOutage`. Its own state rather than a flag
   * beside `paused`, so that a finished transfer cannot also be waiting for a
   * server; what the two have in common is `isStopped`.
   *
   * Only ever the server being unreachable. A refusal, an unsafe name and a
   * failed hash check all stay stopped until somebody looks at them.
   */
  | 'stalled'
  | 'done'
  | 'error'
  | 'cancelled'

/**
 * Stopped with its bytes kept, whoever stopped it.
 *
 * The question nearly every screen is actually asking: such a row is in the
 * active list, is amber, and offers to be finished. Which of the two it is
 * matters in two places only — whether it says "Paused" or "Waiting for RomM",
 * and whether it starts itself again — so everywhere else asks this instead,
 * and a third stopped state would cost one line rather than twenty.
 */
export function isStopped(state: DownloadState): boolean {
  return state === 'paused' || state === 'stalled'
}

export interface DownloadItem {
  romId: number
  name: string
  /** RomM cover path, so the queue and its notifications can show the game. */
  coverPath: string | null
  system: string
  /** RomM's display name for the platform, e.g. "Sega Mega Drive". */
  platformName: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number
  error: string | null
  /**
   * The file arriving right now, for a game fetched one file at a time.
   *
   * A multi-disc game is twenty minutes of a progress bar that says only
   * "Downloading"; which of its three tracks is on the wire is the one thing
   * that moves. Absent for a game that arrives as a single file, where the name
   * would only repeat the game's own.
   */
  currentFile?: string
  /**
   * Whether this transfer could be picked up again if it stopped.
   *
   * Undefined until the server has been asked, which happens as the transfer
   * starts — see `RommClient.supportsRange` and `fileTransfers`. False for a
   * server that will not serve part of a file, where stopping a transfer means
   * losing it; the screen offers Pause only where the answer is yes.
   */
  resumable?: boolean
}

/**
 * A download that was interrupted, as it is remembered between runs.
 *
 * The bytes themselves are the part-downloaded files on disk; this is what says
 * whose they are. Without it a restart leaves a large file that nothing on
 * screen accounts for and nothing will ever finish — so the record and the
 * files are written and removed together.
 *
 * `fileName` is what the server called the game when the transfer started, and
 * is checked before anything is appended: a ROM replaced in the meantime is a
 * different file, and resuming onto it would produce a game that looks complete
 * and does not run.
 */
export interface PendingDownload {
  romId: number
  name: string
  coverPath: string | null
  system: string
  platformName: string
  /**
   * Where the bytes are going: the file itself for a game fetched in one piece,
   * the directory holding them for one fetched file by file.
   */
  targetPath: string
  /**
   * The files the game is made of, for a transfer that fetches them one at a
   * time. Empty for one that does not, where `targetPath` is the whole of it.
   */
  files: string[]
  /**
   * Whether `targetPath` is a directory this game has to itself.
   *
   * It is for a disc set given a folder of its own, and it is not for a game
   * whose files go loose into the system folder beside every other game on the
   * platform. What hangs on it is what a cancelled transfer takes with it: its
   * own folder goes, a shared one obviously cannot.
   */
  ownsFolder: boolean
  fileName: string
  totalBytes: number
  /**
   * Which of the two stopped states this transfer is in.
   *
   * The record has no state of its own — it only ever describes a transfer that
   * stopped — but *how* it stopped has to survive with it, because the two
   * answer for different spans of time. The queue row lasts as long as RomMix
   * is running, and an outage easily outlives that: a handheld carried out of
   * range, closed, and opened again at home. Restored, this is what lets the
   * queue pick itself up on the first start that has a server rather than
   * asking somebody to press Resume once per game for a stop nobody chose.
   *
   * Absent on a record written before this field existed, which reads as the
   * cautious answer: paused, and waiting to be asked.
   */
  stoppedAs?: 'paused' | 'stalled'
}

/**
 * The ways the emulator for a game can run it, and which one is already
 * settled. `options` has fewer than two entries when there is nothing to ask.
 */
export interface LaunchChoice {
  system: string
  emulatorId: EmulatorId
  emulatorName: string
  /** Setup this emulator needs done by hand. See `EmulatorDescriptor.setupNotes`. */
  setupNotes: string[]
  options: { id: string; label: string; note?: string }[]
  /** The recorded choice, or null if the user has not been asked yet. */
  chosen: string | null
}

export interface LaunchResult {
  ok: boolean
  emulator: EmulatorId | null
  command: string
  error: string | null
  /** Saves/states uploaded to RomM after the session ended. */
  uploadedSaves: number
  uploadedStates: number
  /**
   * What the session wrote, waiting to be confirmed — set only when
   * `confirmSavePush` is on, and null when there is nothing to send.
   *
   * The automatic push does not happen in that case; the files are listed here
   * instead, and `saves.pushSelected` sends whichever of them the user
   * approves. Uploading first and asking afterwards would make the question
   * pointless, and blocking the main process on a dialog would hold the session
   * open for as long as nobody answers it.
   */
  pendingPush: SavePushPreview | null
  playSeconds: number
}

/** What a "sync downloaded games" pass changed. */
export interface LibrarySyncResult {
  /** ROMs on the server that were checked against the disk. */
  checked: number
  /** Entries dropped because the file they pointed at is gone. */
  removed: number
  /** ROMs found sitting on disk that the index did not know about. */
  adopted: number
}

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

/** One BIOS file for a platform, and whether it is in place. */
export interface BiosItem {
  fileName: string
  /** What the file is for, from the BIOS table; null for an unrecognised extra. */
  note: string | null
  required: boolean
  /** Present where it belongs already. */
  installed: boolean
  /**
   * The folder this file goes in, absolute, or null when there is nowhere to
   * put it. Not always the platform's `biosDir`: an emulator that cannot take
   * a file directly has it staged in RomMix's own `bios/<system>` instead.
   */
  dir: string | null
  /** True when `dir` is RomMix's staging folder rather than the emulator's. */
  staged: boolean
  /** RomM firmware id, or null when the server does not hold this file. */
  firmwareId: number | null
  sizeBytes: number
  /** RomM verified the file against its known-good hashes. */
  verified: boolean
}

/** A platform's BIOS situation: where files go, what is there, what is missing. */
export interface BiosPlatform {
  platformId: number
  /** RomM's own slug, which is also how its platform icons are named. */
  platformSlug: string
  platformName: string
  /** ES-DE system, or null when the platform has no mapping. */
  system: string | null
  /** The emulator whose BIOS folder RomMix would install into. */
  emulatorId: EmulatorId | null
  emulatorName: string | null
  /** Absolute BIOS folder, or null when there is no usable emulator. */
  biosDir: string | null
  /** Set when some of this platform's files had to be staged: what to do about them. */
  stagingNote: string | null
  items: BiosItem[]
  /** Why nothing can be installed for this platform, phrased for the screen. */
  blockedReason: string | null
  /**
   * How this platform's BIOS works, when there is more to it than the files
   * listed. See `BiosRequirement.setupNote`.
   */
  setupNote: string | null
}

export interface BiosReport {
  platforms: BiosPlatform[]
}

/** What a "sync all BIOS" pass installed. */
export interface BiosSyncResult {
  installed: number
  failed: number
  /** Files RomM does not hold, so nothing could be fetched for them. */
  unavailable: number
}

/** A downloadable file attached to an emulator release. */
export interface EmulatorAsset {
  name: string
  url: string
  /** 0 when the release API does not report it, which Eden's does not. */
  sizeBytes: number
  /**
   * What the release states it published, or null where it states nothing.
   *
   * Carried rather than re-read at install time: the download is a separate
   * call from the listing, and the digest has to describe the same asset the
   * user chose. See `verifyDownload`.
   */
  digest: { algorithm: 'sha256' | 'sha512'; expected: string } | null
}

/** One release of an emulator RomMix can install itself. */
export interface EmulatorRelease {
  tag: string
  name: string
  prerelease: boolean
  publishedAt: string | null
  /** Only assets RomMix can actually run; never empty. */
  assets: EmulatorAsset[]
}

/** Emitted on `emulators:progress` while an emulator is downloading. */
export interface EmulatorInstallProgress {
  emulatorId: EmulatorId
  assetName: string
  receivedBytes: number
  totalBytes: number
  /** Set instead of byte counts when the installer reports text, as flatpak does. */
  message?: string
}

/**
 * What RomMix does about a new version of itself.
 *
 * Three answers rather than a switch, because "check but leave it to me" is a
 * real position and not a half-off: a handheld on a metered connection wants to
 * be told about a release without a hundred megabytes arriving behind it, and
 * `off` is for an installation somebody else's package manager owns.
 */
export type UpdatePolicy =
  /** Check, fetch, and swap the image in on the next start. */
  | 'auto'
  /** Check and say so; download only when asked. */
  | 'notify'
  /** Never check on its own. The button in Settings still works. */
  | 'off'

/** Where RomMix's update of *itself* has got to. See `Updater`. */
export type UpdateState =
  /** Nothing to do: never checked, or checked and already current. */
  | 'idle'
  | 'checking'
  /** A newer version is published and has not been fetched yet. */
  | 'available'
  | 'downloading'
  /** Downloaded and in place; the next start runs it. */
  | 'ready'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  /** The version running now, from `app.getVersion()`. */
  current: string
  /** The newest published version, once a check has found one. */
  latest: string | null
  /** The release notes, as GitHub holds them. Null when the release has none. */
  notes: string | null
  /** The release page, which is the way out when RomMix cannot update itself. */
  url: string | null
  receivedBytes: number
  /** 0 until the download starts and the server declares a length. */
  totalBytes: number
  /**
   * Where the downloaded image landed, once there is one.
   *
   * Shown rather than kept quiet: the new file is named for its version, so
   * updating leaves a different filename in the folder, and anyone who made a
   * shortcut by hand needs to see that.
   */
  readyPath: string | null
  /**
   * Why this copy of RomMix cannot replace itself — a development run, or a
   * build that is not an AppImage. Null when it can.
   *
   * A check still runs and still reports a new version: knowing one exists is
   * useful even where the fix is to download it by hand.
   */
  blockedReason: string | null
  /**
   * Why RomMix cannot restart *itself* into the new version, when it cannot.
   *
   * A separate question from `blockedReason`, and it has a different answer
   * under Steam: the image is replaced perfectly well there, but relaunching is
   * what Steam will not have. Quitting normally and pressing Play again is the
   * whole of the fix, so this says so rather than offering a button that would
   * end the session and start nothing.
   */
  restartBlocked: string | null
  error: string | null
  /** When the last check finished, ISO. Null before the first one. */
  checkedAt: string | null
}

/** Where RomMix keeps everything it owns. */
export interface RootLocation {
  current: string
  /** What it would be with nothing configured. */
  fallback: string
  /** Set by ROMMIX_HOME, which overrides the stored pointer and cannot be changed here. */
  fromEnvironment: boolean
}

/** Result of the pre-flight check shown on the Settings screen. */
export interface DiagnosticsReport {
  /**
   * Whether `flatpak` is on the machine at all.
   *
   * RomMix does not need it for itself, but most of the emulators it drives are
   * distributed that way, and without it they all report themselves missing for
   * a reason nothing else on the screen would explain.
   */
  flatpakAvailable: boolean
  /**
   * Whether Flathub is a remote of the *user* installation, which is the one
   * RomMix installs into.
   *
   * A separate answer from `flatpakAvailable` because it fails separately and
   * far less visibly: Debian, Ubuntu and Arch ship flatpak with no remotes, and
   * Fedora's Flathub is filtered until enabled. On any of those, every emulator
   * reports itself missing while the row above says flatpak is fine. RomMix adds
   * the remote itself on first install; this is what says so before then.
   */
  flathubConfigured: boolean
  emulators: EmulatorState[]
  /** True when every installed emulator's ROM folder can be written to. */
  romsWritable: boolean
  /** The log file, so a bug report can name the file rather than hunt for it. */
  logPath: string
  notes: string[]
}
