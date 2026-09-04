import { useCallback, useLayoutEffect, useRef, useState, type JSX, type Ref } from 'react'
import { Logo, QuitOverlay } from './components'
import {
  FocusZone,
  useAction,
  useFocusable,
  useFocusContext,
  useSuspendGamepad
} from './input/focus'
import { Icon, type IconName } from './icons'
import { useApp, useDownloads, useI18n, type Route } from './state'
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
import { RunningOverlay } from './RunningOverlay'
import { Toasts } from './Toasts'

/**
 * How much of the bar is drawn, in the order its parts are given up: the menu's
 * labels first, then the server line, then the wordmark beside the mark.
 *
 * Measured rather than declared at a width, because the menu's seven labels are
 * a different length in every language — French runs to half again English's.
 * One media query would have to serve all four catalogues, and there is no
 * width that both keeps the labels wherever they fit and drops them before they
 * run over the brand and the server line. See `useBarFit`.
 */
const BAR_FITS = ['full', 'compact', 'tight', 'bare'] as const

/**
 * Whether the bar's three blocks stand side by side without running into one
 * another.
 *
 * The brand and the status flank the menu as equal tracks, so what each costs is
 * the wider of the two. The status is measured a row at a time: it is a column
 * of right-aligned rows, and a row too wide for its track spills to the left,
 * where `scrollWidth` on the column sees nothing.
 */
function barFits(header: HTMLElement): boolean {
  const style = getComputedStyle(header)
  const room = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const widthOf = (selector: string): number => header.querySelector(selector)?.scrollWidth ?? 0
  const side = Math.max(
    widthOf('.topbar__brand'),
    widthOf('.topbar__user'),
    widthOf('.topbar__host')
  )
  return widthOf('.topbar__nav') + 2 * (side + parseFloat(style.columnGap)) <= room
}

/**
 * Give up as little of the bar as the window makes necessary.
 *
 * Re-measured on a resize and on any change to what the bar holds — the
 * language, the count on Downloads, the section that goes when the server does
 * — since each of those changes the answer and only the first is a resize.
 */
function useBarFit(drawn: boolean): Ref<HTMLElement | null> {
  const ref = useRef<HTMLElement | null>(null)

  // `drawn` is what brings the bar into reach: the connect screen has none, so
  // on the pass that ran while it was up there was nothing to measure.
  useLayoutEffect(() => {
    const header = ref.current
    if (!header) return

    const fit = (): void => {
      for (const level of BAR_FITS) {
        header.dataset.fit = level
        if (barFits(header)) return
      }
    }

    fit()
    const resized = new ResizeObserver(fit)
    resized.observe(header)
    // Attributes are deliberately not watched: focus moves along this bar with
    // every press, and none of that changes how wide anything is.
    const changed = new MutationObserver(fit)
    changed.observe(header, { childList: true, subtree: true, characterData: true })
    return () => {
      resized.disconnect()
      changed.disconnect()
    }
  }, [drawn])

  return ref
}

/** App shell: navigation bar, the current screen, and global overlays. */
export function App(): JSX.Element {
  const { t } = useI18n()
  const {
    route,
    goBack,
    canGoBack,
    navigate,
    offline,
    runningRomId,
    runningEmulator,
    status,
    update
  } = useApp()
  const { enterZone } = useFocusContext()
  const [confirmingQuit, setConfirmingQuit] = useState(false)
  const barRef = useBarFit(route.name !== 'connect')

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
      <div className="app" data-screen={route.name}>
        <ConnectScreen />
        {covered ? <RunningOverlay /> : null}
        <Toasts />
      </div>
    )
  }

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
    <div className="app" data-screen={route.name}>
      <FocusZone id="nav">
        {/* The mark on the left, the menu across the middle, who you are on the
            right: the same three slots RomM's own bar has. The brand and the
            status flank the menu as equal tracks so the menu is centred on the
            screen rather than on whatever is left over beside them. */}
        <header className="topbar" ref={barRef}>
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
            {/* The one section with no local half at all: a collection is a
                list the server keeps, and there is nothing of it on this disk
                to show instead. Every other screen narrows to what is here. */}
            {offline ? null : (
              <NavItem
                icon="collection"
                label={t('nav.collections')}
                route={{ name: 'collections' }}
                active={route.name === 'collections' || route.name === 'collection'}
              />
            )}
            <DownloadsNavItem active={route.name === 'downloads'} />
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
            ) : offline ? (
              /* The server it cannot reach is still worth naming: this is the
                 one place that says which machine is missing, and "offline" on
                 its own reads as a setting somebody turned on. */
              <>
                <span className="topbar__user">
                  <span>{t('app.offline')}</span>
                  <Icon name="warn" size={15} />
                </span>
                <span className="topbar__host">
                  <span>{hostOf(status?.baseUrl ?? null)}</span>
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
      <Toasts />
    </div>
  )
}

/**
 * The menu item that counts what is being fetched.
 *
 * Its own component so that the queue is read here and nowhere above: a
 * transfer reports progress several times a second, and the bar is drawn beside
 * whatever screen the player is on. See `DownloadsContext`.
 */
function DownloadsNavItem({ active }: { active: boolean }): JSX.Element {
  const { t } = useI18n()
  const downloads = useDownloads()
  const busy = downloads.filter(
    (item) => item.state === 'downloading' || item.state === 'queued' || item.state === 'extracting'
  ).length

  return (
    <NavItem
      icon="downloads"
      label={t('nav.downloads')}
      route={{ name: 'downloads' }}
      active={active}
      badge={busy > 0 ? busy : undefined}
    />
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
      data-route={route.name}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} size={20} />
      {/* Hidden where the bar has no room for seven of them — see `useBarFit`.
          The title on the row is what is left to name it there. */}
      <span className="nav-item__label">{label}</span>
      {badge ? <span className="nav-item__badge">{badge}</span> : null}
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
