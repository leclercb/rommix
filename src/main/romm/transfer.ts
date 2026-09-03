/**
 * Moving one file from RomM to this disk.
 *
 * Everything hard about a transfer — the partial file, the range header, the
 * stall, the retries, the hash it has to match before it is allowed to become
 * the game — is the same whether what is arriving is a whole ROM, one track of
 * a disc, or a BIOS. It is kept apart from the client for that reason: the
 * client says what to fetch, this says what happens to the bytes.
 *
 * Written against `Transport` rather than against the client so that the rules
 * here can be exercised without one. What it needs is small — a request, a way
 * to read a refusal, and somewhere to say the server has gone — and every one
 * of those is a seam a test can stand in for.
 */

import { createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { hashOf } from '../integrity.ts'
import { i18n, t } from '../i18n.ts'
import { log } from '../log.ts'
import type { Checksum } from './checksums.ts'
import { CorruptDownloadError, RommError, UnreachableError, answered } from './errors.ts'

/**
 * What a transfer needs of whoever is talking to the server.
 *
 * The client implements it; nothing else here knows the client exists.
 */
export interface Transport {
  /** Perform a request against the configured server. See `RommClient.request`. */
  request(path: string, init?: RequestInit): Promise<Response>
  /** Turn a response the server refused into a message. See `RommClient.toError`. */
  toError(res: Response): Promise<RommError>
  /**
   * Say that the server has stopped answering.
   *
   * A transfer that broke off and would not pick up again is the server being
   * gone, and is worth telling the connection watch about as loudly as a
   * request that could not be sent at all.
   */
  onOutage(reason: string): void
}

/** What one transfer is about, for the log. */
export interface TransferSubject {
  kind: string
  romId?: number
  firmwareId?: number
  fileName?: string
}

export interface DownloadProgress {
  received: number
  total: number
}

/**
 * How many times a broken ROM transfer is picked up again before it is called a
 * failure.
 *
 * Enough that a connection dropped repeatedly still finishes a large game — the
 * usual shape is a proxy cutting every response at the same point, so each
 * attempt carries the same amount further — and few enough that a server which
 * is simply gone is reported rather than retried all evening.
 */
const RESUME_ATTEMPTS = 5

/** A pause between attempts, so a server refusing everything is not hammered. */
const RESUME_DELAY_MS = 500

/**
 * How long a transfer may deliver nothing before RomMix gives up on it and
 * asks again.
 *
 * Not every broken connection is closed. A VPN switched on or off, a handheld
 * that moved between access points, a router rebooted — each leaves a socket
 * that is not refused and simply never delivers another byte, and the only
 * thing that ends it otherwise is a timeout meant for a slow server rather than
 * a dead route, minutes away. Timing it here turns those into the same brief
 * interruption as a closed connection, resumed from the same place.
 *
 * Generous, because it is measured against silence rather than against slowness:
 * a ROM crawling in at a few kilobytes a second is still arriving, and only a
 * transfer that has stopped completely reaches this.
 */
const STALL_TIMEOUT_MS = 20_000

/** What a caller can say about one transfer. */
export interface TransferOptions {
  /** Continue the `.part` already on disk rather than replacing it. */
  resume?: boolean
  /**
   * What the finished file has to hash to before it is allowed to become the
   * game. See `verify`.
   */
  verify?: Checksum
  /**
   * Whether what is being fetched can be resumed at all. See `supportsRange`.
   *
   * A transfer that cannot be is handled the opposite way round in both places
   * it matters. It is never given up on for going quiet, because the socket
   * recovering is the only way the download survives — a stalled connection
   * that comes back has cost nothing, while abandoning it costs everything
   * transferred so far. And a break is a failure rather than something to try
   * again, because trying again means fetching the whole thing a second time,
   * which is not a decision to take on the user's behalf on a metered
   * connection.
   */
  resumable?: boolean
}

/** Where a transfer in progress is written. The file itself appears only once
 * it is whole. */
export function partialPathOf(destination: string): string {
  return `${destination}.part`
}

/**
 * Fetch one thing to one path, picking it up again where it breaks.
 *
 * One function for every ROM the client fetches, because everything hard about
 * a transfer — the partial file, the range, the stall, the retries — is the
 * same whether what is arriving is a whole ROM or one track of a disc.
 */
export async function fetchToFile(
  transport: Transport,
  path: string,
  destination: string,
  sizeHint: number,
  subject: TransferSubject,
  onProgress: (progress: DownloadProgress) => void,
  signal: AbortSignal,
  options: TransferOptions = {}
): Promise<number> {
  const resumable = options.resumable !== false
  const attempts = resumable ? RESUME_ATTEMPTS : 1
  const partial = partialPathOf(destination)

  /**
   * Bytes already on disk, kept only when the caller says they belong to
   * what is being fetched now.
   *
   * A `.part` nobody vouched for is of unknown provenance — a different
   * release of the same game, a file the server has since replaced — and
   * appending to it produces a corrupt ROM that looks complete. What makes
   * resuming safe is the queue's own record of what it was downloading; see
   * `PendingDownload`.
   */
  let received = 0
  if (options.resume) received = (await stat(partial).catch(() => null))?.size ?? 0
  else await rm(partial, { force: true }).catch(() => undefined)

  const took = log.since()
  let total = sizeHint
  if (received > 0) {
    log.info('romm', 'resuming a transfer that was part-done', { ...subject, received, total })
    onProgress({ received, total })
  }

  for (let attempt = 1; ; attempt += 1) {
    // One controller per attempt: it carries the caller's cancellation and
    // the stall timeout below, so the transfer can be given up on without the
    // caller having asked for anything.
    const attemptStopped = new AbortController()
    const relay = (): void => attemptStopped.abort()
    signal.addEventListener('abort', relay, { once: true })
    let idle: NodeJS.Timeout | null = null
    const waitForBytes = (): void => {
      if (!resumable) return
      if (idle) clearTimeout(idle)
      idle = setTimeout(() => attemptStopped.abort(), STALL_TIMEOUT_MS)
      idle.unref()
    }

    try {
      if (signal.aborted) attemptStopped.abort()
      waitForBytes()
      const res = await transport.request(path, {
        signal: attemptStopped.signal,
        headers: received > 0 ? { Range: `bytes=${received}-` } : {}
      })
      if (!res.ok) throw await transport.toError(res)
      if (!res.body) throw new RommError(t('error.emptyResponseBody'))

      /**
       * Whether the server honoured the range, which only a 206 says.
       *
       * A server that ignores it answers 200 with the whole file, and
       * appending that to what is already on disk is how a resumed download
       * silently produces a ROM twice the size it should be. So the bytes
       * already fetched are thrown away instead and the attempt starts over.
       */
      const resumed = received > 0 && res.status === 206
      if (received > 0 && !resumed) {
        log.warn('romm', 'the server ignored the range, starting again', {
          ...subject,
          status: res.status,
          discarded: received
        })
        await rm(partial, { force: true }).catch(() => undefined)
        received = 0
      }

      // On a 206 the length is what is left to come, not the whole size.
      const declared = Number(res.headers.get('content-length') ?? 0)
      total = (resumed ? received + declared : declared) || sizeHint

      const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
      source.on('data', (chunk: Buffer) => {
        received += chunk.length
        waitForBytes()
        onProgress({ received, total })
      })

      await pipeline(source, createWriteStream(partial, { flags: resumed ? 'a' : 'w' }), {
        signal: attemptStopped.signal
      })
      break
    } catch (cause) {
      // Cancelling is not a failure to retry: the user asked for it, and the
      // two look identical by the time the queue sees the exception. What
      // happens to the part-downloaded file is the queue's decision, not this
      // one's — cancelling throws it away, an interruption keeps it.
      if (signal.aborted) {
        log.info('romm', 'transfer cancelled', { ...subject, received, total, ms: took() })
        throw cause
      }

      if (attempt >= attempts) {
        log.error('romm', 'transfer failed', cause, {
          ...subject,
          received,
          total,
          attempts: attempt,
          ms: took()
        })
        // Said in RomMix's own words rather than passed on. What arrives here
        // is whatever the network layer called it — undici says `terminated`
        // for a connection that died mid-response — and that word on its own,
        // in red, over a download that was going fine, explains nothing.
        //
        // Sized the way the rest of the interface sizes things: this sentence
        // is read beside a progress bar counting in gigabytes, and a raw byte
        // count is a number nobody converts in their head.
        /**
         * Whether this was the network, which is not the only thing caught
         * here.
         *
         * The loop also sees a status RomM answered with — a ROM deleted
         * server-side is a 404 — and a non-resumable transfer is allowed one
         * attempt, so that 404 arrives on the first pass. Treated as an
         * outage it would report the server unreachable a moment after every
         * attempt had reported it reachable, put the interface into offline
         * mode, and leave the row to be tried again on every reconnection for
         * a reason no amount of waiting fixes.
         */
        if (answered(cause)) throw cause

        const size = i18n().formatBytes
        // A transfer that broke off and would not pick up again is the server
        // being gone, which is worth telling the connection watch as loudly
        // as a request that could not be sent — and worth marking the row
        // with, so it can carry on by itself.
        transport.onOutage((cause as Error).message)
        throw new UnreachableError(
          t('error.downloadInterrupted', { received: size(received), total: size(total) })
        )
      }

      // What actually reached the disk, which is behind what the stream
      // counted: the chunks in flight when the connection died were reported
      // to `onProgress` and never written. Resuming from the counter would
      // leave a hole in the middle of the file.
      received = (await stat(partial).catch(() => null))?.size ?? 0
      onProgress({ received, total })
      log.warn('romm', 'the transfer broke, picking it up again', {
        ...subject,
        received,
        total,
        attempt,
        reason: (cause as Error).message
      })
      await new Promise((resolve) => setTimeout(resolve, RESUME_DELAY_MS))
    } finally {
      if (idle) clearTimeout(idle)
      signal.removeEventListener('abort', relay)
    }
  }

  if (options.verify) await verify(partial, options.verify, subject)

  await rename(partial, destination)
  log.info('romm', 'content downloaded', { ...subject, bytes: received, ms: took(), destination })
  return received
}

/**
 * Refuse to let a file stand unless it is the file RomM holds.
 *
 * A ROM whose bytes are wrong starts, runs and corrupts a save, or does not
 * start and is blamed on the emulator. The one thing that cannot happen is
 * for it to go unnoticed, which is what this is.
 *
 * A resumed transfer is what this exists for. Where the bytes came from is
 * decided by a range header and a record of what was being fetched, and every
 * part of that is true right up until the file on the server is replaced
 * between two halves of one download.
 *
 * The file goes with the failure, whether it is the `.part` still arriving or
 * the game an archive was just unpacked into: what fails is the download
 * rather than a launch, and nothing is left to resume onto — bytes already
 * known to be wrong could only ever produce the same file again.
 */
export async function verify(
  file: string,
  { algorithm, expected }: Checksum,
  subject: TransferSubject
): Promise<void> {
  const actual = await hashOf(file, algorithm)
  if (actual === expected.toLowerCase()) {
    log.debug('romm', 'the file matches what RomM holds', { ...subject, algorithm })
    return
  }
  await rm(file, { force: true }).catch(() => undefined)
  log.error('romm', 'the file that arrived is not the one RomM holds', undefined, {
    ...subject,
    algorithm,
    expected,
    actual
  })
  throw new CorruptDownloadError(t('error.downloadCorrupt'))
}

/**
 * Fetch something small straight to a path, in one go.
 *
 * Saves, states and the BIOS: files of a few kilobytes that either arrive or
 * do not. None of the machinery above applies to them — there is nothing to
 * resume onto and nothing worth timing — and the partial file, where one is
 * wanted, is the caller's own choice of destination.
 */
export async function streamToFile(
  transport: Transport,
  path: string,
  destination: string
): Promise<void> {
  const res = await transport.request(path)
  if (!res.ok) throw await transport.toError(res)
  if (!res.body) throw new RommError(t('error.emptyAssetBody'))
  const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  await pipeline(source, createWriteStream(destination))
}
