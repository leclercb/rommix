import { type JSX, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import qrcode from 'qrcode-generator'
import { PLATFORM_ICON_PATHS, systemInfo } from '@config/systems'
import {
  FocusGroup,
  FocusLayer,
  useAction,
  useFocusable,
  useFocusContext,
  useKeyLabel
} from './input/focus'
import type { InstalledRom, RommRom, RomStorage } from '@shared/types'
import { Icon, type IconName } from './icons'

/** Shared presentational pieces for the 10-foot UI. */

export function Spinner(): JSX.Element {
  return <div className="spinner" aria-label="Loading" />
}

/**
 * Cover art served through the authenticated `rommix-img://` protocol.
 * Falls back to the game's name when RomM has no artwork or the fetch fails.
 */
export function CoverArt({
  path,
  name,
  className
}: {
  path: string | null
  name: string
  className?: string
}): JSX.Element {
  const url = window.rommix.system.imageUrl(path)
  const [failed, setFailed] = useState(false)

  // A new ROM in the same slot must clear the previous failure.
  useEffect(() => setFailed(false), [url])

  return (
    <div className={`cover ${className ?? ''}`}>
      {url && !failed ? (
        <img src={url} alt={name} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="cover__fallback">{name}</div>
      )}
    </div>
  )
}

/**
 * The wash of artwork behind a game's hero.
 *
 * A still from the game where RomM has one, its cover where it does not: blurred
 * far past legibility and faded into the page, so it reads as the colour of the
 * game rather than as a picture competing with the title over it.
 *
 * Nothing at all when there is no artwork or the fetch fails — a broken image
 * behind the hero would be worse than the plain background it replaced, and a
 * homebrew ROM matched to no provider has neither a screenshot nor a cover.
 */
export function ArtBackdrop({
  paths
}: {
  paths: (string | null | undefined)[]
}): JSX.Element | null {
  const url = paths.map((path) => window.rommix.system.imageUrl(path ?? null)).find(Boolean) ?? null
  const [failed, setFailed] = useState(false)

  // A different game in the same slot must clear the previous failure.
  useEffect(() => setFailed(false), [url])

  if (!url || failed) return null

  return (
    <div className="backdrop" aria-hidden="true">
      <img src={url} alt="" onError={() => setFailed(true)} />
    </div>
  )
}

export function FocusButton({
  children,
  onSelect,
  variant = 'default',
  disabled = false,
  autoFocus = false,
  icon,
  on,
  actionLabel
}: {
  children?: ReactNode
  onSelect: () => void
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  autoFocus?: boolean
  /** Drawn before the label — or alone, where the mark is unambiguous. */
  icon?: IconName
  /**
   * For a button that is also a state: the icon is filled in when it is on.
   *
   * Only the icon. A button that changed colour with its state would read as a
   * warning rather than as something the user has switched on, and the label
   * still says what pressing it does either way.
   */
  on?: boolean
  /**
   * What this does, for the hint bar and for assistive tech.
   *
   * Taken from the button's own text when that is a plain string. A button with
   * no text has to say it here: an icon on its own leaves the hint bar with
   * nothing to report and a screen reader with nothing to read.
   */
  actionLabel?: string
}): JSX.Element {
  const { ref, props } = useFocusable({
    onSelect: disabled ? undefined : onSelect,
    enabled: !disabled,
    autoFocus,
    // A button's own text is what pressing A does, so the hint bar needs
    // nothing declared at the call site. Anything richer than a string — a
    // label built from several pieces — says nothing and leaves the screen's
    // own hint standing.
    actionLabel: actionLabel ?? (typeof children === 'string' ? children : undefined)
  })

  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      className={`btn ${variant === 'default' ? '' : `btn--${variant}`}`}
      data-disabled={disabled}
      data-on={on}
      aria-label={actionLabel}
      title={children === undefined ? actionLabel : undefined}
      {...props}
    >
      {/* Beside the word wherever there is one: an icon alone is a guess on a
          television three metres away. Where a button is icon-only by design,
          `actionLabel` is what the hint bar reads back for it. */}
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

/**
 * A text field that a controller can reach.
 *
 * Pressing A moves real DOM focus into the input, at which point Steam's Big
 * Picture on-screen keyboard (or a real keyboard) takes over. Escape hands
 * control back to the spatial navigator.
 */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
  autoFocus = false
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password'
  hint?: string
  autoFocus?: boolean
}): JSX.Element {
  const { ref, props } = useFocusable({
    onSelect: () => (ref.current as HTMLInputElement | null)?.focus(),
    autoFocus,
    actionLabel: 'Type'
  })

  return (
    <div className="field">
      <label className="field__label">{label}</label>
      <input
        ref={ref as Ref<HTMLInputElement>}
        className="field__input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') (event.target as HTMLInputElement).blur()
        }}
        {...props}
      />
      {hint ? <div className="field__hint">{hint}</div> : null}
    </div>
  )
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="segmented">
      {options.map((option) => (
        <SegmentedOption
          key={option.value}
          label={option.label}
          active={option.value === value}
          onSelect={() => onChange(option.value)}
        />
      ))}
    </div>
  )
}

