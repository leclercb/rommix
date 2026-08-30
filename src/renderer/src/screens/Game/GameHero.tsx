import { type JSX, type ReactNode, type Ref, useEffect, useState } from 'react'
import type { InstalledRom, RommRom, RomUserStatus } from '@shared/types'
import { ArtBackdrop, CoverArt, PlatformIcon } from '../../components'
import { useFocusable } from '../../input/focus'
import { Icon } from '../../icons'
import { useI18n } from '../../state'
import { StatusTag } from './StatusDialog'

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
  status,
  children
}: {
  rom: RommRom
  entry?: InstalledRom
  /** The ES-DE system this game resolves to, for the platform icon. */
  system: string | null
  /** How far through it the player says they are, or null if they have not. */
  status: RomUserStatus | null
  /** The action row: Play, Download, Pull saves, and the rest. */
  children: ReactNode
}): JSX.Element {
  const { t, formatBytes } = useI18n()
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
              {/* Larger than the marks on the chips beside it, this being the
                  one that says what the game runs on — but not so large that it
                  sets the chip's height, which would leave this one standing a
                  little taller than the rest of the line. */}
              <PlatformIcon
                slug={rom.platform_slug}
                system={system}
                size={18}
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
                <span className="faint"> {t('game.ratingOutOf')}</span>
              </span>
            ) : null}
            {/* The year only; the full release date is a row in Details. */}
            {year !== null ? (
              <span className="chip chip--icon">
                <Icon name="time" size={14} />
                {year}
              </span>
            ) : null}
            {/* Which dump this is, where the game itself is named — the pair
                that decides whether a copy boots and which of two files of
                the same game you are looking at. */}
            {rom.regions.length > 0 ? (
              <span className="chip chip--icon">
                <Icon name="region" size={14} />
                {rom.regions.join(', ')}
              </span>
            ) : null}
            {rom.revision ? (
              <span className="chip chip--icon">
                <Icon name="revision" size={14} />
                {t('game.revision', { revision: rom.revision })}
              </span>
            ) : null}
            <span className="chip chip--icon">
              <Icon name="size" size={14} />
              {formatBytes(rom.fs_size_bytes)}
            </span>
            {entry ? (
              <span className="chip chip--icon chip--on">
                <Icon name="download" size={14} />
                {t('library.downloadedMark')}
              </span>
            ) : null}
            {/* The genres are the one run of chips left unmarked: three of them
                carrying the same glyph in a row reads as a pattern rather than
                as three facts, and nothing about a genre needs saying twice. */}
            {rom.metadatum.genres.slice(0, 3).map((genre) => (
              <span className="chip" key={genre}>
                {genre}
              </span>
            ))}
            {/* Last on the line, after everything the game is: this is the one
                thing here the player put there themselves. Absent until they
                have — a chip reading "not said" on every game in the library
                would be a fact about nothing. */}
            {status ? <StatusTag status={status} /> : null}
          </div>
          {rom.summary ? <Summary text={rom.summary} /> : null}

          <div className="btn-row">{children}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * What the game is about, clamped to a few lines until it is asked for.
 *
 * The banner is a glance — artwork, platform, how big it is — and a synopsis
 * that ran to a dozen lines would push the buttons off the bottom of a
 * television. So it opens in place rather than in a dialog: the text stays
 * where it was being read, and a summary long enough to need scrolling is
 * scrolled the way every other page here is, by walking down it.
 *
 * Focusable only when there is more to see. A press that visibly does nothing
 * is worse than no press at all, and the hint bar would be advertising it.
 */
function Summary({ text }: { text: string }): JSX.Element {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [clipped, setClipped] = useState(false)
  const { ref, props } = useFocusable({
    onSelect: () => setExpanded((open) => !open),
    enabled: clipped,
    actionLabel: expanded ? t('game.showLess') : t('game.readMore')
  })

  // A fresh game is a fresh question, and one whose summary fits leaves nothing
  // focused where the last one had something.
  useEffect(() => setExpanded(false), [text])

  /**
   * Whether the clamp is actually hiding anything.
   *
   * Measured rather than guessed from the length of the string: how many lines
   * it takes depends on the width of the banner and on `Settings.uiScale`, so
   * the observer re-asks whenever the box is resized. Not while it is open —
   * an expanded box hides nothing by definition, and believing that would take
   * the focus out from under the button being read.
   */
  useEffect(() => {
    const element = ref.current
    if (!element || expanded) return
    const measure = (): void => setClipped(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, text, expanded])

  return (
    <div className="game-hero__about">
      <button
        ref={ref as Ref<HTMLButtonElement>}
        className="game-hero__summary"
        data-expanded={expanded}
        {...props}
      >
        {text}
      </button>
      {clipped ? (
        <span className="game-hero__more">
          {expanded ? t('game.showLess') : t('game.readMore')}
        </span>
      ) : null}
    </div>
  )
}
