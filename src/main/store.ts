import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_DATE_FORMAT } from '@shared/i18n'
import type {
  InstalledRom,
  PendingDownload,
  ServerConfig,
  Settings,
  UnsentSaves
} from '@shared/types'
import { log } from './log.ts'

/**
 * On-disk state for RomMix.
 *
 * Lives in `config/` inside RomMix's root (see `root.ts`), so all of this sits
 * beside the emulators RomMix installed rather than in a hidden per-app
 * directory. Electron's own userData is left where it is: it holds Chromium's
 * caches and lock files, which are not RomMix's state and would follow the
 * folder around. Three files:
 *
 *   settings.json        user preferences + the configured server (no secrets)
 *   credentials.bin      the RomM tokens, encrypted with safeStorage when available
 *   downloaded_roms.json a cache of which ROMs are on disk, not the authority on
 *                        it; `DownloadManager.adopt` reconciles it against the
 *                        files
 *   migrations.json      the one-off steps this folder has already been through
 *   unsent_saves.json    games played away from the server, with saves still here
 */

interface StoredCredentials {
  accessToken: string | null
  refreshToken: string | null
  /** Epoch millis when the access token stops being valid. */
  expiresAt: number | null
  /** Long-lived `rmm_...` client token, used instead of the OAuth pair. */
  clientToken: string | null
  /** Device id RomM assigned us through the device-pairing flow. */
  deviceId: string | null
}

const EMPTY_CREDENTIALS: StoredCredentials = {
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  clientToken: null,
  deviceId: null
}

function defaultSettings(): Settings {
  return {
    systemEmulators: {},
    emulatorPaths: {},
    systemLaunchers: {},
    emulatorRoots: {},
    systemOverrides: {},
    emulatorPriority: [],
    // One folder for everything, which is the answer that keeps working: a
    // platform pointed at another emulator moves nothing and re-downloads
    // nothing, and a game can be fetched before the thing that runs it is
    // installed at all. It costs one setup step per emulator, which the
    // pre-flight check names.
    //
    // Only a fresh installation reads this. Anything that has ever connected to
    // a server has the whole settings object on disk — `persistSettings` writes
    // it entire — so an existing library stays exactly where it was put.
    romStorage: 'rommix',
    setupComplete: false,
    syncSavesDown: true,
    syncSavesUp: true,
    navigationSounds: true,
    confirmUninstall: true,
    confirmSavePush: true,
    dismissedNotices: [],
    uiScale: 0,
    // The desktop's own language, until somebody says otherwise in Settings.
    language: 'auto',
    dateFormat: DEFAULT_DATE_FORMAT,
    // Nothing on a Linux desktop updates an AppImage on RomMix's behalf, so the
    // default is the one that keeps an installation current on its own.
    updates: 'auto',
    // A release candidate is published to be tried, not to be rolled out, so it
    // is offered only to installations that asked for one.
    updatePrereleases: false,
    deviceId: randomUUID(),
    deviceName: `RomMix @ ${hostname()}`
  }
}

/** Atomic JSON write, so a crash mid-write cannot truncate the file. */
function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}

/**
 * One of RomMix's own JSON files, or the fallback where it is not.
 *
 * Anything that is not an object of the expected shape is the fallback,
 * including a valid document of the wrong kind. These files are RomMix's, so
 * the only ways they come back wrong are ways it did not write them — a
 * truncated write, an edit by hand, a restore of the wrong file — and every one
 * of those is "there is nothing here yet" rather than a reason to stop.
 */
function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback
    return { ...fallback, ...parsed } as T
  } catch {
    return fallback
  }
}

/**
 * The records under one key, skipping anything that is not one.
 *
 * The key can hold the wrong thing even in a file that parses as an object, and
 * `{ "roms": null }` is not a shape a spread over a default protects against —
 * it replaces the default with the null. Both files here are lists of things
 * with a `romId`, which is the one field every reader needs and therefore the
 * one worth insisting on.
 */
function readRecords<T extends { romId: number }>(path: string, key: string): T[] {
  const value = readJson<Record<string, unknown>>(path, {})[key]
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is T =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { romId?: unknown }).romId === 'number'
  )
}

export class Store {
  private readonly dir: string
  private readonly settingsPath: string
  private readonly credentialsPath: string
  private readonly installedPath: string
  private readonly pendingPath: string
  private readonly migrationsPath: string
  private readonly unsentPath: string

