import { type TLSSocket, checkServerIdentity } from 'node:tls'
import { Agent, buildConnector, fetch as undiciFetch } from 'undici'
import { t } from '../i18n.ts'

/**
 * Certificates RomM may present when the user has said to accept self-signed
 * ones: a certificate that signed itself, or a chain ending in an authority
 * this machine has never heard of — a private one on a home network, whether
 * or not the server sends the intermediate along with its own.
 *
 * Nothing else is forgiven. An expired certificate, or one issued for another
 * name, is still refused: the setting is about who vouches for the server, not
 * about whether the certificate fits it.
 */
const SELF_SIGNED = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
])

/** Would turning on `Settings.acceptSelfSigned` let this certificate through? */
export function selfSigned(code: string): boolean {
  return SELF_SIGNED.has(code)
}

/**
 * A refusal in words, for the codes a user can do something about.
 *
 * Node's own wording for these comes from OpenSSL and is not reachable from
 * here, so the common ones are said again; any other keeps its code, which
 * `sendFailure` puts beside the sentence.
 */
function refusal(code: string): Error {
  const message =
    code === 'CERT_HAS_EXPIRED'
      ? t('error.certificateExpired')
      : code === 'CERT_NOT_YET_VALID'
        ? t('error.certificateNotYetValid')
        : t('error.certificateRefused')
  return Object.assign(new Error(message), { code })
}

/**
 * Why this connection must still be refused, or nothing where it may go on.
 *
 * The name is checked here because Node checks it only once the chain has
 * verified. With verification turned off for the chain, a certificate for
 * any name at all would otherwise be accepted.
 */
export function stillRefused(socket: TLSSocket, servername: string): Error | undefined {
  if (socket.authorized) return undefined
  const code = String(socket.authorizationError)
  if (!SELF_SIGNED.has(code)) return refusal(code)
  return checkServerIdentity(servername, socket.getPeerCertificate())
}

let agent: Agent | null = null

/**
 * The dispatcher behind `fetchTrustingSelfSigned`.
 *
 * One for the process, so connections are pooled across requests the way the
 * default dispatcher pools them.
 */
function selfSignedDispatcher(): Agent {
  if (agent) return agent
  const connect = buildConnector({ rejectUnauthorized: false })
  agent = new Agent({
    connect: (options, callback) =>
      connect(options, (error, socket) => {
        if (error) return callback(error, null)
        const tls = socket as TLSSocket
        const refused = tls.encrypted
          ? stillRefused(tls, options.servername || options.hostname)
          : undefined
        if (!refused) return callback(null, socket)
        socket.destroy()
        callback(refused, null)
      })
  })
  return agent
}

/**
 * `fetch` for a RomM server whose certificate may be self-signed. See
 * `Settings.acceptSelfSigned`.
 *
 * The package's own `fetch` rather than the runtime's: the dispatcher is the
 * package's too, and the `fetch` bundled with Electron's Node is a different
 * release of undici, whose handler interface need not match it.
 */
export function fetchTrustingSelfSigned(input: string, init: RequestInit): Promise<Response> {
  return undiciFetch(input, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: selfSignedDispatcher()
  }) as unknown as Promise<Response>
}
