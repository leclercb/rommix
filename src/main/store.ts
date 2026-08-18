import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { InstalledRom, ServerConfig, Settings } from '@shared/types'

/**
 * On-disk state for RomMix.
 *
 * Lives in `config/` inside RomMix's root (see `root.ts`), which the bootstrap
 * points Electron's userData at — so all of this sits beside the emulators
 * RomMix installed rather than in a hidden per-app directory. Three files:
 *
 *   settings.json   user preferences + the configured server (no secrets)
 *   credentials.bin the RomM tokens, encrypted with safeStorage when available
 *   installed.json  a cache of which ROMs are on disk, not the authority on it;
 *                   `DownloadManager.adopt` reconciles it against the files
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
    systemOverrides: {},
    syncSavesDown: true,
    syncSavesUp: true,
    confirmUninstall: true,
    deviceId: randomUUID(),
    deviceName: `RomMix @ ${hostname()}`
  }
}

interface LegacySettings {
  /** Before emulators were a registry. */
  preferredRunner?: string
  /** Before per-system choice replaced a single global preference. */
  preferredEmulator?: string
  /** Before per-system choice replaced a global order. */
  emulatorPriority?: string[]
}

/**
 * Carry settings written by an older RomMix forward.
 *
 * All three legacy keys expressed a *global* preference, which the per-system
 * map deliberately has no equivalent for: the whole point is that one emulator
 * is not the right answer for every platform. They are dropped rather than
 * translated — the defaults derived from the registry are a better answer than
 * anything that could be reconstructed from them, and any real deviation is
 * one choice per platform in Settings.
 */
function migrateSettings(settings: Settings): Settings {
  const { preferredRunner, preferredEmulator, emulatorPriority, ...rest } = settings as Settings &
    LegacySettings
  void preferredRunner
  void preferredEmulator
  void emulatorPriority

  return {
    ...rest,
    // The device name is what RomM lists this client as, and it is stored, so
    // the rename to RomMix would otherwise only reach installs that had never
    // run. Only the old default is rewritten — a name the user chose is theirs.
    deviceName: rest.deviceName.startsWith('Rommix @')
      ? rest.deviceName.replace(/^Rommix @/, 'RomMix @')
      : rest.deviceName
  }
}

/** Atomic JSON write, so a crash mid-write cannot truncate the file. */
function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return { ...fallback, ...(JSON.parse(readFileSync(path, 'utf8')) as object) } as T
  } catch {
    return fallback
  }
}

export class Store {
  private readonly dir: string
  private readonly settingsPath: string
  private readonly credentialsPath: string
  private readonly installedPath: string

  private settingsCache: Settings
  private serverCache: ServerConfig | null
  private credentialsCache: StoredCredentials
  private installedCache: Map<number, InstalledRom>

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(this.dir, { recursive: true })
    this.settingsPath = join(this.dir, 'settings.json')
    this.credentialsPath = join(this.dir, 'credentials.bin')
    this.installedPath = join(this.dir, 'installed.json')

    const raw = readJson<{ settings: Settings; server: ServerConfig | null }>(this.settingsPath, {
      settings: defaultSettings(),
      server: null
    })
    this.settingsCache = migrateSettings({ ...defaultSettings(), ...raw.settings })
    this.serverCache = raw.server ?? null
    this.credentialsCache = this.loadCredentials()
    this.installedCache = new Map(
      readJson<{ roms: InstalledRom[] }>(this.installedPath, { roms: [] }).roms.map((r) => [
        r.romId,
        r
      ])
    )
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

  get credentials(): StoredCredentials {
    return this.credentialsCache
  }

  setCredentials(patch: Partial<StoredCredentials>): void {
    this.credentialsCache = { ...this.credentialsCache, ...patch }
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
    const json = JSON.stringify(this.credentialsCache)
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const blob = safeStorage.encryptString(json)
        writeFileSync(this.credentialsPath, Buffer.concat([Buffer.from('ENC1'), blob]))
        return
      }
    } catch {
      // fall through to plaintext
    }
    writeFileSync(this.credentialsPath, Buffer.concat([Buffer.from('RAW1'), Buffer.from(json)]), {
      mode: 0o600
    })
  }

  private loadCredentials(): StoredCredentials {
    try {
      if (!existsSync(this.credentialsPath)) return { ...EMPTY_CREDENTIALS }
      const buf = readFileSync(this.credentialsPath)
      const magic = buf.subarray(0, 4).toString()
      const body = buf.subarray(4)
      const json =
        magic === 'ENC1' ? safeStorage.decryptString(body) : magic === 'RAW1' ? body.toString() : ''
      if (!json) return { ...EMPTY_CREDENTIALS }
      return { ...EMPTY_CREDENTIALS, ...(JSON.parse(json) as object) }
    } catch {
      return { ...EMPTY_CREDENTIALS }
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
    this.installedCache.set(entry.romId, entry)
    this.persistInstalled()
  }

  removeInstalled(romId: number): void {
    this.installedCache.delete(romId)
    this.persistInstalled()
  }

  /** Drop index entries whose files no longer exist (manual deletion, SD card removed). */
  pruneInstalled(): number {
    let removed = 0
    for (const [romId, entry] of this.installedCache) {
      if (!existsSync(entry.path)) {
        this.installedCache.delete(romId)
        removed += 1
      }
    }
    if (removed > 0) this.persistInstalled()
    return removed
  }

  private persistInstalled(): void {
    writeJsonAtomic(this.installedPath, { roms: [...this.installedCache.values()] })
  }
}
