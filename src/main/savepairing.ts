import { AUTOSAVE_SLOT } from '@shared/saveassets'
import type { RommDevice, RommSave, RommState } from '@shared/types'
import { sameFormat } from './savefiles.ts'

/**
 * Which copy on the server answers to which file on this disk.
 *
 * The rules `SaveSync` pairs by, kept apart from the moving of bytes because
 * three of its callers — the listing, the push preview and the pull — ask the
 * same questions and must reach the same answers. Two of them disagreeing is
 * how a screen comes to promise a fetch the pull will not perform, or a push
 * over a copy nothing compared against. Nothing in this file touches the disk
 * or the network.
 */

/**
 * The device a copy on the server came from, where it records one.
 *
 * Saves alone: RomM's `StateSchema` has no origin field, so a state's answer is
 * that there is nothing to answer with.
 */
export function originIdOf(item: RommSave | RommState): string | null {
  return 'origin_device_id' in item && typeof item.origin_device_id === 'string'
    ? item.origin_device_id
    : null
}

/**
 * The server's saves as one per slot, with whatever carries no slot beside it.
 *
 * A slot is a history rather than a file: RomM keeps what each client uploaded
 * into it and only the newest is the copy a client is meant to read back. Taken
 * as they come, a game played on three devices puts a row on this screen per
 * revision any of them ever sent, all but one of them a save nothing here can
 * act on.
 *
 * The rest are the saves RomM pairs with nothing — uploaded through the web UI,
 * or by RomMix before it sent a slot at all — and they keep being matched on
 * their names, which is the only handle they have.
 */
export function bySlot(assets: readonly (RommSave | RommState)[]): {
  slots: Map<string, RommSave | RommState>
  loose: (RommSave | RommState)[]
} {
  const slots = new Map<string, RommSave | RommState>()
  const loose: (RommSave | RommState)[] = []

  for (const asset of assets) {
    const slot = slotOf(asset)
    if (slot === null) {
      loose.push(asset)
      continue
    }
    const held = slots.get(slot)
    if (!held || Date.parse(asset.updated_at) > Date.parse(held.updated_at)) slots.set(slot, asset)
  }
  return { slots, loose }
}

/**
 * The slot RomM filed a copy under, where the copy is the kind that has one.
 *
 * Asked the way `originIdOf` asks about the origin, and for the same reason:
 * `StateSchema` carries no slot, and neither does a save from a RomM too old
 * to keep one. Both answer that there is nothing to pair on.
 */
export function slotOf(item: RommSave | RommState): string | null {
  // Emptiness included: a slot nothing can be filed under is not one to pair
  // on, and taking it for a name would lose the only handle such a copy has.
  return 'slot' in item && typeof item.slot === 'string' && item.slot !== '' ? item.slot : null
}

/**
 * The md5 RomM holds for a copy, where the copy is the kind that has one.
 *
 * States have none — `StateSchema` records no hash — so a state is left to its
 * timestamps, which is all it ever had.
 */
export function contentHashOf(item: RommSave | RommState): string | null {
  return 'content_hash' in item && typeof item.content_hash === 'string' ? item.content_hash : null
}

/**
 * The slot a file on its way up will be filed under.
 *
 * Asked twice — once by the upload and once by the dialog that describes it —
 * and the two must not be able to differ. A preview naming a slot the push then
 * does not use is a promise about where a save is going, made to the one person
 * in a position to say no.
 */
export function slotToSend(fileName: string, primary: string | null): string | null {
  return primary !== null && fileName === primary ? AUTOSAVE_SLOT : null
}

/**
 * Does a copy filed under the shared slot answer to this file on disk?
 *
 * Three callers ask it — the listing, the push preview and the pull — and one
 * rule answers all three, so a change to it cannot reach two sites out of
 * three.
 *
 * Three things have to hold. It is the shared slot, other slots belonging to
 * whoever set them aside. It is the file this device would send there, which
 * `primarySave` decides and which is null where nothing qualifies. And the two
 * are the same kind of file — see `sameFormat`, which is what stands between a
 * battery save and the clock file beside it, the names having been given up as
 * evidence the moment a slot became what pairs them.
 */
export function pairsOnSlot(
  localName: string,
  primary: string | null,
  item: RommSave | RommState,
  slot: string | null
): boolean {
  if (slot !== AUTOSAVE_SLOT || primary === null) return false
  return localName === primary && sameFormat(localName, item.file_name)
}

/**
 * Does a copy on the server answer to this file on disk, by name?
 *
 * What is left where no slot pairs them.
 *
 * Case-insensitively: a save's name is not the file's identity here — the copy
 * on the server was written by some other client on some other filesystem, and
 * a name RomMix would refuse to create twice in one folder is one name. Read
 * any other way, `SONIC.SRM` on the server against `Sonic.srm` here is a push
 * over a copy nothing compared against and a pull that lands beside the file
 * the emulator opens. See `pairsOnSlot`, which this sits beside for the same
 * reason.
 */
export function pairsOnName(localName: string, remoteName: string): boolean {
  return localName.toLowerCase() === remoteName.toLowerCase()
}

/**
 * A save's `origin_device_id` turned into the name of the machine it came from.
 *
 * Matched against both identifiers a device carries, because either can be the
 * one a save was uploaded under — see `RommDevice`. Falls back to `hostname`
 * where the device was never named: RomM leaves `name` null for a client that
 * sent none, and the machine's own name still beats "another device".
 */
export function deviceNamer(devices: readonly RommDevice[]): (id: string | null) => string | null {
  return (id) => {
    if (!id) return null
    const device = devices.find(
      (candidate) => candidate.id === id || candidate.client_device_identifier === id
    )
    return device?.name ?? device?.hostname ?? null
  }
}
