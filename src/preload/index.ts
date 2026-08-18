import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectPayload, GameState, RomMixBridge } from '@shared/api'
import type {
  DownloadItem,
  InstalledRom,
  EmulatorAsset,
  EmulatorInstallProgress,
  RomQuery,
  Settings
} from '@shared/types'

/**
 * The only channel between the renderer and the outside world.
 *
 * Nothing here exposes ipcRenderer itself — each method is a named call onto a
 * fixed channel, so a compromised renderer cannot reach arbitrary IPC.
 */

/** Subscribe to a main-process event, returning an unsubscribe function. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const bridge: RomMixBridge = {
  server: {
    status: () => ipcRenderer.invoke('server:status'),
    connect: (payload: ConnectPayload) => ipcRenderer.invoke('server:connect', payload),
    disconnect: () => ipcRenderer.invoke('server:disconnect'),
    startPairing: (baseUrl: string) => ipcRenderer.invoke('server:startPairing', baseUrl),
    pollPairing: (deviceCode: string, baseUrl: string) =>
      ipcRenderer.invoke('server:pollPairing', deviceCode, baseUrl)
  },
  library: {
    platforms: () => ipcRenderer.invoke('library:platforms'),
    collections: () => ipcRenderer.invoke('library:collections'),
    roms: (query: RomQuery) => ipcRenderer.invoke('library:roms', query),
    rom: (id: number) => ipcRenderer.invoke('library:rom', id),
    installed: () => ipcRenderer.invoke('library:installed'),
    onInstalledChanged: (listener: (installed: InstalledRom[]) => void) =>
      subscribe<InstalledRom[]>('library:installed', listener),
    onAdopted: (listener: (entries: InstalledRom[]) => void) =>
      subscribe<InstalledRom[]>('library:adopted', listener)
  },
  downloads: {
    list: () => ipcRenderer.invoke('downloads:list'),
    start: (romId: number) => ipcRenderer.invoke('downloads:start', romId),
    cancel: (romId: number) => ipcRenderer.invoke('downloads:cancel', romId),
    clearFinished: () => ipcRenderer.invoke('downloads:clearFinished'),
    uninstall: (romId: number) => ipcRenderer.invoke('downloads:uninstall', romId),
    onUpdate: (listener: (items: DownloadItem[]) => void) =>
      subscribe<DownloadItem[]>('downloads:update', listener)
  },
  game: {
    launch: (romId: number) => ipcRenderer.invoke('game:launch', romId),
    stop: () => ipcRenderer.invoke('game:stop'),
    onState: (listener: (state: GameState) => void) => subscribe<GameState>('game:state', listener)
  },
  system: {
    settings: () => ipcRenderer.invoke('system:settings'),
    updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('system:updateSettings', patch),
    emulatorReleases: (id: string) => ipcRenderer.invoke('emulators:releases', id),
    installEmulator: (id: string, asset: EmulatorAsset) =>
      ipcRenderer.invoke('emulators:install', id, asset),
    onInstallProgress: (listener: (progress: EmulatorInstallProgress) => void) =>
      subscribe<EmulatorInstallProgress>('emulators:progress', listener),
    diagnostics: () => ipcRenderer.invoke('system:diagnostics'),
    root: () => ipcRenderer.invoke('system:root'),
    setRoot: (path: string) => ipcRenderer.invoke('system:setRoot', path),
    restart: () => ipcRenderer.invoke('system:restart'),
    // Synchronous on purpose: it only builds a URL string, and <img src> needs
    // it during render.
    imageUrl: (path: string | null) =>
      path ? `rommix-img://asset/?p=${encodeURIComponent(path)}` : null,
    toggleFullscreen: () => ipcRenderer.invoke('system:toggleFullscreen'),
    quit: () => ipcRenderer.invoke('system:quit')
  }
}

contextBridge.exposeInMainWorld('rommix', bridge)
