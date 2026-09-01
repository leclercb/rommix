// Relative, with the extension: `src/shared/gamefiles.ts` explains why.
import type { SaveAsset } from './types.ts'

/**
 * When a save last changed, on the end that is ahead.
 *
 * One definition because two places need the same answer: the Saves tab prints
 * this date on the row, and `SaveSync.listAssets` orders the list by it. Worked
 * out separately they drift, and a list ordered by one date while showing
 * another reads as simply wrong.
 *
 * Which end is ahead is already settled — that is what the row's sync state
 * says, and what its badge is about — so this only has to follow it.
 */
export function changedAt(asset: SaveAsset): string | null {
  return asset.sync === 'local-only' || asset.sync === 'local-newer'
    ? asset.localModifiedAt
    : (asset.updatedAt ?? asset.localModifiedAt)
}
