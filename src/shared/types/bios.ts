/**
 * What each platform's BIOS situation is, and what a sync pass did about it.
 */

import type { EmulatorId } from '../../config/emulators/types.ts'

/** One BIOS file for a platform, and whether it is in place. */
export interface BiosItem {
  fileName: string
  /** What the file is for, from the BIOS table; null for an unrecognised extra. */
  note: string | null
  required: boolean
  /** Present where it belongs already. */
  installed: boolean
  /**
   * The folder this file goes in, absolute, or null when there is nowhere to
   * put it. Not always the platform's `biosDir`: an emulator that cannot take
   * a file directly has it staged in RomMix's own `bios/<system>` instead.
   */
  dir: string | null
  /** True when `dir` is RomMix's staging folder rather than the emulator's. */
  staged: boolean
  /** RomM firmware id, or null when the server does not hold this file. */
  firmwareId: number | null
  sizeBytes: number
  /** RomM verified the file against its known-good hashes. */
  verified: boolean
}

/** A platform's BIOS situation: where files go, what is there, what is missing. */
export interface BiosPlatform {
  platformId: number
  /** RomM's own slug, which is also how its platform icons are named. */
  platformSlug: string
  platformName: string
  /** ES-DE system, or null when the platform has no mapping. */
  system: string | null
  /** The emulator whose BIOS folder RomMix would install into. */
  emulatorId: EmulatorId | null
  emulatorName: string | null
  /** Absolute BIOS folder, or null when there is no usable emulator. */
  biosDir: string | null
  /** Set when some of this platform's files had to be staged: what to do about them. */
  stagingNote: string | null
  items: BiosItem[]
  /** Why nothing can be installed for this platform, phrased for the screen. */
  blockedReason: string | null
  /**
   * How this platform's BIOS works, when there is more to it than the files
   * listed. See `BiosRequirement.setupNote`.
   */
  setupNote: string | null
}

export interface BiosReport {
  platforms: BiosPlatform[]
}

/** What a "sync all BIOS" pass installed. */
export interface BiosSyncResult {
  installed: number
  failed: number
  /** Files RomM does not hold, so nothing could be fetched for them. */
  unavailable: number
}
