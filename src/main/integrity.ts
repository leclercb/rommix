import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { log } from './log.ts'
import { t } from './i18n.ts'

/**
 * Checking that what arrived is what was published.
 *
 * Everything here guards a download that becomes *code*: RomMix replacing its
 * own AppImage, an emulator being installed, a libretro core being put where an
 * emulator will load it. A ROM that is the wrong bytes is a game that will not
 * start; a core that is the wrong bytes is whatever those bytes decide to do.
 *
 * TLS already establishes who the bytes came from, and none of this is a
 * substitute for that. What a digest adds is that the file is the one the
 * publisher meant to publish — which a proxy, a mirror, a cache or a truncated
 * response can all break without the connection ever looking wrong.
 */

/** A digest a publisher stated, and what produced it. */
export interface Digest {
  algorithm: 'sha256' | 'sha512'
  expected: string
}

/**
 * Read a digest out of the form GitHub states one in.
 *
 * `sha256:<hex>` on a release asset. Returns null for anything else, including
 * an absent field and an algorithm this cannot compute — an unreadable digest
 * has to mean "no digest" rather than "refuse the file", or a publisher adopting
 * a new one would break every installation at once.
 */
export function parseDigest(value: string | undefined | null): Digest | null {
  const match = /^(sha256|sha512):([0-9a-f]+)$/i.exec((value ?? '').trim())
  if (!match) return null
  return { algorithm: match[1].toLowerCase() as Digest['algorithm'], expected: match[2] }
}

/** What a file on disk hashes to. */
export async function hashOf(path: string, algorithm: string): Promise<string> {
  const digest = createHash(algorithm)
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer)
  return digest.digest('hex')
}

/**
 * Refuse to put a downloaded file in place unless it is the file that was
 * published.
 *
 * Called on the part-file, before whatever rename or extraction would make it
 * live — so a mismatch costs a failed install rather than a broken one, and the
 * bytes go with the failure rather than sitting there waiting to be retried
 * onto.
 *
 * A source that states no digest is downloaded without one, and says so in the
 * log. That is not a loophole to be closed by refusing: the libretro buildbot
 * publishes nothing to compare against, and a core that cannot be installed is
 * an emulator that cannot run the game at all.
 */
export async function verifyDownload(
  path: string,
  digest: Digest | null,
  subject: { kind: string; name: string }
): Promise<void> {
  if (!digest) {
    log.info('integrity', 'no digest was published for this download', subject)
    return
  }

  const actual = await hashOf(path, digest.algorithm)
  if (actual === digest.expected.toLowerCase()) {
    log.debug('integrity', 'the download matches the digest published for it', {
      ...subject,
      algorithm: digest.algorithm
    })
    return
  }

  await rm(path, { force: true }).catch(() => undefined)
  log.error('integrity', 'the download is not what was published', undefined, {
    ...subject,
    algorithm: digest.algorithm,
    expected: digest.expected,
    actual
  })
  throw new Error(t('error.downloadNotPublished', { name: subject.name }))
}
