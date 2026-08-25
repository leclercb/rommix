import type { JSX } from 'react'
import { FocusButton, Overlay } from '../../components'
import { useI18n } from '../../state'

/**
 * What changing the emulator for a platform actually costs, and the two ways
 * of agreeing to it.
 *
 * Every emulator keeps its own BIOS folder, its own save tree, and — unless
 * games live in RomMix's shared folder — its own copy of every ROM. None of
 * that follows the platform across, so a reorder that looks like a preference
 * is in fact a re-download. Said before it happens rather than discovered
 * afterwards as a library that has apparently emptied itself.
 *
 * Dismissible, because someone arranging five emulators will see this five
 * times and the second time it is already noise.
 */
export function EmulatorChangeNotice({
  sharedRoms,
  onConfirm,
  onCancel
}: {
  sharedRoms: boolean
  onConfirm: (dontAskAgain: boolean) => void
  onCancel: () => void
}): JSX.Element {
  const { t } = useI18n()
  return (
    <Overlay title={t('change.title')}>
      <p className="muted">{t('change.body')}</p>
      <ul className="notice__list muted">
        <li>{t('change.bios')}</li>
        <li>{sharedRoms ? t('change.gamesShared') : t('change.gamesPerEmulator')}</li>
        <li>{t('change.saves')}</li>
      </ul>
      <div className="btn-row">
        <FocusButton icon="confirm" variant="primary" onSelect={() => onConfirm(false)} autoFocus>
          {t('change.confirm')}
        </FocusButton>
        <FocusButton icon="hide" onSelect={() => onConfirm(true)}>
          {t('change.confirmNoAsk')}
        </FocusButton>
        <FocusButton icon="cancel" variant="ghost" onSelect={onCancel}>
          {t('action.cancel')}
        </FocusButton>
      </div>
    </Overlay>
  )
}

/** The dismissal key for `EmulatorChangeNotice`, in `Settings.dismissedNotices`. */
export const EMULATOR_CHANGE_NOTICE = 'emulator-change'
