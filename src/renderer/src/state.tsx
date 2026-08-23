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
  platform?: ToastPlatform
}

/** The game or platform a notification concerns, if any. */
export interface ToastSubject {
  title: string
  coverPath?: string | null
  /**
   * A platform rather than a game. Its icon takes the place a cover would
   * occupy, so "scph5501.bin installed" arrives with the console it belongs to
   * shown the same way the rest of the app shows it.
   */
  platform?: ToastPlatform
}

/** What `PlatformIcon` needs to draw a console. */
export interface ToastPlatform {
  slug: string
  system: string | null
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
  /**
   * What the launch is doing before the emulator is up — installing a missing
   * core — or null when there is nothing to say and it is simply running.
   */
  runningStage: string | null

  route: Route
  navigate: (route: Route) => void
  /**
   * Go somewhere and throw the history away.
   *
   * For the two moves that mean "start again" rather than "go deeper": arriving
   * at the library once signed in, and leaving it once signed out. Pushing
   * those leaves the screen behind reachable with B — a connected user one
   * press away from the sign-in form they just finished with — and it also
   * hides the behaviour `App.back` is built around, where running out of
   * history is what makes B climb into the menu and then offer to quit.
   */
  replace: (route: Route) => void
  goBack: () => void
  /** Whether there is a screen behind this one. See `App`, where B runs out. */
  canGoBack: boolean

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
  const [runningStage, setRunningStage] = useState<string | null>(null)
  const [history, setHistory] = useState<Route[]>([{ name: 'home' }])
  const [toasts, setToasts] = useState<Toast[]>([])

  const route = history[history.length - 1]

  const notify = useCallback(
    (message: string, tone: Toast['tone'] = 'ok', subject?: ToastSubject): void => {
      const id = ++toastId
      setToasts((current) => [
        ...current,
        {
          id,
          message,
          tone,
          title: subject?.title,
          coverPath: subject?.coverPath,
          platform: subject?.platform
        }
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

  const replace = useCallback((next: Route): void => {
    setHistory([next])
  }, [])

  const goBack = useCallback((): void => {
    setHistory((current) => (current.length > 1 ? current.slice(0, -1) : current))
  }, [])

  const canGoBack = history.length > 1

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
    return window.rommix.game.onState((state) => {
      setRunningRomId(state.running ? state.romId : null)
      setRunningStage(state.running ? (state.stage ?? null) : null)
    })
  }, [])

  // Anything that failed in the main process, whoever asked for it.
  //
  // Repeats are dropped for a few seconds: one broken server answers every call
  // a screen makes on the way in with the same message, and three identical
  // toasts say nothing the first one did not.
  const lastError = useRef<{ message: string; at: number } | null>(null)
  useEffect(() => {
    return window.rommix.system.onError((message) => {
      const previous = lastError.current
      if (previous && previous.message === message && Date.now() - previous.at < 5000) return
      lastError.current = { message, at: Date.now() }
      notify(message, 'error')
    })
  }, [notify])

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
      runningStage,
      route,
      navigate,
      replace,
      goBack,
      canGoBack,
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
      runningStage,
      route,
      navigate,
      replace,
      goBack,
      canGoBack,
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
