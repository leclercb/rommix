import type { JSX } from 'react'
import type { MessageKey } from '@shared/i18n'
import type { DownloadState } from '@shared/types'
import { Icon, type IconName } from '../icons'
import { useI18n } from '../state'

/**
 * The two pieces that report a transfer: what it is doing, and how far it has
 * got.
 *
 * Here rather than on either screen because both draw them — the queue against
 * a game's artwork, the game screen under its own banner — and a state or a bar
 * that reads differently in the two places is one fact told two ways.
 */

/**
 * The tones the status pill is drawn in. See `.status[data-state]`.
 *
 * Named for what a state means rather than for a colour: the same four say
 * whether a BIOS file is in place and whether a save is behind the server's.
 */
type Tone = 'ok' | 'warn' | 'off' | 'info' | 'bad'

/**
 * What a transfer is doing, as a badge.
 *
 * Shared by the queue and the game screen because it is the same fact in both
 * places, and a state that reads differently depending on where it is shown is
 * one the user has to learn twice.
 *
 * A word in the same grey as the platform beside it is a word nobody reads from
 * a sofa, and the state is what these screens exist to report — so it gets the
 * mark and the colour the files and saves tabs give theirs: waiting is nothing
 * yet, arriving is in hand, paused wants an answer, failed is wrong.
 */
const BADGES = {
  queued: { label: 'downloads.state.queued', tone: 'off', icon: 'time' },
  downloading: { label: 'downloads.state.downloading', tone: 'info', icon: 'download' },
  extracting: { label: 'downloads.state.extracting', tone: 'info', icon: 'package' },
  paused: { label: 'downloads.state.paused', tone: 'warn', icon: 'pause' },
  done: { label: 'downloads.state.done', tone: 'ok', icon: 'confirm' },
  error: { label: 'downloads.state.error', tone: 'bad', icon: 'warn' },
  cancelled: { label: 'downloads.state.cancelled', tone: 'off', icon: 'cancel' }
} as const satisfies Record<DownloadState, { label: MessageKey; tone: Tone; icon: IconName }>

export function DownloadBadge({ state }: { state: DownloadState }): JSX.Element {
  const { t } = useI18n()
  const badge = BADGES[state]
  return (
    <span className="status status--badge" data-state={badge.tone}>
      <Icon name={badge.icon} size={13} />
      {t(badge.label)}
    </span>
  )
}

/**
 * How far a transfer has got, in the colour of what it is doing.
 *
 * One component for the queue and the game screen, because a bar that is amber
 * on one screen and accent on the other is two different facts as far as anyone
 * looking at it is concerned. Amber for a transfer waiting to be told to carry
 * on, red for one that failed, and the accent for one that is simply arriving.
 */
export function DownloadBar({
  state,
  percent
}: {
  state: DownloadState
  percent: number
}): JSX.Element {
  const colour =
    state === 'error' ? 'var(--danger)' : state === 'paused' ? 'var(--warning)' : undefined

  return (
    <div className="download__bar">
      <div
        className="download__fill"
        style={{ width: `${state === 'done' ? 100 : percent}%`, background: colour }}
      />
    </div>
  )
}
