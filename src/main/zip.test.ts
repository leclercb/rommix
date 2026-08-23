import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractZip, isZip, zipDirectory } from './zip.ts'

/**
 * The zip writer, round-tripped.
 *
 * RomMix emits zip archives by hand — eighty lines of local headers, a central
 * directory and a CRC table — rather than taking a dependency to produce a
 * format that has not changed since 1993. That is a reasonable trade only while
 * the output is genuinely a zip, and "genuinely" is not something the type
 * checker has an opinion about: a wrong CRC, a miscounted central-directory
 * offset or a bad length field all produce a file that is exactly the right
 * size and that no unzip will open.
 *
 * So these tests read the archive back with `extractZip` *and*, where the tool
 * is present, check it against the system `unzip`. Reading it back with the
 * matching reader would pass happily on two halves of the same misunderstanding.
 *
 * What is at stake: a Switch save is a directory, and this is how one reaches
 * RomM. An archive the server accepts and nothing can open is a save the user
 * believes is backed up.
 */

const roots: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-zip-test-'))
  roots.push(dir)
  return dir
}

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

/** Is the system `unzip` available to check our work against? */
function haveUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

test('an archive round-trips through extractZip with its contents intact', async () => {
  const root = scratch()
  const source = join(root, 'save')
  mkdirSync(join(source, 'nested'), { recursive: true })

  // Deliberately awkward: a file large enough to actually compress, a nested
  // path, a name outside ASCII, and an empty file — the last being the one that
  // a length field written from the wrong variable gets wrong.
  const bulk = Buffer.alloc(5000, 7)
  writeFileSync(join(source, 'game.dat'), bulk)
  writeFileSync(join(source, 'nested', 'ünïcode — save.dat'), 'ünïcode ✓')
  writeFileSync(join(source, 'empty.dat'), '')

  const zipPath = join(root, 'out.zip')
  assert.equal(await zipDirectory(source, zipPath), 3)
  assert.equal(await isZip(zipPath), true)

  const back = join(root, 'back')
  await extractZip(zipPath, back)

  assert.deepEqual(readFileSync(join(back, 'game.dat')), bulk)
  assert.equal(readFileSync(join(back, 'nested', 'ünïcode — save.dat'), 'utf8'), 'ünïcode ✓')
  assert.equal(readFileSync(join(back, 'empty.dat')).length, 0)
})

test('the archive is one a different implementation can open', { skip: !haveUnzip() }, async () => {
  const root = scratch()
  const source = join(root, 'save')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'a.dat'), Buffer.alloc(4096, 3))
  writeFileSync(join(source, 'b.dat'), 'plain text')

  const zipPath = join(root, 'out.zip')
  await zipDirectory(source, zipPath)

  // `unzip -t` verifies every entry's CRC against its decompressed bytes, which
  // is the check our own reader cannot make on its own behalf.
  const report = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' })
  assert.match(report, /No errors detected/)
})

test('the directory itself is not a level in the archive', async () => {
  // Entries are named relative to the folder, so a Switch save restored on
  // another device lands in that device's profile folder rather than nesting a
  // copy of the original profile id inside it.
  const root = scratch()
  const source = join(root, '0123456789abcdef')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'slot.dat'), 'x')

  const zipPath = join(root, 'out.zip')
  await zipDirectory(source, zipPath)
  const back = join(root, 'somewhere-else')
  await extractZip(zipPath, back)

  assert.equal(readFileSync(join(back, 'slot.dat'), 'utf8'), 'x')
})

test('an empty folder produces no archive, so an empty save is not uploaded', async () => {
  const root = scratch()
  const source = join(root, 'save')
  mkdirSync(source, { recursive: true })
  assert.equal(await zipDirectory(source, join(root, 'out.zip')), 0)
})

/**
 * Every shape of escaping entry, and what actually happens to it.
 *
 * Built by hand: `zipDirectory` cannot produce one of these, and the case that
 * matters is an archive from somewhere else. RomM serves the ROM zips RomMix
 * unpacks, so this guard stands between a compromised or simply corrupt server
 * and the user's home directory.
 *
 * The extraction *rejects* rather than skipping the entry — yauzl validates
 * names as it reads the central directory and aborts the whole archive, which
 * is stricter than RomMix's own `safeJoin` and gets there first. Asserted as
 * rejection because that is the real behaviour; the caller treats a failed
 * extraction as a failed download and cleans up after it.
 */
for (const name of ['../escaped.txt', '/etc/rommix-escaped', 'a/../../escaped.txt']) {
  test(`a zip entry named ${name} cannot escape the destination`, async () => {
    const root = scratch()
    const dest = join(root, 'dest')
    mkdirSync(dest, { recursive: true })

    const evil = join(root, 'evil.zip')
    writeFileSync(evil, traversingZip(name, 'pwned'))

    await assert.rejects(() => extractZip(evil, dest))
    assert.equal(await exists(join(root, 'escaped.txt')), false, 'nothing written beside dest')
    assert.equal(await exists(join(dest, 'escaped.txt')), false, 'and nothing smuggled inside')
  })
}

test('a file that is not a zip is not mistaken for one', async () => {
  const root = scratch()
  const rom = join(root, 'game.sfc')
  // A ROM download is only unpacked when it really is an archive; a bare ROM
  // whose first bytes happened to be tested as text must not be.
  writeFileSync(rom, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]))
  assert.equal(await isZip(rom), false)
  assert.equal(await isZip(join(root, 'missing.zip')), false)
})

async function exists(path: string): Promise<boolean> {
  const { access } = await import('node:fs/promises')
  return access(path).then(
    () => true,
    () => false
  )
}

/**
 * A one-entry stored (uncompressed) zip whose entry name is whatever is given.
 *
 * Hand-assembled because the point is to produce something our own writer never
 * would. Stored rather than deflated so the two length fields are the same
 * number and the fixture stays readable.
 */
function traversingZip(name: string, contents: string): Buffer {
  const data = Buffer.from(contents, 'utf8')
  const nameBytes = Buffer.from(name, 'utf8')
  const crc = crc32(data)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(0, 8) // stored
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 10) // stored
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  central.writeUInt32LE(0, 42)

  const centralStart = local.length + nameBytes.length + data.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + nameBytes.length, 12)
  end.writeUInt32LE(centralStart, 16)

  return Buffer.concat([local, nameBytes, data, central, nameBytes, end])
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
