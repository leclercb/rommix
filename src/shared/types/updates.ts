/**
 * RomMix updating itself. See `Updater`.
 */

/**
 * What RomMix does about a new version of itself.
 *
 * Three answers rather than a switch, because "check but leave it to me" is a
 * real position and not a half-off: a handheld on a metered connection wants to
 * be told about a release without a hundred megabytes arriving behind it, and
 * `off` is for an installation somebody else's package manager owns.
 */
export type UpdatePolicy =
  /** Check, fetch, and swap the image in on the next start. */
  | 'auto'
  /** Check and say so; download only when asked. */
  | 'notify'
  /** Never check on its own. The button in Settings still works. */
  | 'off'

/** Where RomMix's update of *itself* has got to. See `Updater`. */
export type UpdateState =
  /** Nothing to do: never checked, or checked and already current. */
  | 'idle'
  | 'checking'
  /** A newer version is published and has not been fetched yet. */
  | 'available'
  | 'downloading'
  /** Downloaded and in place; the next start runs it. */
  | 'ready'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  /** The version running now, from `app.getVersion()`. */
  current: string
  /** The newest published version, once a check has found one. */
  latest: string | null
  /** The release notes, as GitHub holds them. Null when the release has none. */
  notes: string | null
  /** The release page, which is the way out when RomMix cannot update itself. */
  url: string | null
  receivedBytes: number
  /** 0 until the download starts and the server declares a length. */
  totalBytes: number
  /**
   * Where the downloaded image landed, once there is one.
   *
   * Shown rather than kept quiet: the new file is named for its version, so
   * updating leaves a different filename in the folder, and anyone who made a
   * shortcut by hand needs to see that.
   */
  readyPath: string | null
  /**
   * Why this copy of RomMix cannot replace itself — a development run, or a
   * build that is not an AppImage. Null when it can.
   *
   * A check still runs and still reports a new version: knowing one exists is
   * useful even where the fix is to download it by hand.
   */
  blockedReason: string | null
  /**
   * Why RomMix cannot restart *itself* into the new version, when it cannot.
   *
   * A separate question from `blockedReason`, and it has a different answer
   * under Steam: the image is replaced perfectly well there, but relaunching is
   * what Steam will not have. Quitting normally and pressing Play again is the
   * whole of the fix, so this says so rather than offering a button that would
   * end the session and start nothing.
   */
  restartBlocked: string | null
  error: string | null
  /** When the last check finished, ISO. Null before the first one. */
  checkedAt: string | null
}
