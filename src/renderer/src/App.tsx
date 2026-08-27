import { useCallback, useEffect, useState, type JSX, type Ref } from 'react'
import {
  CoverArt,
  FocusButton,
  Logo,
  Overlay,
  PlatformIcon,
  QuitOverlay,
  Spinner
} from './components'
import {
  FocusZone,
  useAction,
  useFocusable,
  useFocusContext,
  useKeyLabel,
  useSuspendGamepad
} from './input/focus'
import { Icon, type IconName } from './icons'
import { useApp, useI18n, type Route, type Toast } from './state'
import { BiosScreen } from './screens/Bios'
import { ConnectScreen } from './screens/Connect'
import { GameScreen } from './screens/Game'
import { CollectionScreen } from './screens/Collections/CollectionScreen'
import { CollectionsScreen } from './screens/Collections'
import { DownloadsScreen } from './screens/Downloads'
import { EmulatorsScreen } from './screens/Emulators'
import { HomeScreen } from './screens/Home'
import { LibraryScreen } from './screens/Library'
import { SettingsScreen } from './screens/Settings'

/** App shell: navigation bar, the current screen, and global overlays. */
export function App(): JSX.Element {
  const { t } = useI18n()
  const {
    route,
    goBack,
    canGoBack,
    navigate,
    downloads,
    runningRomId,
    runningEmulator,
    toasts,
    status,
    update
  } = useApp()
  const { enterZone } = useFocusContext()
  const [confirmingQuit, setConfirmingQuit] = useState(false)

  /**
   * B / Escape, and what it means once there is nothing above.
   *
   * Going up is the whole of it while something is: a game hangs off the
   * section it was opened from, a collection's contents off Collections. On a
   * section itself nothing is, and a button that does nothing is a button the
   * player assumes is broken — so it climbs instead, the way every console does
   * it: out of the page to the menu, and from the menu out of RomMix. Quitting
   * is asked rather than done, because the same press arrives there by
   * accident.
   *
   * Three presses from anywhere, then, and never more: what `navigate` keeps is
   * the path to the current screen and not the screens visited on the way.
   */
  const back = useCallback((): void => {
    if (canGoBack) return goBack()
    if (enterZone('nav')) return
    setConfirmingQuit(true)
  }, [canGoBack, goBack, enterZone])

  // Everywhere except the connect screen, which has neither a history nor a
  // menu bar to climb into.
  useAction('back', back, route.name !== 'connect')

  // X / Start opens Settings: on a console this button is the menu, and
  // Settings is where every switch in RomMix lives.
  useAction('menu', () => navigate({ name: 'settings' }), route.name !== 'settings')

  // Whatever is in front of RomMix — a game, or an emulator opened on its own
  // to change a setting in — owns the pad. Here rather than inside the overlay
  // so it holds for the whole session, including the moment before the overlay
  // has mounted.
  const covered = runningRomId !== null || runningEmulator !== null
  useSuspendGamepad(covered)

  if (route.name === 'connect') {
    return (
      <div className="app">
        <ConnectScreen />
        {covered ? <RunningOverlay /> : null}
        <Toasts toasts={toasts} />
      </div>
    )
  }

  const activeDownloads = downloads.filter(
    (item) => item.state === 'downloading' || item.state === 'queued' || item.state === 'extracting'
  ).length

  /**
   * The new version, on the menu item that leads to it.
   *
   * The toast that announced it lasts five seconds, and a machine that checked
   * while nobody was watching has none. This is the part that stays: the version
   * number itself rather than a count, because "Settings 1" says there is
   * something and not what.
   */
  const updateBadge =
    update && update.latest && update.state !== 'idle' && update.state !== 'checking'
      ? update.latest
      : undefined

  return (
    <div className="app">
      <FocusZone id="nav">
        {/* The mark on the left, the menu across the middle, who you are on the
            right: the same three slots RomM's own bar has. The brand and the
            status flank the menu as equal tracks so the menu is centred on the
            screen rather than on whatever is left over beside them. */}
        <header className="topbar">
          <div className="topbar__brand">
            <Logo className="topbar__logo" />
            <div className="topbar__wordmark">
              Rom<span>Mix</span>
            </div>
          </div>

          <nav className="topbar__nav">
            <NavItem
              icon="home"
              label={t('nav.home')}
              route={{ name: 'home' }}
              active={route.name === 'home'}
            />
            <NavItem
              icon="library"
              label={t('nav.library')}
              route={{ name: 'library' }}
              active={route.name === 'library'}
            />
            <NavItem
              icon="collection"
              label={t('nav.collections')}
              route={{ name: 'collections' }}
              active={route.name === 'collections' || route.name === 'collection'}
            />
            <NavItem
              icon="downloads"
              label={t('nav.downloads')}
              route={{ name: 'downloads' }}
              active={route.name === 'downloads'}
              badge={activeDownloads > 0 ? activeDownloads : undefined}
            />
            <NavItem
              icon="bios"
              label={t('nav.bios')}
              route={{ name: 'bios' }}
              active={route.name === 'bios'}
            />
            <NavItem
              icon="emulator"
              label={t('nav.emulators')}
              route={{ name: 'emulators' }}
              active={route.name === 'emulators'}
            />
            <NavItem
              icon="settings"
              label={t('nav.settings')}
              route={{ name: 'settings' }}
              active={route.name === 'settings'}
              badge={updateBadge}
            />
          </nav>

          {/* The mark sits after the text rather than before it, because this
              block is right-aligned: leading icons would leave the two glyphs
              in a ragged column against the words, while trailing ones line up
              against the edge the whole bar ends on. */}
          <div className="topbar__status">
            {status?.connected ? (
              <>
                <span className="topbar__user">
                  <span>{status.user?.username}</span>
                  <Icon name="user" size={15} />
                </span>
                <span className="topbar__host">
                  <span>{hostOf(status.baseUrl)}</span>
                  <Icon name="server" size={15} />
                </span>
              </>
            ) : (
              <span className="topbar__host">
                <span>{t('app.notConnected')}</span>
                <Icon name="warn" size={15} />
              </span>
            )}
          </div>
        </header>
      </FocusZone>

      <FocusZone id="content">
        <Screen route={route} />
      </FocusZone>

      {confirmingQuit ? <QuitOverlay onCancel={() => setConfirmingQuit(false)} /> : null}

      {covered ? <RunningOverlay /> : null}
      <Toasts toasts={toasts} />
    </div>
  )
}

