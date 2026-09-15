import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RommRom, RommUser } from '@shared/types'
import { shouldRefreshAchievements } from './retroachievements.ts'

/**
 * Whether the end of a session is worth a request.
 *
 * The cost of getting this wrong is invisible either way — a request nobody
 * sees, or a screen that stays one session out of date — so it is stated here
 * rather than left to read off the call site.
 */

const rom = (achievements: number): RommRom =>
  ({
    id: 1,
    merged_ra_metadata:
      achievements > 0 ? { achievements: Array.from({ length: achievements }, () => ({})) } : null
  }) as unknown as RommRom

const user = (raName: string | null): RommUser =>
  ({ id: 1, ra_username: raName }) as unknown as RommUser

test('a game with achievements, played by somebody with an account, is asked about', () => {
  assert.equal(shouldRefreshAchievements(rom(3), user('somebody')), true)
})

test('and nothing else is', () => {
  // A game RetroAchievements does not cover: there is nothing on the other end
  // to have changed.
  assert.equal(shouldRefreshAchievements(rom(0), user('somebody')), false)
  // An account with no RetroAchievements name: RomM would fetch on behalf of
  // nobody. This is most RomM accounts.
  assert.equal(shouldRefreshAchievements(rom(3), user(null)), false)
  // And a server that has not said who is signed in, which is every session
  // played offline.
  assert.equal(shouldRefreshAchievements(rom(3), null), false)
})
