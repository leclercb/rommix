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
export const UPDATE_POLICIES = [
  /** Check, fetch, and swap the image in on the next start. */
  'auto',
  /** Check and say so; download only when asked. */
  'notify',
  /** Never check on its own. The button in Settings still works. */
  'off'
] as const
export type UpdatePolicy = (typeof UPDATE_POLICIES)[number]

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
  /**
   * The short commit this copy was built from, or null where nothing stamped
   * one — a source tarball, or a checkout with no history.
   *
   * Beside `current` rather than folded into it: only one of the two is
   * ordered, and `compareVersions` is what reads the version.
   *
   * Given whatever channel the copy is on, which is the part worth stating.
   * A version names a release and not a build — package.json is bumped when a
   * release is cut, so everything made between two releases reports the
   * earlier one — and the copies where that matters are exactly the ones
   * nobody knows are unusual: a build taken from the tip of `main`, by an
   * owner who has since stopped asking for them, reads as the release
   * everybody else is running. The footer is the one thing a photograph of a
   * television carries into a bug report, so it carries this too.
   */
  buildCommit: string | null
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
   * Shown rather than kept quiet: this is the file the next start runs, and
   * anyone who made a shortcut by hand is entitled to know which one that is.
   * `Updater.restart` renames over `process.env.APPIMAGE`, so on an ordinary
   * install the path is the one RomMix was already started from.
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
