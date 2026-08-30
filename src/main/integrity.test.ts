import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashOf, parseDigest, verifyDownload } from './integrity.ts'

/**
 * Checking that a download is the file that was published.
 *
 * This guards the three things RomMix installs as *code* — its own AppImage, an
 * emulator, a libretro core — so the case that matters most is the one where
 * the answer is "no": the bytes have to go, and nothing may be put in place.
 */

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fileHolding(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-integrity-test-'))
  roots.push(dir)
  const path = join(dir, 'download.part')
  writeFileSync(path, contents)
  return path
}

const PUBLISHED = 'the published bytes'
/** Well-formed, and not the digest of anything here — which is the point. */
const SOME_OTHER_DIGEST = 'a'.repeat(64)

describe('reading a digest a publisher stated', () => {
  test('GitHub states one as algorithm and hex', () => {
    assert.deepEqual(parseDigest('sha256:ABCDEF01'), {
      algorithm: 'sha256',
      expected: 'ABCDEF01'
    })
    assert.deepEqual(parseDigest('sha512:beef'), { algorithm: 'sha512', expected: 'beef' })
  })

  test('anything unreadable is no digest rather than a refusal', () => {
    // A publisher adopting a form or an algorithm this cannot compute must not
    // break every installation at once.
    for (const value of [undefined, null, '', 'abcdef', 'md5:abc', 'sha256:', 'sha256:zz']) {
      assert.equal(parseDigest(value), null, `${String(value)} should not parse`)
    }
  })
})

describe('checking a download against it', () => {
  test('a file that matches is left where it is', async () => {
    const path = fileHolding(PUBLISHED)
    const actual = await hashOf(path, 'sha256')

    await verifyDownload(
      path,
      { algorithm: 'sha256', expected: actual },
      {
        kind: 'update',
        name: 'RomMix.AppImage'
      }
    )

    assert.equal(existsSync(path), true)
  })

  test('the digest is matched whatever case it was stated in', async () => {
    const path = fileHolding(PUBLISHED)
    const actual = (await hashOf(path, 'sha256')).toUpperCase()

    await verifyDownload(
      path,
      { algorithm: 'sha256', expected: actual },
      {
        kind: 'update',
        name: 'RomMix.AppImage'
      }
    )

    assert.equal(existsSync(path), true)
  })

  test('a file that does not match is deleted, not merely refused', async () => {
    // Left on disk it would sit there as a part-file waiting to be resumed onto
    // or retried, and the next attempt would append to bytes already known to
    // be wrong.
    const path = fileHolding('something else entirely')

    await assert.rejects(
      () =>
        verifyDownload(
          path,
          { algorithm: 'sha256', expected: SOME_OTHER_DIGEST },
          {
            kind: 'emulator',
            name: 'Eden.AppImage'
          }
        ),
      /Eden\.AppImage/
    )
    assert.equal(existsSync(path), false)
  })

  test('a source that publishes no digest is downloaded without one', async () => {
    // The libretro buildbot is this case. Refusing would mean an emulator that
    // cannot run the game at all, which is worse than the check not happening.
    const path = fileHolding(PUBLISHED)

    await verifyDownload(path, null, { kind: 'core', name: 'genesis_plus_gx' })

    assert.equal(existsSync(path), true)
  })

  test('a digest of the wrong length for its algorithm still fails cleanly', async () => {
    const path = fileHolding(PUBLISHED)

    await assert.rejects(() =>
      verifyDownload(
        path,
        { algorithm: 'sha256', expected: 'ab' },
        {
          kind: 'update',
          name: 'RomMix.AppImage'
        }
      )
    )
    assert.equal(existsSync(path), false)
  })
})
