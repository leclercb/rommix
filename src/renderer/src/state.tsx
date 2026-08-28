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
import { createI18n, localeFor, type I18n } from '@shared/i18n'
import type {
  ConnectionStatus,
  DownloadItem,
  DownloadState,
  InstalledRom,
  Settings,
  UpdateStatus
} from '@shared/types'
import { setSoundEnabled } from './input/sound'

/** Application-wide state: connection, settings, downloads and navigation. */

export type Route =
  | { name: 'connect' }
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'game'; romId: number }
  | { name: 'downloads' }
  /**
   * One shelf on RomM. The name travels with the id: it was on screen in the
   * list that was pressed to get here, so refetching it would put a spinner
   * where the title goes.
   *
   * A number is a collection the user made and a string is one RomM derived —
   * which is the distinction the server itself draws, right down to the query
   * parameter each is passed as.
   */
  | { name: 'collection'; collectionId: number | string; title: string }
  | { name: 'collections' }
  | { name: 'bios' }
  | { name: 'emulators' }
  | { name: 'settings' }

/**
 * The screens that are a place rather than a thing: what the menu bar offers.
 *
 * Going to one of these starts a path instead of continuing one — see
 * `navigate` — which is what keeps B a way *out* rather than a replay of the
 * evening. Everything not named here is something looked at inside a place: a
 * game, a collection's contents.
 */
const SECTIONS: readonly Route['name'][] = [
  'home',
  'library',
  'collections',
  'downloads',
  'bios',
  'emulators',
  'settings'
]

/**
 * Is this the same screen, rather than one of the same kind?
 *
 * What decides whether a move continues the path or returns along it. Opening
 * the game already two steps back is going back to it, and pushing a second
 * copy would make the next B press look like it did nothing.
 */
