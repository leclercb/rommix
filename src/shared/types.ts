/**
 * Types mirroring the RomM 5.1.0 API (verified against a live instance's
 * /openapi.json) plus Rommix's own local state.
 *
 * Only the fields Rommix actually uses are modelled; RomM returns a great
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

/** Query parameters Rommix passes to GET /api/roms. */
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
// Rommix local state
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

/** Which emulator front-end Rommix hands the ROM to. */
export type RunnerKind = 'retrodeck' | 'retroarch'

export interface RunnerInfo {
  kind: RunnerKind
  /** Flatpak application id. */
  appId: string
  available: boolean
  /** Absolute paths discovered for this runner. */
  paths: EmulationPaths
}

export interface EmulationPaths {
  home: string | null
  roms: string | null
  saves: string | null
  states: string | null
  bios: string | null
}

export interface Settings {
  /** Preferred runner; Rommix falls back to whichever is installed. */
  preferredRunner: RunnerKind
  /** Override the auto-discovered ROM/save/state roots. */
  pathOverrides: Partial<EmulationPaths>
  /** RomM platform slug -> ES-DE system folder name. Overrides the built-in map. */
  systemOverrides: Record<string, string>
  /** Pull newer saves down from RomM before launching. */
  syncSavesDown: boolean
  /** Push saves/states back to RomM after the game exits. */
  syncSavesUp: boolean
  /** Delete the local ROM file when uninstalling from the detail screen. */
  confirmUninstall: boolean
  /** Stable identifier reported to RomM as this device. */
  deviceId: string
  deviceName: string
}

/** A ROM that exists on local disk. */
export interface InstalledRom {
  romId: number
  /** Absolute path to the file (or the game directory for multi-file ROMs). */
  path: string
  system: string
  fileName: string
  sizeBytes: number
  installedAt: string
  /** Set when the ROM was installed as an extracted directory. */
  isDirectory: boolean
}

export type DownloadState = 'queued' | 'downloading' | 'extracting' | 'done' | 'error' | 'cancelled'

export interface DownloadItem {
  romId: number
  name: string
  system: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number
  error: string | null
  targetPath: string
}

export interface LaunchResult {
  ok: boolean
  runner: RunnerKind | null
  command: string
  error: string | null
  /** Saves/states uploaded to RomM after the session ended. */
  uploadedSaves: number
  uploadedStates: number
  playSeconds: number
}

/** Result of the pre-flight check shown on the Settings screen. */
export interface DiagnosticsReport {
  inFlatpak: boolean
  canSpawnHost: boolean
  runners: RunnerInfo[]
  activeRunner: RunnerKind | null
  romsWritable: boolean
  notes: string[]
}
