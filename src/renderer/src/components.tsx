import { type JSX, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import qrcode from 'qrcode-generator'
import { systemInfo } from '@config/systems'
import { useAction, useFocusable } from './input/focus'
import type { RommRom } from '@shared/types'

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

export function FocusButton({
  children,
  onSelect,
  variant = 'default',
  disabled = false,
  autoFocus = false
}: {
  children: ReactNode
  onSelect: () => void
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  autoFocus?: boolean
}): JSX.Element {
  const { ref, props } = useFocusable({
    onSelect: disabled ? undefined : onSelect,
    enabled: !disabled,
    autoFocus
  })

  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      className={`btn ${variant === 'default' ? '' : `btn--${variant}`}`}
      data-disabled={disabled}
      {...props}
    >
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
    autoFocus
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

/** A cover-art tile in a row or grid. */
export function GameCard({
  rom,
  installed,
  onSelect,
  showPlatform = false
}: {
  rom: RommRom
  installed: boolean
  onSelect: () => void
  showPlatform?: boolean
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect })
  const title = rom.name ?? rom.fs_name

  return (
    <button ref={ref as Ref<HTMLButtonElement>} className="card" {...props}>
      <div style={{ position: 'relative' }}>
        <CoverArt path={rom.path_cover_small ?? rom.path_cover_large} name={title} />
        {installed ? <span className="card__installed" title="Downloaded" /> : null}
      </div>
      <div className="card__title">{title}</div>
      {showPlatform ? (
        <div className="card__meta">
          <PlatformIcon slug={rom.platform_slug} size={16} label={rom.platform_display_name} />
          <span>{rom.platform_display_name}</span>
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
 */
export function GameRow({
  title,
  roms,
  installedIds,
  onSelect,
  onEndReached
}: {
  title: string
  roms: RommRom[]
  installedIds: Set<number>
  onSelect: (rom: RommRom) => void
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
  }, [onEndReached, roms.length])

  // After the hooks: bailing earlier would call a different number of them.
  if (roms.length === 0) return null

  return (
    <section>
      <h2 className="section-title">{title}</h2>
      <div className="row" ref={rowRef}>
        {roms.map((rom) => (
          <GameCard
            key={rom.id}
            rom={rom}
            installed={installedIds.has(rom.id)}
            onSelect={() => onSelect(rom)}
            showPlatform
          />
        ))}
        {onEndReached ? (
          <div className="row__sentinel" ref={sentinelRef} aria-hidden="true" />
        ) : null}
      </div>
    </section>
  )
}

/** Console-style button hints pinned to the bottom of the screen. */
export function Hints({ items }: { items: { key: string; label: string }[] }): JSX.Element {
  return (
    <div className="hints">
      {items.map((item) => (
        <span key={item.key + item.label}>
          <span className="hint__key">{item.key}</span>
          {item.label}
        </span>
      ))}
    </div>
  )
}

export function Overlay({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="overlay">
      <div className="overlay__panel">
        <h2 className="overlay__title">{title}</h2>
        {children}
      </div>
    </div>
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
export function QrCode({
  value,
  size = 240
}: {
  value: string
  size?: number
}): JSX.Element {
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
export function SystemIcon({
  system,
  size = 34
}: {
  system: string
  size?: number
}): JSX.Element {
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
      // The Systematic set first, so a screen of platforms is one visual family
      // rather than a mix of monochrome glyphs and coloured brand logos.
      .flatMap((name) => [
        `/assets/platforms/systematic/${name}.svg`,
        `/assets/platforms/${name}.svg`
      ])
      .map((path) => window.rommix.system.imageUrl(path))
      .filter((url): url is string => url !== null)
  }, [candidates.join('|')])

  const cacheKey = sources.join('|')
  const cached = resolvedIcons.get(cacheKey)
  const [attempt, setAttempt] = useState(0)

  // A different platform in the same slot has to start from the first source.
  useEffect(() => setAttempt(0), [cacheKey])

  if (cached) {
    return <img className="system-icon" style={{ width: size, height: size }} src={cached} alt={label} title={label} loading="lazy" />
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
    <button
      ref={ref as Ref<HTMLButtonElement>}
      className="tab"
      data-active={active}
      {...props}
    >
      {label}
      {badge != null ? <span className="tab__badge">{badge}</span> : null}
    </button>
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