function SegmentedOption({
  label,
  active,
  onSelect
}: {
  label: string
  active: boolean
  onSelect: () => void
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect })
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      className="segmented__option"
      data-active={active}
      {...props}
    >
      {label}
    </button>
  )
}

/**
 * What a cover tile needs to draw itself.
 *
 * A game can be shown from two directions — a record on the server, or a copy
 * on this disk — and only one of them has a RomM platform slug. Normalising
 * both to this is what lets a shelf be built from the download index without
 * fetching every game back from the server one at a time.
 */
export interface GameTile {
  romId: number
  title: string
  coverPath: string | null
  platformName: string
  /** RomM's platform slug when it is known; the ES-DE system otherwise. */
  platformSlug: string
  /** ES-DE system, which carries the curated fallback icon. */
  system?: string | null
}

export function tileFromRom(rom: RommRom): GameTile {
  return {
    romId: rom.id,
    title: rom.name ?? rom.fs_name,
    coverPath: rom.path_cover_small ?? rom.path_cover_large,
    platformName: rom.platform_display_name,
    platformSlug: rom.platform_slug
  }
}

export function tileFromInstalled(entry: InstalledRom): GameTile {
  return {
    romId: entry.romId,
    title: entry.name || entry.fileName,
    coverPath: entry.coverPath,
    platformName: entry.platformName,
    // The index records the ES-DE system rather than RomM's slug, which the
    // icon lookup falls back to happily.
    platformSlug: entry.system,
    system: entry.system
  }
}

/** A cover-art tile in a row or grid. */
export function GameCard({
  tile,
  installed,
  onSelect,
  showPlatform = false
}: {
  tile: GameTile
  installed: boolean
  onSelect: () => void
  showPlatform?: boolean
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect, actionLabel: 'Open' })

  return (
    <button ref={ref as Ref<HTMLButtonElement>} className="card" {...props}>
      <div style={{ position: 'relative' }}>
        <CoverArt path={tile.coverPath} name={tile.title} />
        {installed ? <span className="card__installed" title="Downloaded" /> : null}
      </div>
      <div className="card__title">{tile.title}</div>
      {showPlatform ? (
        <div className="card__meta">
          <PlatformIcon
            slug={tile.platformSlug}
            system={tile.system}
            size={26}
            label={tile.platformName}
          />
          <span>{tile.platformName}</span>
        </div>
      ) : null}
    </button>
  )
}

