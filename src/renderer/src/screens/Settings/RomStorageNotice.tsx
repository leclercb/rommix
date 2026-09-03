import type { JSX } from 'react'
import type { RomStorage } from '@shared/types'
import { FocusButton, Overlay } from '../../components'
import { useI18n } from '../../state'

/**
 * What moving the library costs, asked before it moves.
 *
 * Both directions, because both have a consequence that shows up somewhere
 * other than this screen, and the hint under the control is one line:
 *
 *  - Into each emulator's folder, a download is tied to the emulator that ran
 *    its platform. Point that platform at another one and the game stops
 *    counting as downloaded — the file is still there, in a tree the new
 *    emulator never reads — so it is offered again. That is discovered on the
 *    game screen, long after the switch that caused it.
 *  - Into RomMix's own folder, nothing is tied to anything, but no emulator
 *    reads that folder until it is told to. Skip the step and the download
 *    lands, RomMix reports it, and the emulator's own list is empty.
 *
 * Neither is dismissible, unlike `EmulatorChangeNotice`: this is one switch
 * flipped once, not a question asked five times while a list is reordered.
 */
export function RomStorageNotice({
  to,
  onConfirm,
  onCancel
}: {
  /** Where the library would go if this is agreed to. */
  to: RomStorage
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const { t } = useI18n()
  const shared = to === 'rommix'

  return (
    <Overlay title={t(shared ? 'storage.toSharedTitle' : 'storage.toEmulatorTitle')} icon="folder">
      <p className="muted">{t(shared ? 'storage.toSharedBody' : 'storage.toEmulatorBody')}</p>
      <ul className="notice__list muted">
        {shared ? (
          <>
            <li>{t('storage.toSharedSetup')}</li>
            <li>{t('storage.toSharedFree')}</li>
            <li>{t('storage.toSharedExisting')}</li>
          </>
        ) : (
          <>
            <li>{t('storage.toEmulatorChange')}</li>
            <li>{t('storage.toEmulatorMissing')}</li>
            <li>{t('storage.toEmulatorExisting')}</li>
          </>
        )}
      </ul>
      <div className="btn-row">
        {/* Staying put is focused, not the change: the control has already been
            pressed, so the press that lands here is one press away from
            agreeing to whatever the list above is explaining. */}
        <FocusButton icon="cancel" action="storage-keep" onSelect={onCancel} autoFocus>
          {t(shared ? 'storage.toSharedKeep' : 'storage.toEmulatorKeep')}
        </FocusButton>
        <FocusButton icon="confirm" action="storage-confirm" variant="primary" onSelect={onConfirm}>
          {t(shared ? 'storage.toSharedConfirm' : 'storage.toEmulatorConfirm')}
        </FocusButton>
      </div>
    </Overlay>
  )
}
