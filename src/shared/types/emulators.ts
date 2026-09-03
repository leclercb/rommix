/**
 * Emulators: the registry's own types, and the releases RomMix installs.
 *
 * The descriptor types are re-exported rather than restated so that the rest of
 * the app has one import for "RomMix's types" without `@config/emulators`
 * becoming a second place the same shapes are declared.
 */

import type { EmulatorId } from '../../config/emulators/types.ts'

export type {
  BiosContext,
  BiosTarget,
  EmulationPaths,
  EmulatorDescriptor,
  EmulatorDispatch,
  EmulatorId,
  EmulatorState,
  ResolvedInstall
} from '../../config/emulators/types.ts'
export type { SaveEnvironment } from '../../config/emulators/savepaths.ts'

/** A downloadable file attached to an emulator release. */
export interface EmulatorAsset {
  name: string
  url: string
  /** 0 when the release API does not report it, which Eden's does not. */
  sizeBytes: number
  /**
   * What the release states it published, or null where it states nothing.
   *
   * Carried rather than re-read at install time: the download is a separate
   * call from the listing, and the digest has to describe the same asset the
   * user chose. See `verifyDownload`.
   */
  digest: { algorithm: 'sha256' | 'sha512'; expected: string } | null
}

/** One release of an emulator RomMix can install itself. */
export interface EmulatorRelease {
  tag: string
  name: string
  prerelease: boolean
  publishedAt: string | null
  /** Only assets RomMix can actually run; never empty. */
  assets: EmulatorAsset[]
}

/** Emitted on `emulators:progress` while an emulator is downloading. */
export interface EmulatorInstallProgress {
  emulatorId: EmulatorId
  assetName: string
  receivedBytes: number
  totalBytes: number
  /** Set instead of byte counts when the installer reports text, as flatpak does. */
  message?: string
}
