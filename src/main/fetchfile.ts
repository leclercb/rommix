import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * Fetching a URL into a file, counting the bytes on their way past.
 *
 * Three things RomMix installs arrive this way — a new version of itself, an
 * emulator build, a libretro core — and each of them wrote the same fetch,
 * the same refusal check, the same byte count and the same pipeline. What
 * differs between them is what a refusal means and where the bytes are
 * reported to, which is what the options are.
 *
 * Not what a ROM or a save comes down: those go through the server's
 * transport, which carries the session, resumes a part-file and retries — see
 * `streamToFile` and `download` in `romm/transfer.ts`. This is for the public
 * URLs that need none of that.
 */

/**
 * How often a transfer reports its progress by default.
 *
 * On a clock rather than per chunk: every one of these is a whole program or a
 * core, so each is tens of thousands of chunks, and a renderer told about each
 * of them spends the download redrawing instead of drawing.
 */
const PROGRESS_EVERY_MS = 250

/** How much of a transfer has arrived, and how much is expected in total. */
export interface Fetched {
  receivedBytes: number
  /** Zero where neither the response nor the caller could say. */
  totalBytes: number
}

export async function fetchToFile(
  url: string,
  destination: string,
  {
    sizeHint = 0,
    everyMs = PROGRESS_EVERY_MS,
    refused,
    onProgress
  }: {
    /**
     * What the file is known to weigh, for a server that does not say.
     *
     * A release API can state a size of zero for its assets, and a response
     * carrying no `content-length` leaves nothing to divide by — so whichever
     * of the two is a number is the total the bar is drawn from.
     */
    sizeHint?: number
    /**
     * The shortest gap between two reports. Zero reports every chunk.
     *
     * Everything fetched through here is a whole program or a core — tens of
     * thousands of chunks — and a renderer told about each of them spends the
     * transfer redrawing. See `PROGRESS_EVERY_MS`.
     */
    everyMs?: number
    /**
     * What a refused request means to the caller: the error it should raise,
     * and the place to log the status that caused it, since only the caller
     * knows which subject it belongs to and how it reads to the user.
     */
    refused: (status: number) => Error
    onProgress?: (progress: Fetched) => void
  }
): Promise<Fetched> {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw refused(response.status)

  const totalBytes = Number(response.headers.get('content-length') ?? 0) || sizeHint
  let receivedBytes = 0
  let announced = 0

  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  await pipeline(
    body,
    // Counted as the bytes pass through rather than from a `data` listener,
    // which would put the stream in flowing mode and race the pipeline for
    // them. The same reason `streamToFile` counts this way.
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        receivedBytes += chunk.length
        const now = Date.now()
        if (onProgress && now - announced >= everyMs) {
          announced = now
          onProgress({ receivedBytes, totalBytes })
        }
        yield chunk
      }
    },
    createWriteStream(destination)
  )

  return { receivedBytes, totalBytes }
}
