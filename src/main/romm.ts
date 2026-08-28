import { app } from 'electron'
import { Blob } from 'node:buffer'
import { createWriteStream } from 'node:fs'
import { readFile, rename, rm, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  RommCollection,
  RommVirtualCollection,
  RommDeviceAuthInit,
  RommDeviceAuthToken,
  RommFirmware,
  RommPlatform,
  RommRom,
  RommRomFile,
  RommRomPage,
  RommSave,
  RommState,
  RommTokenResponse,
  RommUser,
  RomQuery
} from '@shared/types'
import { i18n, t } from './i18n.ts'
import { log } from './log.ts'
import type { Store } from './store.ts'

/**
 * Client for the RomM 5.1.0 REST API.
 *
 * Auth: RomM accepts a Bearer JWT from the OAuth2 password grant, a long-lived
 * `rmm_...` client token, or HTTP basic. RomMix uses the first two — a JWT pair
 * that it silently refreshes, or a client token that never expires. Device
 * pairing (POST /api/auth/device/init) yields a client token without ever
 * typing a password on a controller, which is the path the TV UI prefers.
 */

/**
 * Scopes RomMix needs: browse the library, sync saves, record play state, and
 * read the BIOS files the server holds.
 *
 * `collections.write` is what favouriting costs. RomM has no per-ROM favourite
 * flag — see `setFavourite` — so the star writes a collection, and without the
 * scope every press comes back 403 from a token that looks otherwise healthy.
 */
export const REQUIRED_SCOPES = [
  'me.read',
  'roms.read',
  'roms.user.read',
  'roms.user.write',
  'platforms.read',
  'collections.read',
  'collections.write',
  'assets.read',
  'assets.write',
  'devices.read',
  'devices.write',
  'firmware.read'
]

export class RommError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message)
    this.name = 'RommError'
  }
}

export interface DownloadProgress {
  received: number
  total: number
}

/**
 * How many times a broken ROM transfer is picked up again before it is called a
 * failure.
 *
 * Enough that a connection dropped repeatedly still finishes a large game — the
 * usual shape is a proxy cutting every response at the same point, so each
 * attempt carries the same amount further — and few enough that a server which
 * is simply gone is reported rather than retried all evening.
 */
const RESUME_ATTEMPTS = 5

/** A pause between attempts, so a server refusing everything is not hammered. */
const RESUME_DELAY_MS = 500

/**
 * How long a transfer may deliver nothing before RomMix gives up on it and
 * asks again.
 *
 * Not every broken connection is closed. A VPN switched on or off, a handheld
 * that moved between access points, a router rebooted — each leaves a socket
 * that is not refused and simply never delivers another byte, and the only
 * thing that ends it otherwise is a timeout meant for a slow server rather than
 * a dead route, minutes away. Timing it here turns those into the same brief
 * interruption as a closed connection, resumed from the same place.
 *
 * Generous, because it is measured against silence rather than against slowness:
 * a ROM crawling in at a few kilobytes a second is still arriving, and only a
 * transfer that has stopped completely reaches this.
 */
const STALL_TIMEOUT_MS = 20_000

/** What a caller can say about one transfer. */
interface TransferOptions {
  /** Continue the `.part` already on disk rather than replacing it. */
  resume?: boolean
  /**
   * Whether what is being fetched can be resumed at all. See `supportsRange`.
   *
   * A transfer that cannot be is handled the opposite way round in both places
   * it matters. It is never given up on for going quiet, because the socket
   * recovering is the only way the download survives — a stalled connection
   * that comes back has cost nothing, while abandoning it costs everything
   * transferred so far. And a break is a failure rather than something to try
   * again, because trying again means fetching the whole thing a second time,
   * which is not a decision to take on the user's behalf on a metered
   * connection.
   */
  resumable?: boolean
}

/** Where a transfer in progress is written. The file itself appears only once
 * it is whole. */
export function partialPathOf(destination: string): string {
  return `${destination}.part`
}

/** Strip trailing slashes so we can concatenate paths safely. */
export function normaliseBaseUrl(input: string): string {
  let url = input.trim()
  if (!url) throw new RommError(t('error.serverAddressEmpty'))
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  const parsed = new URL(url)
  // A user pasting the RomM web UI URL often includes a path; keep it, but drop
  // a trailing /api which we add ourselves.
  parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/api$/, '')
  return parsed.toString().replace(/\/+$/, '')
}

