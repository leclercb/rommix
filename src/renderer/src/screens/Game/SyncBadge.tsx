import type { JSX } from 'react'
import type { MessageKey } from '@shared/i18n'
import type { PendingSave, SaveSyncState } from '@shared/types'
import { Icon, type IconName } from '../../icons'
import { useI18n } from '../../state'

/**
 * How each sync state reads on a row.
 *
 * The label says which side is ahead, not what to press: the buttons that move
 * saves move everything at once, so a per-row instruction would be promising an
 * action that does not exist. `hint` is the same thing at length, on hover.
 */
const SYNC_BADGES: Record<
  SaveSyncState,
  { label: MessageKey; tone: 'ok' | 'warn' | 'off'; icon: IconName; hint: MessageKey }
> = {
  synced: { label: 'saves.synced', tone: 'ok', icon: 'confirm', hint: 'saves.syncedHint' },
  'local-newer': {
    label: 'saves.localNewer',
    tone: 'warn',
    icon: 'push',
    hint: 'saves.localNewerHint'
  },
  'local-only': {
    label: 'saves.localOnly',
    tone: 'warn',
    icon: 'push',
    hint: 'saves.localOnlyHint'
  },
  'remote-newer': {
    label: 'saves.remoteNewer',
    tone: 'warn',
    icon: 'pull',
    hint: 'saves.remoteNewerHint'
  },
  'remote-only': {
    label: 'saves.remoteOnly',
    tone: 'off',
    icon: 'pull',
    hint: 'saves.remoteOnlyHint'
  },
  // No arrow on this one: every other badge points at the end that is ahead,
  // and the whole of what this one says is that nobody knows which that is.
  unchecked: { label: 'saves.unchecked', tone: 'off', icon: 'saves', hint: 'saves.uncheckedHint' }
}

/**
 * Which side is ahead, as one chip.
 *
 * A component rather than the table alone, because two lists draw it — the
 * Saves tab and the push confirmation — and a badge that differed between the
 * two would be saying that a file listed in both is two different things.
 */
export function SyncBadge({ sync }: { sync: SaveSyncState }): JSX.Element {
  const { t } = useI18n()
  const badge = SYNC_BADGES[sync]
  return (
    <span className="status status--badge" data-state={badge.tone} title={t(badge.hint)}>
      <Icon name={badge.icon} size={13} />
      {t(badge.label)}
    </span>
  )
}

/**
 * A file a push would send, as the sync state it is in.
 *
 * Three of the five, and the push preview can be in no others: it lists local
 * files, so neither `remote-only` nor — the server's copy having already been
 * compared — `synced` can appear. Derived rather than carried on `PendingSave`,
 * so the dialog and the tab cannot disagree about one file: both are reading
 * `isNewer`, which `previewPush` decides with the same `syncStateOf` the tab's
 * own rows come from.
 */
export function pushSyncState(file: PendingSave): SaveSyncState {
  if (!file.replaces) return 'local-only'
  return file.replaces.isNewer ? 'remote-newer' : 'local-newer'
}
