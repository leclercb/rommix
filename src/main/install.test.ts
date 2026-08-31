import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { RommRom } from '@shared/types'
import {
  directorySize,
  filePathsUnder,
  installedFiles,
  onlyFile,
  pickLaunchFile,
  unpack
} from './install.ts'
import { zipDirectory } from './zip.ts'

/**
 * What an unpacked download turns out to be, read back off a real disk.
 *
 * Every one of these walks a directory tree, so they are tested against one
 * rather than against a mock: the bugs worth catching here are about what a
 * tree actually looks like — an archive that wrapped the game in a folder of
 * its own, a game whose files sit beside a scan of its manual — and a fake
 * filesystem would only ever be as right as the assumption that built it.
 *
 * `installName` and `listDir` are the other half of this file and are covered
 * in `paths.test.ts`, with the rest of the naming rules.
 */

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A directory tree from a description of it: path -> contents. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'rommix-install-test-'))
  scratches.push(root)
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }
  return root
}

describe('measuring what a game occupies', () => {
  test('a directory is the sum of everything below it, however deep', async () => {
    const root = tree({
      'disc.cue': '12345',
      'tracks/track01.bin': '1234567890',
      'tracks/extra/notes.txt': '12'
    })

    assert.equal(await directorySize(root), 17)
  })

  test('an empty directory is nothing rather than an error', async () => {
    assert.equal(await directorySize(tree({})), 0)
  })
})

describe('listing the files a game is made of', () => {
  test('every file below the directory comes back, as a full path', async () => {
    const root = tree({ 'disc.cue': 'x', 'tracks/track01.bin': 'x' })

    const found = await filePathsUnder(root)

    assert.deepEqual(
      found.sort(),
      [join(root, 'disc.cue'), join(root, 'tracks/track01.bin')].sort()
    )
  })

  test('a directory that is not there is an empty list, not a crash', async () => {
    assert.deepEqual(await filePathsUnder(join(tree({}), 'nothing-here')), [])
  })
})

describe('deciding whether an archive held one file or a game', () => {
  test('one file is the file, wherever the archive buried it', async () => {
    const root = tree({ 'Sonic (USA)/Sonic (USA).md': 'rom' })

    assert.equal(await onlyFile(root), join(root, 'Sonic (USA)/Sonic (USA).md'))
  })

  test('two files are a game, and answer with nothing', async () => {
    const root = tree({ 'disc.cue': 'x', 'disc.bin': 'x' })

    assert.equal(await onlyFile(root), null)
  })

  test('a folder holding a folder holding two files is a game as well', async () => {
    const root = tree({ 'wrapper/disc.cue': 'x', 'wrapper/disc.bin': 'x' })

    assert.equal(await onlyFile(root), null)
  })
})

describe('nominating the file to launch', () => {
  test('the disc descriptor wins over the much larger track beside it', async () => {
    const root = tree({ 'game.bin': '0'.repeat(500), 'game.cue': 'FILE "game.bin" BINARY' })

    assert.equal(await pickLaunchFile(root, 'psx'), join(root, 'game.cue'))
  })

  test('with no descriptor, the largest file is the game and the rest is packaging', async () => {
    const root = tree({ 'manual.txt': '0'.repeat(10), 'game.nes': '0'.repeat(400) })

    assert.equal(await pickLaunchFile(root, 'nes'), join(root, 'game.nes'))
  })

  test('the wrapper folder an archive added is descended through, not launched', async () => {
    const root = tree({ 'Sonic (USA)/Sonic (USA).md': '0'.repeat(64) })

    assert.equal(await pickLaunchFile(root, 'megadrive'), join(root, 'Sonic (USA)/Sonic (USA).md'))
  })

  test('a directory with nothing launchable in it nominates nothing', async () => {
    assert.equal(await pickLaunchFile(tree({}), 'nes'), null)
  })
})

/** A ROM as the server describes it, with only what `unpack` reads filled in. */
function rom(fields: Partial<RommRom> = {}): RommRom {
  return {
    fs_name: 'Sonic (USA).md',
    fs_name_no_ext: 'Sonic (USA)',
    fs_extension: 'md',
    files: [],
    ...fields
  } as RommRom
}

/** The archive RomM would have sent, built from a directory of files. */
async function archiveOf(files: Record<string, string>): Promise<{ zip: string; dir: string }> {
  const root = tree(files)
  const zip = join(root, '..', `${basename(root)}.zip`)
  await zipDirectory(root, zip)
  return { zip, dir: mkdtempSync(join(tmpdir(), 'rommix-install-system-')) }
}

