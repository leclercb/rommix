import type { JSX, Ref } from 'react'
import { CoverArt, FocusButton, Logo, Overlay, PlatformIcon } from './components'
import { useAction, useFocusable } from './input/focus'
import { useApp, type Route, type Toast } from './state'
import { BiosScreen } from './screens/Bios'
import { ConnectScreen } from './screens/Connect'
import { DetailScreen } from './screens/Detail'
import { DownloadsScreen } from './screens/Downloads'
import { HomeScreen } from './screens/Home'
import { LibraryScreen } from './screens/Library'
import { SettingsScreen } from './screens/Settings'

/** App shell: navigation rail, the current screen, and global overlays. */
export function App(): JSX.Element {
  const { route, goBack, navigate, downloads, runningRomId, toasts, status } = useApp()

  // B / Escape goes back everywhere except the connect screen, where there is
  // nothing behind us.
  useAction('back', goBack, route.name !== 'connect')

  // X / Start opens Settings: on a console this button is the menu, and
  // Settings is where every switch in RomMix lives.
  useAction('menu', () => navigate({ name: 'settings' }), route.name !== 'settings')

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
      <nav className="rail">
        <div className="rail__brand">
          <Logo className="rail__logo" />
          <div className="rail__wordmark">
            Rom<span>Mix</span>
          </div>
        </div>
        <RailItem icon="⌂" label="Home" route={{ name: 'home' }} active={route.name === 'home'} />
        <RailItem
          icon="▦"
          label="Library"
          route={{ name: 'library' }}
          active={route.name === 'library'}
        />
        <RailItem
          icon="↓"
          label="Downloads"
          route={{ name: 'downloads' }}
          active={route.name === 'downloads'}
          badge={activeDownloads > 0 ? activeDownloads : undefined}
        />
        <RailItem
          icon="▤"
          label="BIOS"
          route={{ name: 'bios' }}
          active={route.name === 'bios'}
        />
        <RailItem
          icon="⚙"
          label="Settings"
          route={{ name: 'settings' }}
          active={route.name === 'settings'}
        />
        <div className="rail__spacer" />
        <div className="rail__status">
          {status?.connected ? (
            <>
              {status.user?.username}
              <br />
              {hostOf(status.baseUrl)}
            </>
          ) : (
            'Not connected'
          )}
        </div>
      </nav>

      <Screen route={route} />

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

function RailItem({
  icon,
  label,
  route,
  active,
  badge
}: {
  icon: string
  label: string
  route: Route
  active: boolean
  badge?: number
}): JSX.Element {
  const { navigate } = useApp()
  const { ref, props } = useFocusable({ onSelect: () => navigate(route) })

  return (
    <div ref={ref as Ref<HTMLDivElement>} className="rail__item" data-active={active} {...props}>
      <span className="rail__icon">{icon}</span>
      {label}
      {badge ? <span className="rail__badge">{badge}</span> : null}
    </div>
  )
}

/**
 * Shown while an emulator owns the screen. RomMix is still running behind
 * gamescope, and this makes it obvious that input is going elsewhere.
 *
 * The close button is the way back from an emulator that has hung or opened
 * off-screen: it asks the process to quit, so the session still ends normally
 * and the saves it wrote are still uploaded.
 */
function RunningOverlay(): JSX.Element {
  return (
    <Overlay title="Game running">
      <p className="muted">
        The emulator has focus. Quit it to come back to RomMix — your saves are synced to RomM
        automatically when it closes.
      </p>
      <div className="btn-row">
        <FocusButton variant="danger" onSelect={() => void window.rommix.game.stop()} autoFocus>
          Close the emulator
        </FocusButton>
      </div>
    </Overlay>
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

/** Just the hostname, so the rail does not show a full URL. */
function hostOf(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
