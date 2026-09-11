import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { InstalledRom, RommRom } from '@shared/types'
import { romToOpen, tileFromInstalled, tileFromRom, tileInstalled } from './tiles.ts'

/**
 * Which game is behind a cover.
 *
 * A tile can stand for several dumps of one game, and two questions are asked
 * of it on every grid: is this downloaded, and what does pressing it open. They
 * are answered by different functions, and a grid where they disagree marks a
 * game as on the disk and then opens the copy that is not — a Play button that
 * offers to download.
 *
 * Pure both, which is why they are in `tiles.ts` rather than beside the markup
 * that draws them.
 */

function rom(id: number, siblings: number[] = []): RommRom {
  return {
    id,
    name: `Game ${id}`,
    fs_name: `Game ${id}.md`,
    path_cover_small: `/cover/${id}.webp`,
    path_cover_large: null,
    platform_display_name: 'Sega Mega Drive',
    platform_slug: 'genesis-slash-megadrive',
    sibling_roms: siblings.map((sibling) => ({ id: sibling }))
  } as unknown as RommRom
}

describe('a tile that stands for several dumps', () => {
  test('carries its siblings only where the list was asked for grouped', () => {
    /**
     * A row carries its siblings either way, so this is not a question the row
     * can answer. On an ungrouped shelf every version is a tile of its own, and
     * one of them claiming to stand for the pair would be two tiles claiming
     * it.
     */
    assert.deepEqual(tileFromRom(rom(1, [2, 3]), true).group, [1, 2, 3])
    assert.equal(tileFromRom(rom(1, [2, 3])).group, undefined)
  })

  test('and never counts itself twice', () => {
    // Whether RomM counts a row among its own siblings is RomM's business. The
    // number is drawn on the tile, so counting it twice is visible.
    assert.deepEqual(tileFromRom(rom(1, [1, 2]), true).group, [1, 2])
  })

  test('a game with no siblings stands only for itself', () => {
    // One member is not a group: it would put a "2 versions" badge on a game
    // that has one.
    assert.equal(tileFromRom(rom(1), true).group, undefined)
  })

  test('the one it is named after comes first', () => {
    // Which is what makes the server's own pick the fallback below.
    assert.equal(tileFromRom(rom(7, [2, 3]), true).group?.[0], 7)
  })
})

describe('what a press opens', () => {
  test('the copy on this disk, where the group has one', () => {
    // That is the version that plays without downloading anything and the one
    // whose saves are on this machine.
    const tile = tileFromRom(rom(1, [2, 3]), true)
    assert.equal(romToOpen(tile, new Set([3])), 3)
  })

  test('the server’s own pick where none of them is downloaded', () => {
    const tile = tileFromRom(rom(1, [2, 3]), true)
    assert.equal(romToOpen(tile, new Set()), 1)
  })

  test('and the tile itself where it stands for nothing else', () => {
    assert.equal(romToOpen(tileFromRom(rom(1)), new Set([9])), 1)
  })
})

describe('the rule the two have to agree on', () => {
  /**
   * Marked downloaded means pressing it opens something downloaded.
   *
   * The failure this guards is not a crash: the tile draws its downloaded mark
   * from one function and opens what the other returns, so a disagreement is a
   * game that says Play and then offers to download. Asserted over every shape
   * of group and every shape of what is on the disk rather than by example,
   * because the two are written apart and only ever meet on screen.
   */
  const shapes: { group: number[]; installed: number[] }[] = []
  for (const group of [[1], [1, 2], [1, 2, 3]]) {
    for (const installed of [[], [1], [2], [3], [2, 3], [1, 2, 3], [9]]) {
      shapes.push({ group, installed })
    }
  }

  test('a tile is downloaded exactly when the press lands on a downloaded copy', () => {
    for (const { group, installed } of shapes) {
      const [first, ...siblings] = group
      const tile = tileFromRom(rom(first, siblings), group.length > 1)
      const ids = new Set(installed)

      assert.equal(
        tileInstalled(tile, ids),
        ids.has(romToOpen(tile, ids)),
        `group ${group.join()} against installed ${installed.join() || 'nothing'}`
      )
    }
  })
})

describe('a tile built from the download index instead', () => {
  const entry = (over: Partial<InstalledRom> = {}): InstalledRom =>
    ({
      romId: 4,
      name: 'Sonic the Hedgehog',
      path: '/roms/megadrive/Sonic the Hedgehog (USA).md',
      coverPath: '/cover/4.webp',
      platformName: 'Sega Mega Drive',
      system: 'genesis',
      ...over
    }) as InstalledRom

  test('falls back to the file name where the index recorded no title', () => {
    // A game adopted off the disk has a file and nothing else; the name of the
    // file is the only thing there is to call it — extension and all, that
    // being what is actually on the disk rather than a guess at what it would
    // have been called.
    assert.equal(tileFromInstalled(entry({ name: '' })).title, 'Sonic the Hedgehog (USA).md')
    assert.equal(tileFromInstalled(entry()).title, 'Sonic the Hedgehog')
  })

  test('and stands for itself alone, whatever the server groups it under', () => {
    // The index is one row per copy on this disk. Grouping is a question about
    // the server's library, and this shelf is not drawn from it.
    assert.equal(tileFromInstalled(entry()).group, undefined)
    assert.equal(romToOpen(tileFromInstalled(entry()), new Set([4])), 4)
  })

  test('the ES-DE system stands in for the platform slug the index has not got', () => {
    // The icon lookup falls back to it happily; a blank slug would draw none.
    const tile = tileFromInstalled(entry())
    assert.equal(tile.platformSlug, 'genesis')
    assert.equal(tile.system, 'genesis')
  })
})