describe('unpacking what the server sent', () => {
  test('a lone ROM comes out of the folder RomM zipped it in', async () => {
    const { zip, dir } = await archiveOf({ 'Sonic (USA).md': '0'.repeat(64) })
    scratches.push(dir)

    const installed = await unpack(rom(), zip, dir, 'genesis', join(dir, 'Sonic (USA).md'), false)

    assert.equal(installed.isDirectory, false)
    assert.equal(installed.path, join(dir, 'Sonic (USA).md'))
    assert.equal(installed.launchPath, installed.path)
    assert.equal(installed.sizeBytes, 64)
    // The staging directory is not left behind beside the game.
    assert.deepEqual(await filePathsUnder(dir), [join(dir, 'Sonic (USA).md')])
  })

  test('a genuine multi-file game keeps a directory of its own', async () => {
    const { zip, dir } = await archiveOf({
      'disc.cue': 'FILE "disc.bin" BINARY',
      'disc.bin': '0'.repeat(128)
    })
    scratches.push(dir)
    const target = join(dir, 'Final Fantasy VII')

    const installed = await unpack(
      rom({ fs_name: 'Final Fantasy VII', fs_name_no_ext: 'Final Fantasy VII', fs_extension: '' }),
      zip,
      dir,
      'psx',
      target,
      true
    )

    assert.equal(installed.isDirectory, true)
    assert.equal(installed.path, target)
    assert.equal(installed.launchPath, join(target, 'disc.cue'))
  })

  test('several files for a flat library go loose, and are recorded one by one', async () => {
    const { zip, dir } = await archiveOf({
      'inside/game.nsp': '0'.repeat(32),
      'inside/update.nsp': '0'.repeat(16)
    })
    scratches.push(dir)

    const installed = await unpack(
      rom({ fs_name: 'A Switch game', fs_name_no_ext: 'A Switch game', fs_extension: '' }),
      zip,
      dir,
      'switch',
      join(dir, 'A Switch game'),
      false,
      true
    )

    assert.equal(installed.isDirectory, false)
    assert.deepEqual(installed.files?.sort(), ['game.nsp', 'update.nsp'])
    assert.equal(installed.sizeBytes, 48)
    // The archive's own folder is discarded: a path is what this emulator
    // cannot follow.
    assert.equal(installed.launchPath, join(dir, 'game.nsp'))
  })

  test('an archive of several files with nowhere flat to go becomes a directory', async () => {
    const { zip, dir } = await archiveOf({ 'disc.cue': 'x', 'disc.bin': '0'.repeat(64) })
    scratches.push(dir)

    const installed = await unpack(
      rom({ fs_name: 'Some game', fs_name_no_ext: 'Some game', fs_extension: '' }),
      zip,
      dir,
      'psx',
      join(dir, 'Some game'),
      false
    )

    assert.equal(installed.isDirectory, true)
    assert.equal(installed.path, join(dir, 'Some game'))
  })
})

describe('what a game is recorded as consisting of', () => {
  test('a game in folders is its files, not the folders holding them', async () => {
    // The record the index keeps and the Files tab draws. A listing that
    // stopped at the top of the tree recorded two folder names and showed each
    // of them as though it were a file.
    const root = tree({
      'Disc 1/track01.bin': '0'.repeat(8),
      'Disc 1/disc.cue': 'FILE "track01.bin" BINARY',
      'Disc 2/track01.bin': '0'.repeat(8)
    })

    assert.deepEqual(await installedFiles(root), [
      'Disc 1/disc.cue',
      'Disc 1/track01.bin',
      'Disc 2/track01.bin'
    ])
  })

  test('a folder with nothing in it is nothing, which is how a game is told from one', async () => {
    // What a cancelled transfer leaves behind. Adoption reads this to decide
    // whether there is a game there at all.
    const root = tree({})

    assert.deepEqual(await installedFiles(root), [])
  })

  test('an unpacked game reports its own contents rather than being read back', async () => {
    const { zip, dir } = await archiveOf({
      'disc.cue': 'FILE "disc.bin" BINARY',
      'disc.bin': '0'.repeat(128)
    })
    scratches.push(dir)
    const target = join(dir, 'Final Fantasy VII')

    const installed = await unpack(
      rom({ fs_name: 'Final Fantasy VII', fs_name_no_ext: 'Final Fantasy VII', fs_extension: '' }),
      zip,
      dir,
      'psx',
      target,
      true
    )

    assert.deepEqual(installed.files?.sort(), ['disc.bin', 'disc.cue'])
  })
})