/**
 * A horizontally scrolling shelf of games.
 *
 * `onEndReached` makes the shelf endless. The sentinel is observed against the
 * row itself rather than the viewport, because this scroller moves sideways
 * independently of the page — and the margin is horizontal so the next batch
 * is requested while the end of the shelf is still off to the right.
 *
 * A focus group, keyed by the shelf's own title: walking down onto a shelf
 * arrives at its first card, or at the card last left on it, rather than at
 * whichever one happens to sit under the column the press came down. See
 * `FocusGroup`.
 */
export function GameRow({
  title,
  tiles,
  installedIds,
  onSelect,
  onEndReached
}: {
  title: string
  tiles: GameTile[]
  installedIds: Set<number>
  onSelect: (tile: GameTile) => void
  onEndReached?: () => void
}): JSX.Element | null {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const row = rowRef.current
    const sentinel = sentinelRef.current
    if (!onEndReached || !row || !sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onEndReached()
      },
      { root: row, rootMargin: '0px 600px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onEndReached, tiles.length])

  // After the hooks: bailing earlier would call a different number of them.
  if (tiles.length === 0) return null

  return (
    <section>
      <h2 className="section-title">{title}</h2>
      <FocusGroup id={`shelf:${title}`}>
        <div className="row" ref={rowRef}>
          {tiles.map((tile) => (
            <GameCard
              key={tile.romId}
              tile={tile}
              installed={installedIds.has(tile.romId)}
              onSelect={() => onSelect(tile)}
              showPlatform
            />
          ))}
          {onEndReached ? (
            <div className="row__sentinel" ref={sentinelRef} aria-hidden="true" />
          ) : null}
        </div>
      </FocusGroup>
    </section>
  )
}

/**
 * The footer: who made this on the left, what the buttons do on the right.
 *
 * Call sites name controller buttons; what is drawn is whatever the player is
 * actually holding, so the bar stops telling a keyboard user to press A.
 *
 * The signature lives here because every screen draws this bar, which makes it
 * the only strip in the app that is genuinely always on screen — and because
 * the far end of it is the one place a line nobody needs to read can sit
 * without being in the way of something that must be.
 */
export function Hints({ items }: { items: { key: string; label: string }[] }): JSX.Element {
  const keyLabel = useKeyLabel()
  const { focusedAction } = useFocusContext()

  return (
    <div className="hints">
      <span className="hints__credit">
        Developed with <span className="hints__heart">♥</span> by leclercb
      </span>
      {items.map((item) => (
        <span key={item.key + item.label}>
          <span className="hint__key">{keyLabel(item.key)}</span>
          {/* A is whatever is focused, when it has said what it does: the
              screen's own label describes one action out of several and is
              wrong the moment focus moves off it. Every other key is a screen
              or app binding, and means the same wherever focus happens to be. */}
          {item.key === 'A' && focusedAction ? focusedAction : item.label}
        </span>
      ))}
    </div>
  )
}

/**
 * A modal panel.
 *
 * Its contents are a focus layer of their own, so the screen behind it stops
 * being reachable while it is open — without that, the pad walks straight out
 * of a confirmation dialog onto the buttons it is asking about.
 */
export function Overlay({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="overlay">
      <div className="overlay__panel">
        <h2 className="overlay__title">{title}</h2>
        <FocusLayer>{children}</FocusLayer>
      </div>
    </div>
  )
}

/**
 * The RomMix mark: a cartridge whose label is a cassette.
 *
 * The same drawing as the app icon (flatpak/be.bl_it.RomMix.svg) minus its dark
 * plate — the rail already supplies the ground, and a second rounded square
 * inside the chrome would read as a floating badge. Colours come from the
 * palette rather than the icon's literals, so the mark follows the theme.
 */
export function Logo({ className }: { className?: string }): JSX.Element {
  // Palette tokens have to arrive as CSS declarations: a var() sitting in an SVG
  // presentation attribute (fill="var(--accent)") is never substituted, and the
  // shape silently renders black.
  const body = { fill: 'url(#rommix-mark)' }
  const ground = { fill: 'var(--bg)' }
  const accent = { fill: 'var(--accent)' }

  return (
    <svg className={className} viewBox="22 22 84 84" role="img" aria-label="RomMix">
      <defs>
        <linearGradient id="rommix-mark" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-strong)' }} />
        </linearGradient>
      </defs>

      {/* Connector tab and contacts, behind the body */}
      <rect
        x="40"
        y="82"
        width="48"
        height="24"
        rx="6"
        style={{ fill: 'var(--accent-strong)' }}
        opacity="0.75"
      />
      <g style={ground} opacity="0.55">
        <rect x="48" y="94" width="6" height="10" rx="2" />
        <rect x="61" y="94" width="6" height="10" rx="2" />
        <rect x="74" y="94" width="6" height="10" rx="2" />
      </g>

      <rect x="22" y="22" width="84" height="68" rx="11" style={body} />

      {/* Label window, cut as a cassette */}
      <rect x="32" y="32" width="64" height="38" rx="7" style={ground} />
      <rect x="50" y="48.5" width="28" height="5" style={accent} opacity="0.4" />
      <g style={{ fill: 'none', stroke: 'var(--accent)' }} strokeWidth="4">
        <circle cx="50" cy="51" r="9" />
        <circle cx="78" cy="51" r="9" />
      </g>
      <circle cx="50" cy="51" r="2.5" style={accent} />
      <circle cx="78" cy="51" r="2.5" style={accent} />

      <rect x="36" y="76" width="56" height="4" rx="2" style={ground} opacity="0.5" />
    </svg>
  )
}

