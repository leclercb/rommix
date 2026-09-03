import { useEffect, useState } from 'react'
import type { RomUserStatus } from '@shared/types'
import { useApp, useI18n } from '../../state'
import type { ToastSubject } from '../../state'

/**
 * The two marks this screen puts on the game itself rather than on the copy of
 * it that happens to be on this disk.
 *
 * Both live on RomM, which is the whole point of them: a game favourited or
 * marked finished from the sofa says the same thing in a browser and on the
 * handheld. And both are shown as set before the server has agreed — the round
 * trip is a collection edit that takes a moment, and a control that does
 * nothing for that long reads as one that missed the press. A refusal puts the
 * previous answer back, and `app:error` has already said why.
 */
export function useGameMarks(
  romId: number,
  subjectOf: () => ToastSubject
): {
  /** Null until RomM has been asked, which is what the button waits on. */
  favourite: boolean | null
  toggleFavourite: () => Promise<void>
  status: RomUserStatus | null
  /**
   * The status the fetched ROM arrived carrying.
   *
   * Handed in rather than fetched here: the screen is already asking for the
   * ROM, and the overlay it belongs to comes back on that same response. Asking
   * again would be a second round trip for something already in hand.
   */
  setStatus: (status: RomUserStatus | null) => void
  chooseStatus: (next: RomUserStatus | null) => Promise<void>
} {
  const { t } = useI18n()
  const { notify, offline } = useApp()
  const [favourite, setFavourite] = useState<boolean | null>(null)
  const [status, setStatus] = useState<RomUserStatus | null>(null)

  useEffect(() => {
    setFavourite(null)
    // Not asked at all while the server is away: the screen hides both marks
    // there, and every failed call raises a notification of its own, so asking
    // anyway would greet a game opened offline with an error about a button
    // that is not on it. Nor before the first answer, which is the same call
    // made a moment earlier. See `AppState.offline`.
    if (offline !== false) return
    void window.rommix.library
      .favourite(romId)
      .then(setFavourite)
      // Asked for a button, not for the screen: a server that will not answer
      // leaves the button waiting rather than putting an error over the game.
      .catch(() => setFavourite(null))
  }, [romId, offline])

  const toggleFavourite = async (): Promise<void> => {
    if (favourite === null) return
    const next = !favourite
    setFavourite(next)
    try {
      const settled = await window.rommix.library.setFavourite(romId, next)
      setFavourite(settled)
      // Said because the change is on the *server*: the filled heart only
      // proves the button was pressed, and this is the confirmation that RomM
      // and the Favourites shelf now agree with it.
      notify(settled ? t('game.favouriteAdded') : t('game.favouriteRemoved'), 'ok', subjectOf())
    } catch {
      setFavourite(!next)
    }
  }

  const chooseStatus = async (next: RomUserStatus | null): Promise<void> => {
    const previous = status
    if (next === previous) return
    setStatus(next)
    try {
      await window.rommix.library.setStatus(romId, next)
      // Said because the change is on the server, not here: this is what
      // confirms a browser and another device now agree.
      notify(
        next ? t('status.set', { status: t(`status.${next}`) }) : t('status.cleared'),
        'ok',
        subjectOf()
      )
    } catch {
      setStatus(previous)
    }
  }

  return { favourite, toggleFavourite, status, setStatus, chooseStatus }
}
