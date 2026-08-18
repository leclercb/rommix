import type {
  ConnectionStatus,
  DiagnosticsReport,
  DownloadItem,
  InstalledRom,
  LaunchResult,
  RommCollection,
  RommDeviceAuthInit,
  RommPlatform,
  RommRom,
  RommRomPage,
  RomQuery,
  EmulatorAsset,
  EmulatorInstallProgress,
  EmulatorRelease,
  RootLocation,
  Settings,
  AuthMode
} from './types'

/** Payload for `server:connect`. */
export interface ConnectPayload {
  baseUrl: string
  mode: AuthMode
  username?: string
  password?: string
  /** A long-lived `rmm_...` client token, when mode is 'token'. */
  token?: string
}

/** Emitted on `game:state` so the UI can show a "running" overlay. */
export interface GameState {
  running: boolean
  romId: number | null
}

/**
 * The surface exposed to the renderer on `window.rommix`.
 * Every method crosses the context bridge and is therefore asynchronous.
 */
export interface RomMixBridge {
  server: {
    status(): Promise<ConnectionStatus>
    connect(payload: ConnectPayload): Promise<ConnectionStatus>
    disconnect(): Promise<void>
    startPairing(baseUrl: string): Promise<RommDeviceAuthInit>
    pollPairing(deviceCode: string, baseUrl: string): Promise<boolean>
  }
  library: {
    platforms(): Promise<RommPlatform[]>
    collections(): Promise<RommCollection[]>
    roms(query: RomQuery): Promise<RommRomPage>
    rom(id: number): Promise<RommRom>
    installed(): Promise<InstalledRom[]>
    /** The installed list changed — a download finished, or a ROM was adopted. */
    onInstalledChanged(listener: (installed: InstalledRom[]) => void): () => void
    /** ROMs found already on disk rather than downloaded. */
    onAdopted(listener: (entries: InstalledRom[]) => void): () => void
  }
  downloads: {
    list(): Promise<DownloadItem[]>
    start(romId: number): Promise<DownloadItem>
    cancel(romId: number): Promise<void>
    clearFinished(): Promise<void>
    uninstall(romId: number): Promise<void>
    onUpdate(listener: (items: DownloadItem[]) => void): () => void
  }
  game: {
    launch(romId: number): Promise<LaunchResult>
    stop(): Promise<void>
    onState(listener: (state: GameState) => void): () => void
  }
  system: {
    settings(): Promise<Settings>
    updateSettings(patch: Partial<Settings>): Promise<Settings>
    /** Releases RomMix could install for an emulator that ships as a download. */
    emulatorReleases(id: string): Promise<EmulatorRelease[]>
    /** Download an asset and adopt it as that emulator's executable. */
    installEmulator(id: string, asset: EmulatorAsset): Promise<string>
    onInstallProgress(listener: (progress: EmulatorInstallProgress) => void): () => void
    diagnostics(): Promise<DiagnosticsReport>
    root(): Promise<RootLocation>
    /** Repoint RomMix's folder, copying the configuration across. Needs a restart. */
    setRoot(path: string): Promise<RootLocation>
    restart(): Promise<void>
    /** Turn a RomM asset path into a URL the renderer can put in an <img>. */
    imageUrl(path: string | null): string | null
    toggleFullscreen(): Promise<boolean>
    quit(): Promise<void>
  }
}