  private settingsCache: Settings
  private serverCache: ServerConfig | null
  /**
   * Null until something asks, which is what makes this correct rather than
   * merely lazy: see `credentials`.
   */
  private credentialsCache: StoredCredentials | null = null
  private installedCache: Map<number, InstalledRom>

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(this.dir, { recursive: true })
    this.settingsPath = join(this.dir, 'settings.json')
    this.credentialsPath = join(this.dir, 'credentials.bin')
    this.installedPath = join(this.dir, 'downloaded_roms.json')
    this.pendingPath = join(this.dir, 'pending_downloads.json')
    this.migrationsPath = join(this.dir, 'migrations.json')
    this.unsentPath = join(this.dir, 'unsent_saves.json')

    const raw = readJson<{ settings: Settings; server: ServerConfig | null }>(this.settingsPath, {
      settings: defaultSettings(),
      server: null
    })
    this.settingsCache = { ...defaultSettings(), ...raw.settings }
    this.serverCache = raw.server ?? null
    this.installedCache = new Map(
      readRecords<InstalledRom>(this.installedPath, 'roms').map((r) => [r.romId, r])
    )

    // What RomMix believes at the moment it starts. Which credential kind is
    // held is just as worth knowing — a client token that never expires and a
    // JWT pair behave differently — but it is deliberately not read here; that
    // line comes from `loadCredentials`, whenever the first reader arrives.
    log.info('store', 'state loaded', {
      dir: this.dir,
      server: this.serverCache?.baseUrl ?? null,
      authMode: this.serverCache?.authMode ?? null,
      installed: this.installedCache.size
    })
  }

  // -- settings -------------------------------------------------------------

  get settings(): Settings {
    return this.settingsCache
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.settingsCache = { ...this.settingsCache, ...patch }
    this.persistSettings()
    return this.settingsCache
  }

  get server(): ServerConfig | null {
    return this.serverCache
  }

  setServer(server: ServerConfig | null): void {
    this.serverCache = server
    this.persistSettings()
  }

  private persistSettings(): void {
    writeJsonAtomic(this.settingsPath, { settings: this.settingsCache, server: this.serverCache })
  }

  // -- credentials ----------------------------------------------------------

  /**
   * Read from disk on first use, not in the constructor.
   *
   * `safeStorage` throws outright before the app is ready, and the store is
   * built while `RomMixApp` is being constructed — which is before
   * `app.whenReady()`, because the single-instance handlers need the object to
   * exist. Decrypting there therefore failed on every single start, and the
   * failure is indistinguishable from having no tokens: RomMix asked the user
   * to pair, encrypted the new tokens successfully (that write happens after
   * ready), and then could not read them back the next time either.
   *
   * Lazy is not a workaround here but the correct lifetime: nothing wants the
   * tokens until a request is made, and by then Electron is up.
   */
  get credentials(): StoredCredentials {
    this.credentialsCache ??= this.loadCredentials()
    // A read that *failed* is deliberately not cached. "Could not be read" and
    // "there are none" are different facts, and caching the first as the second
    // is what turned one bad read into a permanent signed-out state.
    return this.credentialsCache ?? { ...EMPTY_CREDENTIALS }
  }

  setCredentials(patch: Partial<StoredCredentials>): void {
    this.credentialsCache = { ...this.credentials, ...patch }
    this.persistCredentials()
  }

  clearCredentials(): void {
    this.credentialsCache = { ...EMPTY_CREDENTIALS }
    this.persistCredentials()
  }

  /**
   * Tokens are encrypted with the OS keyring via safeStorage where possible.
   * A flatpak without a portal-accessible keyring falls back to plaintext —
   * we mark the payload so we know which decoder to use on the way back in.
   */
  private persistCredentials(): void {
    const json = JSON.stringify(this.credentials)
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const blob = safeStorage.encryptString(json)
        this.writeCredentials(Buffer.concat([Buffer.from('ENC1'), blob]))
        return
      }
      log.warn('store', 'no OS keyring available, credentials are stored in plain text')
    } catch (cause) {
      // fall through to plaintext
      log.warn('store', 'the OS keyring refused to encrypt, falling back to plain text', {
        reason: (cause as Error).message
      })
    }
    this.writeCredentials(Buffer.concat([Buffer.from('RAW1'), Buffer.from(json)]))
  }

  /**
   * Write the credential file, owner-only however it got there.
   *
   * `chmodSync` rather than `writeFileSync`'s `mode`, which is consulted only
   * when the call creates the file. The file that matters here is the one
   * already on disk: written encrypted on an earlier run, and rewritten in
   * plain text now that the keyring has gone missing — a flatpak whose portal
   * is unreachable this boot is exactly that sequence. The mode argument is
   * ignored on that write, so on its own it would leave the tokens in whatever
   * the encrypted file was created as.
   *
   * The encrypted file is held to the same mode. Ciphertext nobody else can
   * read is still nobody else's to read.
   */
  private writeCredentials(payload: Buffer): void {
    writeFileSync(this.credentialsPath, payload, { mode: 0o600 })
    chmodSync(this.credentialsPath, 0o600)
  }

  /** The stored tokens, or null when the file is there and could not be read. */
  private loadCredentials(): StoredCredentials | null {
    try {
      if (!existsSync(this.credentialsPath)) return { ...EMPTY_CREDENTIALS }
      const buf = readFileSync(this.credentialsPath)
      const magic = buf.subarray(0, 4).toString()
      const body = buf.subarray(4)
      const json =
        magic === 'ENC1' ? safeStorage.decryptString(body) : magic === 'RAW1' ? body.toString() : ''
      if (!json) return { ...EMPTY_CREDENTIALS }
      const loaded = { ...EMPTY_CREDENTIALS, ...(JSON.parse(json) as object) }
      // The kind, never the token: it is what most sign-in questions turn on.
      log.info('store', 'credentials loaded', {
        encrypted: magic === 'ENC1',
        kind: loaded.clientToken ? 'client token' : loaded.accessToken ? 'access token' : 'none'
      })
      return loaded
    } catch (cause) {
      // Reads as "signed out" to the user, which is the wrong explanation: the
      // tokens are there and could not be decrypted, usually because the
      // keyring the OS offered this time is not the one that encrypted them.
      log.warn('store', 'stored credentials could not be read', {
        path: this.credentialsPath,
        reason: (cause as Error).message
      })
      return null
    }
  }

  // -- installed ROM index --------------------------------------------------

  get installed(): InstalledRom[] {
    return [...this.installedCache.values()]
  }

  getInstalled(romId: number): InstalledRom | undefined {
    return this.installedCache.get(romId)
  }

  addInstalled(entry: InstalledRom): void {
    this.addInstalledMany([entry])
  }

  /**
   * Several at once, written to disk once.
   *
   * The index is rewritten whole on every save, and `DownloadManager.adopt`
   * recognises a library page at a time — so recording them one by one rewrites
   * a growing file once per entry. Reconciling a restored library that way is
   * the difference between one write and thousands, each larger than the last,
   * every one of them synchronous and in front of whatever the interface was
   * waiting for.
   */
  addInstalledMany(entries: readonly InstalledRom[]): void {
    if (entries.length === 0) return
    for (const entry of entries) this.installedCache.set(entry.romId, entry)
    this.persistInstalled()
  }

  removeInstalled(romId: number): void {
    this.installedCache.delete(romId)
    this.persistInstalled()
  }

  /**
   * Drop index entries whose games are not on the disk after all.
   *
   * A missing *directory* is not a missing game: an unmounted SD card takes a
   * whole library's worth of paths with it, and forgetting them would leave the
   * user re-downloading games that are sitting on a card they plug back in a
   * minute later. Only a path that has gone from a folder still there counts.
   *
   * An empty directory counts as well, and is the one case where a path that
   * exists is not a game. A multi-file game is its files; a folder holding none
   * of them is what a cancelled transfer leaves behind, and while the index
   * believes it the game reads as installed on every screen and cannot be
   * downloaded, because RomMix thinks it already has it. Nothing is deleted
   * here — the folder is left where it is, and only the claim about it goes.
   */
  pruneInstalled(): number {
    let removed = 0
    for (const [romId, entry] of this.installedCache) {
      if (!this.hasGone(entry)) continue
      this.installedCache.delete(romId)
      removed += 1
    }
    if (removed > 0) this.persistInstalled()
    return removed
  }

  /** Is this entry's game no longer where the index says it is? */
  private hasGone(entry: InstalledRom): boolean {
    if (!existsSync(entry.path)) {
      // The whole folder went with the card it was on, so the game has not.
      return existsSync(dirname(entry.path))
    }
    if (!entry.isDirectory) return false
    try {
      return readdirSync(entry.path).length === 0
    } catch {
      // Unreadable is not empty, and a permissions problem is no reason to
      // forget a game.
      return false
    }
  }

  private persistInstalled(): void {
    writeJsonAtomic(this.installedPath, { roms: [...this.installedCache.values()] })
  }

  // -- downloads that have not finished -------------------------------------

  /**
   * The transfers that were interrupted, read from disk on every call.
   *
   * Not cached, unlike the index above: this list is short, it is read when a
   * screen asks and when a download starts, and what actually matters is the
   * part-downloaded files it points at. A cache would be one more place for the
   * two to disagree.
   */
  get pending(): PendingDownload[] {
    return readRecords<PendingDownload>(this.pendingPath, 'downloads')
  }

  /** Record an interrupted transfer, replacing any earlier one for that ROM. */
  setPending(entry: PendingDownload): void {
    const kept = this.pending.filter((item) => item.romId !== entry.romId)
    writeJsonAtomic(this.pendingPath, { downloads: [...kept, entry] })
  }

  /**
   * Note how a transfer stopped, on the record that outlives this run.
   *
   * Patched onto the record rather than written with it: how a transfer stopped
   * is only known when it stops, and the record is written before the first
   * byte — see `setPending` — precisely so that a RomMix that never gets to
   * write anything again has still left one behind.
   *
   * Both ways round, because it can change. A transfer the network stopped and
   * the user then paused is paused; without writing that down, the pause would
   * be undone by the next start, which is a Pause button that does not.
   */
  markPendingStopped(romId: number, stoppedAs: 'paused' | 'stalled'): void {
    const held = this.pending.find((item) => item.romId === romId)
    if (!held || held.stoppedAs === stoppedAs) return
    this.setPending({ ...held, stoppedAs })
  }

  /** Forget one — it finished, or the user cancelled it. */
  removePending(romId: number): void {
    const kept = this.pending.filter((item) => item.romId !== romId)
    writeJsonAtomic(this.pendingPath, { downloads: kept })
  }

  // -- saves this device owes the server ------------------------------------

  /**
   * Games played while RomM was unreachable, whose saves never went up.
   *
   * Read from disk on every call, like `pending` and for the same reason: the
   * list is short, it is read when a session ends and when the server comes
   * back, and what actually matters is the files on the disk it points at.
   */
  get unsentSaves(): UnsentSaves[] {
    return readRecords<UnsentSaves>(this.unsentPath, 'games')
  }

  /**
   * Note that a game's session had nowhere to send its saves.
   *
   * The earliest moment wins where there is already a record: two sessions
   * played out of range are one span of files to send, and the later `since`
   * would leave the first session's saves out of it.
   */
  noteUnsentSaves(entry: UnsentSaves): void {
    const held = this.unsentSaves.find((row) => row.romId === entry.romId)
    const kept = this.unsentSaves.filter((row) => row.romId !== entry.romId)
    const since = held ? Math.min(held.since, entry.since) : entry.since
    writeJsonAtomic(this.unsentPath, { games: [...kept, { romId: entry.romId, since }] })
  }

  /** Forget one — its saves went up, or the game was uninstalled. */
  clearUnsentSaves(romId: number): void {
    const kept = this.unsentSaves.filter((row) => row.romId !== romId)
    writeJsonAtomic(this.unsentPath, { games: kept })
  }

  // -- one-off steps this folder has been through ---------------------------

  /**
   * The migrations already applied here, by name. See `runMigrations`.
   *
   * Read from disk rather than cached, for the same reason `pending` is: it is
   * asked for once a run, and the file is the record — a cache would only be
   * something for a second window or a crash mid-run to disagree with.
   */
  get appliedMigrations(): string[] {
    const value = readJson<Record<string, unknown>>(this.migrationsPath, {}).applied
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  }

  /** Note that a migration has finished, so it is not run again. */
  recordMigration(id: string): void {
    if (this.appliedMigrations.includes(id)) return
    writeJsonAtomic(this.migrationsPath, { applied: [...this.appliedMigrations, id] })
  }
}
