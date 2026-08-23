import { app } from 'electron'
import { Blob } from 'node:buffer'
import { createWriteStream } from 'node:fs'
import { readFile, rename, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  RommCollection,
  RommDeviceAuthInit,
  RommDeviceAuthToken,
  RommFirmware,
  RommPlatform,
  RommRom,
  RommRomPage,
  RommSave,
  RommState,
  RommTokenResponse,
  RommUser,
  RomQuery
} from '@shared/types'
import { log } from './log'
import type { Store } from './store'

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

/** Strip trailing slashes so we can concatenate paths safely. */
export function normaliseBaseUrl(input: string): string {
  let url = input.trim()
  if (!url) throw new RommError('Server address is empty')
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
    if (!server) throw new RommError('No RomM server configured')
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
      throw new RommError(`Cannot reach ${base}: ${(cause as Error).message}`)
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
    if (res.status === 401) return new RommError('Not authorised — sign in again', 401)
    if (res.status === 403) return new RommError(`Permission denied: ${detail}`, 403)
    return new RommError(`RomM returned ${res.status}: ${detail}`, res.status)
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
      if (res.status === 401) throw new RommError('Wrong username or password', 401)
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
      if (!refreshToken) throw new RommError('Session expired — sign in again', 401)

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
        throw new RommError('Session expired — sign in again', 401)
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
    const res = await this.request(`/api/collections/${collection.id}/roms`, {
      method: favourite ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rom_ids: [romId] })
    })
    if (!res.ok) throw await this.toError(res)
    log.info('romm', favourite ? 'added to favourites' : 'removed from favourites', {
      romId,
      collectionId: collection.id
    })
    return favourite
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
   */
  async downloadRom(
    rom: RommRom,
    destination: string,
    onProgress: (progress: DownloadProgress) => void,
    signal: AbortSignal
  ): Promise<void> {
    const path = `/api/roms/${rom.id}/content/${encodeURIComponent(rom.fs_name)}`
    const res = await this.request(path, { signal })
    if (!res.ok) throw await this.toError(res)
    if (!res.body) throw new RommError('RomM returned an empty response body')

    const total = Number(res.headers.get('content-length') ?? 0) || rom.fs_size_bytes
    let received = 0

    const partial = `${destination}.part`
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    source.on('data', (chunk: Buffer) => {
      received += chunk.length
      onProgress({ received, total })
    })

    const took = log.since()
    try {
      await pipeline(source, createWriteStream(partial), { signal })
      await rename(partial, destination)
      log.info('romm', 'ROM content downloaded', {
        romId: rom.id,
        bytes: received,
        ms: took(),
        destination
      })
    } catch (cause) {
      // Distinguished here rather than upstream: a cancelled transfer and a
      // broken one look identical by the time the queue sees the exception.
      const detail = { romId: rom.id, received, total, ms: took() }
      if (signal.aborted) log.info('romm', 'ROM download cancelled', detail)
      else log.error('romm', 'ROM download failed', cause, detail)
      await rm(partial, { force: true }).catch(() => undefined)
      throw cause
    }
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
    if (!res.body) throw new RommError('Empty asset body')
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
