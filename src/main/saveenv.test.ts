import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { fileSystemEnvironment } from './saveenv.ts'

/**
 * The machine as a descriptor sees it.
 *
 * Every method here answers with the empty value rather than throwing, and that
 * is the whole contract: a descriptor asking about a folder that does not exist
 * is asking about a game nobody has played yet, and an exception there aborts a
 * save sync that had nothing wrong with it. So each of these is tested twice —
 * once against something that is there, once against something that is not.
 */

const env = fileSystemEnvironment()
const scratches: string[] = []

afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tree(files: Record<string, string | Buffer>, dirs: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'rommix-saveenv-test-'))
  scratches.push(root)
  for (const name of dirs) mkdirSync(join(root, name), { recursive: true })
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }
  return root
}

describe('looking at a path', () => {
  test('a directory and a file both exist; nothing else does', () => {
    const root = tree({ 'save.srm': 'x' }, ['states'])

    assert.equal(env.exists(root), true)
    assert.equal(env.exists(join(root, 'save.srm')), true)
    assert.equal(env.exists(join(root, 'never-written')), false)
  })

  test('directories and files are listed apart, because they mean different things', () => {
    const root = tree({ 'save.srm': 'x', 'notes.txt': 'x' }, ['states', 'memcards'])

    assert.deepEqual([...env.dirs(root)].sort(), ['memcards', 'states'])
    assert.deepEqual([...env.files(root)].sort(), ['notes.txt', 'save.srm'])
  })

  test('a folder that is not there lists nothing rather than failing the sync', () => {
    const root = tree({})

    assert.deepEqual(env.dirs(join(root, 'gone')), [])
    assert.deepEqual(env.files(join(root, 'gone')), [])
  })
})

describe('reading a file', () => {
  test('a config file comes back as text, a missing one as nothing', () => {
    const root = tree({ 'retroarch.cfg': 'savefile_directory = "~/saves"' })

    assert.equal(env.text(join(root, 'retroarch.cfg')), 'savefile_directory = "~/saves"')
    assert.equal(env.text(join(root, 'absent.cfg')), null)
  })

  test('a header is read byte for byte, so binary offsets survive', () => {
    // A ROM header: a run of ASCII inside bytes that are not valid UTF-8. Read
    // as UTF-8 these collapse into replacement characters and everything after
    // them shifts, which is the bug this mapping exists to avoid.
    const root = tree({ 'game.iso': Buffer.from([0xff, 0xfe, 0x53, 0x45, 0x47, 0x41, 0x00]) })

    const head = env.head(join(root, 'game.iso'), 6)

    assert.equal(head?.length, 6)
    assert.equal(head?.slice(2), 'SEGA')
  })

  test('a header asked for beyond the end of the file is what there was', () => {
    const root = tree({ 'tiny.bin': 'ab' })

    assert.equal(env.head(join(root, 'tiny.bin'), 64), 'ab')
    assert.equal(env.head(join(root, 'gone.bin'), 64), null)
  })

  test('a read from inside a file is byte for byte, and past the end is what there was', () => {
    // Where a disc image keeps a file is past any header worth reading whole.
    const root = tree({ 'game.iso': Buffer.from([0x00, 0xff, 0x00, 0xfe, 0x55, 0x4d, 0x44]) })
    const game = join(root, 'game.iso')

    assert.equal(env.read(game, 4, 3), 'UMD')
    assert.equal(env.read(game, 3, 64)?.charCodeAt(0), 0xfe)
    assert.equal(env.read(game, 64, 64), '')
    assert.equal(env.read(join(root, 'gone.iso'), 0, 64), null)
  })
})

describe('inflating a block', () => {
  test('a raw deflate stream comes back whole, the padding after it ignored', () => {
    // A CSO block runs to the next aligned position, so its stream is followed
    // by bytes that belong to nothing.
    const block = Buffer.from([0xff, 0x00, ...Buffer.from('ULUS-10064|')])
    const deflated = deflateRawSync(block).toString('latin1')

    assert.equal(env.inflateRaw(deflated + '\0\0\0', 64), block.toString('latin1'))
  })

  test('a stream past the limit, or no stream at all, is nothing rather than a failed sync', () => {
    const deflated = deflateRawSync(Buffer.alloc(1 << 20)).toString('latin1')

    assert.equal(env.inflateRaw(deflated, 2048), null)
    assert.equal(env.inflateRaw('not a deflate stream', 64), null)
  })
})

describe('when a folder was last written to', () => {
  test('the newest file below it is the answer, not the folder own stamp', () => {
    const root = tree({ 'old/save.srm': 'x', 'new/save.srm': 'x' })
    const older = new Date('2026-01-01T00:00:00Z')
    const newer = new Date('2026-06-01T00:00:00Z')
    utimesSync(join(root, 'old/save.srm'), older, older)
    utimesSync(join(root, 'new/save.srm'), newer, newer)

    assert.equal(env.newest(root), newer.getTime())
  })

  test('a tree with nothing in it, or no tree at all, is zero', () => {
    const root = tree({})

    assert.equal(env.newest(root), 0)
    assert.equal(env.newest(join(root, 'gone')), 0)
  })

  test('a file below the depth it descends does not count', () => {
    const root = tree({ 'a/b/c/d/e/deep.srm': 'x', 'shallow.srm': 'x' })
    const shallow = new Date('2026-01-01T00:00:00Z')
    const deep = new Date('2026-06-01T00:00:00Z')
    utimesSync(join(root, 'shallow.srm'), shallow, shallow)
    utimesSync(join(root, 'a/b/c/d/e/deep.srm'), deep, deep)

    assert.equal(env.newest(root), shallow.getTime())
  })
})
