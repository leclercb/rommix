import { app } from 'electron'
import { Blob } from 'node:buffer'
import { readFile, rename, rm } from 'node:fs/promises'
import type {
  RommCollection,
  RommCollectionRomsPayload,
  RommVirtualCollection,
  RommDeviceAuthInit,
  RommDeviceAuthInitPayload,
  RommDevice,
  RommDeviceAuthToken,
  RommDeviceAuthTokenPayload,
  RommFirmware,
  RommHeartbeat,
  RommPlaySession,
  RommPlaySessionPayload,
  RommRomUserPayload,
  RommSaveDeletePayload,
  RommStateDeletePayload,
  RommPlatform,
  RommRom,
  RommRomFile,
  RommRomPage,
  RommSave,
  RomUserStatus,
  RommState,
  RommTokenResponse,
  RommUser,
  RomQuery
} from '@shared/types'
import { log } from '../log.ts'
import { t } from '../i18n.ts'
import type { Store } from '../store.ts'
import { checksumOf, digestOf, unpackedChecksumOf } from './checksums.ts'
import { DeviceRegistry } from './devices.ts'
import { RommError, UnreachableError, UnsupportedServerError } from './errors.ts'
import { atLeast, isComparable, MINIMUM_SERVER_VERSION } from './version.ts'
import {
  fetchToFile,
  partialPathOf,
  streamToFile,
  verify,
  type DownloadProgress,
  type Transport,
  type TransferOptions
} from './transfer.ts'

/**
 * Client for the RomM REST API.
 *
 * Which versions of it is `schema/`, against which `romm.test.ts` checks every
 * field RomMix reads, and `MINIMUM_SERVER_VERSION` is the oldest a server may
 * report.
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
  'firmware.read',
  // `POST /api/users/{id}/ra/refresh`, which every document under `schema/`
  // attaches this scope to. Without it the RetroAchievements refresh after a
  // session is a 403 the interface can only swallow.
  'me.write'
]

/**
 * How many of the platform counts are asked for at once.
 *
 * The library's platform chips are one count query each — see `romCounts` — so
 * a library with a shelf full of consoles is that many round trips, and end to
 * end they are a screen the user watches settle. Enough at once to hide the
 * latency, few enough not to fall on a home server as a burst.
 */
const COUNTS_AT_ONCE = 6

/**
 * How the play-session history is walked, for `playTime`.
 *
 * The page is the size RomM's own endpoint defaults to, deliberately: the
 * walk stops on the first page that comes back short, and a server quietly
 * capping a larger page than that would end it early with a total missing
 * everything after it.
 *
 * The depth is a stop, not a budget. A game played every evening for years is
 * still inside it, and a server answering with full pages forever cannot hold
 * the screen open.
 */
const PLAY_SESSION_PAGE = 50
const PLAY_SESSION_PAGES = 20

/**
 * How long any one request that carries an *answer* may take.
 *
 * The runtime's own default is long enough that a server which accepts the
 * connection and then stops answering — a captive portal, a host that went away
 * mid-reply — leaves the interface waiting behind a button that has already
 * been pressed. Generous enough for a home server indexing a large library on
 * the far end of a slow link.
 *
 * Not applied to the calls that carry *bytes*: the streamed asset fetch, the two
 * uploads and everything reached through `transport` pass `timeoutMs: null`,
 * because how long those take is a function of the file's size and the link, and
 * a deadline there is a transfer that breaks off for no reason the user can see.
 * `transfer.ts` owns those instead, and can resume.
 */
const REQUEST_TIMEOUT_MS = 30_000

/** Strip trailing slashes so we can concatenate paths safely. */
export function normaliseBaseUrl(input: string): string {
  let url = input.trim()
  if (!url) throw new RommError(t('error.serverAddressEmpty'))
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  const parsed = new URL(url)
  // A user pasting the RomM web UI URL often includes a path; keep it, but drop
  // a trailing /api which we add ourselves.
  parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/api$/, '')
  // `https://user:password@host` is a realistic paste, since RomM accepts HTTP
  // basic — and this string is written to settings.json, which `store.ts` says
  // holds no secrets, and printed beside every request. RomMix authenticates
  // with a token, so there is nothing here to keep.
  parsed.username = ''
  parsed.password = ''
  // Request paths are concatenated onto what this returns, so anything the URL
  // carries after the path would sit between the base and `/api/...`. A pasted
  // web UI address is the realistic source of both: a fragment is never sent,
  // so every call would fetch `/`.
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/+$/, '')
}

