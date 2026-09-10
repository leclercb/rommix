import type { JSX } from 'react'
import type { SaveProgress } from '@shared/api'
import { ProgressBar } from '../../components'
import { Icon } from '../../icons'
import { useI18n } from '../../state'

/**
 * A pull or a push while it is running.
 *
 * The two buttons used to grey themselves out and say nothing else, which on a
 * home connection is a screen that has stopped: a save folder is a hundred
 * files on some systems, and a Switch title's archive is minutes of it.
 *
 * The same panel the download above it uses, because it is the same fact —
 * bytes crossing the wire against this game — and one that looked different
 * would read as a different kind of thing.
 */
export function SaveTransfer({ progress }: { progress: SaveProgress }): JSX.Element {
  const { t, formatBytes } = useI18n()
  const { direction, fileName, done, total, receivedBytes, totalBytes } = progress

  /** How far into the file in flight, where its size is known. */
  const share = totalBytes > 0 ? receivedBytes / totalBytes : null
  /**
   * How far into the run, where there is a run to measure.
   *
   * Only past one file: a push of a single save knows its list and still has
   * nothing to fill a bar with, and one that sat at nothing until it jumped to
   * finished is the screen this exists to replace.
   *
   * In files rather than in files and bytes together: the only run that knows
   * how many files it holds is a push, and a push is told nothing about the
   * bytes of the one on the wire, so folding `share` in here would count the
   * file that has just landed twice.
   */
  const run = total !== null && total > 1 ? done / total : null
  const percent = run ?? share

  return (
    <div className="download download--bare">
      <span className="download__facts">
        <span className="download__fact">
          <Icon name={direction === 'pull' ? 'pull' : 'push'} size={13} />
          {t(direction === 'pull' ? 'saves.pulling' : 'saves.pushing')}
        </span>
        {/* Null until the first file is chosen, which on a slow connection is
            the listing and the comparison — seconds of the panel saying only
            which direction it is going. */}
        {fileName ? (
          <span className="download__fact download__fact--file">
            <Icon name="file" size={13} />
            <span className="download__filename">{fileName}</span>
          </span>
        ) : null}
      </span>
      <div className="download__figures">
        <span className="download__size">
          {share !== null
            ? t('value.progressBytes', {
                received: formatBytes(receivedBytes),
                total: formatBytes(totalBytes)
              })
            : /* The file in flight, not the count of those finished — and the
                 last of a run stays the last, rather than becoming a file after
                 the end of it. */
              total !== null && total > 1
              ? t('value.progressFiles', { done: Math.min(done + 1, total), total })
              : ''}
        </span>
      </div>
      {/* Travelling rather than filling where there is nothing to divide by: an
          upload is handed over whole and nothing is heard until the server
          answers, and a bar stuck at nothing for that whole time is what a
          stalled transfer looks like. */}
      <ProgressBar percent={percent ?? 0} waiting={percent === null} />
    </div>
  )
}
