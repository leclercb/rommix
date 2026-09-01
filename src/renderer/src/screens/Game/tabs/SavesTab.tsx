import type { JSX } from 'react'
import type { I18n, MessageKey } from '@shared/i18n'
import type { InstalledRom, SaveAsset, SaveDeleteScope, SaveSyncState } from '@shared/types'
import { changedAt } from '@shared/saveassets'
import { FocusButton, Spinner } from '../../../components'
import { Icon, type IconName } from '../../../icons'
import { useI18n } from '../../../state'

/**
 * How each sync state reads on a row.
 *
 * The label says which side is ahead, not what to press: the two buttons move
 * everything at once, so a per-row instruction would be promising an action
 * that does not exist. `hint` is the same thing at length, on hover.
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
  }
}

/**
 * The two ends a row's delete buttons clear, one button each.
 *
 * Both buttons on every row that has both copies, rather than one that clears
 * the pair: the two ends are the whole subject of this tab — every badge above
 * is about which of them is ahead — and the reason to delete one is almost
 * always that the other is the copy worth keeping. Throwing away a corrupt
 * local save and pulling RomM's back is a thing to want, and "delete
 * everywhere" cannot say it.
 *
 * `where` completes both the button — `Delete {where}` — and the dialog's
 * question, so the two cannot drift apart. `consequence` is what the surviving
 * copy will do, which is the part worth pausing over: neither delete stays
 * deleted by itself, and that is exactly why one presses it.
 */
export function deleteScopeText(
  scope: SaveDeleteScope,
  t: I18n['t']
): { where: string; consequence: string } {
  return scope === 'local'
    ? { where: t('saves.scopeLocal'), consequence: t('saves.consequenceLocal') }
    : { where: t('saves.scopeRemote'), consequence: t('saves.consequenceRemote') }
}

/** Which ends hold this file, and so which of the two buttons can act. */
export function deleteScopesOf(asset: SaveAsset): SaveDeleteScope[] {
  const scopes: SaveDeleteScope[] = []
  if (asset.localPath) scopes.push('local')
  if (asset.id !== null) scopes.push('remote')
  return scopes
}

/**
 * Saves and states held by RomM, and by this device.
 *
 * Both kinds in one list rather than two: they answer the same question — what
 * of mine is on the server, and how recent is it — and a save and its state
 * from the same session belong next to each other.
 */
export function SavesTab({
  assets,
  entry,
  onDelete
}: {
  assets: SaveAsset[] | null
  entry?: InstalledRom
  onDelete: (asset: SaveAsset, scope: SaveDeleteScope) => void
}): JSX.Element {
  const { t, formatBytes, formatDateTime } = useI18n()
  if (!assets) return <Spinner />
  if (assets.length === 0) {
    return (
      <div className="empty">
        {t('saves.empty')}
        {entry ? ` ${t('saves.emptyPlayIt')}` : ''}
      </div>
    )
  }

  return (
    <ul className="asset-list">
      {assets.map((asset) => {
        const badge = SYNC_BADGES[asset.sync]
        // The time the badge is talking about: the end that is ahead. Shared
        // with the sort that put this row where it is.
        const at = changedAt(asset)
        // Where the server's copy came from, on the rows where the answer
        // changes what to do about it: one this device does not have, and one
        // that is ahead of what it has. Everywhere else it is a copy the two
        // ends already agree about, and saying whose it is only crowds the
        // line — the more so as no state can ever say it, RomM recording an
        // origin for saves alone.
        const origin =
          asset.sync === 'remote-only' || asset.sync === 'remote-newer'
            ? asset.fromThisDevice
            : null

        return (
          <li key={`${asset.kind}-${asset.id ?? asset.localPath}`}>
            <span className="asset__kind" data-kind={asset.kind}>
              {asset.kind === 'save' ? t('asset.save') : t('asset.state')}
            </span>
            {/* Which side has it and whether they agree — and so which button,
                if any, would do something about this row. */}
            <span className="status status--badge" data-state={badge.tone} title={t(badge.hint)}>
              <Icon name={badge.icon} size={13} />
              {t(badge.label)}
            </span>
            <span className="asset__name">{asset.fileName}</span>
            <span className="asset__meta">
              {formatBytes(asset.sizeBytes)}
              {asset.emulator ? ` · ${asset.emulator}` : ''}
              {origin === true ? ` · ${t('push.thisDevice')}` : ''}
              {origin === false ? ` · ${t('push.anotherDevice')}` : ''}
              {at ? ` · ${formatDateTime(at)}` : ''}
            </span>
            {/* One button per end that actually holds the file, each naming its
                end. A row with both copies gets both, which is what makes the
                two ends separable: delete the local one, pull RomM's back. */}
            <span className="asset__actions">
              {deleteScopesOf(asset).map((scope) => (
                <FocusButton
                  key={scope}
                  icon="delete"
                  variant="danger"
                  onSelect={() => onDelete(asset, scope)}
                >
                  {t('game.deleteAt', { where: deleteScopeText(scope, t).where })}
                </FocusButton>
              ))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
