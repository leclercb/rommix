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
  EmulatorState,
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
export interface RommixBridge {
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
    emulators(): Promise<EmulatorState[]>
    diagnostics(): Promise<DiagnosticsReport>
    /** Turn a RomM asset path into a URL the renderer can put in an <img>. */
    imageUrl(path: string | null): string | null
    toggleFullscreen(): Promise<boolean>
    quit(): Promise<void>
  }
}
