import type { JSX } from 'react'
import { emulatorById } from '@config/emulators'
import { SHARED_LIBRARY, type InstalledRom, type RommRom } from '@shared/types'
import { Icon } from '../../../icons'
import { useApp, useI18n } from '../../../state'
import { achievementsOf, type AchievementRow } from './achievements'

/**
 * What RetroAchievements holds for a game, and how much of it this player has.
 *
 * Read from RomM and nothing else. RomMix cannot earn an achievement — the
 * emulator is what talks to RetroAchievements, with the player's own login —
 * and it holds no RA credentials to offer anybody. What it can do is show the
 * score the server already keeps, which is the half a television is good for.
 *
 * The set is drawn whether or not the account is linked, because most of what
 * this answers is "what is there in this game"; the line at the top is what
 * changes, from a score to an explanation of why there is not one.
 */
export function AchievementsTab({
  rom,
  entry
}: {
  rom: RommRom
  /** This copy on the disk, which is what says the emulator to name. */
  entry?: InstalledRom
}): JSX.Element {
  const { t } = useI18n()
  const { status } = useApp()
  const user = status?.user ?? null
  const progress = achievementsOf(rom, user)

  /*
   * The emulator this copy was downloaded for, where there is one.
   *
   * Which emulator a platform runs on is a setting, and a game that is not on
   * the disk has not been through that question yet — so the sentence below
   * has a version that names nothing. The shared tree is the same case: a copy
   * there is held for no emulator in particular.
   *
   * Nothing here decides whether that emulator *can* do achievements. The
   * frontends in the registry are several emulators wearing one name, and
   * which of them runs a platform is not a thing a descriptor states — so what
   * is said is where achievements are earned, which is true of every one of
   * them, rather than a claim about what this one supports.
   */
  const emulator =
    entry && entry.emulatorId !== SHARED_LIBRARY ? emulatorById(entry.emulatorId)?.name : undefined

  if (!progress) return <div className="empty">{t('achievements.empty')}</div>

  return (
    <>
      <p className="muted">
        {user?.ra_username
          ? t('achievements.progress', {
              earned: progress.earned,
              total: progress.rows.length,
              points: progress.points,
              totalPoints: progress.totalPoints
            })
          : t('achievements.notLinked')}
      </p>
      {/* Under the score rather than instead of it: somebody reading this tab
          for the first time has no reason to know that RomMix is not what
          earns these, and a set that never fills is otherwise read as RomMix
          failing to notice. */}
      <p className="achievements__note">
        {emulator ? t('achievements.earnedIn', { emulator }) : t('achievements.earnedInEmulator')}
      </p>
      <ul className="achievements">
        {progress.rows.map((row) => (
          <Achievement key={row.id} row={row} />
        ))}
      </ul>
    </>
  )
}

/**
 * One achievement, with the badge RetroAchievements draws for the state it is
 * in.
 *
 * Not focusable, and deliberately: there is nothing to press. The list is read
 * rather than driven, and a page of rows that take the highlight is a page the
 * pad has to be walked all the way down to leave.
 */
function Achievement({ row }: { row: AchievementRow }): JSX.Element {
  const { t } = useI18n()
  const badge = window.rommix.system.assetUrl(row.badge)

  return (
    <li className="achievement" data-achievement={row.id} data-earned={row.earned}>
      {badge ? (
        <img className="achievement__badge" src={badge} alt="" loading="lazy" />
      ) : (
        // RomM has the achievement but not its picture, which happens while a
        // set is still being fetched. A mark of our own rather than a gap, so
        // the row keeps the shape of every other row.
        <span className="achievement__badge achievement__badge--none">
          <Icon name="achievement" size={28} />
        </span>
      )}
      <div className="achievement__text">
        <div className="achievement__title">{row.title}</div>
        <div className="achievement__description">{row.description}</div>
      </div>
      <div className="achievement__points">{t('achievements.points', { count: row.points })}</div>
    </li>
  )
}
