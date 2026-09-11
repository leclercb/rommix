import type { JSX } from 'react'
import type { MessageKey } from '@shared/i18n'
import { isStopped, type DownloadState } from '@shared/types'
import type { IconName } from '../icons'
import { useI18n } from '../state'
import { Spinner } from './overlay'
import { StatusBadge, type Tone } from './status'

/**
 * The pieces that report a transfer: what it is doing, how far it has got, and
 * the panel a dialog watches one in.
 *
 * Here rather than on any one screen because several draw them — the queue
 * against a game's artwork, the game screen under its own banner, the two
 * install dialogs over a file they are fetching — and a state or a bar that
 * reads differently from one place to the next is one fact told two ways.
 */

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
  checking: { label: 'downloads.state.checking', tone: 'info', icon: 'search' },
  extracting: { label: 'downloads.state.extracting', tone: 'info', icon: 'package' },
  installing: { label: 'downloads.state.installing', tone: 'info', icon: 'install' },
  paused: { label: 'downloads.state.paused', tone: 'warn', icon: 'pause' },
  // Amber like a pause, because it is one to look at and one to finish. Not
  // the pause icon: nobody pressed anything.
  stalled: { label: 'downloads.state.stalled', tone: 'warn', icon: 'server' },
  done: { label: 'downloads.state.done', tone: 'ok', icon: 'confirm' },
  error: { label: 'downloads.state.error', tone: 'bad', icon: 'warn' },
  cancelled: { label: 'downloads.state.cancelled', tone: 'off', icon: 'cancel' }
} as const satisfies Record<DownloadState, { label: MessageKey; tone: Tone; icon: IconName }>

export function DownloadBadge({ state }: { state: DownloadState }): JSX.Element {
  const { t } = useI18n()
  const badge = BADGES[state]
  return <StatusBadge tone={badge.tone} icon={badge.icon} label={t(badge.label)} />
}

/**
 * How far something has got.
 *
 * The bar itself, without an opinion about what is filling it: the queue and
 * the game screen come through `DownloadBar` below, and the install dialogs —
 * a BIOS file, an emulator build — draw it directly. One bar in the app rather
 * than one per screen, because a transfer that looks different depending on
 * where it is watched from reads as a different kind of thing.
 */
export function ProgressBar({
  percent,
  colour,
  waiting = false
}: {
  /**
   * How far along, 0 to 100.
   *
   * Out of a hundred rather than out of one because it is written straight
   * into a CSS width, and a share of one is a legal percent — so a caller
   * that hands over `done / total` draws a sliver and is told nothing.
   */
  percent: number
  colour?: string
  /**
   * Nothing to divide by, so the bar travels instead of filling.
   *
   * For the transfers whose size cannot be known while they run — a save handed
   * to the server whole, a response that declares no length. A bar left at
   * nothing for the length of one is indistinguishable from a transfer that has
   * stopped, which is the one thing it must not say.
   */
  waiting?: boolean
}): JSX.Element {
  return (
    <div className={`download__bar${waiting ? ' download__bar--waiting' : ''}`}>
      <div
        className="download__fill"
        style={{
          width: waiting ? undefined : `${Math.max(0, Math.min(100, percent))}%`,
          background: colour
        }}
      />
    </div>
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
    state === 'error' ? 'var(--danger)' : isStopped(state) ? 'var(--warning)' : undefined

  return <ProgressBar percent={state === 'done' ? 100 : percent} colour={colour} />
}

/**
 * One file on its way in, as an install dialog reports it: its name, a bar,
 * and the figures under it.
 *
 * Drawn by the BIOS screen over a firmware file and by the emulator picker
 * over a release build. Both sit it inside `.install-progress`, and whatever
 * else a screen has to say — which console the file is for, how far through a
 * run of them it is — goes above and below it in that same panel.
 */
export function TransferProgress({
  name,
  receivedBytes,
  totalBytes
}: {
  name: string
  receivedBytes: number
  totalBytes: number
}): JSX.Element {
  const { t, formatBytes } = useI18n()

  return (
    <>
      <div className="install-progress__file">{name}</div>
      {totalBytes > 0 ? (
        <>
          <ProgressBar percent={(receivedBytes / totalBytes) * 100} />
          <div className="install-progress__meta">
            {t('value.progressBytes', {
              received: formatBytes(receivedBytes),
              total: formatBytes(totalBytes)
            })}
          </div>
        </>
      ) : (
        /* Nothing to divide by until a size is known, and one of the release
           APIs states none for its assets at all — so what has arrived is the
           whole of what can honestly be said, and the spinner beside it is
           what says the file is still coming. */
        <>
          <div className="install-progress__meta">{formatBytes(receivedBytes)}</div>
          <Spinner />
        </>
      )}
    </>
  )
}
