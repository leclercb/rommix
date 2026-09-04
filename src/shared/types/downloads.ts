/**
 * The download queue: what one transfer is doing, and what survives a restart.
 */

export type DownloadState =
  | 'queued'
  | 'downloading'
  /**
   * The three states after the last byte, in the order they happen.
   *
   * What follows a transfer is not nothing: the file is read back off the disk
   * and hashed against the digest RomM holds, an archive is unpacked, and what
   * came out of it is walked and written into the index. On a large game each
   * of those is minutes under a bar that is already full, and one word over all
   * of them says no more than "Downloading" at 100% did — which is a transfer
   * that reads as stuck.
   *
   * A word each, then, and none of them repeats: the hash of what came out of
   * an archive stays part of `extracting`, so the row never goes back to a
   * state it has already left.
   */
  | 'checking'
  | 'extracting'
  | 'installing'
  /**
   * Interrupted, with what has arrived so far still on disk.
   *
   * Not an error: a transfer RomMix could not finish is a transfer to pick up
   * again, and on a television that is usually a matter of the network coming
   * back rather than of anything the user has to fix. It stays in the list —
   * across restarts, see `PendingDownload` — until it finishes or is cancelled.
   */
  | 'paused'
  /**
   * Stopped because nothing answered, rather than because anybody asked.
   *
   * What makes a queue survive a network going away: the transfer that was on
   * the wire and every one waiting behind it stop for the same reason, and none
   * of them needs a person to press anything to carry on — see
   * `DownloadManager.resumeAfterOutage`. Its own state rather than a flag
   * beside `paused`, so that a finished transfer cannot also be waiting for a
   * server; what the two have in common is `isStopped`.
   *
   * Only ever the server being unreachable. A refusal, an unsafe name and a
   * failed hash check all stay stopped until somebody looks at them.
   */
  | 'stalled'
  | 'done'
  | 'error'
  | 'cancelled'

/**
 * Stopped with its bytes kept, whoever stopped it.
 *
 * The question nearly every screen is actually asking: such a row is in the
 * active list, is amber, and offers to be finished. Which of the two it is
 * matters in two places only — whether it says "Paused" or "Waiting for RomM",
 * and whether it starts itself again — so everywhere else asks this instead,
 * and a third stopped state would cost one line rather than twenty.
 */
export function isStopped(state: DownloadState): boolean {
  return state === 'paused' || state === 'stalled'
}

export interface DownloadItem {
  romId: number
  name: string
  /** RomM cover path, so the queue and its notifications can show the game. */
  coverPath: string | null
  system: string
  /** RomM's display name for the platform, e.g. "Sega Mega Drive". */
  platformName: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number
  error: string | null
  /**
   * The file arriving right now, for a game fetched one file at a time.
   *
   * A multi-disc game is twenty minutes of a progress bar that says only
   * "Downloading"; which of its three tracks is on the wire is the one thing
   * that moves. Absent for a game that arrives as a single file, where the name
   * would only repeat the game's own.
   */
  currentFile?: string
  /**
   * Whether this transfer could be picked up again if it stopped.
   *
   * Undefined until the server has been asked, which happens as the transfer
   * starts — see `RommClient.supportsRange` and `fileTransfers`. False for a
   * server that will not serve part of a file, where stopping a transfer means
   * losing it; the screen offers Pause only where the answer is yes.
   */
  resumable?: boolean
}

/**
 * A download that was interrupted, as it is remembered between runs.
 *
 * The bytes themselves are the part-downloaded files on disk; this is what says
 * whose they are. Without it a restart leaves a large file that nothing on
 * screen accounts for and nothing will ever finish — so the record and the
 * files are written and removed together.
 *
 * `fileName` is what the server called the game when the transfer started, and
 * is checked before anything is appended: a ROM replaced in the meantime is a
 * different file, and resuming onto it would produce a game that looks complete
 * and does not run.
 */
export interface PendingDownload {
  romId: number
  name: string
  coverPath: string | null
  system: string
  platformName: string
  /**
   * Where the bytes are going: the file itself for a game fetched in one piece,
   * the directory holding them for one fetched file by file.
   */
  targetPath: string
  /**
   * The files the game is made of, for a transfer that fetches them one at a
   * time. Empty for one that does not, where `targetPath` is the whole of it.
   */
  files: string[]
  /**
   * Whether `targetPath` is a directory this game has to itself.
   *
   * It is for a disc set given a folder of its own, and it is not for a game
   * whose files go loose into the system folder beside every other game on the
   * platform. What hangs on it is what a cancelled transfer takes with it: its
   * own folder goes, a shared one obviously cannot.
   */
  ownsFolder: boolean
  fileName: string
  totalBytes: number
  /**
   * Which of the two stopped states this transfer is in.
   *
   * The record has no state of its own — it only ever describes a transfer that
   * stopped — but *how* it stopped has to survive with it, because the two
   * answer for different spans of time. The queue row lasts as long as RomMix
   * is running, and an outage easily outlives that: a handheld carried out of
   * range, closed, and opened again at home. Restored, this is what lets the
   * queue pick itself up on the first start that has a server rather than
   * asking somebody to press Resume once per game for a stop nobody chose.
   *
   * Absent on a record written before this field existed, which reads as the
   * cautious answer: paused, and waiting to be asked.
   */
  stoppedAs?: 'paused' | 'stalled'
}
