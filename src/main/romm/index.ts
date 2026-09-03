/**
 * Everything that talks to RomM.
 *
 * Split by what each part is answerable for rather than by endpoint: the
 * client says what to ask the server for, `transfer.ts` owns what happens to
 * bytes on their way to the disk, `checksums.ts` decides which hash — if any —
 * describes what is arriving, and `errors.ts` holds the three failures the
 * rest of RomMix branches on.
 *
 * One import for the lot, because every caller wants the client and at least
 * one of the error types: a download that has to tell an outage from a
 * refusal, a screen that has to tell a refusal from a bad hash.
 */

export { RommClient, REQUIRED_SCOPES, normaliseBaseUrl } from './client.ts'
export { CorruptDownloadError, RommError, UnreachableError, answered, refusedUs } from './errors.ts'
export { partialPathOf } from './transfer.ts'
export type { DownloadProgress, TransferOptions } from './transfer.ts'
