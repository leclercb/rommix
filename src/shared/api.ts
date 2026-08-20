import type {
  BiosPlatform,
  BiosReport,
  BiosSyncResult,
  ConnectionStatus,
  DiagnosticsReport,
  DownloadItem,
  InstalledRom,
  LaunchChoice,
  LaunchResult,
  LibrarySyncResult,
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
  SaveAsset,
  SavePushPreview,
  SaveSyncResult,
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

/** Emitted while a long "check everything" pass is running. */
export interface SyncProgress {
  checked: number
  total: number
}

/** Emitted while BIOS files are being fetched. */
export interface BiosProgress {
  done: number
  total: number
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
    /**
     * Check every ROM on the server against the disk: forget what has been
     * deleted, adopt what is there. Slow by design, so it is a button.
     */
    sync(): Promise<LibrarySyncResult>
    onSyncProgress(listener: (progress: SyncProgress) => void): () => void
    /** The installed list changed — a download finished, or a ROM was adopted. */
    onInstalledChanged(listener: (installed: InstalledRom[]) => void): () => void
    /** ROMs found already on disk rather than downloaded. */
    onAdopted(listener: (entries: InstalledRom[]) => void): () => void
  }
  saves: {
    /**
     * Every save and state this game has, on RomM and on this device, one row
     * per file name with a sync state each.
     */
    list(romId: number): Promise<SaveAsset[]>
    /** Fetch newer remote saves now, ignoring the automatic-sync preference. */
    pull(romId: number): Promise<SaveSyncResult>
    /** Send every local save for this game to RomM, not only this session's. */
    push(romId: number): Promise<SaveSyncResult>
    /**
     * The same list `push` would send, without sending it — for the
     * confirmation dialog behind the `confirmSavePush` setting.
     */
    pushPreview(romId: number): Promise<SavePushPreview>
    /**
     * Send exactly the files a confirmation dialog approved, by local path.
     *
     * Also how the automatic push completes: when confirmation is on, the
     * launch result carries the session's files instead of uploading them.
     */
    pushSelected(romId: number, paths: string[]): Promise<SaveSyncResult>
    /** Delete one asset, from the server and from this device. */
    remove(romId: number, kind: 'save' | 'state', id: number): Promise<void>
  }
  bios: {
    /** Per platform: what is needed, what the server holds, what is in place. */
    list(): Promise<BiosReport>
    /** One platform's row, cheap enough for a game page. Null when unknowable. */
    platform(platformId: number): Promise<BiosPlatform | null>
    install(firmwareId: number): Promise<string>
    /**
     * Install every BIOS file the server holds that is not already in place —
     * for one platform, or for the whole library when no platform is named.
     */
    syncAll(platformId?: number | null): Promise<BiosSyncResult>
    onProgress(listener: (progress: BiosProgress) => void): () => void
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
    /**
     * The ways this game can be run, and whether the user has already chosen.
     * Fewer than two options means there is nothing to ask about.
     */
    variants(romId: number): Promise<LaunchChoice>
    /** `variant` is remembered for the platform once passed. */
    launch(romId: number, variant?: string): Promise<LaunchResult>
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
    /** Install an emulator that ships as a flatpak, from Flathub. */
    installEmulatorFlatpak(id: string): Promise<void>
    /** Start an emulator on its own, so it can be set up. Returns the command. */
    runEmulator(id: string): Promise<string>
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
    /**
     * Every failed call across this bridge, reported centrally.
     *
     * The renderer turns these into notifications, so a call that fails is
     * always visible even when the code that made it only wanted the value.
     */
    onError(listener: (message: string) => void): () => void
  }
}
