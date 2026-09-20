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
import {
  DEFAULT_THEME,
  isStopped,
  type ConnectionStatus,
  type DownloadItem,
  type DownloadState,
  type InstalledRom,
  type SavesWaiting,
  type Settings,
  type UpdateStatus
} from '@shared/types'
import { setSoundEnabled } from './input/sound'
import { popRoute, prunedForOffline, pushRoute, type Route } from './history'
import { fileNameOf } from '@shared/gamefiles'

/** Application-wide state: connection, settings, downloads and navigation. */

// Where RomMix is, and the rules for moving between screens, live in
// `history.ts` — pure, and testable for it. Re-exported because this is where
// every screen already reaches for the type.
export type { Route, SettingsTarget } from './history'

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
  /**
   * Signed in and the server is not answering, or null before it has been
   * asked. See `ConnectionStatus.offline`.
   *
   * Three states rather than two, because the moment before the first answer is
   * neither of the other two and the two kinds of caller want it read
   * differently. Chrome that only appears offline — a warning, a control that
   * is hidden — reads it as a plain condition, so an unknown answer draws the
   * ordinary screen and nothing flickers on every start. Anything that would
   * *ask the server* has to wait for `offline === false` instead: fetching
   * before the first answer is how a screen that should have narrowed puts up
   * a fetch error and keeps it.
   */
  offline: boolean | null
  refreshStatus: () => Promise<ConnectionStatus>
  settings: Settings | null
  saveSettings: (patch: Partial<Settings>) => Promise<void>

  installed: InstalledRom[]
  installedIds: Set<number>
  refreshInstalled: () => Promise<void>
  /**
   * Games with saves on this device that RomM has not been given.
   *
   * The game screen draws a notice for these, and reads the same list to
   * decide whether Push saves should ask first. See `saves:waiting`.
   */
  unsentSaves: SavesWaiting[]

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

  notify: (message: string, tone?: Toast['tone'], subject?: ToastSubject) => void
}

const AppContext = createContext<AppState | null>(null)

/**
 * The two things that change while nobody has touched anything, each on a
 * context of its own.
 *
 * A transfer reports progress several times a second and a notification comes
 * and goes on a timer, so both would invalidate an application state every
 * screen reads — and a screen redrawn on a timer is a screen redrawn while the
 * player is looking at it. Held apart, a tick reaches the progress bars and the
 * one notification tray and nothing else.
 *
 * What is *done* to them stays on `AppState`: `notify` never changes, so a
 * component that only raises notifications is not a component that redraws for
 * them.
 */
const DownloadsContext = createContext<DownloadItem[] | null>(null)
const ToastsContext = createContext<Toast[] | null>(null)

/**
 * The words, apart from the state that changes under them.
 *
 * `useI18n` is the line nearly every component in the interface starts with —
 * `GameCard` among them — so reading it off `AppState` made every cover on
 * screen a consumer of everything on that object. A self-update reports progress
 * several times a second through `update`, and `installed` changes as library
 * pages land, so a grid of a few hundred cards was re-rendering on a timer for
 * words that had not changed. This changes only with the language and the date
 * format, which is to say twice in a session at most.
 *
 * `input/focus.test.tsx` counts what one focus move wakes up; nothing counts
 * what a tick of the other contexts wakes up, which is why this is worth
 * keeping apart rather than measuring.
 */
const I18nContext = createContext<I18n | null>(null)

/** What the updater is doing, which it reports as often as bytes arrive. */
const UpdateContext = createContext<UpdateStatus | null>(null)

/**
 * How the first load is tried again, where the two answers it cannot draw
 * without do not come.
 *
 * Retried, and not for long: what could be in the way is the main process
 * rather than the network, and every moment of it is a blank screen with
 * nothing to press. Past the last go the screen stays as it is, the failure
 * having been reported the way every failed call is.
 */
const BOOT_RETRY_MS = 2000
const BOOT_ATTEMPTS = 5

/**
 * How long a toast stays up.
 *
 * Long enough to be read from a sofa without being chased, and short enough
 * that two in a row do not stack into a wall. Nothing depends on it having
 * gone: every toast is also a line in the log.
 */
const TOAST_MS = 5200

/**
 * How long the same error is treated as the same error.
 *
 * One failure in the main process can surface on several channels at once — a
 * server that went away answers every call in flight — and a toast apiece says
 * the same sentence three times. Long enough to cover one burst, short enough
 * that a fault which is genuinely recurring is still reported as recurring.
 */
const REPEAT_ERROR_MS = 5000

