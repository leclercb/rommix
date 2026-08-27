import { type JSX, useEffect, useMemo, useState } from 'react'
import { PLATFORM_ICON_PATHS, systemInfo } from '@config/systems'

/** Artwork: what RomM serves, and what stands in for it when it cannot. */

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
 * Four covers in one tile, the way RomM draws a collection.
 *
 * A collection has no artwork of its own unless someone uploaded some, and a
 * shelf drawn as one grey rectangle with a name on it is indistinguishable
 * from every other shelf. What identifies it from across a room is what is on
 * it, so the first few covers stand in — two by two, in the same 3:4 box a game
 * occupies, so a grid of collections lines up with a grid of games.
 *
 * One cover fills the tile rather than sitting in a quarter of it: a mosaic
 * with three empty cells reads as three missing pictures rather than as a
 * shelf with one game on it.
 */
export function CoverMosaic({
  paths,
  name
}: {
  /** Covers of the first few games, in the collection's own order. */
  paths: readonly (string | null)[]
  name: string
}): JSX.Element {
  const covers = paths.filter((path): path is string => Boolean(path)).slice(0, 4)

  if (covers.length <= 1) return <CoverArt path={covers[0] ?? null} name={name} />

  // The grid is a layer over `.cover`, not `.cover` itself. That box gets its
  // height from a padding-ratio pseudo-element, and a pseudo-element inside a
  // grid is a grid *item*: it took a row of its own and pushed the pictures out
  // below it. Absolutely positioned over the spacer, the way a single cover
  // already is, the ratio holds and the four cells divide it.
  return (
    <div className="cover cover--mosaic">
      <div className="cover__grid">
        {covers.map((path) => (
          <MosaicCell key={path} path={path} />
        ))}
      </div>
    </div>
  )
}

/**
 * One quarter of a mosaic.
 *
 * Its own component for the failure state: a cover that 404s has to fall back
 * to the empty gradient in that cell alone, which needs a `useState` per cell
 * and so a component per cell.
 */
function MosaicCell({ path }: { path: string }): JSX.Element {
  const url = window.rommix.system.imageUrl(path)
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [url])

  return url && !failed ? (
    <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <span />
  )
}

/**
 * The wash of artwork behind a hero.
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

/**
 * The RomMix mark: a cartridge whose label is a cassette.
 *
 * The same drawing as the app icon (packaging/icon.svg) minus its dark
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
  /**
   * The candidate names as one string, so the memo below has a dependency it
   * can actually be given.
   *
   * `candidates` is built inline by every caller and is therefore a new array
   * on every render — memoising against it would recompute each time, and
   * memoising against `candidates.join('|')` is an expression rather than a
   * value, which is the shape no dependency checker can verify. Joining first
   * costs one pass over at most two short strings. A platform slug never
   * contains a pipe, so the split below is exact.
   */
  const names = [...new Set(candidates.filter((name): name is string => Boolean(name)))].join('|')

  const sources = useMemo(
    () =>
      names
        .split('|')
        .filter(Boolean)
        .flatMap((name) => PLATFORM_ICON_PATHS.map((path) => path.replace('{name}', name)))
        .map((path) => window.rommix.system.imageUrl(path))
        .filter((url): url is string => url !== null),
    [names]
  )

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
