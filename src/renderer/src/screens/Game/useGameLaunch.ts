import { useEffect, useState } from 'react'
import { emulatorById } from '@config/emulators'
import type { InstalledRom, LaunchChoice, SavePushPreview } from '@shared/types'
import { useApp, useI18n } from '../../state'
import type { ToastSubject } from '../../state'

/**
 * Starting the game, and the two questions that have to be settled first.
 *
 * Which emulator, when the one in charge offers several ways to run the system:
 * EmuDeck ships three Saturn cores and four Switch emulators, and picking one
 * silently is a guess whose wrong answer is a game that will not start or a save
 * written where the other emulator will never look. The answer is remembered per
 * platform, so it is asked once.
 *
 * And what that emulator still needs done by hand, which is dismissed per
 * emulator rather than per game — the steps are about setting it up once, and
 * being told again on the next Switch game is the nagging the button exists to
 * stop.
 */
export function useGameLaunch(options: {
  romId: number
  entry: InstalledRom | undefined
  subjectOf: () => ToastSubject
  /**
   * Run once the emulator has closed.
   *
   * A session is exactly what makes the saves list wrong: it writes files and
   * syncs them, so every row's state was decided before any of that happened.
   */
  afterSession: () => Promise<void>
  /** Where the session's own saves go when the user asked to see them first. */
  onPendingPush: (preview: SavePushPreview) => void
}): {
  busy: boolean
  /** The ways this game can be run, for deciding whether "Run with" is worth showing. */
  variants: LaunchChoice['options']
  /** The choice being put to the user, or null while nothing is being asked. */
  choosing: LaunchChoice | null
  setChoosing: (choice: LaunchChoice | null) => void
  startPlay: () => Promise<void>
  play: (variant?: string) => Promise<void>
  openChooser: () => Promise<void>
  /** The setup steps still outstanding for this emulator, once per emulator. */
  setupNotes: string[] | null
  dismissSetup: () => Promise<void>
} {
  const { romId, entry, subjectOf, afterSession, onPendingPush } = options
  const { t } = useI18n()
  const { notify, settings, saveSettings } = useApp()

  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState<LaunchChoice | null>(null)
  const [variants, setVariants] = useState<LaunchChoice['options']>([])
  const [setup, setSetup] = useState<{ emulatorId: string; notes: string[] } | null>(null)

  // Read out before the effect, so what it depends on and what it closes over
  // are the same three values. Depending on `entry?.emulatorId` while using
  // `entry` is the shape that goes wrong quietly: the entry can be replaced by
  // one the effect never re-runs for.
  const installedFor = entry ? `${entry.emulatorId}:${entry.system}` : null
  useEffect(() => {
    if (installedFor === null) {
      setVariants([])
      setSetup(null)
      return
    }
    void window.rommix.game
      .variants(romId)
      .then((choice) => {
        setVariants(choice.options)
        setSetup({ emulatorId: choice.emulatorId, notes: choice.setupNotes })
      })
      .catch(() => {
        setVariants([])
        setSetup(null)
      })
  }, [romId, installedFor])

  const noticeKey = setup ? `setup:${setup.emulatorId}` : null
  const dismissed = !noticeKey || (settings?.dismissedNotices ?? []).includes(noticeKey)

  const dismissSetup = async (): Promise<void> => {
    if (!setup || !noticeKey || dismissed) return
    await saveSettings({
      dismissedNotices: [...(settings?.dismissedNotices ?? []), noticeKey]
    })
    // The notice vanishing is ambiguous on its own — dismissed, or scrolled
    // past? — and it is dismissed for the *emulator*, which is wider than the
    // game it was dismissed from and worth saying out loud.
    notify(
      t('setup.hidden', {
        emulator: emulatorById(setup.emulatorId)?.name ?? setup.emulatorId
      })
    )
  }

  const play = async (variant?: string): Promise<void> => {
    setChoosing(null)
    setBusy(true)
    try {
      const result = await window.rommix.game.launch(romId, variant)
      const subject = subjectOf()
      if (!result.ok) {
        notify(result.error ?? t('game.couldNotStart'), 'error', subject)
      } else {
        const synced = result.uploadedSaves + result.uploadedStates
        const waiting = result.pendingPush?.files.length ?? 0
        notify(
          waiting > 0
            ? t('game.sessionPending', { count: waiting })
            : synced > 0
              ? t('game.sessionSent', { count: synced })
              : t('game.sessionEnded'),
          result.error ? 'warn' : 'ok',
          subject
        )
        if (result.error) notify(result.error, 'warn')

        // The session's saves, held back for the same question the button
        // asks. Raised here rather than by the main process because this is
        // the side that has a screen, and the emulator has just closed over
        // it — there is no better moment to ask. The toast above says the same
        // thing, which is what the user sees if they left this screen while
        // the game was running and the dialog goes up behind them.
        if (result.pendingPush) onPendingPush(result.pendingPush)
      }
    } catch {
      // Reported centrally.
    } finally {
      await afterSession()
      setBusy(false)
    }
  }

  const startPlay = async (): Promise<void> => {
    setBusy(true)
    try {
      const choice = await window.rommix.game.variants(romId)
      if (choice.options.length > 1 && !choice.chosen) {
        setChoosing(choice)
        return
      }
      await play(choice.chosen ?? undefined)
    } catch {
      // Reported centrally.
    } finally {
      setBusy(false)
    }
  }

  /** Re-open the picker for a platform that has already been answered. */
  const openChooser = async (): Promise<void> => {
    try {
      setChoosing(await window.rommix.game.variants(romId))
    } catch {
      // Reported centrally.
    }
  }

  return {
    busy,
    variants,
    choosing,
    setChoosing,
    startPlay,
    play,
    openChooser,
    setupNotes: setup && !dismissed && setup.notes.length > 0 ? setup.notes : null,
    dismissSetup
  }
}
