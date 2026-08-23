import type { JSX, Ref } from 'react'
import { CoverArt, FocusButton, Logo, Overlay, PlatformIcon, Spinner } from './components'
import { FocusZone, useAction, useFocusable, useKeyLabel, useSuspendGamepad } from './input/focus'
import { Icon, type IconName } from './icons'
import { useApp, type Route, type Toast } from './state'
import { BiosScreen } from './screens/Bios'
import { ConnectScreen } from './screens/Connect'
import { DetailScreen } from './screens/Detail'
import { DownloadsScreen } from './screens/Downloads'
import { HomeScreen } from './screens/Home'
import { LibraryScreen } from './screens/Library'
import { SettingsScreen } from './screens/Settings'

/** App shell: navigation bar, the current screen, and global overlays. */
export function App(): JSX.Element {
  const { route, goBack, navigate, downloads, runningRomId, toasts, status } = useApp()

  // B / Escape goes back everywhere except the connect screen, where there is
  // nothing behind us.
  useAction('back', goBack, route.name !== 'connect')

  // X / Start opens Settings: on a console this button is the menu, and
  // Settings is where every switch in RomMix lives.
  useAction('menu', () => navigate({ name: 'settings' }), route.name !== 'settings')

  // While an emulator is up, the pad belongs to the game and not to us. Here
  // rather than inside the overlay so it holds for the whole session, including
  // the moment before the overlay has mounted.
  useSuspendGamepad(runningRomId !== null)

  if (route.name === 'connect') {
    return (
      <div className="app">
        <ConnectScreen />
        {runningRomId !== null ? <RunningOverlay /> : null}
        <Toasts toasts={toasts} />
      </div>
    )
  }

  const activeDownloads = downloads.filter(
    (item) => item.state === 'downloading' || item.state === 'queued' || item.state === 'extracting'
  ).length

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
              label="Home"
              route={{ name: 'home' }}
              active={route.name === 'home'}
            />
            <NavItem
              icon="library"
              label="Library"
              route={{ name: 'library' }}
              active={route.name === 'library'}
            />
            <NavItem
              icon="downloads"
              label="Downloads"
              route={{ name: 'downloads' }}
              active={route.name === 'downloads'}
              badge={activeDownloads > 0 ? activeDownloads : undefined}
            />
            <NavItem
              icon="bios"
              label="BIOS"
              route={{ name: 'bios' }}
              active={route.name === 'bios'}
            />
            <NavItem
              icon="settings"
              label="Settings"
              route={{ name: 'settings' }}
              active={route.name === 'settings'}
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
                <span>Not connected</span>
                <Icon name="warn" size={15} />
              </span>
            )}
          </div>
        </header>
      </FocusZone>

      <FocusZone id="content">
        <Screen route={route} />
      </FocusZone>

      {runningRomId !== null ? <RunningOverlay /> : null}
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
    case 'detail':
      return <DetailScreen romId={route.romId} />
    case 'downloads':
      return <DownloadsScreen />
    case 'bios':
      return <BiosScreen />
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
  badge?: number
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
  const { settings, runningStage } = useApp()

  if (runningStage) {
    return (
      <Overlay title="Getting ready">
        <p className="muted">{runningStage}</p>
        <Spinner />
      </Overlay>
    )
  }

  return (
    <Overlay title="Game running">
      <p className="muted">
        The emulator has focus. Quit it to come back
        {settings?.confirmSavePush
          ? ' — RomMix will ask what to send to RomM.'
          : ' — saves sync to RomM automatically.'}
      </p>
      <RunningActions />
    </Overlay>
  )
}

/**
 * The way out, inside the overlay rather than beside it.
 *
 * A child component because `useAction` registers on the layer it is *called*
 * from, and `Overlay` raises the layer for its children only — called from
 * `RunningOverlay` the handler would sit on the layer below, where `fireAction`
 * never looks while the overlay is up.
 */
function RunningActions(): JSX.Element {
  const { notify } = useApp()
  const keyLabel = useKeyLabel()

  const stop = (): void => {
    // Said because the request is not the outcome: RomMix asks the emulator to
    // quit and gives it five seconds to save before killing it, so this overlay
    // stays up for a moment afterwards and would otherwise look like a button
    // that did nothing.
    notify('Asking the emulator to quit…', 'warn')
    void window.rommix.game.stop()
  }

  // The one press that reaches RomMix while a game has the pad.
  useAction('menu', stop)

  return (
    <>
      <p className="muted">Hold {keyLabel('START')} to close it from here.</p>
      <div className="btn-row">
        {/* Not autofocused: the pad cannot reach it while a game is running, and
            a focused danger button nothing can press only looks armed. */}
        <FocusButton icon="cancel" variant="danger" onSelect={stop}>
          Close the emulator
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
