import { useEffect, useRef, useState } from 'react'
import type { RommPlayer, RommPlayers } from '@shared/types'

const NONE: RommPlayers = { browser: false, stream: false }

/**
 * Playing the game on RomM rather than here: its in-browser player, or a
 * stream from an emulator the server runs. Neither needs the game on this disk
 * or an emulator installed, which is what makes them worth a button.
 *
 * Asked again when the connection comes back, since a server that was away
 * answered nothing.
 */
export function useRommPlayers(options: {
  romId: number
  /** The game's platform on RomM, once the game has arrived. */
  platformSlug: string | null
  offline: boolean | null
  /** Run once the player has been closed. See `useGameLaunch`. */
  afterSession: () => Promise<void>
}): {
  players: RommPlayers
  busy: boolean
  playOnRomm: (player: RommPlayer) => Promise<void>
} {
  const { romId, platformSlug, offline, afterSession } = options
  const [players, setPlayers] = useState<RommPlayers>(NONE)
  const [busy, setBusy] = useState(false)

  /** Which request the answer on screen belongs to. See `Game`'s own guard. */
  const run = useRef(0)
  useEffect(() => {
    const mine = (run.current += 1)
    setPlayers(NONE)
    if (offline || platformSlug === null) return
    void window.rommix.game
      .rommPlayers(platformSlug)
      .then((next) => {
        if (run.current === mine) setPlayers(next)
      })
      .catch(() => {
        // Reported centrally; nothing is offered.
      })
  }, [platformSlug, offline])

  const playOnRomm = async (player: RommPlayer): Promise<void> => {
    setBusy(true)
    try {
      await window.rommix.game.playOnRomm(romId, player)
    } catch {
      // Reported centrally.
    } finally {
      await afterSession()
      setBusy(false)
    }
  }

  return { players, busy, playOnRomm }
}