export class RommClient {
  /** Guards against several 401s triggering parallel refreshes. */
  private refreshInFlight: Promise<void> | null = null

  /** What RomM knows this machine and its siblings as. See `DeviceRegistry`. */
  private readonly registry: DeviceRegistry

  /**
   * Told after every request whether the server was there at all.
   *
   * Set once, by whatever is watching the connection. Every call RomMix makes
   * is already a probe with a better answer than any poll could have — it is
   * being made anyway, and it fails the instant the network does — so this is
   * how the interface learns it is out of range within one request rather than
   * within one polling interval. See `ConnectionWatch.observed`.
   */
  private reachability: ((reachable: boolean, reason?: string) => void) | null = null

  constructor(private readonly store: Store) {
    this.registry = new DeviceRegistry(store, (path, init) => this.json(path, init))
  }

  /** Watch whether requests are reaching the server. See `reachability`. */
  observeReachability(listener: (reachable: boolean, reason?: string) => void): void {
    this.reachability = listener
  }

  /**
   * Report on a request, but only one aimed at the server RomMix is signed in
   * to.
   *
   * Signing in and device pairing both talk to a server that is not the
   * configured one yet, and a typo in that form is not evidence about the
   * server the user's library is on.
   */
  private report(base: string, reachable: boolean, reason?: string): void {
    if (this.store.server?.baseUrl !== base) return
    if (reachable) this.registry.serverAnswered(base)
    this.reachability?.(reachable, reason)
  }

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
    opts: { baseUrl?: string; retryOn401?: boolean; timeoutMs?: number | null } = {}
  ): Promise<Response> {
    const base = opts.baseUrl ?? this.baseUrl
    const retryOn401 = opts.retryOn401 ?? true
    const method = init.method ?? 'GET'
    const timeoutMs = opts.timeoutMs === undefined ? REQUEST_TIMEOUT_MS : opts.timeoutMs
    /**
     * The token goes only to the configured server.
     *
     * A caller naming its own address is talking to a server the user has just
     * typed, which is not the one the stored token belongs to. All four such
     * endpoints are unauthenticated, so there is nothing to send and every
     * reason not to: a mistyped address would otherwise be handed the bearer
     * token for the server the user is actually signed in to.
     *
     * Read per attempt rather than once, because the retry below exists to use
     * a token the refresh has just written.
     */
    const auth = (): Record<string, string> => (opts.baseUrl === undefined ? this.authHeader() : {})

    /**
     * One attempt, with what a failure to send means settled here.
     *
     * Nothing answered — as against answering with a refusal, which comes back
     * as an ordinary response — is the only shape of failure that says the
     * server is not there, and every attempt has to read it the same way: the
     * replay after a token refresh is as much a request as the first send, and
     * a network that drops between the two must still put the interface into
     * offline mode rather than hand it the runtime's own wording.
     */
    const attempt = async (): Promise<Response> => {
      try {
        const res = await fetch(`${base}${path}`, {
          // A server that accepts the connection and then says nothing
          // otherwise holds the screen for as long as the runtime's own default
          // allows, behind a button that has already been pressed. The deadline
          // covers the body as well as the reply, which is why the endpoints
          // that carry bytes rather than an answer turn it off. See
          // `REQUEST_TIMEOUT_MS`.
          ...(timeoutMs === null ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
          ...init,
          headers: { Accept: 'application/json', ...auth(), ...(init.headers ?? {}) }
        })
        // Any status at all: a 404 is the server, present and answering.
        this.report(base, true)
        return res
      } catch (cause) {
        // The caller's own abort — a transfer paused, cancelled or overtaken
        // while its request was out — says nothing about the server, and
        // reported as an outage it would put the interface into offline mode.
        if (init.signal?.aborted) throw cause
        log.error('romm', `${method} ${path} could not be sent`, cause, { baseUrl: base })
        this.report(base, false, (cause as Error).message)
        throw new UnreachableError(
          t('error.cannotReach', { url: base, reason: (cause as Error).message })
        )
      }
    }

    // Every call to the server, with what came back. The path carries the query
    // string, so this doubles as the record of what RomMix asked *for* — which
    // page of the library, which ROM's saves, which platform's firmware.
    const took = log.since()
    let res = await attempt()

    if (res.status === 401 && retryOn401 && this.store.credentials.refreshToken) {
      log.info('romm', `${method} ${path} → 401, refreshing the access token and retrying`)
      await this.refreshAccessToken()
      res = await attempt()
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

  /**
   * The three things a transfer needs of this client, as one object.
   *
   * Built per call rather than held: it is three bound methods, and a field
   * would only be a second place the client's own plumbing is named. See
   * `Transport`.
   */
  private get transport(): Transport {
    return {
      // `timeoutMs: null` because everything reached through here carries bytes
      // rather than an answer: a deadline on a firmware dump or a large save is
      // a transfer that breaks off for no reason the user can see, and the
      // deadline covers the body, not just the reply. See `REQUEST_TIMEOUT_MS`.
      request: (path, init) => this.request(path, init, { timeoutMs: null }),
      toError: (res) => this.toError(res),
      onOutage: (reason) => this.report(this.store.server?.baseUrl ?? '', false, reason)
    }
  }

  // -- authentication -------------------------------------------------------

  /**
   * GET /api/heartbeat — also the "is this a RomM server we can read" probe.
   *
   * Both halves of that, because both are asked in the same three places: when
   * a server is first typed in, when a pairing starts against one, and on every
   * connection check afterwards. A version this build has no schema for is
   * refused here rather than at each of them, so none can forget to ask — see
   * `MINIMUM_SERVER_VERSION`.
   *
   * A server that names no version is let through, and so is one whose version
   * is not a number — RomM's own development builds report `development`.
   * Nothing can be proved about either, and turning somebody away over a string
   * their server chose is the worse of the two mistakes: the one this guards
   * against is a save that reads as ancient, the other is an application that
   * will not open. See `isComparable`.
   */
  async heartbeat(baseUrl?: string): Promise<{ version: string | null }> {
    const res = await this.request('/api/heartbeat', {}, { baseUrl, retryOn401: false })
    if (!res.ok) throw await this.toError(res)
    const body = (await res.json()) as RommHeartbeat
    const version = body.SYSTEM?.VERSION ?? null
    log.debug('romm', 'heartbeat', { baseUrl: baseUrl ?? this.baseUrl, serverVersion: version })

    if (version !== null && !isComparable(version)) {
      log.info('romm', 'the server names a version with no number in it', {
        baseUrl: baseUrl ?? this.baseUrl,
        serverVersion: version
      })
    } else if (version !== null && !atLeast(version, MINIMUM_SERVER_VERSION)) {
      log.warn('romm', 'the server is older than this build can read', {
        baseUrl: baseUrl ?? this.baseUrl,
        serverVersion: version,
        minimum: MINIMUM_SERVER_VERSION
      })
      throw new UnsupportedServerError(
        t('error.serverTooOld', { version, minimum: MINIMUM_SERVER_VERSION })
      )
    }
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
    this.storeToken(token, { sameSession: false })
  }

  /** Store a long-lived `rmm_...` client token typed in by the user. */
  setClientToken(token: string): void {
    log.info('romm', 'using a client token typed in by the user')
    this.store.setCredentials({
      clientToken: token.trim(),
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      // Whose token this is, is not knowable from here — see `storeToken`.
      deviceId: null
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
        } satisfies RommDeviceAuthInitPayload)
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
        body: JSON.stringify({ device_code: deviceCode } satisfies RommDeviceAuthTokenPayload)
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

  /**
   * Hold a token pair, and say whether it continues the session or begins one.
   *
   * A device id is issued to an account — see `deviceId` — and nothing in a
   * token says which account it is for, so a sign-in cannot tell whether the
   * id already stored is still this user's and drops it rather than uploading
   * saves under somebody else's device. A refresh is the same user by
   * definition and keeps it, which is what stops every refresh registering
   * this machine again.
   */
  private storeToken(token: RommTokenResponse, { sameSession }: { sameSession: boolean }): void {
    this.store.setCredentials({
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: Date.now() + token.expires * 1000,
      clientToken: null,
      deviceId: sameSession ? this.store.credentials.deviceId : null
    })
  }

  private async refreshAccessToken(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight

    this.refreshInFlight = (async () => {
      const refreshToken = this.store.credentials.refreshToken
      if (!refreshToken) throw new RommError(t('error.sessionExpired'), 401)

      // Through the request layer like everything else: a refresh that fails
      // because nothing answered must not be read as a refusal. `request`
      // raises `UnreachableError` for that case and never reaches the branch
      // below, so credentials survive an outage and are cleared only when the
      // server actually turned them down. `retryOn401` because this *is* the
      // retry.
      const res = await this.request(
        '/api/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
          }).toString()
        },
        { retryOn401: false }
      )
      if (!res.ok) {
        log.warn('romm', 'token refresh refused, credentials cleared', { status: res.status })
        this.store.clearCredentials()
        throw new RommError(t('error.sessionExpired'), 401)
      }
      log.info('romm', 'access token refreshed')
      this.storeToken((await res.json()) as RommTokenResponse, { sameSession: true })
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
   * answers 422 and the page shows nothing.
   *
   * Only a 404 is answered with silence, and only because it is the one failure
   * that is not a failure: a server too old to have the endpoint has no virtual
   * collections to list, and a page that works is the right outcome.
   *
   * Everything else is thrown, like every other call here. Swallowed, a 422
   * is an empty page and a line in a log nobody has a reason to open — an
   * error the user cannot see is an error nobody can report.
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
   * of one ordinary collection, which the server flags `is_favorite`. A user
   * who has never favourited anything has no such collection yet, hence the
   * null.
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
   * The flag is what makes it the favourites collection, not the name: RomM
   * stores `is_favorite` as it is given on the create call, and reads nothing
   * into what the collection is called.
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
   * PUT /api/roms/{id}/props — the per-user overlay.
   *
   * The endpoint takes the whole overlay and treats an absent key as "leave it
   * alone", so sending only the status cannot disturb a rating or a backlog
   * flag set from RomM's own interface.
   */
  async setStatus(romId: number, status: RomUserStatus | null): Promise<void> {
    const res = await this.request(`/api/roms/${romId}/props`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status } satisfies RommRomUserPayload)
    })
    if (!res.ok) throw await this.toError(res)
    log.info('romm', 'status set', { romId, status })
  }

  /**
   * PUT /api/roms/{id}/props — whether this game is up right now.
   *
   * RomM raises the flag from its own player, and raises it again every time it
   * takes a play session, but nothing on the server ever lowers it. A game
   * played from here would therefore sit in "now playing" for good, on every
   * device the user opens RomM on, unless RomMix lowers it as well as raising
   * it — see `Launcher.launch`, which does both around the run.
   *
   * Best effort, like the session report: the flag is worth keeping honest and
   * not worth failing a launch over.
   */
  async setNowPlaying(romId: number, playing: boolean): Promise<void> {
    log.info('romm', playing ? 'marking a game as playing' : 'clearing what is playing', { romId })
    try {
      const res = await this.request(`/api/roms/${romId}/props`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ now_playing: playing } satisfies RommRomUserPayload)
      })
      if (!res.ok) throw await this.toError(res)
    } catch (cause) {
      log.warn('romm', 'could not say what is being played', {
        romId,
        playing,
        reason: (cause as Error).message
      })
    }
  }

  /**
   * Put one game in a collection, or take it out.
   *
   * The same two calls favouriting makes, which is what favouriting *is* on
   * RomM — one collection the server flags `is_favorite`. Named separately
   * because the shelves a user makes for themselves are the general case and
   * the star is the special one, not the other way round.
   */
  async setCollectionMembership(
    collectionId: number,
    romId: number,
    member: boolean
  ): Promise<void> {
    const res = await this.request(`/api/collections/${collectionId}/roms`, {
      method: member ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rom_ids: [romId] } satisfies RommCollectionRomsPayload)
    })
    if (!res.ok) throw await this.toError(res)
    log.info('romm', member ? 'added to a collection' : 'removed from a collection', {
      romId,
      collectionId
    })
  }

  /**
   * POST /api/collections — multipart, since RomM takes artwork on the same
   * call, with the flags as query parameters. Named as RomM's own interface
   * names the collection it makes, so the shelf reads the same from either.
   */
  private async createFavourites(): Promise<RommCollection> {
    const form = new FormData()
    form.append('name', 'Favorites')
    const res = await this.request('/api/collections?is_favorite=true&is_public=false', {
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
    if (query.group_by_meta_id) params.set('group_by_meta_id', 'true')
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

  /**
   * How many games each of these platforms holds, for one search term.
   *
   * A count query apiece: RomM filters by platform and by term together, but
   * has nothing that groups a search by platform, so a chip's number is the
   * `total` of a page asked for a single row. A platform the server did not
   * count — see `RommRomPage.total` — is left out rather than reported as
   * none, and the chip falls back to the count the platform carries itself.
   */
  async romCounts(platformIds: number[], searchTerm: string): Promise<Record<number, number>> {
    const queue = [...platformIds]
    const counts: Record<number, number> = {}
    const ask = async (): Promise<void> => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        // Grouped, because the grid this number is a promise about is grouped:
        // a chip offering two where pressing it draws one tile is a chip that
        // has been read as a filter that lost something.
        //
        // One platform's failure leaves that platform out, which is what this
        // method promises above. Through `Promise.all` an uncaught rejection
        // would instead lose every count — and `ipc/handler.ts` reports it to
        // the renderer whatever the caller does with it, so a shelf of chips
        // would raise a toast per keystroke over one platform that 500s.
        const page = await this.roms({
          search_term: searchTerm,
          platform_ids: [id],
          group_by_meta_id: true,
          limit: 1
        }).catch((cause: unknown) => {
          log.warn('romm', 'a platform would not be counted', {
            platformId: id,
            reason: cause instanceof Error ? cause.message : String(cause)
          })
          return null
        })
        if (page && page.total !== null) counts[id] = page.total
      }
    }
    await Promise.all(Array.from({ length: Math.min(COUNTS_AT_ONCE, queue.length) }, ask))
    return counts
  }

  rom(id: number): Promise<RommRom> {
    return this.json<RommRom>(`/api/roms/${id}`)
  }

  /** Streamed asset fetch used by the custom image protocol. */
  async asset(path: string): Promise<Response> {
    const clean = path.startsWith('/') ? path : `/${path}`
    // The caller reads the body; see `REQUEST_TIMEOUT_MS`.
    return this.request(clean, {}, { timeoutMs: null })
  }

  // -- ROM content ----------------------------------------------------------

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
  async downloadRom(
    rom: RommRom,
    destination: string,
    onProgress: (progress: DownloadProgress) => void,
    signal: AbortSignal,
    options: TransferOptions = {}
  ): Promise<void> {
    await fetchToFile(
      this.transport,
      this.romContentPath(rom),
      destination,
      rom.fs_size_bytes,
      { kind: 'ROM', romId: rom.id },
      onProgress,
      signal,
      { verify: checksumOf(rom) ?? undefined, ...options }
    )
  }

  /**
   * Hold the game that came out of an archive to what RomM holds.
   *
   * Does nothing where there is no digest that describes it — a game RomM has
   * no hash for, one served as a plain file and already checked on the way in,
   * or an archive that held more than the game. See `unpackedChecksumOf`.
   *
   * The file goes with the failure, the same as on the way in: what is left
   * behind is a ROM already known to be wrong, sitting under the name an
   * emulator would load it by.
   */
  async verifyUnpacked(rom: RommRom, path: string): Promise<void> {
    const digest = unpackedChecksumOf(rom)
    if (!digest) return
    await verify(path, digest, { kind: 'ROM', romId: rom.id })
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
    await fetchToFile(
      this.transport,
      this.fileContentPath(file),
      destination,
      file.file_size_bytes,
      { kind: 'file', romId: file.rom_id, fileName: file.file_name },
      onProgress,
      signal,
      // The file's own hash, which is the one worth having: a game fetched this
      // way is fetched this way *because* it is large enough to be worth
      // resuming, and every one of its files crosses the network on its own.
      { verify: digestOf(file) ?? undefined, ...options }
    )
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

  async downloadFirmware(
    item: RommFirmware,
    destination: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    /**
     * Written beside whatever BIOS is already there, never on top of it.
     *
     * The check below deletes what it refuses, so downloading into the
     * installed name would mean a refused copy had overwritten a working BIOS
     * on its way to being thrown away — the emulator left with nothing, off a
     * button that offered to install something. The same reason
     * `installAsset` builds an emulator beside the old one.
     */
    const partial = partialPathOf(destination)
    try {
      await streamToFile(
        this.transport,
        `/api/firmware/${item.id}/content/${encodeURIComponent(item.file_name)}`,
        partial,
        onProgress
      )
      // Checked here rather than left to the emulator, which has no way to say
      // so: a BIOS that is the wrong bytes is a console that hangs on a black
      // screen, and nothing on the way to that names the file.
      //
      // Only where RomM has a digest to compare against. It records one for the
      // firmware it has scanned, and a check that cannot be made is not a
      // failure — refusing the file would leave the emulator with no BIOS at
      // all.
      if (item.md5_hash) {
        await verify(
          partial,
          { algorithm: 'md5', expected: item.md5_hash },
          // Under its own name: a firmware id logged as a ROM id sends whoever
          // reads the line looking for a game that does not exist.
          { kind: 'firmware', firmwareId: item.id, fileName: item.file_name }
        )
      }
    } catch (cause) {
      // Nothing to resume from — there is no range request behind a BIOS — so
      // a part-file left here is scratch that the next attempt would have to
      // step over.
      await rm(partial, { force: true }).catch(() => undefined)
      throw cause
    }

    await rename(partial, destination)
    log.info('romm', 'firmware downloaded', {
      firmwareId: item.id,
      fileName: item.file_name,
      destination
    })
  }

  // -- saves and states -----------------------------------------------------

  /** The devices paired with this account. See `DeviceRegistry.list`. */
  devices(): Promise<RommDevice[]> {
    return this.registry.list()
  }

  /** The id RomM knows this machine by, or null. See `DeviceRegistry.id`. */
  deviceId(): Promise<string | null> {
    return this.registry.id()
  }

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
      body: JSON.stringify({ saves: [...ids] } satisfies RommSaveDeletePayload)
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
      body: JSON.stringify({ states: [...ids] } satisfies RommStateDeletePayload)
    })
    if (!res.ok) throw await this.toError(res)
    log.info('romm', 'states deleted on the server', { ids })
  }

  async downloadSave(
    id: number,
    destination: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    await streamToFile(this.transport, `/api/saves/${id}/content`, destination, onProgress)
  }

  async downloadState(
    id: number,
    destination: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    await streamToFile(this.transport, `/api/states/${id}/content`, destination, onProgress)
  }

  /**
   * POST /api/saves — multipart upload of a save file produced by the emulator.
   *
   * `slot` is what RomM pairs the upload against on the next client to ask —
   * see `AUTOSAVE_SLOT`. Left off, the save is stored as an archival upload
   * that pairs with nothing. A server too old to know the parameter ignores it
   * and stores exactly that,
   * so nothing here has to ask what version it is talking to.
   *
   * A slot is a history and not a file: RomM files each upload into it as a new
   * copy under a name it stamps with the time, and `overwrite` does not apply
   * within one. So the cleanup goes with the slot — without it a push after
   * every session would leave a copy on the server after every session, for
   * every game, with nothing ever taking one away. How many it keeps is the
   * server's own default, deliberately not named here: retention belongs to the
   * machine holding the files, and either way it is more than the single
   * overwritten copy a slotless upload leaves.
   */
  async uploadSave(
    romId: number,
    filePath: string,
    fileName: string,
    emulator: string | null,
    slot: string | null
  ): Promise<RommSave> {
    const params = new URLSearchParams({ rom_id: String(romId), overwrite: 'true' })
    if (emulator) params.set('emulator', emulator)
    if (slot) {
      params.set('slot', slot)
      params.set('autocleanup', 'true')
    }
    const deviceId = await this.deviceId()
    if (deviceId) params.set('device_id', deviceId)

    const payload = await readFile(filePath)
    const form = new FormData()
    form.append('saveFile', new Blob([payload]) as unknown as Blob, fileName)

    log.info('romm', 'uploading a save', {
      romId,
      fileName,
      emulator,
      slot,
      deviceId,
      bytes: payload.length,
      from: filePath
    })
    const res = await this.request(
      `/api/saves?${params.toString()}`,
      { method: 'POST', body: form as RequestInit['body'] },
      // The body is the save; see `REQUEST_TIMEOUT_MS`.
      { timeoutMs: null }
    )
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
    const res = await this.request(
      `/api/states?${params.toString()}`,
      { method: 'POST', body: form as RequestInit['body'] },
      // The body is the save state; see `REQUEST_TIMEOUT_MS`.
      { timeoutMs: null }
    )
    if (!res.ok) throw await this.toError(res)
    const saved = (await res.json()) as RommState
    log.info('romm', 'save state uploaded', { romId, stateId: saved.id, fileName })
    return saved
  }

  /**
   * POST /api/users/{id}/ra/refresh — have RomM read this user's
   * RetroAchievements progress again.
   *
   * RomM is what talks to RetroAchievements: it holds the key, and the score
   * RomMix draws is whatever it last fetched. Without this the tab is right on
   * whatever schedule the server keeps, which means a session that earned
   * something shows nothing when the page is opened a minute later.
   *
   * Sent after a session and only where it can change anything — see
   * `shouldRefreshAchievements`. The answer is not read: what it says is that
   * RomM has been told, and what was fetched arrives with the next `me`.
   */
  async refreshAchievements(userId: number): Promise<void> {
    log.info('romm', 'asking the server to refresh RetroAchievements', { userId })
    const res = await this.request(`/api/users/${userId}/ra/refresh`, { method: 'POST' })
    if (!res.ok) throw await this.toError(res)
  }

  /**
   * GET /api/play-sessions — how long this game has been played, in seconds.
   *
   * Added up here because RomM keeps the sessions and not the total: every
   * device reports its own spans, and the sum across them is what "time
   * played" means for a library one person plays from a sofa and a handheld.
   *
   * Paged until the server stops answering with a full page, since a game
   * played every evening for a year is more sessions than one page holds. The
   * cap is there so a server answering oddly cannot spin this forever; a total
   * short by the tail of a very long history is still the right order of
   * magnitude, which is all this number is read for.
   */
  async playTime(romId: number): Promise<number> {
    let total = 0
    let offset = 0

    for (let page = 0; page < PLAY_SESSION_PAGES; page += 1) {
      const res = await this.request(
        `/api/play-sessions?rom_id=${romId}&limit=${PLAY_SESSION_PAGE}&offset=${offset}`
      )
      if (!res.ok) throw await this.toError(res)

      const sessions = (await res.json()) as RommPlaySession[]
      for (const session of sessions) total += session.duration_ms
      if (sessions.length < PLAY_SESSION_PAGE) break
      offset += PLAY_SESSION_PAGE
    }

    return Math.round(total / 1000)
  }

  /**
   * POST /api/play-sessions — report time played so RomM's stats stay honest.
   *
   * The window and the time played are both sent because RomM requires both and
   * derives neither from the other: the span is what the history is ordered by,
   * the duration is what the totals are added up from. An entry missing either
   * is refused whole.
   */
  async reportPlaySession(romId: number, startedAt: Date, seconds: number): Promise<void> {
    if (seconds < 5) {
      log.debug('romm', 'play session too short to report', { romId, seconds })
      return
    }
    const deviceId = await this.deviceId()
    log.info('romm', 'reporting a play session', {
      romId,
      deviceId,
      startedAt: startedAt.toISOString(),
      seconds
    })
    try {
      const res = await this.request('/api/play-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          sessions: [
            {
              rom_id: romId,
              start_time: startedAt.toISOString(),
              end_time: new Date(startedAt.getTime() + seconds * 1000).toISOString(),
              duration_ms: seconds * 1000
            }
          ]
        } satisfies RommPlaySessionPayload)
      })
      // Checked, unlike the reply to a fire-and-forget: a refused report is the
      // one thing that can go wrong here, and unread it goes wrong in silence.
      if (!res.ok) throw await this.toError(res)
    } catch (cause) {
      // Play-time reporting is best-effort; never fail a launch over it.
      log.warn('romm', 'could not report the play session', {
        romId,
        reason: (cause as Error).message
      })
    }
  }
}
