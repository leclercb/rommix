import type { JSX, ReactNode } from 'react'
import { Icon, type IconName } from '../icons'

/**
 * The marks that say what state something is in.
 *
 * Everything the app reports about a state wears one of these: whether an
 * emulator is installed, whether a BIOS file is in place, which end of a save
 * is ahead, how a transfer ended. One shape and one set of colours for all of
 * them, because a state that is drawn differently depending on the screen it
 * is on is a state the user has to learn twice.
 */

/**
 * The tones a mark is drawn in. See `.status[data-state]`.
 *
 * Named for what a state means rather than for a colour: the same set says
 * that a file is in place, that something still wants doing, and that
 * something will not happen at all.
 */
export type Tone = 'ok' | 'warn' | 'off' | 'info' | 'bad'

/** The glyph on a badge, at the size that sits on the line of its own words. */
const GLYPH_SIZE = 13

/**
 * A state as a word behind a coloured dot.
 *
 * The dot is what carries across a room and the word is what settles it: a
 * colour alone is easy to miss on a television, and a word alone is easy to
 * skim past.
 */
export function StatusPill({ tone, children }: { tone?: Tone; children: ReactNode }): JSX.Element {
  return (
    <span className="status" data-state={tone}>
      {children}
    </span>
  )
}

/**
 * A state as a word behind the mark of what it is about.
 *
 * The glyph stands in for the dot rather than joining it — see
 * `.status--badge` — because it says something the colour cannot: which way a
 * file would move, which end is holding it, what is being done to it. `title`
 * is the same fact at length, for whoever is close enough to hover.
 */
export function StatusBadge({
  tone,
  icon,
  label,
  title
}: {
  tone: Tone
  icon: IconName
  label: string
  title?: string
}): JSX.Element {
  return (
    <span className="status status--badge" data-state={tone} title={title}>
      <Icon name={icon} size={GLYPH_SIZE} />
      {label}
    </span>
  )
}
