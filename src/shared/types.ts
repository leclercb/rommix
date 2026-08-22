/**
 * Types mirroring the RomM 5.1.0 API (verified against a live instance's
 * /openapi.json) plus RomMix's own local state.
 *
 * Only the fields RomMix actually uses are modelled; RomM returns a great
 * deal more per ROM (per-provider metadata blobs, sibling roms, ...).
 */

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
}

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
  status: string | null
}

/** `RomMetadataSchema` — merged metadata across providers. */
export interface RommRomMetadata {
  genres: string[]
  franchises: string[]
  companies: string[]
  game_modes: string[]
  age_ratings: string[]
  player_count: string
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

/** GET /api/collections (`CollectionSchema`). */
export interface RommCollection {
  id: number
  name: string
  description: string
  /** Every ROM in it. Present on the list response, not only on one collection. */
  rom_ids: number[]
  rom_count: number
  path_cover_small: string | null
  path_cover_large: string | null
  is_virtual: boolean
  is_favorite: boolean
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
  md5_hash: string
  missing_from_fs: boolean
  created_at: string
  updated_at: string
}

/** Query parameters RomMix passes to GET /api/roms. */
export interface RomQuery {
  search_term?: string
  platform_ids?: number[]
  collection_id?: number
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
 */
export type RomStorage = 'emulator' | 'rommix'

/**
 * The `InstalledRom.emulatorId` recorded for a game in RomMix's shared tree.
 *
 * Not an emulator, on purpose: with shared storage there may not be one — the
 * whole point is that a Switch game can be downloaded before Eden is installed.
 * A sentinel rather than an empty string so the index has something to compare
 * against when the setting changes, and the detail screen has something to
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
  /** Ask for confirmation before deleting a downloaded game. */
  confirmUninstall: boolean
  /**
   * Ask before anything is sent to RomM — both the Push saves button and the
   * automatic upload when a game exits.
   *
   * Off by default: pushing is additive — RomM keeps every version — so it is
   * not the kind of destructive action `confirmUninstall` guards. It is here
   * for the case where seeing *what* is about to be sent matters: a shared RomM
   * account, or an emulator whose save location RomMix resolved by heuristic
   * and which is worth checking before it lands on the server.
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
  /** Every file that makes up the game; one entry for an ordinary single ROM. */
  files: string[]
  /** ES-DE system id — the folder name, and RomMix's internal platform key. */
  system: string
  /** RomM's display name for the platform, e.g. "Sega Mega Drive". */
  platformName: string
  fileName: string
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

export type DownloadState = 'queued' | 'downloading' | 'extracting' | 'done' | 'error' | 'cancelled'

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
  targetPath: string
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
  /** When RomM last saw it change, ISO. Null when only this device has it. */
  updatedAt: string | null
  sync: SaveSyncState
}

/** Result of an explicit save pull or push from the detail screen. */
export interface SaveSyncResult {
  saves: number
  states: number
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
  } | null
}

/** What `saves.push` would send, asked before it is sent. */
export interface SavePushPreview {
  files: PendingSave[]
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
  inFlatpak: boolean
  canSpawnHost: boolean
  emulators: EmulatorState[]
  /** True when every installed emulator's ROM folder can be written to. */
  romsWritable: boolean
  /** The log file, so a bug report can name the file rather than hunt for it. */
  logPath: string
  notes: string[]
}
