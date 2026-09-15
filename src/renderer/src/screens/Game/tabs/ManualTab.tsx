import { type JSX, useState } from 'react'
import type { RommRom } from '@shared/types'
import { FocusButton } from '../../../components'
import { Icon } from '../../../icons'
import { FocusLayer, useAction } from '../../../input/focus'
import { useApp, useI18n } from '../../../state'

/**
 * The scanned manual RomM holds for a game, opened the way a screenshot is.
 *
 * A PDF is not a format RomMix has any business implementing, and the browser
 * this is built on renders one — so the page is a frame pointed at the file,
 * fetched over the same authenticated protocol a cover comes down. The viewer
 * is a plugin and off unless asked for; see `plugins` in `app.ts`.
 *
 * The tab itself is one row. A manual read inside the panel is a page the size
 * of a postcard under a banner and a strip of tabs, and the paper is the whole
 * subject — so pressing the row hands it the screen, exactly as pressing a
 * thumbnail hands the screen to a screenshot. See `ShotViewer`, which this is
 * shaped after down to which button opens with the highlight.
 */
export function ManualTab({ rom }: { rom: RommRom }): JSX.Element {
  const { t } = useI18n()
  const { offline } = useApp()
  const [reading, setReading] = useState(false)
  const url = window.rommix.system.assetUrl(rom.path_manual)

  if (!url) return <div className="empty">{t('manual.missing')}</div>

  /*
   * The one part of this page that is never on the disk.
   *
   * Every other thing a game's page draws has a copy saved when the game was
   * installed, so the screen narrows rather than empties with the server away.
   * A manual is tens of megabytes of a game nobody may ever open, so it is
   * fetched when it is asked for — which means saying so here, rather than
   * leaving the frame to draw the browser's own error page in English.
   */
  if (offline) return <div className="empty">{t('manual.offline')}</div>

  return (
    <>
      <ul className="asset-list">
        <li>
          {/* The mark rather than a coloured tag: `asset__kind` says which of
              two kinds of *file* a row holds, and there is only one kind of
              manual. */}
          <Icon name="manual" size={18} />
          <span className="asset__name">{t('game.tabManual')}</span>
          <FocusButton icon="manual" action="read-manual" onSelect={() => setReading(true)}>
            {t('manual.read')}
          </FocusButton>
        </li>
      </ul>
      {reading ? <ManualViewer url={url} onClose={() => setReading(false)} /> : null}
    </>
  )
}

/**
 * The manual, as large as the screen will show it.
 *
 * A focus layer of its own, like every dialog: without it the pad walks off the
 * page and onto the row still sitting behind it.
 */
function ManualViewer({ url, onClose }: { url: string; onClose: () => void }): JSX.Element {
  return (
    <div className="viewer">
      <FocusLayer>
        <ViewerFrame url={url} onClose={onClose} />
      </FocusLayer>
    </div>
  )
}

/**
 * The page, and the three things that can be done to it.
 *
 * A child of the layer rather than part of it, so that `useAction` registers on
 * the layer the viewer is on — B closes the manual, and the screen behind it
 * keeps the same button for going back to the library.
 *
 * `toolbar=0` takes away the viewer's own controls, which are small mouse
 * targets along the top and unreachable from a sofa. `view=Fit` is what lets
 * them go: fitted to the width instead, a page is taller than the screen and
 * the rest of it is behind a scrollbar the pad cannot reach — the highlight is
 * what scrolls a page here, and it cannot go inside a frame. Fitted whole, a
 * press of Next is the only movement a manual needs.
 */
function ViewerFrame({ url, onClose }: { url: string; onClose: () => void }): JSX.Element {
  const { t } = useI18n()
  const [page, setPage] = useState(1)
  useAction('back', onClose)

  return (
    <>
      <div className="viewer__frame">
        {/* Neither end wraps, unlike a set of screenshots: a manual is read in
            order and from the front, so there is no page nought to come round
            to — and walking off the back leaves the viewer where it is, the
            page count being the viewer's own and never told to us. */}
        <FocusButton
          icon="previous"
          variant="ghost"
          action="manual-previous"
          actionLabel={t('manual.previous')}
          disabled={page === 1}
          onSelect={() => setPage((at) => Math.max(1, at - 1))}
        />
        <iframe
          /*
           * Keyed by the page, so each press builds a frame rather than editing
           * one. The viewer reads the page out of the address it is opened
           * with; a fragment changed underneath an open document is a
           * navigation the browser is free to skip, and skipping it is what
           * left these buttons doing nothing at all outside Electron.
           */
          key={page}
          className="viewer__page"
          data-manual={page}
          src={`${url}#toolbar=0&view=Fit&page=${page}`}
          title={t('game.tabManual')}
        />
        {/* Where focus starts, so a manual is read with A alone. */}
        <FocusButton
          icon="next"
          variant="ghost"
          action="manual-next"
          actionLabel={t('manual.next')}
          onSelect={() => setPage((at) => at + 1)}
          autoFocus
        />
      </div>
      <div className="viewer__bar">
        <FocusButton icon="keep" variant="ghost" action="close-manual" onSelect={onClose}>
          {t('action.close')}
        </FocusButton>
      </div>
    </>
  )
}
