import { type JSX, useState } from 'react'
import type { RommRom } from '@shared/types'
import { FocusButton } from '../../../components'
import { useApp, useI18n } from '../../../state'

/**
 * The scanned manual RomM holds for a game, drawn by the viewer Chromium
 * already has.
 *
 * A PDF is not a format RomMix has any business implementing, and the browser
 * this is built on renders one — so the tab is a frame pointed at the file,
 * fetched over the same authenticated protocol a cover comes down. The viewer
 * is a plugin and off unless asked for; see `plugins` in `app.ts`.
 *
 * `toolbar=0` takes away the viewer's own controls, which are small mouse
 * targets along the top and unreachable from a sofa, and the two buttons under
 * the frame put paging back where the pad can get at it: the page is part of
 * the address, so setting it is what moves the manual.
 *
 * Nothing here knows how many pages there are. The viewer knows and does not
 * say, and the file is fetched by the frame rather than read here — so the page
 * is not numbered on screen, a number that carried on past the end of the
 * manual being worse than no number at all. Walking past the last page leaves
 * the viewer standing where it is.
 */
export function ManualTab({ rom }: { rom: RommRom }): JSX.Element {
  const { t } = useI18n()
  const { offline } = useApp()
  const [page, setPage] = useState(1)
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
    <div className="manual">
      <iframe
        className="manual__page"
        data-manual={page}
        src={`${url}#toolbar=0&view=FitH&page=${page}`}
        title={t('game.tabManual')}
      />
      <div className="btn-row">
        <FocusButton
          icon="previous"
          action="manual-previous"
          disabled={page === 1}
          onSelect={() => setPage((at) => Math.max(1, at - 1))}
        >
          {t('manual.previous')}
        </FocusButton>
        <FocusButton icon="next" action="manual-next" onSelect={() => setPage((at) => at + 1)}>
          {t('manual.next')}
        </FocusButton>
      </div>
    </div>
  )
}
