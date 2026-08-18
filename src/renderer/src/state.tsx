import type { JSX } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  ConnectionStatus,
  DownloadItem,
  DownloadState,
  InstalledRom,
  Settings
} from '@shared/types'

/** Application-wide state: connection, settings, downloads and navigation. */

export type Route =
  | { name: 'connect' }
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'detail'; romId: number }
  | { name: 'downloads' }
  | { name: 'bios' }
  | { name: 'settings' }

export interface Toast {
  id: number
  message: string
  tone: 'ok' | 'error' | 'warn'
  /**
   * What the notification is about, when it is about a game. Every toast
   * concerning one shows the same shape — cover, title, then what happened —
   * so "Download started" and "Game uninstalled" are not two different designs.
   */
  title?: string
  coverPath?: string | null
}

/** The game a notification concerns, if any. */
export interface ToastSubject {
  title: string
  coverPath?: string | null
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
  notify: (message: string, tone?: Toast['tone'], subject?: ToastSubject) => void
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

  const notify = useCallback(
    (message: string, tone: Toast['tone'] = 'ok', subject?: ToastSubject): void => {
    const id = ++toastId
    setToasts((current) => [
      ...current,
      { id, message, tone, title: subject?.title, coverPath: subject?.coverPath }
    ])
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5200)
    },
    []
  )

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
  //
  // Announcing completion needs the *previous* states, not the current ones: an
  // item stays 'done' in the queue until it is cleared, so notifying on the
  // value alone would repeat on every subsequent progress event.
  const seenStates = useRef(new Map<number, DownloadState>())
  useEffect(() => {
    return window.rommix.downloads.onUpdate((items) => {
      setDownloads(items)

      let finished = false
      for (const item of items) {
        const previous = seenStates.current.get(item.romId)
        seenStates.current.set(item.romId, item.state)
        if (previous === item.state) continue

        const subject = { title: item.name, coverPath: item.coverPath }
        if (item.state === 'done') {
          finished = true
          notify('Download complete', 'ok', subject)
        } else if (item.state === 'error' && item.error) {
          notify(item.error, 'error', subject)
        } else if (item.state === 'cancelled') {
          notify('Download cancelled', 'warn', subject)
        }
      }

      // A finished download changes what the library can launch.
      if (finished) void refreshInstalled()
    })
  }, [refreshInstalled, notify])

  useEffect(() => {
    return window.rommix.game.onState((state) => setRunningRomId(state.running ? state.romId : null))
  }, [])

  // The main process reconciles the library against the disk as pages load, so
  // the installed list changes without anything here having asked for it.
  useEffect(() => window.rommix.library.onInstalledChanged(setInstalled), [])

  useEffect(() => {
    return window.rommix.library.onAdopted((entries) => {
      const count = entries.length
      if (count === 1) {
        const entry = entries[0]
        notify('Already on disk — added to your library', 'ok', {
          title: entry.name || entry.fileName,
          coverPath: entry.coverPath
        })
      } else {
        notify(`${count} games were already on disk — added to your library`)
      }
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
