import type { JSX } from 'react'
import type { InstalledRom, SaveAsset, SaveDeleteScope, SaveSyncState } from '@shared/types'
import { FocusButton, Spinner, formatBytes, formatDateTime } from '../../../components'
import { Icon, type IconName } from '../../../icons'

/**
 * How each sync state reads on a row.
 *
 * The label says which side is ahead, not what to press: the two buttons move
 * everything at once, so a per-row instruction would be promising an action
 * that does not exist. `hint` is the same thing at length, on hover.
 */
const SYNC_BADGES: Record<
  SaveSyncState,
  { label: string; tone: 'ok' | 'warn' | 'off'; icon: IconName; hint: string }
> = {
  synced: {
    label: 'In sync',
    tone: 'ok',
    icon: 'confirm',
    hint: 'This device and RomM have the same file.'
  },
  'local-newer': {
    label: 'Newer here',
    tone: 'warn',
    icon: 'push',
    hint: 'Played since it was last uploaded. Push saves sends it.'
  },
  'local-only': {
    label: 'Not on RomM',
    tone: 'warn',
    icon: 'push',
    hint: 'Only on this device. Push saves sends it.'
  },
  'remote-newer': {
    label: 'Newer on RomM',
    tone: 'warn',
    icon: 'pull',
    hint: 'RomM has a more recent copy. Pull saves fetches it.'
  },
  'remote-only': {
    label: 'Not on this device',
    tone: 'off',
    icon: 'pull',
    hint: 'Only on RomM. Pull saves fetches it.'
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
export const DELETE_SCOPES: Record<SaveDeleteScope, { where: string; consequence: string }> = {
  local: {
    where: 'from this device',
    consequence: 'Pull saves brings the copy on RomM back down.'
  },
  remote: {
    where: 'from RomM',
    consequence: 'Push saves sends the copy on this device back up.'
  }
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
  if (!assets) return <Spinner />
  if (assets.length === 0) {
    return (
      <div className="empty">
        No saves for this game, here or on RomM.
        {entry ? ' Play it once and its save will appear here.' : ''}
      </div>
    )
  }

  return (
    <ul className="asset-list">
      {assets.map((asset) => {
        const badge = SYNC_BADGES[asset.sync]
        // The time the badge is talking about: the end that is ahead.
        const at =
          asset.sync === 'local-only' || asset.sync === 'local-newer'
            ? asset.localModifiedAt
            : (asset.updatedAt ?? asset.localModifiedAt)

        return (
          <li key={`${asset.kind}-${asset.id ?? asset.localPath}`}>
            <span className="asset__kind" data-kind={asset.kind}>
              {asset.kind === 'save' ? 'Save' : 'State'}
            </span>
            {/* Which side has it and whether they agree — and so which button,
                if any, would do something about this row. */}
            <span className="status status--badge" data-state={badge.tone} title={badge.hint}>
              <Icon name={badge.icon} size={13} />
              {badge.label}
            </span>
            <span className="asset__name">{asset.fileName}</span>
            <span className="asset__meta">
              {formatBytes(asset.sizeBytes)}
              {asset.emulator ? ` · ${asset.emulator}` : ''}
              {/* Where it came from, when the server recorded it: the useful
                  thing to know about a save you did not expect to see. */}
              {asset.fromThisDevice === true ? ' · this device' : ''}
              {asset.fromThisDevice === false ? ' · another device' : ''}
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
                  Delete {DELETE_SCOPES[scope].where}
                </FocusButton>
              ))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