let toastId = 0

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [installed, setInstalled] = useState<InstalledRom[]>([])
  const [runningRomId, setRunningRomId] = useState<number | null>(null)
  const [runningEmulator, setRunningEmulator] = useState<string | null>(null)
  const [runningStage, setRunningStage] = useState<string | null>(null)
  const [history, setHistory] = useState<readonly Route[]>([{ name: 'home' }])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [unsentSaves, setUnsentSaves] = useState<SavesWaiting[]>([])

  const route = history[history.length - 1]

  /**
   * `auto` asks the browser, which under Electron is the desktop's own locale.
   * Recomputed from the setting alone, so changing the language in Settings
   * redraws every screen in it without a restart.
   */
  const i18n = useMemo(
    () => createI18n(localeFor(settings?.language, navigator.language), settings?.dateFormat),
    [settings?.language, settings?.dateFormat]
  )

  // So the page itself says what it is written in: hyphenation, spell checking
  // and screen readers all read this rather than guessing from the text.
  useEffect(() => {
    document.documentElement.lang = i18n.locale
  }, [i18n])

  // On the root element, where `themes.css` looks for it — and set from here
  // rather than written into the markup, so choosing a theme in Settings
  // repaints the interface with nothing reloaded. Midnight until the settings
  // have arrived, which is what `base.css` already draws.
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? DEFAULT_THEME
  }, [settings?.theme])

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
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), TOAST_MS)
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
    setHistory((current) => pushRoute(current, next))
  }, [])

  const replace = useCallback((next: Route): void => {
    setHistory([next])
  }, [])

  const goBack = useCallback((): void => {
    setHistory(popRoute)
  }, [])

  const canGoBack = history.length > 1

  /**
   * Initial load: decide between setup and the library.
   *
   * Two answers the interface cannot be drawn without, and three it can. The
   * status and the settings are tried again if they do not come — see
   * `BOOT_ATTEMPTS` — since without them there is nothing on screen to press.
   * The rest are asked once each and left to the report every failed call
   * makes: a queue that cannot be read back is a toast over a working library,
   * not a reason to ask for the settings again.
   */
  useEffect(() => {
    let timer: number | null = null
    let listening = true
    const load = async (attempt: number): Promise<void> => {
      let nextStatus: ConnectionStatus
      try {
        const [answered, nextSettings] = await Promise.all([
          window.rommix.server.status(),
          window.rommix.system.settings()
        ])
        if (!listening) return
        nextStatus = answered
        setStatus(answered)
        setSettings(nextSettings)
      } catch {
        if (listening && attempt < BOOT_ATTEMPTS) {
          timer = window.setTimeout(() => void load(attempt + 1), BOOT_RETRY_MS)
        }
        return
      }
      // A server that did not answer is not a reason to ask for the sign-in
      // form again: the credentials are fine, the games are on the disk, and
      // Home shows them. Anything else — never set up, or credentials RomM
      // refuses — has nowhere to go but Connect.
      if (!nextStatus.connected && !nextStatus.offline) setHistory([{ name: 'setup' }])

      const [queue, onDisk, known] = await Promise.all([
        window.rommix.downloads.list().catch(() => null),
        window.rommix.library.installed().catch(() => null),
        // Whatever the main process already knows — a check that ran before
        // this window existed, or an image downloaded during the previous
        // session.
        window.rommix.updates.status().catch(() => null)
      ])
      if (!listening) return
      if (queue) setDownloads(queue)
      if (onDisk) setInstalled(onDisk)
      if (known) setUpdate(known)
    }
    void load(1)
    return () => {
      listening = false
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  /**
   * The server coming and going, which nothing on screen asked about.
   *
   * A handheld carried out of range makes no requests to fail, so this is the
   * only thing that notices — and the screens that need RomM have to give way
   * before somebody presses one of them, not after. See `ConnectionWatch`.
   */
  const offline = status === null ? null : status.offline
  useEffect(() => {
    return window.rommix.server.onStatus(setStatus)
  }, [])

  /**
   * The installed list as the last render saw it, for a subscription that must
   * not be torn down and rebuilt every time a game is downloaded.
   */
  const installedNow = useRef<InstalledRom[]>([])
  useEffect(() => {
    installedNow.current = installed
  }, [installed])

  /**
   * Saves a reconnection handed over by itself.
   *
   * The one thing worth saying out loud about this: it happened without anybody
   * asking, so it is news. Its opposite — what RomMix would not send unasked —
   * is deliberately not announced anywhere, because a notification about
   * something the user has to come back to is a notification that comes back.
   * That is a notice on the game's own page, where the button that answers it
   * is.
   */
  useEffect(() => {
    return window.rommix.saves.onSent((romIds) => {
      if (romIds.length === 0) return
      // One game is a game, and every notification about one in RomMix carries
      // its cover and its name. Several is a number, there being no single
      // cover to show.
      const only =
        romIds.length === 1
          ? installedNow.current.find((entry) => entry.romId === romIds[0])
          : undefined
      notify(
        only
          ? i18n.t('saves.sentAutomaticallyOne')
          : i18n.t('saves.sentAutomatically', { count: romIds.length }),
        'ok',
        only ? { title: only.name, coverPath: only.coverPath } : undefined
      )
    })
  }, [notify, i18n])

  /**
   * The games whose saves are on this disk and not on RomM.
   *
   * Held here rather than fetched by the screen that draws it, because it
   * changes without anybody having asked: a reconnection sends what it safely
   * can, and what is left is what this holds.
   *
   * Not a notification. Something outstanding is worth seeing, and a warning
   * that reappears until it is dealt with is a warning that teaches people to
   * ignore warnings.
   */
  useEffect(() => {
    /**
     * Whether a pushed list has already arrived.
     *
     * The first ask is slow — it lists both ends for every outstanding game —
     * and the catch-up finishes with a list of its own. Landing second, the
     * ask would put back the games the catch-up had just sent.
     */
    let pushed = false
    void window.rommix.saves.waiting().then((waiting) => {
      if (!pushed) setUnsentSaves(waiting)
    })
    return window.rommix.saves.onWaiting((waiting) => {
      pushed = true
      setUnsentSaves(waiting)
    })
  }, [])

  /**
   * Off a screen that has just stopped working.
   *
   * The whole path rather than the screen on top of it: a game opened from a
   * collection is still perfectly readable offline, and leaving the collection
   * underneath it would make B a press onto a screen with nothing on it. What
   * is left hangs off Home, which is where the menu starts.
   *
   * Nothing to undo on the way back: every other screen narrows rather than
   * going, so the path is still a path once RomM answers again.
   */
  useEffect(() => {
    if (!offline) return
    setHistory(prunedForOffline)
  }, [offline])

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
  //
  // Only what happens unbidden is announced from here. Starting a transfer and
  // picking one up again are presses that come back with an answer, and the
  // button that made them is the only thing that knows what was asked for —
  // read off a state instead, a game promoted to the front of the queue passes
  // through 'queued' on its way to the wire and gets announced as waiting.
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
        } else if (isStopped(item.state) && previous !== undefined) {
          /**
           * A transfer that stopped, however it stopped.
           *
           * Every way it happens is worth saying: a network that went away
           * takes a download with it silently otherwise, and a pause the user
           * asked for is confirmed the same way cancelling one is.
           *
           * A row that carries a reason stopped for one, and the reason is what
           * gets said. A file refused for its hash pauses like any other —
           * the rest of a multi-file game is still on disk and worth keeping —
           * so the generic phrase would be the only account of bytes that were
           * thrown away. See `DownloadManager.runOne`.
           *
           * Only where the row was already being watched. A transfer restored
           * at start-up arrives paused with nothing before it, and announcing
           * that would greet every launch with news of something that happened
           * yesterday.
           */
          if (item.error) notify(item.error, 'error', subject)
          else if (item.state === 'stalled')
            notify(i18n.t('toast.downloadWaitingForServer'), 'warn', subject)
          else notify(i18n.t('toast.downloadPaused'), 'warn', subject)
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
        if (previous && previous.message === message && Date.now() - previous.at < REPEAT_ERROR_MS)
          return
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
          title: entry.name || fileNameOf(entry.path),
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
      offline,
      refreshStatus,
      settings,
      saveSettings,
      installed,
      installedIds,
      refreshInstalled,
      unsentSaves,
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
      notify
    }),
    [
      i18n,
      status,
      offline,
      refreshStatus,
      settings,
      saveSettings,
      installed,
      installedIds,
      refreshInstalled,
      unsentSaves,
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
      notify
    ]
  )

  return (
    <I18nContext.Provider value={i18n}>
      <AppContext.Provider value={value}>
        <UpdateContext.Provider value={update}>
          <DownloadsContext.Provider value={downloads}>
            <ToastsContext.Provider value={toasts}>{children}</ToastsContext.Provider>
          </DownloadsContext.Provider>
        </UpdateContext.Provider>
      </AppContext.Provider>
    </I18nContext.Provider>
  )
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside an AppProvider')
  return ctx
}

/** The download queue, for the screens that draw it. See `DownloadsContext`. */
export function useDownloads(): DownloadItem[] {
  const ctx = useContext(DownloadsContext)
  if (!ctx) throw new Error('useDownloads must be used inside an AppProvider')
  return ctx
}

/** The notifications on screen, for the tray that draws them. Same note. */
export function useToasts(): Toast[] {
  const ctx = useContext(ToastsContext)
  if (!ctx) throw new Error('useToasts must be used inside an AppProvider')
  return ctx
}

/**
 * The catalogue and the formatters, for a component that only needs words.
 *
 * Its own context rather than a field of `AppState`, so that a button or a badge
 * is translated without becoming a consumer of everything else on that object —
 * see `I18nContext`. `const { t } = useI18n()` stays the one line every screen
 * starts with; what changed is what it costs.
 */
export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside an AppProvider')
  return ctx
}

/** What the updater is doing, for the one panel that draws it. */
export function useUpdate(): UpdateStatus | null {
  return useContext(UpdateContext)
}
