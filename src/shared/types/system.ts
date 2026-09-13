/**
 * The machine RomMix is running on: where it keeps its files, and what the
 * pre-flight check found.
 */

import type { EmulatorState } from '../../config/emulators/types.ts'

/** Where RomMix keeps everything it owns. */
export interface RootLocation {
  current: string
  /** What it would be with nothing configured. */
  fallback: string
  /** Set by ROMMIX_HOME, which overrides the stored pointer and cannot be changed here. */
  fromEnvironment: boolean
}

/**
 * The room left on one drive games are written to.
 *
 * `path` is a folder on it rather than the mount point: it is what RomMix was
 * asked about and what the user would recognise — "this is where my Switch
 * games go" — where `/run/media/mmcblk0p1` is a fact about the machine.
 */
export interface DriveSpace {
  path: string
  /** Free to the user running RomMix, which is below what is free to root. */
  freeBytes: number
  totalBytes: number
}

/** Result of the pre-flight check shown on the Settings screen. */
export interface DiagnosticsReport {
  /**
   * Whether `flatpak` is on the machine at all.
   *
   * RomMix does not need it for itself, but most of the emulators it drives are
   * distributed that way, and without it they all report themselves missing for
   * a reason nothing else on the screen would explain.
   */
  flatpakAvailable: boolean
  /**
   * Whether Flathub is a remote of the *user* installation, which is the one
   * RomMix installs into.
   *
   * A separate answer from `flatpakAvailable` because it fails separately and
   * far less visibly: Debian, Ubuntu and Arch ship flatpak with no remotes, and
   * Fedora's Flathub is filtered until enabled. On any of those, every emulator
   * reports itself missing while the row above says flatpak is fine. RomMix adds
   * the remote itself on first install; this is what says so before then.
   */
  flathubConfigured: boolean
  emulators: EmulatorState[]
  /** True when every installed emulator's ROM folder can be written to. */
  romsWritable: boolean
  /**
   * The drives those folders are on, one entry each. See `drivesOf`.
   *
   * Empty where nothing could be measured, which is the same thing the screen
   * says about a drive that will not answer: nothing.
   */
  drives: DriveSpace[]
  /** The log file, so a bug report can name the file rather than hunt for it. */
  logPath: string
  notes: string[]
}