export class RommClient {
  /** Guards against several 401s triggering parallel refreshes. */
  private refreshInFlight: Promise<void> | null = null

  constructor(private readonly store: Store) {}

  private get baseUrl(): string {
    const server = this.store.server
    if (!server) throw new RommError(t('error.noServerConfigured'))
    return server.baseUrl
  }

  // -- request plumbing -----------------------------------------------------

  private authHeader(): Record<string, string> {
    const { clientToken, accessToken } = this.store.credentials
    const token = clientToken ?? accessToken
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  /**
   * Perform a request against the configured server. On a 401 with a refresh
   * token available, refresh once and replay the request.
   */
  private async request(
    path: string,
    init: RequestInit = {},
    opts: { baseUrl?: string; retryOn401?: boolean } = {}
  ): Promise<Response> {
    const base = opts.baseUrl ?? this.baseUrl
    const retryOn401 = opts.retryOn401 ?? true
    const method = init.method ?? 'GET'

    const send = async (): Promise<Response> =>
      fetch(`${base}${path}`, {
        ...init,
        headers: { Accept: 'application/json', ...this.authHeader(), ...(init.headers ?? {}) }
      })

    // Every call to the server, with what came back. The path carries the query
    // string, so this doubles as the record of what RomMix asked *for* — which
    // page of the library, which ROM's saves, which platform's firmware.
    const took = log.since()
    let res: Response
    try {
      res = await send()
    } catch (cause) {
      log.error('romm', `${method} ${path} could not be sent`, cause, { baseUrl: base })
      throw new RommError(t('error.cannotReach', { url: base, reason: (cause as Error).message }))
    }

    if (res.status === 401 && retryOn401 && this.store.credentials.refreshToken) {
      log.info('romm', `${method} ${path} → 401, refreshing the access token and retrying`)
      await this.refreshAccessToken()
      res = await send()
    }

    const line = `${method} ${path} → ${res.status}`
    if (res.ok) log.debug('romm', line, { ms: took() })
    else log.warn('romm', line, { ms: took(), baseUrl: base })
    return res
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path, init)
    if (!res.ok) throw await this.toError(res)
    return (await res.json()) as T
  }

