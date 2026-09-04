import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BACKUP_COPIES, cpDirectory, keepBackup, sizeOf, stampMtime, walk } from './savefiles.ts'

/**
 * The disk half of save sync: what is under a save folder, how big it is, and
 * the copy taken before anything is overwritten.
 *
 * The matching rules these sit beside — which save belongs to which ROM, which
 * emulator may load it, which end is ahead — are `saves.test.ts`. What is here
 * is everything that touches a real tree, tested against one, because the cases
 * that matter are the ones a filesystem produces: a folder that is not there, a
 * save that is a directory of memory cards rather than a file, a copy that has
 * to reach the bottom of a nested tree.
 */

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'rommix-savefiles-test-'))
  scratches.push(root)
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }
  return root
}

describe('walking a save folder', () => {
  test('every file comes back, however deeply it is filed', async () => {
    const root = tree({
      'game.srm': 'x',
      'states/game.state1': 'x',
      'memcards/slot1/card.mcd': 'x'
    })

    const found = await walk(root)

    assert.deepEqual(found.map((path) => path.slice(root.length + 1)).sort(), [
      'game.srm',
      'memcards/slot1/card.mcd',
      'states/game.state1'
    ])
  })

  test('a folder that is not there is nothing, not a failure', async () => {
    assert.deepEqual(await walk(join(tree({}), 'never-created')), [])
  })

  test('a tree deeper than the walk goes is cut off rather than followed forever', async () => {
    const deep = 'a/b/c/d/e/f/g/h/save.srm'
    const root = tree({ 'shallow.srm': 'x', [deep]: 'x' })

    const found = await walk(root)

    assert.ok(found.some((path) => path.endsWith('shallow.srm')))
    assert.equal(
      found.some((path) => path.endsWith('save.srm')),
      false
    )
  })
})

describe('measuring what is about to be uploaded', () => {
  test('a file is its own size', async () => {
    const root = tree({ 'game.srm': '01234' })

    assert.equal(await sizeOf(join(root, 'game.srm'), false), 5)
  })

  test('a directory save is everything inside it, because that is what is sent', async () => {
    const root = tree({ 'cards/slot1.mcd': '01234', 'cards/slot2.mcd': '567' })

    assert.equal(await sizeOf(join(root, 'cards'), true), 8)
  })

  test('a path that cannot be read is zero rather than a failed dialog', async () => {
    assert.equal(await sizeOf(join(tree({}), 'gone.srm'), false), 0)
  })
})

describe('dating a file that was just pulled', () => {
  test('it takes the time the server copy was written, not the time it arrived', async () => {
    const root = tree({ 'game.srm': 'x' })
    const path = join(root, 'game.srm')
    const when = Date.parse('2026-01-02T03:04:05.000Z')

    await stampMtime(path, when)

    assert.equal(Math.round(statSync(path).mtimeMs), when)
  })

  test('a file that has gone is not worth failing a pull over', async () => {
    await stampMtime(join(tree({}), 'gone.srm'), Date.now())
  })
})

describe('backing up a directory save', () => {
  test('the whole tree is copied, contents and all', async () => {
    const root = tree({ 'cards/slot1.mcd': 'one', 'cards/nested/slot2.mcd': 'two' })

    await cpDirectory(join(root, 'cards'), join(root, 'backup'))

    assert.equal(readFileSync(join(root, 'backup/slot1.mcd'), 'utf8'), 'one')
    assert.equal(readFileSync(join(root, 'backup/nested/slot2.mcd'), 'utf8'), 'two')
  })

  test('nothing to copy leaves nothing behind, and does not throw', async () => {
    const root = tree({})

    await cpDirectory(join(root, 'missing'), join(root, 'backup'))

    assert.deepEqual(await walk(join(root, 'backup')), [])
  })
})

describe('keeping copies of a save a pull is about to overwrite', () => {
  test('the copy taken now is the first slot, and the older ones move down', async () => {
    const root = tree({ 'game.srm': 'first' })
    const path = join(root, 'game.srm')
    const into = join(root, 'kept')

    for (const contents of ['second', 'third', 'fourth']) {
      await keepBackup(path, into)
      writeFileSync(path, contents)
    }

    assert.equal(readFileSync(join(into, 'game.srm.1'), 'utf8'), 'third')
    assert.equal(readFileSync(join(into, 'game.srm.2'), 'utf8'), 'second')
    assert.equal(readFileSync(join(into, 'game.srm.3'), 'utf8'), 'first')
  })

  test('the copies are kept away from the folder the emulator reads', async () => {
    const root = tree({ 'saves/game.srm': 'played' })
    const into = join(root, 'kept')

    await keepBackup(join(root, 'saves/game.srm'), into)

    assert.deepEqual(await walk(join(root, 'saves')), [join(root, 'saves/game.srm')])
  })

  test('the oldest falls off the end rather than the folder filling up', async () => {
    const root = tree({ 'game.srm': '0' })
    const path = join(root, 'game.srm')
    const into = join(root, 'kept')

    for (let pull = 1; pull <= BACKUP_COPIES + 3; pull += 1) {
      await keepBackup(path, into)
      writeFileSync(path, String(pull))
    }

    assert.equal((await walk(into)).length, BACKUP_COPIES)
    assert.equal(existsSync(join(into, `game.srm.${BACKUP_COPIES + 1}`)), false)
  })

  test('a directory save is copied whole, tree and all', async () => {
    const root = tree({ 'cards/slot1.mcd': 'one', 'cards/nested/slot2.mcd': 'two' })
    const into = join(root, 'kept')

    await keepBackup(join(root, 'cards'), into, true)

    assert.equal(readFileSync(join(into, 'cards.1/slot1.mcd'), 'utf8'), 'one')
    assert.equal(readFileSync(join(into, 'cards.1/nested/slot2.mcd'), 'utf8'), 'two')
  })

  test('the single copy an older RomMix left beside the save joins the chain', async () => {
    const root = tree({ 'game.srm': 'now', 'game.srm.rommix-bak': 'from before' })
    const path = join(root, 'game.srm')
    const into = join(root, 'kept')

    await keepBackup(path, into)

    assert.equal(existsSync(`${path}.rommix-bak`), false)
    assert.equal(readFileSync(join(into, 'game.srm.1'), 'utf8'), 'now')
    assert.equal(readFileSync(join(into, 'game.srm.2'), 'utf8'), 'from before')
  })

  test('a copy is dated as the save it was taken from, not as the pull', async () => {
    const root = tree({ 'game.srm': 'played', 'cards/slot1.mcd': 'played' })
    const into = join(root, 'kept')
    const played = Date.parse('2026-03-04T05:06:07.000Z')
    await stampMtime(join(root, 'game.srm'), played)
    await stampMtime(join(root, 'cards/slot1.mcd'), played)

    await keepBackup(join(root, 'game.srm'), into)
    await keepBackup(join(root, 'cards'), into, true)

    assert.equal(Math.round(statSync(join(into, 'game.srm.1')).mtimeMs), played)
    assert.equal(Math.round(statSync(join(into, 'cards.1/slot1.mcd')).mtimeMs), played)
  })

  test('a save that is not there is not worth failing a pull over', async () => {
    const root = tree({})

    await keepBackup(join(root, 'gone.srm'), join(root, 'kept'))
  })
})
