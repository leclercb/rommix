import { type JSX, type Ref, useState } from 'react'
import type { RommRom } from '@shared/types'
import { FocusButton } from '../../../components'
import { FocusLayer, useAction, useFocusable } from '../../../input/focus'
import { useI18n } from '../../../state'

/**
 * The screenshots RomM holds for a game, and the viewer they open into.
 *
 * The grid crops every shot to one height so the rows stay straight, which is
 * what makes a viewer necessary rather than a nicety: a screenshot is looked at
 * for what is in it, and the thumbnail has thrown some of that away.
 */

export function ScreenshotsTab({ rom }: { rom: RommRom }): JSX.Element {
  const { t } = useI18n()
  const shots = rom.merged_screenshots ?? []
  /** Which shot the viewer is showing, or null while it is closed. */
  const [viewing, setViewing] = useState<number | null>(null)

  if (shots.length === 0) {
    return <div className="empty">{t('shots.empty')}</div>
  }
  return (
    <>
      <div className="shots">
        {shots.map((path, index) => (
          <Shot key={path} path={path} onSelect={() => setViewing(index)} />
        ))}
      </div>
      {viewing !== null ? (
        <ShotViewer
          shots={shots}
          index={viewing}
          onMove={setViewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </>
  )
}

/** One thumbnail, as something the pad can land on and press. */
function Shot({ path, onSelect }: { path: string; onSelect: () => void }): JSX.Element {
  const { t } = useI18n()
  const { ref, props } = useFocusable({ onSelect, actionLabel: t('shots.view') })

  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      className="shot"
      data-shot={path}
      aria-label={t('shots.view')}
      {...props}
    >
      <img
        className="shot__image"
        src={window.rommix.system.imageUrl(path) ?? undefined}
        alt=""
        loading="lazy"
      />
    </button>
  )
}

/**
 * One screenshot, as large as the screen will show it.
 *
 * A focus layer of its own, like every dialog: without it the pad walks off the
 * picture and onto the grid still sitting behind it.
 */
function ShotViewer({
  shots,
  index,
  onMove,
  onClose
}: {
  shots: string[]
  index: number
  onMove: (index: number) => void
  onClose: () => void
}): JSX.Element {
  return (
    <div className="viewer">
      <FocusLayer>
        <ViewerFrame shots={shots} index={index} onMove={onMove} onClose={onClose} />
      </FocusLayer>
    </div>
  )
}

/**
 * The picture and the three things that can be done to it.
 *
 * A child of the layer rather than part of it, so that `useAction` registers on
 * the layer the viewer is on — B closes the picture, and the screen behind it
 * keeps the same button for going back to the library.
 */
function ViewerFrame({
  shots,
  index,
  onMove,
  onClose
}: {
  shots: string[]
  index: number
  onMove: (index: number) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useI18n()
  useAction('back', onClose)

  // Both ends wrap round. Flipping through a set is a run of presses on one
  // button that stays under the thumb, and a button that stops answering at the
  // last shot reads as the viewer having stuck rather than as the end.
  const step = (by: number): void => onMove((index + by + shots.length) % shots.length)
  const several = shots.length > 1

  return (
    <>
      <div className="viewer__frame">
        {several ? (
          <FocusButton
            icon="previous"
            variant="ghost"
            action="shot-previous"
            actionLabel={t('shots.previous')}
            onSelect={() => step(-1)}
          />
        ) : null}
        <img
          className="viewer__image"
          src={window.rommix.system.imageUrl(shots[index]) ?? undefined}
          alt=""
        />
        {/* Where focus starts, so a set is walked with A alone. Next rather
            than Close: the picture is what was asked for, and the way out is
            the button that opened it. */}
        {several ? (
          <FocusButton
            icon="next"
            variant="ghost"
            action="shot-next"
            actionLabel={t('shots.next')}
            onSelect={() => step(1)}
            autoFocus
          />
        ) : null}
      </div>
      <div className="viewer__bar">
        {several ? (
          <span className="viewer__count">
            {t('shots.position', { index: index + 1, total: shots.length })}
          </span>
        ) : null}
        <FocusButton icon="keep" variant="ghost" onSelect={onClose} autoFocus={!several}>
          {t('action.close')}
        </FocusButton>
      </div>
    </>
  )
}
