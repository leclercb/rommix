import type { JSX, Ref } from 'react'
import { isStopped, type DownloadItem } from '@shared/types'
import { CoverArt, DownloadBadge, DownloadBar, FocusButton, SystemIcon } from '../../components'
import { Icon } from '../../icons'
import { useFocusable } from '../../input/focus'
import { useI18n } from '../../state'

/**
 * One transfer.
 *
 * Selecting the row opens the game, the same as everywhere else in the app.
 * Cancelling is a labelled button of its own: it used to be what the row itself
 * did, so pressing A on a download in progress — the obvious thing to do to a
 * thing you are watching — threw away the transfer with nothing on screen
 * saying that it would.
 */
export function ProgressRow({
  item,
  onSelect,
  onCancel,
  onPause,
  onResume,
  onNext,
  interrupts = true
}: {
  item: DownloadItem
  onSelect: () => void
  onCancel?: () => void
  onPause?: () => void
  onResume?: () => void
  /** Offered only where it would change the order. See `DownloadManager.promote`. */
  onNext?: () => void
  /** Whether pressing that starts this game now or only moves it up the queue. */
  interrupts?: boolean
}): JSX.Element {
  const { t, formatBytes } = useI18n()
  const { ref, props } = useFocusable({ onSelect, actionLabel: t('action.open') })
  const percent = item.totalBytes > 0 ? Math.round((item.receivedBytes / item.totalBytes) * 100) : 0
  const stopped = isStopped(item.state)
  const resumable = stopped && onResume !== undefined
  /**
   * Whether Pause is a thing this transfer can honestly offer.
   *
   * Extracting is out because unpacking an archive is nobody's to interrupt
   * half-way. A ROM the server cannot send in pieces is out for a better
   * reason: pausing it would lose everything transferred, which is what Cancel
   * is for — two buttons for one outcome, one of them lying about it.
   */
  const stoppable =
    onPause !== undefined &&
    item.resumable !== false &&
    (item.state === 'downloading' || item.state === 'queued')
  // The column the buttons need is added for the buttons there actually are,
  // not for one of them: a row that only offers Resume needs it just as much.
  const acts = Boolean(onCancel) || resumable || stoppable || Boolean(onNext)

  return (
    <div
      ref={ref as Ref<HTMLDivElement>}
      className={`download download--row ${acts ? 'download--action' : ''}`}
      data-download={item.romId}
      {...props}
    >
      <div className="download__art">
        <CoverArt path={item.coverPath} name={item.name} />
      </div>
      {/* The game over what is happening to it, in two lines of one column.
          Everything here is text that can run long — a game's name, a platform,
          the file of a disc set on the wire — so it is the part that gives way,
          and the figures and buttons beside it keep their place. */}
      <div className="download__text">
        <span className="download__name">{item.name}</span>
        <span className="download__facts">
          <span className="download__fact">
            <SystemIcon system={item.system} size={16} />
            {item.platformName}
          </span>
          {/* Said rather than left to be inferred from a missing button. */}
          {item.state === 'downloading' && item.resumable === false ? (
            <span className="download__fact">{t('downloads.notResumable')}</span>
          ) : null}
          {/* Which of a disc set's files is on the wire, which is the only
              thing that moves through twenty minutes of the same bar. Only
              while one actually is: a transfer that has stopped is not
              halfway through anything. */}
          {item.state === 'downloading' && item.currentFile ? (
            <span className="download__fact download__fact--file">
              <Icon name="file" size={13} />
              <span className="download__filename">{item.currentFile}</span>
            </span>
          ) : null}
        </span>
      </div>
      {/* The state and how far it has got, together and to the right — the two
          things that change, where they can be read down the list without the
          words beside them moving anything sideways. */}
      <div className="download__figures">
        <DownloadBadge state={item.state} />
        {/* Whenever there is something to say, which is not the same as being
            on the wire: a transfer that was paused and then resumed waits its
            turn with a gigabyte already on disk, and a row that said nothing
            about it read as a download about to start from nothing. */}
        {item.receivedBytes > 0 && item.state !== 'done' ? (
          <span className="download__size">
            {formatBytes(item.receivedBytes)} / {formatBytes(item.totalBytes)}
          </span>
        ) : null}
      </div>
      {acts ? (
        <div className="download__actions">
          {/* First, because it is the one that decides what the other two are
              about: a small game moved past a large one is the difference
              between playing it now and pausing something to get at it. */}
          {onNext ? (
            <FocusButton icon="next" action="promote" onSelect={onNext}>
              {interrupts ? t('downloads.now') : t('downloads.next')}
            </FocusButton>
          ) : null}
          {resumable ? (
            <FocusButton icon="download" action="resume" onSelect={onResume}>
              {t('action.resume')}
            </FocusButton>
          ) : null}
          {stoppable ? (
            <FocusButton icon="pause" action="pause-transfer" onSelect={onPause}>
              {t('action.pause')}
            </FocusButton>
          ) : null}
          {onCancel ? (
            <FocusButton
              icon="cancel"
              variant="danger"
              action="cancel-transfer"
              onSelect={onCancel}
            >
              {t('action.cancel')}
            </FocusButton>
          ) : null}
        </div>
      ) : null}
      <DownloadBar state={item.state} percent={percent} />
      {item.error ? <span className="download__state faint">{item.error}</span> : null}
    </div>
  )
}
