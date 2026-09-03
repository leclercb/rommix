/**
 * Starting a game: what has to be settled first, and what the session left
 * behind.
 */

import type { EmulatorId } from '../../config/emulators/types.ts'
import type { SavePushPreview } from './saves.ts'

/**
 * The ways the emulator for a game can run it, and which one is already
 * settled. `options` has fewer than two entries when there is nothing to ask.
 */
export interface LaunchChoice {
  system: string
  emulatorId: EmulatorId
  emulatorName: string
  /** Setup this emulator needs done by hand. See `EmulatorDescriptor.setupNotes`. */
  setupNotes: string[]
  options: { id: string; label: string; note?: string }[]
  /** The recorded choice, or null if the user has not been asked yet. */
  chosen: string | null
}

export interface LaunchResult {
  ok: boolean
  emulator: EmulatorId | null
  command: string
  error: string | null
  /** Saves/states uploaded to RomM after the session ended. */
  uploadedSaves: number
  uploadedStates: number
  /**
   * What the session wrote, waiting to be confirmed — set only when
   * `confirmSavePush` is on, and null when there is nothing to send.
   *
   * The automatic push does not happen in that case; the files are listed here
   * instead, and `saves.pushSelected` sends whichever of them the user
   * approves. Uploading first and asking afterwards would make the question
   * pointless, and blocking the main process on a dialog would hold the session
   * open for as long as nobody answers it.
   */
  pendingPush: SavePushPreview | null
  playSeconds: number
}
