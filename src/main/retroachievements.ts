import type { RommRom, RommUser } from '@shared/types'

/**
 * When it is worth asking RomM to read RetroAchievements again.
 *
 * RomM holds the RetroAchievements key and does the fetching, on whatever
 * schedule it keeps. The one moment RomMix knows something might have changed
 * is the end of a session — the player has just been in the emulator, which is
 * the only thing that can earn an achievement — so that is where the ask goes.
 *
 * Both halves have to be true or the request is a round trip that cannot
 * change anything: a game RetroAchievements does not cover has nothing to
 * fetch, and a RomM account with no RA name against it has nobody to fetch it
 * for. Most libraries are one or the other, which is why this is asked before
 * the request rather than left to the server to answer with an empty result.
 */
export function shouldRefreshAchievements(rom: RommRom, user: RommUser | null): boolean {
  const achievements = rom.merged_ra_metadata?.achievements?.length ?? 0
  return achievements > 0 && Boolean(user?.ra_username)
}
