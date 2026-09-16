import { app } from 'electron'
import { hostname } from 'node:os'
import type { RommDevice, RommDeviceCreated, RommDeviceCreatePayload } from '@shared/types'
import { log } from '../log.ts'
import type { Store } from '../store.ts'
import { UnreachableError } from './errors.ts'

/**
 * The device RomM knows this machine by, and the devices it knows at all.
 *
 * Kept apart from the client because it is a session's fact rather than a
 * request's: a device belongs to one account on one server, both of which can
 * change without the client being rebuilt, and everything here is keyed on the
 * pair so that neither switching servers nor switching accounts on one server
 * can reuse an answer. The client hands over the one thing this needs of it — a
 * way to ask the server for JSON — and reads the two answers back.
 */

/** What this needs of the client: one authenticated JSON request. */
export type AskJson = <T>(path: string, init?: RequestInit) => Promise<T>

export class DeviceRegistry {
  /**
   * See `list`. Carries the server *and* the token: two accounts on the same
   * RomM see different device lists, and the names off this list are what
   * every Saves row is labelled with.
   */
  private cached: { baseUrl: string; token: string | null; devices: RommDevice[] } | null = null

  /** See `id`. Carries what it was resolved against, so nothing else inherits it. */
  private registration: {
    baseUrl: string
    token: string | null
    deviceId: Promise<string | null>
    /** Set where nothing answered, so `serverAnswered` can let it be asked again. */
    afterOutage?: boolean
  } | null = null

  constructor(
    private readonly store: Store,
    private readonly ask: AskJson
  ) {}

  /** The token the server is being asked with, which is what an answer is keyed on. */
  private token(): string | null {
    const { clientToken, accessToken } = this.store.credentials
    return clientToken ?? accessToken
  }

  /**
   * The server has answered something.
   *
   * A registration that failed because nothing answered is asked again once
   * something does, rather than in front of every save while the server is
   * away — which is three connection attempts each on the one path that
   * already has a queue waiting to drain. See `id`.
   */
  serverAnswered(baseUrl: string): void {
    if (this.registration?.afterOutage && this.registration.baseUrl === baseUrl) {
      this.registration = null
    }
  }

  /**
   * GET /api/devices — the devices paired with this account, so a save can say
   * where it came from by name instead of by identifier.
   *
   * Never throws. An empty list costs a name and nothing else — the rows fall
   * back to "another device" — while a throw would take down the Saves tab and
   * the push dialog over a label. That matters for real servers: the endpoint
   * post-dates the save sync it describes, so a RomM old enough to record
   * `origin_device_id` may still 404 here, and a token issued before
   * `devices.read` joined the required scopes gets a 403.
   *
   * Held for as long as RomMix runs. Pairing a device, renaming one or
   * removing it are all rare enough that a restart is a fair way to see it,
   * and a name a few hours stale is a smaller cost than fetching the list
   * again behind every game screen.
   */
  async list(): Promise<RommDevice[]> {
    // Off the store rather than through the client's own accessor, which
    // throws: there is no server to ask before one is configured, and that is
    // not a failure.
    const baseUrl = this.store.server?.baseUrl
    if (!baseUrl) return []
    const token = this.token()

    const held = this.cached
    if (held && held.baseUrl === baseUrl && held.token === token) return held.devices

    try {
      const devices = await this.ask<RommDevice[]>('/api/devices')
      this.cached = { baseUrl, token, devices }
      return devices
    } catch (cause) {
      log.warn('romm', 'the device list could not be read; saves will not be named', {
        reason: (cause as Error).message
      })
      // Cached as empty, so one unsupported server is not asked on every row.
      // Not for a server that did not answer: that is no answer at all, and a
      // list asked for out of range would otherwise name nothing until the
      // next restart.
      if (!(cause instanceof UnreachableError)) this.cached = { baseUrl, token, devices: [] }
      return []
    }
  }

