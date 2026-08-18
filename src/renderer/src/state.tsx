import type { JSX } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { ConnectionStatus, DownloadItem, InstalledRom, Settings } from '@shared/types'

/** Application-wide state: connection, settings, downloads and navigation. */

export type Route =
  | { name: 'connect' }
  | { name: 'home' }
  | { name: 'library'; platformId?: number }
  | { name: 'detail'; romId: number }
  | { name: 'downloads' }
  | { name: 'settings' }

export interface Toast {
  id: number
  message: string
  tone: 'ok' | 'error' | 'warn'
}

interface AppState {
  status: ConnectionStatus | null
  refreshStatus: () => Promise<ConnectionStatus>
  settings: Settings | null
  saveSettings: (patch: Partial<Settings>) => Promise<void>

  downloads: DownloadItem[]
  installed: InstalledRom[]
  installedIds: Set<number>
  refreshInstalled: () => Promise<void>

  runningRomId: number | null

  route: Route
  navigate: (route: Route) => void
  goBack: () => void

  toasts: Toast[]
  notify: (message: string, tone?: Toast['tone']) => void
}

const AppContext = createContext<AppState | null>(null)

let toastId = 0

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [installed, setInstalled] = useState<InstalledRom[]>([])
  const [runningRomId, setRunningRomId] = useState<number | null>(null)
  const [history, setHistory] = useState<Route[]>([{ name: 'home' }])
  const [toasts, setToasts] = useState<Toast[]>([])

  const route = history[history.length - 1]

  const notify = useCallback((message: string, tone: Toast['tone'] = 'ok'): void => {
    const id = ++toastId
    setToasts((current) => [...current, { id, message, tone }])
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5200)
  }, [])

  const refreshStatus = useCallback(async (): Promise<ConnectionStatus> => {
    const next = await window.rommix.server.status()
    setStatus(next)
    return next
  }, [])

  const refreshInstalled = useCallback(async (): Promise<void> => {
    setInstalled(await window.rommix.library.installed())
  }, [])

  const saveSettings = useCallback(async (patch: Partial<Settings>): Promise<void> => {
    setSettings(await window.rommix.system.updateSettings(patch))
  }, [])

  const navigate = useCallback((next: Route): void => {
    setHistory((current) => [...current, next])
  }, [])

  const goBack = useCallback((): void => {
    setHistory((current) => (current.length > 1 ? current.slice(0, -1) : current))
  }, [])

  // Initial load: decide between the connect screen and the library.
  useEffect(() => {
    void (async () => {
      const [nextStatus, nextSettings] = await Promise.all([
        window.rommix.server.status(),
        window.rommix.system.settings()
      ])
      setStatus(nextStatus)
      setSettings(nextSettings)
      setDownloads(await window.rommix.downloads.list())
      setInstalled(await window.rommix.library.installed())
      if (!nextStatus.connected) setHistory([{ name: 'connect' }])
    })()
  }, [])

  // Live download progress from the main process.
  useEffect(() => {
    return window.rommix.downloads.onUpdate((items) => {
      setDownloads(items)
      // A finished download changes what the library can launch.
      if (items.some((item) => item.state === 'done')) void refreshInstalled()
    })
  }, [refreshInstalled])

  useEffect(() => {
    return window.rommix.game.onState((state) => setRunningRomId(state.running ? state.romId : null))
  }, [])

  // The main process reconciles the library against the disk as pages load, so
  // the installed list changes without anything here having asked for it.
  useEffect(() => window.rommix.library.onInstalledChanged(setInstalled), [])

  useEffect(() => {
    return window.rommix.library.onAdopted((entries) => {
      const count = entries.length
      notify(
        count === 1
          ? `${entries[0].fileName} was already on disk — added to your library`
          : `${count} games were already on disk — added to your library`
      )
    })
  }, [notify])

  const installedIds = useMemo(() => new Set(installed.map((item) => item.romId)), [installed])

  const value = useMemo<AppState>(
    () => ({
      status,
      refreshStatus,
      settings,
      saveSettings,
      downloads,
      installed,
      installedIds,
      refreshInstalled,
      runningRomId,
      route,
      navigate,
      goBack,
      toasts,
      notify
    }),
    [
      status,
      refreshStatus,
      settings,
      saveSettings,
      downloads,
      installed,
      installedIds,
      refreshInstalled,
      runningRomId,
      route,
      navigate,
      goBack,
      toasts,
      notify
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside an AppProvider')
  return ctx
}