function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false
  if (a.name === 'game' && b.name === 'game') return a.romId === b.romId
  if (a.name === 'collection' && b.name === 'collection') return a.collectionId === b.collectionId
  return true
}

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
  /**
   * The language everything on screen is written in, with the number and date
   * formats that go with it.
   *
   * Held beside the settings it is derived from rather than in a provider of
   * its own: `Settings.language` is what decides it, and a second context over
   * the same value would only be a second thing to keep in step. `useI18n` is
   * the hook screens actually call.
   */
  i18n: I18n

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
   * The emulator someone started on its own, from the Emulators page, or null.
   *
   * The other way something can be in front of RomMix. It is not a session —
   * there is no game and nothing to sync — but the screen belongs to it just
   * the same, so the same overlay says so.
   */
  runningEmulator: string | null
  /**
   * What the launch is doing before the emulator is up — installing a missing
   * core — or null when there is nothing to say and it is simply running.
   */
  runningStage: string | null

  /**
   * RomMix's own version, and what is being done about a newer one.
   *
   * Held here rather than in the Settings screen because the news has to reach
   * someone who is not on it: the check runs on a timer in the main process, and
   * what it finds becomes a notification and a mark on the menu.
   */
  update: UpdateStatus | null
  refreshUpdate: () => Promise<void>

  route: Route
  /**
   * Go to a screen, keeping the way back to where it hangs from.
   *
   * A path, not a log. A section replaces whatever was on screen, because a
   * section is where a path starts; anything else is a step deeper and is
   * pushed onto the one being walked, unless it is already on it, in which case
   * this is a walk back to it. So the most B ever has to undo is collections,
   * then a collection, then a game — never the ten screens somebody looked at
   * on the way, which was a back button that took a dozen presses to leave.
   */
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
  /** Whether this screen hangs off another. See `navigate`, and `App.back`. */
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
  const [runningEmulator, setRunningEmulator] = useState<string | null>(null)
  const [runningStage, setRunningStage] = useState<string | null>(null)
  const [history, setHistory] = useState<Route[]>([{ name: 'home' }])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [update, setUpdate] = useState<UpdateStatus | null>(null)

  const route = history[history.length - 1]

  /**
   * `auto` asks the browser, which under Electron is the desktop's own locale.
   * Recomputed from the setting alone, so changing the language in Settings
   * redraws every screen in it without a restart.
   */
  const i18n = useMemo(
    () => createI18n(localeFor(settings?.language, navigator.language)),
    [settings?.language]
  )

  // So the page itself says what it is written in: hyphenation, spell checking
  // and screen readers all read this rather than guessing from the text.
  useEffect(() => {
    document.documentElement.lang = i18n.locale
  }, [i18n])

  // Told to the input layer rather than read by it: the cues are played from
  // inside the focus engine, which has no business holding a settings object.
  // Silent until the settings have arrived, so nothing clicks on a screen the
  // user has not reached yet.
  useEffect(() => {
    setSoundEnabled(settings?.navigationSounds ?? false)
  }, [settings?.navigationSounds])

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

  const refreshUpdate = useCallback(async (): Promise<void> => {
    setUpdate(await window.rommix.updates.status())
  }, [])

  const saveSettings = useCallback(async (patch: Partial<Settings>): Promise<void> => {
    setSettings(await window.rommix.system.updateSettings(patch))
  }, [])

  const navigate = useCallback((next: Route): void => {
    setHistory((current) => {
      if (SECTIONS.includes(next.name)) return [next]
      const at = current.findIndex((step) => sameRoute(step, next))
      return at >= 0 ? current.slice(0, at + 1) : [...current, next]
    })
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
      // Whatever the main process already knows — a check that ran before this
      // window existed, or an image downloaded during the previous session.
      setUpdate(await window.rommix.updates.status())
      if (!nextStatus.connected) setHistory([{ name: 'connect' }])
    })()
  }, [])

  /**
   * The update, and the two moments in it worth interrupting for.
   *
   * Announced from the states rather than from the events: a download emits
   * progress several times a second, and every one of those carries the same
   * `available`. What is new is the pair — this state, for this version — so
   * each pair is announced once and the rest pass silently into the panel and
   * the mark on the menu.
   */
  const announced = useRef<string | null>(null)
  useEffect(() => {
    return window.rommix.updates.onStatus((next) => {
      setUpdate(next)
      if (!next.latest) return

      const key = `${next.state}:${next.latest}`
      if (announced.current === key) return

      if (next.state === 'available') {
        announced.current = key
        notify(
          // What happens next differs by policy, and saying nothing about it
          // leaves "available" reading as "and RomMix is doing nothing".
          next.blockedReason
            ? i18n.t('toast.updateAvailableSettings', { version: next.latest })
            : i18n.t('toast.updateAvailable', { version: next.latest }),
          next.blockedReason ? 'warn' : 'ok'
        )
      } else if (next.state === 'ready') {
        announced.current = key
        notify(
          // Under Steam there is no restarting from here — see
          // `UpdateStatus.restartBlocked` — so the instruction is the one that
          // works there rather than a button this toast cannot offer.
          next.restartBlocked
            ? i18n.t('toast.updateReadyQuit', { version: next.latest })
            : i18n.t('toast.updateReadyRestart', { version: next.latest }),
          'ok'
        )
      }
    })
  }, [notify, i18n])

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
          notify(i18n.t('toast.downloadComplete'), 'ok', subject)
        } else if (item.state === 'error' && item.error) {
          notify(item.error, 'error', subject)
        } else if (item.state === 'cancelled') {
          notify(i18n.t('toast.downloadCancelled'), 'warn', subject)
        } else if (item.state === 'paused' && previous !== undefined) {
          /**
           * A transfer that stopped, however it stopped.
           *
           * Both ways it happens are worth saying: a network that went away
           * takes a download with it silently otherwise, and a pause the user
           * asked for is confirmed the same way cancelling one is.
           *
           * Only where the row was already being watched. A transfer restored
           * at start-up arrives paused with nothing before it, and announcing
           * that would greet every launch with news of something that happened
           * yesterday.
           */
          notify(i18n.t('toast.downloadPaused'), 'warn', subject)
        } else if (previous === 'paused') {
          // The one transition that can only be a resume, which is why it is
          // read from where it came rather than from where it is going: a
          // download becomes queued when it starts, too.
          notify(i18n.t('toast.downloadResumed'), 'ok', subject)
        }
      }

      // A finished download changes what the library can launch.
      if (finished) void refreshInstalled()
    })
  }, [refreshInstalled, notify, i18n])

  useEffect(() => {
    return window.rommix.running.onState((state) => {
      setRunningRomId(state.running ? state.romId : null)
      setRunningEmulator(state.running ? (state.emulator ?? null) : null)
      setRunningStage(state.running ? (state.stage ?? null) : null)
    })
  }, [])

  /**
   * Anything that failed in the main process, whoever asked for it.
   *
   * Repeats are dropped for a few seconds: one broken server answers every call
   * a screen makes on the way in with the same message, the pairing screen goes
   * on asking on a timer while it waits, and three identical toasts say nothing
   * the first one did not.
   *
   * The web preview is the one place that rule is wrong. Nothing there polls
   * and nothing there is broken: every error it raises is the demo turning down
   * a button that was just pressed, so collapsing them answers the second press
   * with silence — which is the thing the message was added to prevent. The
   * flag is a compile-time constant, so this is dropped from the bundle the app
   * ships.
   */
  const lastError = useRef<{ message: string; at: number } | null>(null)
  useEffect(() => {
    return window.rommix.system.onError((message) => {
      if (!import.meta.env.VITE_WEB_PREVIEW) {
        const previous = lastError.current
        if (previous && previous.message === message && Date.now() - previous.at < 5000) return
        lastError.current = { message, at: Date.now() }
      }
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
        notify(i18n.t('toast.adoptedOne'), 'ok', {
          title: entry.name || entry.fileName,
          coverPath: entry.coverPath
        })
      } else {
        notify(i18n.t('toast.adoptedMany', { count }))
      }
    })
  }, [notify, i18n])

  const installedIds = useMemo(() => new Set(installed.map((item) => item.romId)), [installed])

  const value = useMemo<AppState>(
    () => ({
      i18n,
      status,
      refreshStatus,
      settings,
      saveSettings,
      downloads,
      installed,
      installedIds,
      refreshInstalled,
      runningRomId,
      runningEmulator,
      runningStage,
      update,
      refreshUpdate,
      route,
      navigate,
      replace,
      goBack,
      canGoBack,
      toasts,
      notify
    }),
    [
      i18n,
      status,
      refreshStatus,
      settings,
      saveSettings,
      downloads,
      installed,
      installedIds,
      refreshInstalled,
      runningRomId,
      runningEmulator,
      runningStage,
      update,
      refreshUpdate,
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

/**
 * The catalogue and the formatters, for a component that only needs words.
 *
 * The same object `useApp().i18n` returns — this exists so that a button or a
 * badge can be translated without reaching for the whole application state, and
 * so `const { t } = useI18n()` is the one line every screen starts with.
 */
export function useI18n(): I18n {
  return useApp().i18n
}
