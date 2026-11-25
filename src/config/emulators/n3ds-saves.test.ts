import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { n3dsSavePaths, n3dsTitleId } from './n3ds-saves.ts'
import { cia, ncch, ncsd } from './test/n3ds.ts'
import type { SaveContext, SaveEnvironment } from './savepaths.ts'

/**
 * Reading the title id a 3DS ROM declares, which names the folder Azahar keeps
 * the game's save data in.
 *
 * A wrong id is another game's save folder archived and sent up under this one,
 * so every container here is built byte by byte rather than taken from a game.
 */

function reading(bytes: string): SaveEnvironment {
  return {
    read: (_path, offset, length) => bytes.slice(offset, offset + length),
    head: (_path, length) => bytes.slice(0, length)
  } as SaveEnvironment
}

const id = (bytes: string, name = 'game.3ds'): string | null =>
  n3dsTitleId(reading(bytes), `/roms/n3ds/${name}`)

describe('the title id of a 3DS ROM', () => {
  test('is an NCSD’s media id', () => {
    assert.equal(id(ncsd('0004000000030800')), '0004000000030800')
  })

  test('is a bare NCCH’s program id', () => {
    assert.equal(id(ncch('000400000008F800'), 'game.cxi'), '000400000008F800')
  })

  test('is the id a CIA’s TMD states, whatever signature signs it', () => {
    assert.equal(id(cia('0004000000164800'), 'game.cia'), '0004000000164800')
    assert.equal(
      id(cia('0004000000164800', { signature: 0x010000 }), 'game.cia'),
      '0004000000164800'
    )
    assert.equal(
      id(cia('0004000000164800', { certs: 0x700, ticket: 0x2c4 }), 'game.cia'),
      '0004000000164800'
    )
  })

  test('is the application’s when the file is a patch for it', () => {
    assert.equal(id(cia('0004000E00164800'), 'update.cia'), '0004000000164800')
  })

  test('keeps a demo’s own id', () => {
    assert.equal(id(ncsd('0004000200164800')), '0004000200164800')
  })

  test('is nothing for downloadable content or a system title', () => {
    assert.equal(id(cia('0004008C00164800'), 'dlc.cia'), null)
    assert.equal(id(ncsd('0004001B00164800')), null)
    assert.equal(id(ncsd('0001000200164800')), null)
  })

  test('is nothing for a file that is not a container', () => {
    assert.equal(id('\0'.repeat(0x4000)), null)
    assert.equal(id(ncsd('0004000000030800'), 'game.3dsx'), null)
    assert.equal(id(cia('0004000000164800').slice(0, 0x2100), 'game.cia'), null)
  })

  test('is nothing when the CIA’s TMD names a signature it does not know', () => {
    assert.equal(
      id(
        cia('0004000000164800', { signature: 0x010004 }).replace('\0\x01\0\x04', '\0\x09\0\x09'),
        'game.cia'
      ),
      null
    )
  })

  test('is nothing for an unreadable file', () => {
    const unreadable = { head: () => null, read: () => null } as unknown as SaveEnvironment
    assert.equal(n3dsTitleId(unreadable, '/roms/n3ds/game.3ds'), null)
  })
})

const SDMC = '/saves/azahar/sdmc'
const ZERO = '00000000000000000000000000000000'
const OTHER = 'ABCDEF0123456789ABCDEF0123456789'
const ID = '0004000000030800'

interface Disk {
  dirs?: Record<string, string[]>
  mtimes?: Record<string, number>
}

/** A save context for the game `rom`, on a disk described as a literal. */
function context(rom: string, disk: Disk = {}): SaveContext {
  const dirs = disk.dirs ?? {}
  return {
    paths: { home: null, roms: null, saves: null, states: null, bios: null },
    system: 'n3ds',
    romPath: '/roms/n3ds/game.3ds',
    romDir: '/roms/n3ds',
    romStem: 'game',
    home: '/home/deck',
    configDir: null,
    dataDir: null,
    installDir: null,
    env: {
      head: (_path: string, length: number) => rom.slice(0, length),
      read: (_path: string, offset: number, length: number) => rom.slice(offset, offset + length),
      dirs: (path: string) => dirs[path] ?? [],
      exists: (path: string) => path in dirs,
      files: () => [],
      text: () => null,
      inflateRaw: () => null,
      zstd: () => null,
      newest: (path: string) => disk.mtimes?.[path] ?? 0
    } satisfies SaveEnvironment
  }
}

const title = (id0: string, id1: string): string =>
  `${SDMC}/Nintendo 3DS/${id0}/${id1}/title/00040000/00030800`

describe('where Azahar keeps a game’s saves', () => {
  test('is the data folder under the title id, in the one profile there is', () => {
    const disk = {
      dirs: {
        [`${SDMC}/Nintendo 3DS`]: [ZERO],
        [`${SDMC}/Nintendo 3DS/${ZERO}`]: [ZERO]
      }
    }
    const paths = n3dsSavePaths(context(ncsd(ID), disk), SDMC, 'Azahar')
    assert.deepEqual(paths.saves, { dir: `${title(ZERO, ZERO)}/data`, match: 'directory' })
  })

  test('is under the default ids when the emulator has written nothing yet', () => {
    const paths = n3dsSavePaths(context(ncsd(ID)), SDMC, 'Azahar')
    assert.equal(paths.saves?.dir, `${title(ZERO, ZERO)}/data`)
  })

  test('is under the profile that already holds the title, among several', () => {
    const disk = {
      dirs: {
        [`${SDMC}/Nintendo 3DS`]: [ZERO, OTHER],
        [`${SDMC}/Nintendo 3DS/${ZERO}`]: [ZERO],
        [`${SDMC}/Nintendo 3DS/${OTHER}`]: [OTHER],
        [title(ZERO, ZERO)]: []
      },
      mtimes: { [`${SDMC}/Nintendo 3DS/${OTHER}/${OTHER}`]: 9 }
    }
    const paths = n3dsSavePaths(context(ncsd(ID), disk), SDMC, 'Azahar')
    assert.equal(paths.saves?.dir, `${title(ZERO, ZERO)}/data`)
  })

  test('is under the most recently written profile when none holds the title', () => {
    const disk = {
      dirs: {
        [`${SDMC}/Nintendo 3DS`]: [ZERO, OTHER],
        [`${SDMC}/Nintendo 3DS/${ZERO}`]: [ZERO],
        [`${SDMC}/Nintendo 3DS/${OTHER}`]: [OTHER]
      },
      mtimes: { [`${SDMC}/Nintendo 3DS/${OTHER}/${OTHER}`]: 9 }
    }
    const paths = n3dsSavePaths(context(ncsd(ID), disk), SDMC, 'Azahar')
    assert.equal(paths.saves?.dir, `${title(OTHER, OTHER)}/data`)
  })

  test('is nowhere, and says why, when the title id cannot be read', () => {
    const paths = n3dsSavePaths(context('\0'.repeat(0x4000)), SDMC, 'Azahar')
    assert.equal(paths.saves, null)
    assert.deepEqual(paths.unsyncableReason, {
      key: 'saves.n3dsNoTitleId',
      params: { emulator: 'Azahar' }
    })
  })

  test('is nowhere when the emulator’s SD card was never found', () => {
    assert.deepEqual(n3dsSavePaths(context(ncsd(ID)), null, 'Azahar'), { saves: null })
  })
})
