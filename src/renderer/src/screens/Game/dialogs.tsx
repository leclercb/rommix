import type { JSX } from 'react'
import type {
  InstalledRom,
  LaunchChoice,
  SaveAsset,
  SaveDeleteScope,
  SavePushPreview
} from '@shared/types'
import { FocusButton, Overlay, formatBytes } from '../../components'
import { PushPreviewList } from './PushPreviewList'
import { DELETE_SCOPES, deleteScopesOf } from './tabs'

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
  return (
    <Overlay title={`How should ${choice.system} games run?`}>
      <p className="muted">
        {choice.emulatorName} offers several. Remembered for {choice.system} — change it later with
        Run with
      </p>
      <div className="btn-row">
        {choice.options.map((option) => (
          <FocusButton
            key={option.id}
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
          Cancel
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
  return (
    <Overlay title={`Delete this ${asset.kind} ${DELETE_SCOPES[scope].where}?`}>
      <p className="muted">
        {/* The title says which end; this names the file and, for a local
            delete, the folder it is actually in. */}
        {asset.fileName} — {scope === 'local' ? asset.localPath?.replace(/\/[^/]*$/, '') : 'RomM'}.{' '}
        {/* What happens to the copy left behind. Not a warning: it is the
            reason for deleting one end rather than both. */}
        {deleteScopesOf(asset).length === 2
          ? DELETE_SCOPES[scope].consequence
          : 'This is the only copy.'}
      </p>
      <div className="btn-row">
        <FocusButton icon="keep" onSelect={onKeep} autoFocus>
          Keep it
        </FocusButton>
        <FocusButton icon="delete" variant="danger" onSelect={onDelete}>
          Delete {DELETE_SCOPES[scope].where}
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
  return (
    <Overlay title="Uninstall this game?">
      <p className="muted">
        {entry.fileName} will be deleted from {entry.path.replace(/\/[^/]*$/, '')}. Your saves on
        RomM are kept.
      </p>
      <div className="btn-row">
        <FocusButton icon="keep" onSelect={onKeep} autoFocus>
          Keep it
        </FocusButton>
        <FocusButton icon="uninstall" variant="danger" onSelect={onUninstall}>
          Uninstall, freeing {formatBytes(entry.sizeBytes)}
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
  return (
    <Overlay
      title={`Send ${preview.files.length} file${preview.files.length === 1 ? '' : 's'} to RomM?`}
    >
      <p className="muted">Uploaded as {preview.deviceName}.</p>
      <PushPreviewList files={preview.files} />
      <div className="btn-row">
        <FocusButton icon="cancel" onSelect={onCancel} autoFocus>
          Cancel
        </FocusButton>
        <FocusButton icon="push" variant="primary" onSelect={() => onSend(false)}>
          Send to RomM
        </FocusButton>
      </div>
      {/* The shortcut to the Settings toggle, put where the question is
          actually being asked. Sends as well as stops asking: turning it off
          and leaving these files unsent would be the one answer nobody means
          by "don't ask me". */}
      <div className="btn-row">
        <FocusButton icon="hide" variant="ghost" onSelect={() => onSend(true)}>
          Send and don&apos;t ask again
        </FocusButton>
      </div>
    </Overlay>
  )
}