  /**
   * The id RomM knows this machine by, or null where it has none.
   *
   * RomM resolves `device_id` against its own devices table and refuses an
   * upload naming one that is not in it. Pairing hands that id back with the
   * token; a client token typed in or a password does not, and the identifier
   * RomMix generated for itself is not a device on the server until something
   * asks for one. So the ask happens here, once, the first time a save has a
   * device to name.
   *
   * Null is an answer rather than a failure. A save uploaded without a device
   * is one RomM keeps — it only loses the label saying which machine wrote it,
   * and `syncStateOf` falls back to treating the server's copy as somebody
   * else's — which is a smaller loss than a save that never leaves the
   * handheld. Registering is therefore attempted once per server and session,
   * and a refusal remembered for as long as that session's token lasts rather
   * than retried behind every push.
   */
  async id(): Promise<string | null> {
    const known = this.store.credentials.deviceId
    if (known) return known

    const baseUrl = this.store.server?.baseUrl
    if (!baseUrl) return null
    const token = this.token()
    let registration = this.registration
    if (!registration || !this.current(baseUrl, token)) {
      registration = { baseUrl, token, deviceId: this.register(baseUrl, token) }
      this.registration = registration
    }

    const id = await registration.deviceId
    // Written down here rather than where it was obtained, so an answer this
    // run already has still reaches the disk — and only while it is still the
    // answer for the server and session that asked for it.
    if (id && this.current(baseUrl, token) && this.store.credentials.deviceId !== id) {
      this.store.setCredentials({ deviceId: id })
    }
    return id
  }

  /** Is the registration in hand still the one this server and session want? */
  private current(baseUrl: string, token: string | null): boolean {
    return this.registration?.baseUrl === baseUrl && this.registration.token === token
  }

  /**
   * POST /api/devices — ask RomM to record this machine, and remember the id.
   *
   * Kept with the credentials rather than the settings: it is the account's
   * device, so signing out or moving to another server has to lose it, and
   * that is what `clearCredentials` already does.
   *
   * Never throws — see `id`. An old server, a token issued before
   * `devices.write` joined the required scopes, or a server that answers
   * something other than a device all come out as "this machine has no id".
   */
  private async register(baseUrl: string, token: string | null): Promise<string | null> {
    const { deviceId, deviceName } = this.store.settings
    try {
      // Paired once and signed in again since with a token: RomM already holds
      // this machine under the identifier RomMix chose for it, and registering
      // would stand a second device beside the one that is already there.
      const paired = (await this.pairedAs(deviceId))?.id
      const id = paired ?? (await this.create(deviceName))
      if (id) {
        // The list was read before the device was on it.
        this.cached = null
        log.info('romm', 'this machine is registered with RomM', { deviceId: id })
        return id
      }
      log.warn('romm', 'RomM took the registration but named no id; saves will name no device')
    } catch (cause) {
      // A server that was not there has refused nothing, so it is not an answer
      // to keep: `serverAnswered` lets it be asked again once the server
      // answers something. Marked rather than dropped, or every save would ask
      // again for as long as the server stays away. A refusal is kept — see
      // `id`.
      if (this.registration && cause instanceof UnreachableError && this.current(baseUrl, token)) {
        this.registration.afterOutage = true
      }
      log.warn('romm', 'this machine could not be registered; saves will name no device', {
        reason: (cause as Error).message
      })
    }
    return null
  }

  /**
   * The device RomM holds under this machine's own identifier, if any.
   *
   * Read fresh rather than off `list`, which caches `[]` for the run after any
   * failure: taking that for "this machine never paired" is how a second row
   * appears beside the one already there. Only a paired device is ever found
   * this way, `DeviceCreatePayload` having no field for the identifier — what
   * keeps a registered one from doubling is the server's `allow_existing`. A
   * failure is silence, since it is not an answer either and what follows is a
   * registration, which is the right move when the list cannot be read.
   */
  private async pairedAs(identifier: string): Promise<RommDevice | null> {
    try {
      const devices = await this.ask<RommDevice[]>('/api/devices')
      return devices.find((device) => device.client_device_identifier === identifier) ?? null
    } catch (cause) {
      log.debug('romm', 'the device list could not be read before registering', {
        reason: (cause as Error).message
      })
      return null
    }
  }

  /** The registration itself, so `register` is the policy around it. */
  private async create(name: string): Promise<string | null> {
    const created = await this.ask<RommDeviceCreated>('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        hostname: hostname(),
        client: 'rommix',
        platform: 'linux',
        // From the packaged app, not the environment: npm_package_version is
        // only set when RomMix is started through npm.
        client_version: app.getVersion(),
        allow_existing: true
      } satisfies RommDeviceCreatePayload)
    })
    // Asked because the id is the whole point of the call, and a reply without
    // one would otherwise be sent as the string "undefined" on every upload.
    return created.device_id || null
  }
}