/**
 * A QR code, drawn as SVG.
 *
 * Deliberately black on white with a four-module quiet zone, ignoring the dark
 * theme around it: a phone camera needs the contrast and the light margin, and
 * a QR rendered in the UI's own palette is often simply unreadable.
 *
 * The modules are emitted as one path rather than a few hundred <rect>s, and
 * `crispEdges` keeps the cells from being antialiased into each other.
 */
export function QrCode({ value, size = 240 }: { value: string; size?: number }): JSX.Element {
  const { path, moduleCount } = useMemo(() => {
    // Type 0 auto-sizes; 'M' tolerates ~15% damage, which is the usual choice
    // for something displayed on a screen rather than printed.
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()

    const count = qr.getModuleCount()
    let d = ''
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`
      }
    }
    return { path: d, moduleCount: count }
  }, [value])

  const quietZone = 4
  const span = moduleCount + quietZone * 2

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code"
    >
      <rect width={span} height={span} fill="#ffffff" />
      <path d={path} fill="#000000" transform={`translate(${quietZone} ${quietZone})`} />
    </svg>
  )
}

/**
 * The console's own logo, from RomM's platform icon set.
 *
 * RomM ships the Systematic console-icon set and serves it at a stable path,
 * so the icon comes over the same authenticated protocol as cover art rather
 * than being bundled: a couple of hundred logos would otherwise have to ship
 * with the app and be kept in step with a platform list that keeps growing.
 *
 * Two fallbacks, in order, because neither failure is hypothetical. An older
 * RomM has the brand icons but not the Systematic set, and an unreachable
 * server has neither — while the Downloads screen, which is the densest user
 * of this component, is exactly the screen that still works offline. The last
 * resort is the short code on a colour derived from the system name: distinct
 * per platform, and legible at a distance.
 */
export function SystemIcon({ system, size = 34 }: { system: string; size?: number }): JSX.Element {
  const info = systemInfo(system)
  return <IconImage candidates={[info.icon]} system={system} label={info.label} size={size} />
}

/**
 * The same icon, for the places that hold a RomM platform rather than an ES-DE
 * system.
 *
 * Worth distinguishing because RomM names its icons by *its own* platform slug,
 * so when that slug is in hand it is the direct answer — no mapping to be wrong
 * about, and it still produces an icon for a platform RomMix has no ES-DE
 * mapping for at all, which is exactly the platform the BIOS screen most needs
 * to identify.
 */
export function PlatformIcon({
  slug,
  system,
  size = 34,
  label
}: {
  slug: string
  /** ES-DE system, when known: its curated icon is the second candidate. */
  system?: string | null
  size?: number
  label?: string
}): JSX.Element {
  const info = system ? systemInfo(system) : null
  return (
    <IconImage
      candidates={[slug, info?.icon]}
      system={system ?? slug}
      label={label ?? info?.label ?? slug}
      size={size}
    />
  )
}

/**
 * Icons that resolved are remembered for the session.
 *
 * Without this every cover in a 60-card grid re-runs the same cascade of
 * 404s for its platform. Only successes are cached: a miss is usually "not
 * connected yet", and caching that would leave the library showing short codes
 * until the app was restarted.
 */
const resolvedIcons = new Map<string, string>()

function IconImage({
  candidates,
  system,
  label,
  size
}: {
  candidates: (string | undefined)[]
  system: string
  label: string
  size: number
}): JSX.Element {
  const sources = useMemo(() => {
    const names = [...new Set(candidates.filter((name): name is string => Boolean(name)))]
    return names
      .flatMap((name) => PLATFORM_ICON_PATHS.map((path) => path.replace('{name}', name)))
      .map((path) => window.rommix.system.imageUrl(path))
      .filter((url): url is string => url !== null)
  }, [candidates.join('|')])

  const cacheKey = sources.join('|')
  const cached = resolvedIcons.get(cacheKey)
  const [attempt, setAttempt] = useState(0)

  // A different platform in the same slot has to start from the first source.
  useEffect(() => setAttempt(0), [cacheKey])

  if (cached) {
    return (
      <img
        className="system-icon"
        style={{ width: size, height: size }}
        src={cached}
        alt={label}
        title={label}
        loading="lazy"
      />
    )
  }
  if (attempt >= sources.length) return <PlatformBadge system={system} />

  return (
    <img
      className="system-icon"
      style={{ width: size, height: size }}
      src={sources[attempt]}
      alt={label}
      title={label}
      loading="lazy"
      onLoad={() => resolvedIcons.set(cacheKey, sources[attempt])}
      onError={() => setAttempt((current) => current + 1)}
    />
  )
}

/**
 * A platform marker: the system's short code on a colour derived from its
 * name, so every platform gets a stable, distinct chip with nothing fetched.
 * Used on its own where an icon would be too big, and as `SystemIcon`'s
 * fallback when no artwork can be reached.
 */
export function PlatformBadge({ system }: { system: string }): JSX.Element {
  const { short } = systemInfo(system)
  let hash = 0
  for (let i = 0; i < system.length; i += 1) hash = (hash * 31 + system.charCodeAt(i)) % 360
  return (
    <span
      className="platform-badge"
      style={{
        background: `hsl(${hash} 62% 22%)`,
        color: `hsl(${hash} 85% 76%)`,
        borderColor: `hsl(${hash} 60% 38%)`
      }}
    >
      {short}
    </span>
  )
}

/**
 * A tab strip.
 *
 * Bound to LB/RB (and shift-Tab/Tab) as well as being focusable, because a tab
 * strip that can only be reached by walking focus up to it is a tab strip
 * nobody uses on a controller — the shoulder buttons are where a console UI
 * puts this, and the hint bar says so.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange
}: {
  tabs: { id: T; label: string; badge?: number }[]
  active: T
  onChange: (id: T) => void
}): JSX.Element {
  const step = (delta: number): void => {
    const index = tabs.findIndex((tab) => tab.id === active)
    if (index < 0) return
    onChange(tabs[(index + delta + tabs.length) % tabs.length].id)
  }

  useAction('tabLeft', () => step(-1))
  useAction('tabRight', () => step(1))

  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <TabButton
          key={tab.id}
          label={tab.label}
          badge={tab.badge}
          active={tab.id === active}
          onSelect={() => onChange(tab.id)}
        />
      ))}
    </div>
  )
}

function TabButton({
  label,
  badge,
  active,
  onSelect
}: {
  label: string
  badge?: number
  active: boolean
  onSelect: () => void
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect })
  return (
    <button ref={ref as Ref<HTMLButtonElement>} className="tab" data-active={active} {...props}>
      {label}
      {badge != null ? <span className="tab__badge">{badge}</span> : null}
    </button>
  )
}

/**
 * A labelled setting with its own On/Off control, rather than the label
 * smuggled into the text of one of the options.
 */
export function Toggle({
  label,
  hint,
  on,
  onToggle
}: {
  label: string
  hint?: string
  on: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <div className="setting">
      <div className="setting__text">
        <div className="setting__label">{label}</div>
        {hint ? <div className="setting__hint">{hint}</div> : null}
      </div>
      <SegmentedControl<'on' | 'off'>
        value={on ? 'on' : 'off'}
        onChange={(next) => {
          if ((next === 'on') !== on) onToggle()
        }}
        options={[
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' }
        ]}
      />
    </div>
  )
}

/** The same row as `Toggle`, for a setting with more than two answers. */
export function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange
}: {
  label: string
  hint?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="setting">
      <div className="setting__text">
        <div className="setting__label">{label}</div>
        {hint ? <div className="setting__hint">{hint}</div> : null}
      </div>
      <SegmentedControl<T> value={value} options={options} onChange={onChange} />
    </div>
  )
}

/**
 * The scales offered, as the strings the segmented control switches on.
 *
 * A short list of round numbers rather than a slider: this is a control being
 * driven from a sofa, and every value between 100% and 200% that anyone would
 * actually stop at is here. `auto` is 0 in settings — see `Settings.uiScale`.
 *
 * Here rather than beside the Settings screen because the first-run wizard asks
 * the same question, and two lists of scales would drift apart.
 */
export type UiScaleChoice = 'auto' | '1' | '1.25' | '1.5' | '2'

export const UI_SCALES: { value: UiScaleChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '1', label: '100%' },
  { value: '1.25', label: '125%' },
  { value: '1.5', label: '150%' },
  { value: '2', label: '200%' }
]

/** The stored number as one of the offered choices, falling back to Auto. */
export function uiScaleChoice(scale: number): UiScaleChoice {
  const match = UI_SCALES.find((option) => option.value === String(scale))
  return match ? match.value : 'auto'
}

/**
 * Where downloaded games go. Asked in Settings and again by the first-run
 * wizard, which is the only reason it is a component rather than two lines.
 */
export function RomStorageChoice({
  value,
  onChange
}: {
  value: RomStorage
  onChange: (value: RomStorage) => void
}): JSX.Element {
  return (
    <Choice<RomStorage>
      label="Where downloaded games go"
      hint={
        value === 'rommix'
          ? 'One folder for everything, which each emulator has to be pointed at once. Changing emulator moves nothing, and a game can be downloaded before anything that runs it is installed.'
          : "Each emulator's own ROM folder, so games show up in its list when you start it yourself. Changing emulator for a platform means downloading its games again."
      }
      value={value}
      options={[
        { value: 'emulator', label: "Each emulator's folder" },
        { value: 'rommix', label: 'RomMix folder' }
      ]}
      onChange={onChange}
    />
  )
}

/**
 * A web address to open away from the television.
 *
 * The QR code is the control, not the decoration: RomMix is driven from a sofa,
 * where a phone is the browser that is actually to hand — and under gamescope
 * there is frequently no other one to open at all. The address is printed under
 * it for anyone typing it somewhere else.
 */
export function ScanToOpen({ url, size = 200 }: { url: string; size?: number }): JSX.Element {
  return (
    <>
      <div className="pair-qr">
        <QrCode value={url} size={size} />
      </div>
      <p className="muted" style={{ textAlign: 'center', wordBreak: 'break-all' }}>
        {url}
      </p>
    </>
  )
}

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
