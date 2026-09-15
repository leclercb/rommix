import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RommRaAchievement, RommRom, RommUser } from '@shared/types'
import { achievementsOf } from './achievements.ts'

/**
 * Joining a game's achievements to what one user has earned.
 *
 * Every way this goes wrong draws the same screen: a full set of locked
 * badges, which is also what an honest answer looks like for somebody who has
 * just started. So none of it can be seen by looking, and all of it is about
 * identity — the id RomM names an achievement with on the game is a number and
 * the one it names on the user's earned list is a string, and the game is found
 * in that list by its RetroAchievements id rather than by RomM's.
 */

function achievement(fields: Partial<RommRaAchievement>): RommRaAchievement {
  return {
    ra_id: 1,
    title: 'Got there',
    description: 'Reached the end of the first stage',
    points: 5,
    badge_path: '/badges/1.png',
    badge_path_lock: '/badges/1-lock.png',
    display_order: 0,
    ...fields
  }
}

function rom(achievements: RommRaAchievement[], raId: number | null = 900): RommRom {
  return {
    id: 7,
    ra_id: raId,
    merged_ra_metadata: achievements.length > 0 ? { achievements } : null
  } as unknown as RommRom
}

/** A user who has earned those achievements of that game. */
function user(gameRaId: number | null, earned: string[]): RommUser {
  return {
    id: 1,
    ra_username: 'somebody',
    ra_progression: {
      total: 1,
      results: [
        {
          rom_ra_id: gameRaId,
          max_possible: 10,
          num_awarded: earned.length,
          num_awarded_hardcore: 0,
          earned_achievements: earned.map((id) => ({
            id,
            date: '2026-01-01 12:00:00',
            date_hardcore: ''
          }))
        }
      ]
    }
  } as unknown as RommUser
}

describe('a game with achievements', () => {
  test('marks the ones this user has, across the two types RomM names them in', () => {
    const game = rom([achievement({ ra_id: 11 }), achievement({ ra_id: 12, display_order: 1 })])
    const progress = achievementsOf(game, user(900, ['11']))

    assert.ok(progress)
    assert.deepEqual(
      progress.rows.map((row) => row.earned),
      [true, false],
      'the earned list names its ids as strings and the game as numbers'
    )
    assert.equal(progress.earned, 1)
  })

  test('draws the badge that says which of the two it is', () => {
    const game = rom([achievement({ ra_id: 11 })])

    assert.equal(achievementsOf(game, user(900, ['11']))?.rows[0].badge, '/badges/1.png')
    assert.equal(achievementsOf(game, user(900, []))?.rows[0].badge, '/badges/1-lock.png')
  })

  test('adds up the points earned against the points there are', () => {
    const game = rom([
      achievement({ ra_id: 11, points: 5 }),
      achievement({ ra_id: 12, points: 25, display_order: 1 })
    ])
    const progress = achievementsOf(game, user(900, ['12']))

    assert.equal(progress?.points, 25)
    assert.equal(progress?.totalPoints, 30)
  })

  test('lists them in the order the set is meant to be played', () => {
    const game = rom([
      achievement({ ra_id: 11, title: 'Last', display_order: 9 }),
      achievement({ ra_id: 12, title: 'First', display_order: 1 })
    ])

    assert.deepEqual(
      achievementsOf(game, user(900, []))?.rows.map((row) => row.title),
      ['First', 'Last']
    )
  })

  test('and is read as a set nobody has started where the user is not there', () => {
    // Signed out, or a server that has not answered yet. The game's own list is
    // still worth drawing: most of what this tab is for is what a game has.
    const progress = achievementsOf(rom([achievement({ ra_id: 11 })]), null)

    assert.equal(progress?.rows.length, 1)
    assert.equal(progress?.earned, 0)
  })
})

describe('what does not become a tab', () => {
  test('a game RetroAchievements does not cover', () => {
    assert.equal(achievementsOf(rom([]), user(900, [])), null)
  })

  test('and a progression belonging to another game earns nothing here', () => {
    // `results` is one row per game, keyed by RetroAchievements' id for it. A
    // game matched against RomM's own id instead would take another game's
    // earned list as its own, which is the one failure that invents progress
    // rather than losing it.
    const game = rom([achievement({ ra_id: 11 })], 900)

    assert.equal(achievementsOf(game, user(901, ['11']))?.earned, 0)
  })

  test('nor does a game with no RetroAchievements id of its own', () => {
    const game = rom([achievement({ ra_id: 11 })], null)

    assert.equal(achievementsOf(game, user(900, ['11']))?.earned, 0)
  })
})
