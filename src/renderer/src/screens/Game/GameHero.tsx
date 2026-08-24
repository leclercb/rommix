import type { JSX, ReactNode } from 'react'
import type { InstalledRom, RommRom } from '@shared/types'
import { ArtBackdrop, CoverArt, PlatformIcon, formatBytes } from '../../components'
import { Icon } from '../../icons'

/**
 * The game's own banner: a still of it washed out behind the cover and the
 * title, running to both edges of the screen. The artwork is what says which
 * game this is from across a room — the words only confirm it — so it is given
 * the top of the page rather than a thumbnail.
 *
 * Everything drawn here is a fact about the game. What can be *done* with it
 * arrives as `children`, because those buttons are the screen's own state —
 * what is downloading, what is running, what is busy — and only the screen
 * holding that state can say what each one does.
 */
export function GameHero({
  rom,
  entry,
  system,
  children
}: {
  rom: RommRom
  entry?: InstalledRom
  /** The ES-DE system this game resolves to, for the platform icon. */
  system: string | null
  /** The action row: Play, Download, Pull saves, and the rest. */
  children: ReactNode
}): JSX.Element {
  const title = rom.name ?? rom.fs_name
  const rating = rom.metadatum.average_rating ? Math.round(rom.metadatum.average_rating) : null
  const year = rom.metadatum.first_release_date
    ? new Date(rom.metadatum.first_release_date * 1000).getFullYear()
    : null

  return (
    <div className="game-hero">
      <ArtBackdrop
        paths={[rom.merged_screenshots?.[0], rom.path_cover_large, rom.path_cover_small]}
      />
      <div className="game-hero__body">
        <div className="game-hero__art">
          <CoverArt path={rom.path_cover_large ?? rom.path_cover_small} name={title} />
        </div>
        <div className="game-hero__text">
          <h1 className="game-hero__title">{title}</h1>
          <div className="game-hero__meta">
            <span className="chip chip--icon">
              <PlatformIcon
                slug={rom.platform_slug}
                system={system}
                size={22}
                label={rom.platform_display_name}
              />
              {rom.platform_display_name}
            </span>
            {/* Out on its own rather than as one chip among several: it is
                the one number here that helps decide whether to press Play,
                and in a line of grey pills it was read last. */}
            {rating !== null ? (
              <span className="game-hero__rating">
                <Icon name="rating" size={16} />
                {rating}
                <span className="faint"> / 100</span>
              </span>
            ) : null}
            {/* The year only; the full release date is a row in Details. */}
            {year !== null ? <span className="chip">{year}</span> : null}
            {/* Which dump this is, where the game itself is named — the pair
                that decides whether a copy boots and which of two files of
                the same game you are looking at. */}
            {rom.regions.length > 0 ? (
              <span className="chip chip--icon">
                <Icon name="region" size={14} />
                {rom.regions.join(', ')}
              </span>
            ) : null}
            {rom.revision ? <span className="chip">Rev {rom.revision}</span> : null}
            <span className="chip">{formatBytes(rom.fs_size_bytes)}</span>
            {entry ? <span className="chip chip--on">Downloaded</span> : null}
            {rom.metadatum.genres.slice(0, 3).map((genre) => (
              <span className="chip" key={genre}>
                {genre}
              </span>
            ))}
          </div>
          {rom.summary ? <p className="game-hero__summary">{rom.summary}</p> : null}

          <div className="btn-row">{children}</div>
        </div>
      </div>
    </div>
  )
}
