import type { RommRom, RommUser } from '@shared/types'

/**
 * What a game's RetroAchievements amount to for the person looking at it.
 *
 * The two halves arrive from opposite directions and are joined here rather
 * than in the tab: the achievements come with the game, the ones already earned
 * come with the user, and neither knows about the other. Keeping the join in a
 * module is what lets it be tested without a screen — which matters, because
 * the ways it can be quietly wrong are all about identity rather than layout.
 */

/** One achievement as the tab draws it: what it is, and whether it is had. */
export interface AchievementRow {
  /** RetroAchievements' own id, which is what the earned list names. */
  id: string
  title: string
  description: string
  points: number
  /** The badge to draw, which is a different picture once it has been earned. */
  badge: string | null
  earned: boolean
}

/** A game's achievements, and how far through them somebody is. */
export interface AchievementProgress {
  rows: AchievementRow[]
  earned: number
  /** Points earned and points there are, in that order. */
  points: number
  totalPoints: number
}

/**
 * The game's achievements in the order RetroAchievements lists them, each
 * marked with whether this user has it.
 *
 * Null where the game has none, which is not the same as having none earned:
 * the tab is absent for a game RetroAchievements does not cover, and present
 * and empty-handed for one nobody has started.
 *
 * The user may be null — signed out, or a server that has not answered — and
 * the answer is then the list with nothing earned, rather than nothing at all.
 * What the tab is mostly for is reading what a game *has*.
 */
export function achievementsOf(rom: RommRom, user: RommUser | null): AchievementProgress | null {
  const achievements = rom.merged_ra_metadata?.achievements ?? []
  if (achievements.length === 0) return null

  /*
   * The ids this user has earned, as strings.
   *
   * RomM names an achievement with a number on the game and with a string on
   * the user's earned list — the same id in two types — so the set is built in
   * the one they have in common. A `Set<number>` here would match nothing and
   * draw every badge as locked, which reads as a player who has earned nothing
   * rather than as a comparison that never had a chance.
   *
   * The game is found by its RetroAchievements id, not RomM's: `results` is one
   * entry per RA game, and a RomM id used here matches another game's row as
   * happily as none at all.
   */
  const progress = user?.ra_progression?.results.find(
    (result) => rom.ra_id !== null && result.rom_ra_id === rom.ra_id
  )
  const earned = new Set((progress?.earned_achievements ?? []).map((one) => String(one.id)))

  const rows = [...achievements]
    // RetroAchievements orders a set so that it reads as a walkthrough of the
    // game. Sorted rather than trusted to arrive that way, and stable where a
    // scraped row has no order at all.
    .sort((left, right) => (left.display_order ?? 0) - (right.display_order ?? 0))
    .map((achievement): AchievementRow => {
      const id = String(achievement.ra_id ?? '')
      const has = id !== '' && earned.has(id)
      return {
        id,
        title: achievement.title ?? '',
        description: achievement.description ?? '',
        points: achievement.points ?? 0,
        badge: (has ? achievement.badge_path : achievement.badge_path_lock) ?? null,
        earned: has
      }
    })

  return {
    rows,
    earned: rows.filter((row) => row.earned).length,
    points: rows.reduce((sum, row) => sum + (row.earned ? row.points : 0), 0),
    totalPoints: rows.reduce((sum, row) => sum + row.points, 0)
  }
}
