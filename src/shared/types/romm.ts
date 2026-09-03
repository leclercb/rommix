/**
 * The RomM 5.1.0 API, as RomMix reads it.
 *
 * Verified against a live instance's /openapi.json. Only the fields RomMix
 * actually uses are modelled; RomM returns a great deal more per ROM
 * (per-provider metadata blobs, sibling roms, ...).
 *
 * Every name here is the server's, spelling and all — `fs_name`, `md5_hash`,
 * `is_favorite` — so that a field can be looked up in RomM's own schema
 * without a translation step in between. RomMix's own state is written the
 * other way, in the rest of this folder.
 */

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
  /**
   * How many the query matches, where the server counted them.
   *
   * Null since RomM 5.2.0, which stopped promising a count. Nothing may decide
   * whether to ask for another page by counting up to this — see `hasMorePages`
   * — because `checked < null` is false, and a pass that walks the library
   * would stop after its first page and call the job done.
   */
  total: number | null
  limit: number
  offset: number
}

/**
 * Is there another page after this one?
 *
 * A page that came back full is a page the server had to stop filling, so
 * there is more behind it; a short one is the end. That holds whatever `total`
 * says, and whether it says anything at all — which is why it is asked this way
 * rather than by comparing what has been fetched against a count.
 *
 * The limit is the server's own echo of what was asked for, so a server that
 * caps a page lower than the caller wanted still ends the walk in the right
 * place.
 */
export function hasMorePages(page: RommRomPage): boolean {
  return page.items.length >= page.limit
}

/**
 * What every kind of collection has in common — RomMix's own factoring of
 * `CollectionSchema` and `VirtualCollectionSchema`, which each carry all of it.
 *
 * RomM has two, on two endpoints, and they differ in one field that matters:
 * a collection somebody made has an integer id and can be written to, and one
 * RomM derived has a string id like `genre/platform` and cannot. There is no
 * base schema on the server to point at — the two are flattened — so this is
 * checked against both.
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
