/**
 * What went wrong with a request, in the three shapes anything acts on.
 *
 * The distinctions are the whole point of the file: every fallback in RomMix —
 * a screen drawn from a saved copy, a download that picks itself up, a queue
 * that waits for the network — is gated on which of these arrived, and telling
 * them apart wrongly is how a refusal gets treated as an outage and a user is
 * never told their token has expired.
 */
/**
 * Did the server answer this at all?
 *
 * Asked by whatever has to decide whether trying again could help. A 404 for a
 * game RomM no longer has is an answer, and no number of retries will change
 * it; a request nothing answered is still to do.
 */
export function answered(cause: unknown): boolean {
  return cause instanceof RommError && cause.status !== null
}

/**
 * Did the server turn *us* away?
 *
 * The other question, and the one every fallback in RomMix is gated on. A
 * saved copy stands in for a server that could not be reached — but never for
 * one that is right there refusing the request, because the only thing that
 * fixes those credentials is being told about them, and a screen quietly drawn
 * from last week is the opposite of being told.
 *
 * Narrower than `answered` on purpose: a 502 from a proxy has answered, and is
 * still nothing the user can act on.
 */
export function refusedUs(cause: unknown): boolean {
  return cause instanceof RommError && (cause.status === 401 || cause.status === 403)
}

export class RommError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message)
    this.name = 'RommError'
  }
}

/**
 * The server could not be reached at all.
 *
 * Its own type because "nothing answered" is the one failure worth acting on
 * rather than only reporting: it is what puts the interface into offline mode,
 * and what marks a transfer as one to pick up by itself when the network comes
 * back. Every other failure — a refusal, a name RomMix will not write, bytes
 * that did not match their hash — is a thing the user has to know about, and no
 * amount of waiting fixes any of them.
 */
export class UnreachableError extends RommError {
  constructor(message: string) {
    super(message)
    this.name = 'UnreachableError'
  }
}

/**
 * What arrived is not what RomM holds. See `verify`.
 *
 * Its own type because the queue answers for it differently from a transfer
 * that merely stopped: a break with bytes worth keeping is a row waiting to be
 * finished and has nothing to report, while bytes that failed a hash check were
 * refused, and a row that said only "Paused" would never say so.
 */
export class CorruptDownloadError extends RommError {
  constructor(message: string) {
    super(message)
    this.name = 'CorruptDownloadError'
  }
}