function Screen({ route }: { route: Route }): JSX.Element {
  switch (route.name) {
    case 'home':
      return <HomeScreen />
    case 'library':
      return <LibraryScreen />
    case 'game':
      return <GameScreen romId={route.romId} />
    case 'collections':
      return <CollectionsScreen />
    case 'collection':
      return <CollectionScreen collectionId={route.collectionId} title={route.title} />
    case 'downloads':
      return <DownloadsScreen />
    case 'bios':
      return <BiosScreen />
    case 'emulators':
      return <EmulatorsScreen />
    case 'settings':
      return <SettingsScreen />
    case 'connect':
      return <ConnectScreen />
  }
}

function NavItem({
  icon,
  label,
  route,
  active,
  badge
}: {
  icon: IconName
  label: string
  route: Route
  active: boolean
  /** A count, as Downloads has, or a short word — the new version on Settings. */
  badge?: number | string
}): JSX.Element {
  const { navigate } = useApp()
  const { ref, props } = useFocusable({ onSelect: () => navigate(route), actionLabel: label })

  return (
    <div
      ref={ref as Ref<HTMLDivElement>}
      className="nav-item"
      data-active={active}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} size={20} />
      {/* Hidden on a narrow window, where five labels would wrap the bar onto a
          second line. The title on the row is what is left to name it there. */}
      <span className="nav-item__label">{label}</span>
      {badge ? <span className="nav-item__badge">{badge}</span> : null}
    </div>
  )
}

/**
 * Shown while an emulator owns the screen. RomMix is still running behind
 * gamescope, and this makes it obvious that input is going elsewhere.
 *
 * It also covers the part of a launch before there is an emulator at all —
 * installing a missing core is a download of several megabytes — because this
 * overlay goes up the moment Play is pressed and nothing behind it can be seen.
 * A screen that says "the emulator has focus" while RomMix is still fetching
 * the core is describing something that has not happened yet.
 *
 * The close button is the way back from an emulator that has hung or opened
 * off-screen: it asks the process to quit, so the session still ends normally
 * and the saves it wrote are still uploaded. It cannot be reached with the pad,
 * which the game has for the duration — holding Start is the way in, and is
 * what `useSuspendGamepad` lets through.
 */
