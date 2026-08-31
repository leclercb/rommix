import type { JSX } from 'react'
import type {
  InstalledRom,
  LaunchChoice,
  SaveAsset,
  SaveDeleteScope,
  SavePushPreview
} from '@shared/types'
import { FocusButton, Overlay } from '../../components'
import { useI18n } from '../../state'
import { PushPreviewList } from './PushPreviewList'
import { deleteScopeText, deleteScopesOf } from './tabs'

/**
 * The four questions this screen asks before doing something it cannot undo.
 *
 * Presentational, and here rather than in the screen: each is a title, a
 * sentence of consequence and two or three buttons, and stacked inline at the
 * end of the screen they buried the part that decides *when* each is asked.
 */

/** Which of an emulator's several runners should handle this system. */
export function LaunchVariantDialog({
  choice,
  onPick,
  onCancel
}: {
  choice: LaunchChoice
  onPick: (variant: string) => void
  onCancel: () => void
}): JSX.Element {
  const { t } = useI18n()
  return (
    <Overlay title={t('game.variantTitle', { system: choice.system })}>
      <p className="muted">
        {t('game.variantBody', { emulator: choice.emulatorName, system: choice.system })}
      </p>
      <div className="btn-row">
        {choice.options.map((option) => (
          <FocusButton
            key={option.id}
            icon="emulator"
            variant={option.id === choice.chosen ? 'primary' : 'default'}
            onSelect={() => onPick(option.id)}
            autoFocus={option.id === (choice.chosen ?? choice.options[0].id)}
          >
            {option.label}
            {option.note ? ` · ${option.note}` : ''}
          </FocusButton>
        ))}
      </div>
      <div className="btn-row">
        <FocusButton icon="cancel" variant="ghost" onSelect={onCancel}>
          {t('action.cancel')}
        </FocusButton>
      </div>
    </Overlay>
  )
}

/** One save or state, deleted from the one end the row's button named. */
export function DeleteAssetDialog({
  asset,
  scope,
  onKeep,
  onDelete
}: {
  asset: SaveAsset
  scope: SaveDeleteScope
  onKeep: () => void
  onDelete: () => void
}): JSX.Element {
  const { t } = useI18n()
  const { where, consequence } = deleteScopeText(scope, t)
  // Two whole questions rather than one with the kind slotted in: "this save"
  // and "this state" do not share an article in every language.
  return (
    <Overlay
      title={t(asset.kind === 'save' ? 'game.deleteSaveTitle' : 'game.deleteStateTitle', {
        where
      })}
    >
      <p className="muted">
        {/* The title says which end; this names the file and, for a local
            delete, the folder it is actually in — and then what happens to the
            copy left behind, which is the reason for deleting one end at all. */}
        {t('game.deleteAssetBody', {
          file: asset.fileName,
          location: scope === 'local' ? (asset.localPath?.replace(/\/[^/]*$/, '') ?? '') : 'RomM',
          consequence: deleteScopesOf(asset).length === 2 ? consequence : t('game.deleteOnlyCopy')
        })}
      </p>
      <div className="btn-row">
        <FocusButton icon="keep" onSelect={onKeep} autoFocus>
          {t('action.keep')}
        </FocusButton>
        <FocusButton icon="delete" variant="danger" onSelect={onDelete}>
          {t('game.deleteAt', { where })}
        </FocusButton>
      </div>
    </Overlay>
  )
}

/** The downloaded copy, and how much space getting rid of it frees. */
export function UninstallDialog({
  entry,
  onKeep,
  onUninstall
}: {
  entry: InstalledRom
  onKeep: () => void
  onUninstall: () => void
}): JSX.Element {
  const { t, formatBytes } = useI18n()
  return (
    <Overlay title={t('uninstall.title')}>
      <p className="muted">{t('uninstall.body', { folder: entry.path.replace(/\/[^/]*$/, '') })}</p>
      <div className="btn-row">
        <FocusButton icon="keep" onSelect={onKeep} autoFocus>
          {t('action.keep')}
        </FocusButton>
        <FocusButton icon="uninstall" variant="danger" onSelect={onUninstall}>
          {t('uninstall.freeing', { size: formatBytes(entry.sizeBytes) })}
        </FocusButton>
      </div>
    </Overlay>
  )
}

/** Exactly what a push would send, before it sends it. */
export function PushConfirmDialog({
  preview,
  onCancel,
  onSend
}: {
  preview: SavePushPreview
  onCancel: () => void
  /** `stopAsking` also turns the confirmation off for every future push. */
  onSend: (stopAsking: boolean) => void
}): JSX.Element {
  const { t } = useI18n()
  return (
    <Overlay title={t('game.pushTitle', { count: preview.files.length })}>
      <p className="muted">{t('game.pushUploadedAs', { device: preview.deviceName })}</p>
      <PushPreviewList files={preview.files} />
      <div className="btn-row">
        <FocusButton icon="cancel" onSelect={onCancel} autoFocus>
          {t('action.cancel')}
        </FocusButton>
        <FocusButton icon="push" variant="primary" onSelect={() => onSend(false)}>
          {t('game.pushSend')}
        </FocusButton>
        {/* Sends as well as stops asking: turning the setting off and leaving
            these files unsent is not what "don't ask me" means. */}
        <FocusButton icon="hide" variant="ghost" onSelect={() => onSend(true)}>
          {t('game.pushSendNoAsk')}
        </FocusButton>
      </div>
    </Overlay>
  )
}