  private async toError(res: Response): Promise<RommError> {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown; msg?: unknown }
      const raw = body.detail ?? body.msg
      if (typeof raw === 'string') detail = raw
      else if (raw) detail = JSON.stringify(raw)
    } catch {
      // non-JSON error body; statusText is the best we have
    }
    if (res.status === 401) return new RommError(t('error.notAuthorised'), 401)
    if (res.status === 403) return new RommError(t('error.permissionDenied', { detail }), 403)
    return new RommError(t('error.rommReturned', { status: res.status, detail }), res.status)
  }

  // -- authentication -------------------------------------------------------

  /** GET /api/heartbeat — also doubles as the "is this actually a RomM server" probe. */
  async heartbeat(baseUrl?: string): Promise<{ version: string | null }> {
    const res = await this.request('/api/heartbeat', {}, { baseUrl, retryOn401: false })
    if (!res.ok) throw await this.toError(res)
    const body = (await res.json()) as { SYSTEM?: { VERSION?: string } }
    const version = body.SYSTEM?.VERSION ?? null
    log.debug('romm', 'heartbeat', { baseUrl: baseUrl ?? this.baseUrl, serverVersion: version })
    return { version }
  }

  /** POST /api/token with the OAuth2 password grant. */
  async loginWithPassword(username: string, password: string, baseUrl?: string): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'password',
      username,
      password,
      scope: REQUIRED_SCOPES.join(' ')
    })
    const res = await this.request(
      '/api/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      },
      { baseUrl, retryOn401: false }
    )
    if (!res.ok) {
      log.warn('romm', 'password sign-in refused', { username, status: res.status })
      if (res.status === 401) throw new RommError(t('error.wrongCredentials'), 401)
      throw await this.toError(res)
    }
    const token = (await res.json()) as RommTokenResponse
    log.info('romm', 'signed in with a password', { username, expiresIn: token.expires })
    this.storeToken(token)
  }

  /** Store a long-lived `rmm_...` client token typed in by the user. */
  setClientToken(token: string): void {
    log.info('romm', 'using a client token typed in by the user')
    this.store.setCredentials({
      clientToken: token.trim(),
      accessToken: null,
      refreshToken: null,
      expiresAt: null
    })
  }

  /**
   * POST /api/auth/device/init — start the pairing flow.
   *
   * Returns a short user code the player types into the RomM web UI on their
   * phone or desktop; no password is ever entered on the TV.
   */
  async startDevicePairing(baseUrl?: string): Promise<RommDeviceAuthInit> {
    const { deviceId, deviceName } = this.store.settings
    log.info('romm', 'starting device pairing', {
      deviceId,
      deviceName,
      clientVersion: app.getVersion(),
      scopes: REQUIRED_SCOPES
    })
    const res = await this.request(
      '/api/auth/device/init',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_device_identifier: deviceId,
          name: deviceName,
          client: 'rommix',
          platform: 'linux',
          // From the packaged app, not the environment: npm_package_version is
          // only set when RomMix is started through npm, so a real install
          // would have reported a made-up version forever.
          client_version: app.getVersion(),
          requested_scopes: REQUIRED_SCOPES
        })
      },
      { baseUrl, retryOn401: false }
    )
    if (!res.ok) throw await this.toError(res)
    return (await res.json()) as RommDeviceAuthInit
  }

  /**
   * POST /api/auth/device/token — exchange the device code once approved.
   * Returns false while the user has not approved yet, so the caller can poll.
   */
  async pollDevicePairing(deviceCode: string, baseUrl?: string): Promise<boolean> {
    const res = await this.request(
      '/api/auth/device/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: deviceCode })
      },
      { baseUrl, retryOn401: false }
    )
    // Still pending: RomM answers 4xx until the user approves in the web UI.
    if (res.status === 400 || res.status === 401 || res.status === 428) return false
    if (!res.ok) throw await this.toError(res)

    const token = (await res.json()) as RommDeviceAuthToken
    log.info('romm', 'device paired', { deviceId: token.device_id, expiresAt: token.expires_at })
    this.store.setCredentials({
      clientToken: token.access_token,
      deviceId: token.device_id,
      accessToken: null,
      refreshToken: null,
      expiresAt: token.expires_at ? Date.parse(token.expires_at) : null
    })
    return true
  }

  private storeToken(token: RommTokenResponse): void {
    this.store.setCredentials({
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: Date.now() + token.expires * 1000,
      clientToken: null
    })
  }

  private async refreshAccessToken(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight

    this.refreshInFlight = (async () => {
      const refreshToken = this.store.credentials.refreshToken
      if (!refreshToken) throw new RommError(t('error.sessionExpired'), 401)

      const res = await fetch(`${this.baseUrl}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        }).toString()
      })
      if (!res.ok) {
        log.warn('romm', 'token refresh refused, credentials cleared', { status: res.status })
        this.store.clearCredentials()
        throw new RommError(t('error.sessionExpired'), 401)
      }
      log.info('romm', 'access token refreshed')
      this.storeToken((await res.json()) as RommTokenResponse)
    })()

    try {
      await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
    }
  }

  // -- library --------------------------------------------------------------

  me(): Promise<RommUser> {
    return this.json<RommUser>('/api/users/me')
  }

  platforms(): Promise<RommPlatform[]> {
    return this.json<RommPlatform[]>('/api/platforms')
  }

  collections(): Promise<RommCollection[]> {
    return this.json<RommCollection[]>('/api/collections')
  }

  /**
   * The shelves RomM derives rather than the ones the user made.
   *
   * A separate endpoint with a separate schema — see `RommVirtualCollection`.
   *
   * `type` is required, and naming one kind would fetch only that kind: there
   * is a shelf per genre, per franchise, per company and per play mode, and
   * RomM's own handler reads `all` as "do not filter". Without it the server
   * answers 422 and the page shows nothing, which is exactly what it did.
   *
   * Only a 404 is answered with silence, and only because it is the one failure
   * that is not a failure: a server too old to have the endpoint has no virtual
   * collections to list, and a page that works is the right outcome.
   *
   * Everything else is thrown, like every other call here. Swallowing the lot
   * was how this shipped with a missing `type` — the server answered 422, the
   * page showed an empty list, and the only evidence was a line in a log nobody
   * had a reason to open. An error the user cannot see is an error nobody can
   * report.
   */
  async virtualCollections(): Promise<RommVirtualCollection[]> {
    try {
      return await this.json<RommVirtualCollection[]>('/api/collections/virtual?type=all')
    } catch (cause) {
      if (cause instanceof RommError && cause.status === 404) {
        log.info('romm', 'this server has no virtual collections endpoint')
        return []
      }
      throw cause
    }
  }

  /**
   * The user's favourites.
   *
   * RomM has no per-ROM favourite flag — /api/roms/{id}/props carries rating,
   * backlog and play status and nothing else — so a favourite is a membership
   * of one ordinary collection, which the server marks `is_favorite` by its
   * name. A user who has never favourited anything has no such collection yet,
   * hence the null.
   */
  async favourites(): Promise<RommCollection | null> {
    const all = await this.collections()
    return all.find((collection) => collection.is_favorite) ?? null
  }

  async isFavourite(romId: number): Promise<boolean> {
    const collection = await this.favourites()
    return collection?.rom_ids.includes(romId) ?? false
  }

  /**
   * Add or remove one game, making the collection on first use.
   *
   * The name is the whole of what makes it the favourites collection: RomM
   * derives `is_favorite` from it, and the create call has no field to set.
   */
  async setFavourite(romId: number, favourite: boolean): Promise<boolean> {
    const existing = await this.favourites()
    // Nothing to remove it from. Creating a collection in order to not put a
    // game in it would leave the user with an empty shelf they never asked for.
    if (!existing && !favourite) return false

    const collection = existing ?? (await this.createFavourites())
    await this.setCollectionMembership(collection.id, romId, favourite)
    return favourite
  }

  /**
   * Put one game in a collection, or take it out.
   *
   * The same two calls favouriting makes, which is what favouriting *is* on
   * RomM — one collection whose name the server reads as `is_favorite`. Named
   * separately because the shelves a user makes for themselves are the general
   * case and the star is the special one, not the other way round.
   */
  async setCollectionMembership(
    collectionId: number,
    romId: number,
    member: boolean
  ): Promise<void> {
    const res = await this.request(`/api/collections/${collectionId}/roms`, {
      method: member ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rom_ids: [romId] })
    })
    if (!res.ok) throw await this.toError(res)
    log.info('romm', member ? 'added to a collection' : 'removed from a collection', {
      romId,
      collectionId
    })
  }

  /** POST /api/collections — multipart, since RomM takes artwork on the same call. */
  private async createFavourites(): Promise<RommCollection> {
    const form = new FormData()
    form.append('name', 'Favourites')
    const res = await this.request('/api/collections', {
      method: 'POST',
      body: form as RequestInit['body']
    })
    if (!res.ok) throw await this.toError(res)
    return (await res.json()) as RommCollection
  }

  roms(query: RomQuery = {}): Promise<RommRomPage> {
    const params = new URLSearchParams()
    if (query.search_term) params.set('search_term', query.search_term)
    for (const id of query.platform_ids ?? []) params.append('platform_ids', String(id))
    if (query.collection_id != null) params.set('collection_id', String(query.collection_id))
    if (query.virtual_collection_id != null) {
      params.set('virtual_collection_id', query.virtual_collection_id)
    }
    if (query.favorite != null) params.set('favorite', String(query.favorite))
    if (query.last_played != null) params.set('last_played', String(query.last_played))
    params.set('order_by', query.order_by ?? 'name')
    params.set('order_dir', query.order_dir ?? 'asc')
    params.set('limit', String(query.limit ?? 60))
    params.set('offset', String(query.offset ?? 0))
    // Always: `files` is what tells RomMix the real name of a ROM the server
    // holds as a folder, and which files a multi-file game is made of. Without
    // it a listing can only offer the folder's name, which matches nothing on
    // disk — so every such game looks un-downloaded however many times the
    // library is reconciled.
    params.set('with_files', 'true')
    return this.json<RommRomPage>(`/api/roms?${params.toString()}`)
  }

  rom(id: number): Promise<RommRom> {
    return this.json<RommRom>(`/api/roms/${id}`)
  }

  /** Streamed asset fetch used by the custom image protocol. */
  async asset(path: string): Promise<Response> {
    const clean = path.startsWith('/') ? path : `/${path}`
    return this.request(clean)
  }

  // -- ROM content ----------------------------------------------------------

  /**
   * GET /api/roms/{id}/content/{file_name}, streamed straight to disk.
   *
   * RomM serves a single-file ROM verbatim and zips anything with multiple
   * files, so the caller decides whether the result needs extracting.
   * Writes to `${destination}.part` and renames on success, so an interrupted
   * download never looks like a complete ROM.
   *
   * A transfer that breaks part-way is picked up where it stopped rather than
   * started again. A ROM is the largest thing RomMix moves and the one most
   * likely to outlive the connection carrying it — a reverse proxy in front of
   * RomM with a response cap or a time limit, a handheld that changed access
   * point, a server restarted mid-copy. Losing a gigabyte to any of those and
   * beginning again is, on a slow link, indistinguishable from RomMix simply
   * being unable to download the game at all. See `RESUME_ATTEMPTS`.
   */
  /**
   * Where one file of a multi-file game is served from.
   *
   * Keyed by the *file's* id rather than the game's, and it is an ordinary file
   * on the server's disk — which is the whole reason RomMix asks for these one
   * at a time. See `downloadRomFile`.
   */
  private fileContentPath(file: RommRomFile): string {
    return `/api/roms/${file.id}/files/content/${encodeURIComponent(file.file_name)}`
  }

  /** Where the whole game is served from, as one file or as an archive. */
  private romContentPath(rom: RommRom): string {
    return `/api/roms/${rom.id}/content/${encodeURIComponent(rom.fs_name)}`
  }

  /**
   * What a ranged request to an endpoint answers, without fetching anything.
   *
   * One byte, asked for by range. `206` means the server can seek into what it
   * is serving and a transfer that breaks can be picked up; `404` means the
   * endpoint is not there at all, which is how a server too old to serve files
   * individually says so; anything else means it is there and cannot be
   * resumed.
   */
  private async probeRange(path: string): Promise<number> {
    const res = await this.request(path, { headers: { Range: 'bytes=0-0' } })
    // Released rather than read: the answer is in the status line, and the body
    // is either one byte or the whole ROM starting to arrive.
    await res.body?.cancel().catch(() => undefined)
    return res.status
  }

  /**
   * Can this game be fetched one file at a time, and can those be resumed?
   *
   * Asked before the transfer rather than discovered during it. What hangs on
   * the answer is not only how a break is handled but what the screen offers: a
   * Pause button on a download that cannot resume is a promise RomMix cannot
   * keep.
   *
   * A probe that fails answers no to both. It is the safe way round — the cost
   * of believing a transfer resumable when it is not is a download thrown away.
   */
  async fileTransfers(rom: RommRom): Promise<{ available: boolean; resumable: boolean }> {
    const file = rom.files[0]
    if (!file || rom.files.length < 2) return { available: false, resumable: false }
    try {
      const status = await this.probeRange(this.fileContentPath(file))
      // Only an answer that actually carried the file counts as this endpoint
      // working. A 404 is a server too old to have it; anything else — a 403, a
      // 500 — is a reason to leave the strategy alone rather than to fetch a
      // game through an endpoint that has just refused one byte of it.
      const answer = { available: status === 206 || status === 200, resumable: status === 206 }
      log.info('romm', 'asked whether this game can be fetched file by file', {
        romId: rom.id,
        files: rom.files.length,
        status,
        ...answer
      })
      return answer
    } catch (cause) {
      log.warn('romm', 'could not tell whether this game can be fetched file by file', {
        romId: rom.id,
        reason: (cause as Error).message
      })
      return { available: false, resumable: false }
    }
  }

  /**
   * Can this ROM be fetched in pieces, or only from the beginning?
   *
   * One byte, asked for by range. A `206` means the server can seek into the
   * file and a transfer that breaks can be picked up; anything else means it
   * cannot, and RomM answers that way for a good reason — a game of several
   * files has no file to seek into, because the zip is built for each request
   * and is not even the same size twice.
   *
   * Asked before the transfer rather than discovered during it. What hangs on
   * the answer is not only how a break is handled but what the screen offers:
   * a Pause button on a download that cannot resume is a promise RomMix cannot
   * keep.
   *
   * A probe that fails answers "no". It is the safe way round: the cost of
   * believing a transfer resumable when it is not is a download thrown away.
   */
  async supportsRange(rom: RommRom): Promise<boolean> {
    try {
      const status = await this.probeRange(this.romContentPath(rom))
      const ranged = status === 206
      log.info('romm', ranged ? 'this ROM can be resumed' : 'this ROM cannot be resumed', {
        romId: rom.id,
        status
      })
      return ranged
    } catch (cause) {
      log.warn('romm', 'could not tell whether this ROM can be resumed', {
        romId: rom.id,
        reason: (cause as Error).message
      })
      return false
    }
  }

  async downloadRom(
    rom: RommRom,
    destination: string,
    onProgress: (progress: DownloadProgress) => void,
    signal: AbortSignal,
    options: TransferOptions = {}
  ): Promise<void> {
    await this.fetchToFile(
      this.romContentPath(rom),
      destination,
      rom.fs_size_bytes,
      { kind: 'ROM', romId: rom.id },
      onProgress,
      signal,
      options
    )
  }

  /**
   * One file of a game made of several, straight to disk.
   *
   * The reason RomMix asks for these one at a time rather than for the archive
   * RomM would build: the archive is generated per request, so the server has
   * nothing to seek into and a transfer that breaks starts again from nothing.
   * These are ordinary files on its disk, so each one resumes — and the sum of
   * them is a few hundred bytes *smaller* than the archive, which only adds zip
   * headers around bytes it does not compress.
   */
  async downloadRomFile(
    file: RommRomFile,
    destination: string,
    onProgress: (progress: DownloadProgress) => void,
    signal: AbortSignal,
    options: TransferOptions = {}
  ): Promise<void> {
    await this.fetchToFile(
      this.fileContentPath(file),
      destination,
      file.file_size_bytes,
      { kind: 'file', romId: file.rom_id, fileName: file.file_name },
      onProgress,
      signal,
      options
    )
  }

  /**
   * Fetch one thing to one path, picking it up again where it breaks.
   *
   * Shared by both of the above, because everything hard about a transfer — the
   * partial file, the range, the stall, the retries — is the same whether what
   * is arriving is a whole ROM or one track of a disc.
   */
  private async fetchToFile(
    path: string,
    destination: string,
    sizeHint: number,
    subject: { kind: string; romId: number; fileName?: string },
    onProgress: (progress: DownloadProgress) => void,
    signal: AbortSignal,
    options: TransferOptions = {}
  ): Promise<number> {
    const resumable = options.resumable !== false
    const attempts = resumable ? RESUME_ATTEMPTS : 1
    const partial = partialPathOf(destination)

    /**
     * Bytes already on disk, kept only when the caller says they belong to
     * what is being fetched now.
     *
     * A `.part` nobody vouched for is of unknown provenance — a different
     * release of the same game, a file the server has since replaced — and
     * appending to it produces a corrupt ROM that looks complete. What makes
     * resuming safe is the queue's own record of what it was downloading; see
     * `PendingDownload`.
     */
    let received = 0
    if (options.resume) received = (await stat(partial).catch(() => null))?.size ?? 0
    else await rm(partial, { force: true }).catch(() => undefined)

    const took = log.since()
    let total = sizeHint
    if (received > 0) {
      log.info('romm', 'resuming a transfer that was part-done', { ...subject, received, total })
      onProgress({ received, total })
    }

    for (let attempt = 1; ; attempt += 1) {
      // One controller per attempt: it carries the caller's cancellation and
      // the stall timeout below, so the transfer can be given up on without the
      // caller having asked for anything.
      const attemptStopped = new AbortController()
      const relay = (): void => attemptStopped.abort()
      signal.addEventListener('abort', relay, { once: true })
      let idle: NodeJS.Timeout | null = null
      const waitForBytes = (): void => {
        if (!resumable) return
        if (idle) clearTimeout(idle)
        idle = setTimeout(() => attemptStopped.abort(), STALL_TIMEOUT_MS)
        idle.unref()
      }

      try {
        if (signal.aborted) attemptStopped.abort()
        waitForBytes()
        const res = await this.request(path, {
          signal: attemptStopped.signal,
          headers: received > 0 ? { Range: `bytes=${received}-` } : {}
        })
        if (!res.ok) throw await this.toError(res)
        if (!res.body) throw new RommError(t('error.emptyResponseBody'))

        /**
         * Whether the server honoured the range, which only a 206 says.
         *
         * A server that ignores it answers 200 with the whole file, and
         * appending that to what is already on disk is how a resumed download
         * silently produces a ROM twice the size it should be. So the bytes
         * already fetched are thrown away instead and the attempt starts over.
         */
        const resumed = received > 0 && res.status === 206
        if (received > 0 && !resumed) {
          log.warn('romm', 'the server ignored the range, starting again', {
            ...subject,
            status: res.status,
            discarded: received
          })
          await rm(partial, { force: true }).catch(() => undefined)
          received = 0
        }

        // On a 206 the length is what is left to come, not the whole size.
        const declared = Number(res.headers.get('content-length') ?? 0)
        total = (resumed ? received + declared : declared) || sizeHint

        const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
        source.on('data', (chunk: Buffer) => {
          received += chunk.length
          waitForBytes()
          onProgress({ received, total })
        })

        await pipeline(source, createWriteStream(partial, { flags: resumed ? 'a' : 'w' }), {
          signal: attemptStopped.signal
        })
        break
      } catch (cause) {
        // Cancelling is not a failure to retry: the user asked for it, and the
        // two look identical by the time the queue sees the exception. What
        // happens to the part-downloaded file is the queue's decision, not this
        // one's — cancelling throws it away, an interruption keeps it.
        if (signal.aborted) {
          log.info('romm', 'transfer cancelled', { ...subject, received, total, ms: took() })
          throw cause
        }

        if (attempt >= attempts) {
          log.error('romm', 'transfer failed', cause, {
            ...subject,
            received,
            total,
            attempts: attempt,
            ms: took()
          })
          // Said in RomMix's own words rather than passed on. What arrives here
          // is whatever the network layer called it — undici says `terminated`
          // for a connection that died mid-response — and that word on its own,
          // in red, over a download that was going fine, explains nothing.
          //
          // Sized the way the rest of the interface sizes things: this sentence
          // is read beside a progress bar counting in gigabytes, and a raw byte
          // count is a number nobody converts in their head.
          const size = i18n().formatBytes
          throw new RommError(
            t('error.downloadInterrupted', { received: size(received), total: size(total) })
          )
        }

        // What actually reached the disk, which is behind what the stream
        // counted: the chunks in flight when the connection died were reported
        // to `onProgress` and never written. Resuming from the counter would
        // leave a hole in the middle of the file.
        received = (await stat(partial).catch(() => null))?.size ?? 0
        onProgress({ received, total })
        log.warn('romm', 'the transfer broke, picking it up again', {
          ...subject,
          received,
          total,
          attempt,
          reason: (cause as Error).message
        })
        await new Promise((resolve) => setTimeout(resolve, RESUME_DELAY_MS))
      } finally {
        if (idle) clearTimeout(idle)
        signal.removeEventListener('abort', relay)
      }
    }

    await rename(partial, destination)
    log.info('romm', 'content downloaded', { ...subject, bytes: received, ms: took(), destination })
    return received
  }

  // -- firmware (BIOS) ------------------------------------------------------

  /**
   * GET /api/firmware — the BIOS files uploaded to RomM, for one platform or
   * all of them.
   *
   * RomM is the only source RomMix will fetch a BIOS from. They are neither
   * freely distributable nor safe to guess at, so "install the BIOS" means
   * "copy the one you put on your own server into the emulator that needs it".
   */
  firmware(platformId?: number): Promise<RommFirmware[]> {
    const query = platformId != null ? `?platform_id=${platformId}` : ''
    return this.json<RommFirmware[]>(`/api/firmware${query}`)
  }

  async downloadFirmware(item: RommFirmware, destination: string): Promise<void> {
    await this.downloadAsset(
      `/api/firmware/${item.id}/content/${encodeURIComponent(item.file_name)}`,
      destination
    )
    log.info('romm', 'firmware downloaded', {
      firmwareId: item.id,
      fileName: item.file_name,
      destination
    })
  }

  // -- saves and states -----------------------------------------------------

  saves(romId: number): Promise<RommSave[]> {
    return this.json<RommSave[]>(`/api/saves?rom_id=${romId}`)
  }

  states(romId: number): Promise<RommState[]> {
    return this.json<RommState[]>(`/api/states?rom_id=${romId}`)
  }

  /**
   * POST /api/saves/delete — remove save files from the server.
   *
   * A POST taking a list rather than a DELETE per id: RomM's own shape, and the
   * one that stays honest when a screen ever deletes several at once.
   */
  async deleteSaves(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return
    const res = await this.request('/api/saves/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saves: ids })
    })
    if (!res.ok) throw await this.toError(res)
    log.info('romm', 'saves deleted on the server', { ids })
  }

  /** POST /api/states/delete — the same, for save states. */
  async deleteStates(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return
    const res = await this.request('/api/states/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ states: ids })
    })
    if (!res.ok) throw await this.toError(res)
    log.info('romm', 'states deleted on the server', { ids })
  }

  async downloadSave(id: number, destination: string): Promise<void> {
    await this.downloadAsset(`/api/saves/${id}/content`, destination)
  }

  async downloadState(id: number, destination: string): Promise<void> {
    await this.downloadAsset(`/api/states/${id}/content`, destination)
  }

  private async downloadAsset(path: string, destination: string): Promise<void> {
    const res = await this.request(path)
    if (!res.ok) throw await this.toError(res)
    if (!res.body) throw new RommError(t('error.emptyAssetBody'))
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    await pipeline(source, createWriteStream(destination))
  }

  /** POST /api/saves — multipart upload of a save file produced by the emulator. */
  async uploadSave(
    romId: number,
    filePath: string,
    fileName: string,
    emulator: string | null
  ): Promise<RommSave> {
    const params = new URLSearchParams({ rom_id: String(romId), overwrite: 'true' })
    if (emulator) params.set('emulator', emulator)
    const deviceId = this.store.credentials.deviceId ?? this.store.settings.deviceId
    if (deviceId) params.set('device_id', deviceId)

    const payload = await readFile(filePath)
    const form = new FormData()
    form.append('saveFile', new Blob([payload]) as unknown as Blob, fileName)

    log.info('romm', 'uploading a save', {
      romId,
      fileName,
      emulator,
      deviceId,
      bytes: payload.length,
      from: filePath
    })
    const res = await this.request(`/api/saves?${params.toString()}`, {
      method: 'POST',
      body: form as RequestInit['body']
    })
    if (!res.ok) throw await this.toError(res)
    const saved = (await res.json()) as RommSave
    log.info('romm', 'save uploaded', { romId, saveId: saved.id, fileName })
    return saved
  }

  /** POST /api/states — multipart upload of a save state. */
  async uploadState(
    romId: number,
    filePath: string,
    fileName: string,
    emulator: string | null
  ): Promise<RommState> {
    const params = new URLSearchParams({ rom_id: String(romId) })
    if (emulator) params.set('emulator', emulator)

    const payload = await readFile(filePath)
    const form = new FormData()
    form.append('stateFile', new Blob([payload]) as unknown as Blob, fileName)

    log.info('romm', 'uploading a save state', {
      romId,
      fileName,
      emulator,
      bytes: payload.length,
      from: filePath
    })
    const res = await this.request(`/api/states?${params.toString()}`, {
      method: 'POST',
      body: form as RequestInit['body']
    })
    if (!res.ok) throw await this.toError(res)
    const saved = (await res.json()) as RommState
    log.info('romm', 'save state uploaded', { romId, stateId: saved.id, fileName })
    return saved
  }

  /** POST /api/play-sessions — report time played so RomM's stats stay honest. */
  async reportPlaySession(romId: number, startedAt: Date, seconds: number): Promise<void> {
    if (seconds < 5) {
      log.debug('romm', 'play session too short to report', { romId, seconds })
      return
    }
    const deviceId = this.store.credentials.deviceId ?? this.store.settings.deviceId
    log.info('romm', 'reporting a play session', {
      romId,
      deviceId,
      startedAt: startedAt.toISOString(),
      seconds
    })
    try {
      await this.request('/api/play-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          sessions: [
            {
              rom_id: romId,
              start_time: startedAt.toISOString(),
              end_time: new Date(startedAt.getTime() + seconds * 1000).toISOString()
            }
          ]
        })
      })
    } catch (cause) {
      // Play-time reporting is best-effort; never fail a launch over it.
      log.warn('romm', 'could not report the play session', {
        romId,
        reason: (cause as Error).message
      })
    }
  }
}
