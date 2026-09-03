/**
 * What is on this device's disk, and what a reconciliation pass made of it.
 *
 * The index behind the Downloads screen: it is written when a game is
 * installed and read without the server, which is what lets the screen work
 * with RomM out of reach.
 */

import type { EmulatorId } from '../../config/emulators/types.ts'

/**
 * The `InstalledRom.emulatorId` recorded for a game in RomMix's shared tree.
 *
 * Not an emulator, on purpose: with shared storage there may not be one — the
 * whole point is that a Switch game can be downloaded before Eden is installed.
 * A sentinel rather than an empty string so the index has something to compare
 * against when the setting changes, and the game screen has something to
 * print.
 */
export const SHARED_LIBRARY = 'rommix:shared'

/** A ROM that exists on local disk. */
export interface InstalledRom {
  romId: number
  /** Absolute path to the file (or the game directory for multi-file ROMs). */
  path: string
  /**
   * The file to hand an emulator. Equal to `path` for a single file; for a
   * multi-file game it is the disc descriptor or playlist inside the
   * directory, because emulators cannot be given a directory.
   */
  launchPath: string
  /**
   * The game's name as RomM knows it. Recorded at install time because the
   * Downloads screen has only this index to work from — it never fetches the
   * library — and a filename is a poor substitute for a title.
   */
  name: string
  /** RomM cover path, for the same reason. Null when the game has no artwork. */
  coverPath: string | null
  /**
   * Every file the game is made of, relative to `path` where that is a
   * directory, and one entry for an ordinary single ROM.
   *
   * Recorded by whatever put the game there — see `unpack` and `adopt` — rather
   * than read back off the folder afterwards. A listing taken later is a
   * listing of whatever is in there now, which for a game RomMix installed is
   * the same thing only for as long as nothing else writes beside it.
   */
  files: string[]
  /** ES-DE system id — the folder name, and RomMix's internal platform key. */
  system: string
  /** RomM's display name for the platform, e.g. "Sega Mega Drive". */
  platformName: string
  sizeBytes: number
  installedAt: string
  /** Set when the ROM was installed as an extracted directory. */
  isDirectory: boolean
  /**
   * The emulator whose library this copy was written into.
   *
   * Each emulator keeps its games in its own tree, so a ROM downloaded for
   * RetroDECK is simply not present for Eden. Recording which emulator was
   * current at install time is what lets RomMix stop claiming a game is
   * downloaded after the platform has been pointed at a different emulator —
   * the file is still on disk, but not where the emulator now in charge looks.
   *
   */
  emulatorId: EmulatorId
}

/** What a "sync downloaded games" pass changed. */
export interface LibrarySyncResult {
  /** ROMs on the server that were checked against the disk. */
  checked: number
  /** Entries dropped because the file they pointed at is gone. */
  removed: number
  /** ROMs found sitting on disk that the index did not know about. */
  adopted: number
}