function RunningOverlay(): JSX.Element {
  const { t } = useI18n()
  const { settings, runningStage, runningEmulator } = useApp()

  if (runningStage) {
    return (
      <Overlay title={t('app.gettingReady')}>
        <p className="muted">{runningStage}</p>
        <Spinner />
      </Overlay>
    )
  }

  // An emulator opened on its own has no session behind it: nothing was
  // launched, nothing will be synced, and saying either would describe
  // something that is not happening. What it shares with a game is the only
  // thing this overlay is for — something else has the screen, and here is the
  // way back.
  if (runningEmulator) {
    return (
      <Overlay title={t('app.emulatorRunning', { name: runningEmulator })}>
        <p className="muted">{t('app.emulatorOpened', { name: runningEmulator })}</p>
        <RunningActions />
      </Overlay>
    )
  }

  return (
    <Overlay title={t('app.gameRunning')}>
      <p className="muted">
        {settings?.confirmSavePush ? t('app.emulatorHasFocusAsk') : t('app.emulatorHasFocusAuto')}
      </p>
      <RunningActions />
    </Overlay>
  )
}

/**
 * How long a polite request gets before the panel offers to force it.
 *
 * Past the five seconds `stopFlatpakApp` waits before killing a flatpak itself,
 * so that route has already finished by the time this appears. What is left is
 * an emulator RomMix signalled directly and which has not gone.
 */
const FORCE_AFTER_MS = 6000

/**
 * The way out, inside the overlay rather than beside it.
 *
 * A child component because `useAction` registers on the layer it is *called*
 * from, and `Overlay` raises the layer for its children only — called from
 * `RunningOverlay` the handler would sit on the layer below, where `fireAction`
 * never looks while the overlay is up.
 *
 * Three states, in the order they happen: offer to close, say it has been
 * asked, and — if it is still there — offer to close it outright. That last one
 * exists because asking is all RomMix could do: a SIGTERM an emulator handles
 * by opening its own dialog leaves both of us waiting, and off-screen or hung
 * that dialog is never answered.
 *
 * Start does each step in turn, because it is the only press that reaches
 * RomMix while something else has the pad.
 */
function RunningActions(): JSX.Element {
  const { t } = useI18n()
  const keyLabel = useKeyLabel()
  const [asked, setAsked] = useState(false)
  const [stuck, setStuck] = useState(false)

  // Only while it is still up: the overlay unmounts when the emulator exits,
  // and the timer goes with it.
  useEffect(() => {
    if (!asked) return
    const timer = window.setTimeout(() => setStuck(true), FORCE_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [asked])

  const stop = (): void => {
    setAsked(true)
    void window.rommix.running.stop()
  }
  const force = (): void => void window.rommix.running.forceStop()

  // The one press that reaches RomMix while a game has the pad. Asking twice
  // does nothing — the request is already out — so it does nothing until there
  // is something else to offer.
  useAction('menu', () => {
    if (!asked) stop()
    else if (stuck) force()
  })

  if (asked && stuck) {
    return (
      <>
        <p className="muted">{t('app.notClosing')}</p>
        <p className="muted">{t('app.holdToForce', { key: keyLabel('START') })}</p>
        <div className="btn-row">
          <FocusButton icon="quit" variant="danger" onSelect={force}>
            {t('app.forceClose')}
          </FocusButton>
        </div>
      </>
    )
  }

  // Said because the request is not the outcome: an emulator is given time to
  // save, so the overlay stays up for a moment and would otherwise look like a
  // button that did nothing.
  if (asked) return <p className="muted">{t('app.askingEmulatorToQuit')}</p>

  return (
    <>
      <p className="muted">{t('app.holdToClose', { key: keyLabel('START') })}</p>
      <div className="btn-row">
        {/* Not autofocused: the pad cannot reach it while a game is running, and
            a focused danger button nothing can press only looks armed. */}
        <FocusButton icon="cancel" variant="danger" onSelect={stop}>
          {t('app.closeEmulator')}
        </FocusButton>
      </div>
    </>
  )
}

/**
 * Notifications, all one shape.
 *
 * A toast about a game leads with its cover and title and then says what
 * happened; one about the app is just the message. The uniformity is the point:
 * every notification concerning a game says which game, in the same place.
 */
function Toasts({ toasts }: { toasts: Toast[] }): JSX.Element {
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`notice toast ${
            toast.tone === 'error'
              ? 'notice--error'
              : toast.tone === 'warn'
                ? 'notice--warn'
                : 'notice--ok'
          }`}
        >
          {toast.title ? (
            <div className="toast__art" data-kind={toast.platform ? 'platform' : 'game'}>
              {toast.platform ? (
                <PlatformIcon
                  slug={toast.platform.slug}
                  system={toast.platform.system}
                  size={40}
                  label={toast.title}
                />
              ) : (
                <CoverArt path={toast.coverPath ?? null} name={toast.title} />
              )}
            </div>
          ) : null}
          <div className="toast__body">
            {toast.title ? <div className="toast__title">{toast.title}</div> : null}
            <div className="toast__message">{toast.message}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Just the hostname, so the bar does not show a full URL. */
function hostOf(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
