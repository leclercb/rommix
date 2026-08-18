import { type JSX, useEffect, useMemo, useState, type ReactNode, type Ref } from 'react'
import qrcode from 'qrcode-generator'
import { useFocusable } from './input/focus'
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
      {showPlatform ? <div className="card__meta">{rom.platform_display_name}</div> : null}
    </button>
  )
}

/** A horizontally scrolling shelf of games. */
export function GameRow({
  title,
  roms,
  installedIds,
  onSelect
}: {
  title: string
  roms: RommRom[]
  installedIds: Set<number>
  onSelect: (rom: RommRom) => void
}): JSX.Element | null {
  if (roms.length === 0) return null
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      <div className="row">
        {roms.map((rom) => (
          <GameCard
            key={rom.id}
            rom={rom}
            installed={installedIds.has(rom.id)}
            onSelect={() => onSelect(rom)}
            showPlatform
          />
        ))}
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
