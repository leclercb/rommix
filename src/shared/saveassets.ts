// Relative, with the extension: `src/shared/gamefiles.ts` explains why.
import type { PendingSave, SaveAsset } from './types/index.ts'

/**
 * The slot a save has to carry to pair with the copy another client uploaded.
 *
 * RomM pairs a client's save against the server's on the ROM and the slot it
 * was sent under, never on what the file is called. A save sent under no slot
 * is filed as an archive and paired with nothing — which is what makes this
 * the difference between a save the rest of the ecosystem can see and one only
 * RomMix will ever read back.
 *
 * This name because RomM's own schema points clients at it, in the
 * `ClientSaveState` field and again in the docstring for `/api/sync/negotiate`,
 * because Grout's guide says its saves go there by default, and because Argosy
 * — the client issue #12 was raised about — has been seen filing its saves
 * under it against a real server. The last of those is the one that settles it:
 * a slot is a convention between programs rather than anything the server
 * validates, the field taking any string with no enum, pattern or length in any
 * document under `schema/`, so nothing but another client's uploads can say
 * what the name really is.
 *
 * Shared rather than kept beside the upload because both ends need it: the
 * main process decides which file goes up under it, and the Saves tab names
 * the slots that are *not* it.
 */
export const AUTOSAVE_SLOT = 'autosave'

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

/**
 * May this file go up without anybody being asked first?
 *
 * The one decision that can lose somebody's progress, so it is written once,
 * here, and read by the pass that drains what was written offline.
 *
 * Only when RomMix can see that the copy on the server is the one this file was
 * made from. RomM records which device uploaded a save, so "the newest copy up
 * there came from here" is exactly that: whatever this device sends next is a
 * continuation of its own last upload, and nothing made anywhere else is
 * underneath it. A name RomM holds nothing under is the same thing with no
 * history at all.
 *
 * Everything else is a question for the user, and deliberately so — a device
 * out of range for a fortnight has no idea what the rest of the household did
 * meanwhile. That includes every *state*, which RomM stores with no origin, so
 * `fromThisDevice` is null for all of them and none is ever sent unasked.
 */
export function mayBeSentUnasked(file: PendingSave): boolean {
  if (!file.replaces) return true
  // The server's copy carries a change this file has not seen. Sending would
  // write over it, whoever made it.
  if (file.replaces.isNewer) return false
  return file.replaces.fromThisDevice === true
}
