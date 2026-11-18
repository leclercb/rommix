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

/**
 * Why a request could not be sent, in words the user can act on.
 *
 * `fetch` reports every failure to send as `fetch failed` and keeps the reason
 * on `cause`: a certificate it would not trust, a name the resolver did not
 * know, a port nothing listened on. Those are different fixes, and the outer
 * message alone gives no hint which one is needed.
 */
export function sendFailure(cause: unknown): string {
  // Deepest first, since the innermost error is the one that names the fault.
  const chain = causeChain(cause).toReversed()
  const message = chain.map((error) => error.message).find(Boolean)
  const code = chain.map(codeOf).find(Boolean)
  // A refused connection tried on several addresses comes back as an
  // `AggregateError` with no message, and only a code.
  if (!message) return code ?? String(cause)
  return code && !message.includes(code) ? `${message} (${code})` : message
}

/**
 * The code of the certificate the request was stopped for, if that is why.
 *
 * Told apart from every other failure to send because it is not an outage:
 * the server is there and answered the handshake, and waiting changes
 * nothing. Node names these after OpenSSL's verify errors, and its own
 * name check adds `ERR_TLS_CERT_ALTNAME_INVALID`.
 */
export function certificateRefused(cause: unknown): string | undefined {
  return causeChain(cause)
    .map(codeOf)
    .find((code) =>
      /^(ERR_TLS_CERT_|CERT_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_(GET|VERIFY)_|HOSTNAME_MISMATCH)/.test(
        code ?? ''
      )
    )
}

/** The errors along a `cause` chain, outermost first. Anything else ends it. */
function causeChain(cause: unknown): Error[] {
  const chain: Error[] = []
  // Bounded, because a `cause` chain is any object graph and may loop.
  for (let next = cause; next instanceof Error && chain.length < 8; next = next.cause) {
    chain.push(next)
  }
  return chain
}

function codeOf(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code ? code : undefined
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
 * The server answered, and is older than this build can read — see `atLeast`.
 *
 * Its own type because it is the one failure that is neither the network's
 * fault nor the credentials': waiting does not fix it and signing in again does
 * not either, so it must not be taken for an outage and drawn over with a saved
 * copy. What fixes it is upgrading the server, which nobody is told to do by a
 * screen saying "offline".
 */
export class UnsupportedServerError extends RommError {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedServerError'
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

/**
 * The server's certificate was not trusted.
 *
 * Not an `UnreachableError`, because it is not an outage: offline mode would
 * draw the saved library over the one sentence saying what to do, and a
 * download queued to resume when the network returns would wait forever. See
 * `certificateRefused`.
 */
export class UntrustedCertificateError extends RommError {
  constructor(message: string) {
    super(message)
    this.name = 'UntrustedCertificateError'
  }
}
