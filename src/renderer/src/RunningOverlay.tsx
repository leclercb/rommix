/**
 * The overlay that stands in front of everything while an emulator has the
 * screen, and the way back out of one that has not.
 *
 * Beside `App` rather than inside it because it is the one part of the shell
 * that is not navigation: nothing routes to it, it goes up when a launch starts
 * and comes down when the process ends, and it owns its own focus layer while
 * it is there.
 */

import { useEffect, useState, type JSX } from 'react'
import { ArtBackdrop, CoverArt, FocusButton, Overlay, Spinner } from './components'
import { FocusLayer, useAction, useKeyLabel } from './input/focus'
import { useApp, useI18n } from './state'

/**
 * Shown while an emulator owns the screen. RomMix is still running behind
 * gamescope, and this makes it obvious that input is going elsewhere.
 *
 * It also covers the part of a launch before there is an emulator at all —
 * installing a missing core is a download of several megabytes — because this
 * overlay goes up the moment Play is pressed and nothing behind it can be seen.
 * A screen that says "the emulator has focus" while RomMix is still fetching
 * the core is describing something that has not happened yet.
 *
 * The close button is the way back from an emulator that has hung or opened
 * off-screen: it asks the process to quit, so the session still ends normally
 * and the saves it wrote are still uploaded. It cannot be reached with the pad,
 * which the game has for the duration — holding Start is the way in, and is
 * what `useSuspendGamepad` lets through.
 */
export function RunningOverlay(): JSX.Element {
  const { t } = useI18n()
  const { runningStage, runningEmulator, runningRomId, installed } = useApp()

  // What is known about the game without asking anything: the index carries its
  // name and its cover so that the Downloads screen can draw a row without the
  // library, and that is exactly what is wanted here.
  const game = installed.find((entry) => entry.romId === runningRomId)

  /**
   * The screen between pressing Play and the emulator having drawn anything.
   *
   * It is dead time — a few seconds of nothing while a process starts, longer
   * if a core has to be fetched first — and it is also the moment RomMix is
   * most looked at, because it is the one the player is waiting through from
   * across the room. A panel of text is a poor answer to that. The game's own
   * cover is the thing they just chose, so it is what they get, at the size the
   * screen allows.
   *
   * Only where there is a cover to show. A game with no artwork falls back to
   * the panel below rather than to a large empty rectangle.
   */
  if (game?.coverPath) {
    return (
      <div className="curtain">
        <ArtBackdrop paths={[game.coverPath]} />
        <div className="curtain__stage">
          <CoverArt path={game.coverPath} name={game.name} className="curtain__cover" />
          <div className="curtain__words">
            <h2 className="curtain__title">{game.name}</h2>
            <p className="curtain__line">
              {/* What is happening, when something is: fetching a core is the
                  one part of a launch that takes long enough to need saying.
                  Otherwise the line says where the screen has gone. */}
              {runningStage ?? t('app.emulatorHasFocus')}
            </p>
          </div>
          <FocusLayer>
            <RunningActions />
          </FocusLayer>
        </div>
      </div>
    )
  }

  if (runningStage) {
    return (
      <Overlay title={t('app.gettingReady')}>
        <p className="muted">{runningStage}</p>
        <Spinner />
      </Overlay>
    )
  }

  // An emulator opened on its own has no session behind it: nothing was
  // launched, nothing will be synced, and saying either would describe
  // something that is not happening. What it shares with a game is the only
  // thing this overlay is for — something else has the screen, and here is the
  // way back.
  if (runningEmulator) {
    return (
      <Overlay title={t('app.emulatorRunning', { name: runningEmulator })}>
        {/* The name is already the title above; saying it twice in two lines
            is one line too many. What is left is the same sentence a running
            game gets, which is the only thing the two situations share. */}
        <p className="muted">{t('app.emulatorHasFocus')}</p>
        <RunningActions />
      </Overlay>
    )
  }

  return (
    <Overlay title={t('app.gameRunning')}>
      <p className="muted">{t('app.emulatorHasFocus')}</p>
      <RunningActions />
    </Overlay>
  )
}

/**
 * How long a polite request gets before the panel offers to force it.
 *
 * Past the five seconds `stopFlatpakApp` waits before killing a flatpak itself,
 * so that route has already finished by the time this appears. What is left is
 * an emulator RomMix signalled directly and which has not gone.
 */
const FORCE_AFTER_MS = 6000

/**
 * The way out, inside the overlay rather than beside it.
 *
 * A child component because `useAction` registers on the layer it is *called*
 * from, and `Overlay` raises the layer for its children only — called from
 * `RunningOverlay` the handler would sit on the layer below, where `fireAction`
 * never looks while the overlay is up.
 *
 * Three states, in the order they happen: offer to close, say it has been
 * asked, and — if it is still there — offer to close it outright. That last one
 * exists because asking is all RomMix could do: a SIGTERM an emulator handles
 * by opening its own dialog leaves both of us waiting, and off-screen or hung
 * that dialog is never answered.
 *
 * Start does each step in turn, because it is the only press that reaches
 * RomMix while something else has the pad.
 */
function RunningActions(): JSX.Element {
  const { t } = useI18n()
  const keyLabel = useKeyLabel()
  const [asked, setAsked] = useState(false)
  const [stuck, setStuck] = useState(false)
  const [forcing, setForcing] = useState(false)
  /** Whether it has been killed once already, which changes what is true. */
  const [forced, setForced] = useState(false)

  // Only while it is still up: the overlay unmounts when the emulator exits,
  // and the timer goes with it.
  useEffect(() => {
    if (!asked) return
    const timer = window.setTimeout(() => setStuck(true), FORCE_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [asked])

  /**
   * A force that is still not enough, said rather than left to be guessed.
   *
   * This overlay unmounts the moment the emulator goes, so anything still on
   * screen after the wait is an emulator that survived being killed. Saying so
   * is the whole of what RomMix can do at that point — but it is a great deal
   * better than a button that answers a press with nothing, which is what the
   * user reads as "it did not register" and presses again.
   */
  useEffect(() => {
    if (!forcing) return
    const timer = window.setTimeout(() => setForcing(false), FORCE_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [forcing])

  const stop = (): void => {
    setAsked(true)
    void window.rommix.running.stop()
  }
  const force = (): void => {
    setForcing(true)
    setForced(true)
    void window.rommix.running.forceStop()
  }

  // The one press that reaches RomMix while a game has the pad. Asking twice
  // does nothing — the request is already out — so it does nothing until there
  // is something else to offer.
  useAction('menu', () => {
    if (!asked) stop()
    else if (stuck && !forcing) force()
  })

  // Killing it is not instant, and it is the press most likely to be repeated:
  // there is nothing else left to try, so a second one has to be absorbed
  // rather than land on a button that is still offered.
  if (forcing) return <p className="muted">{t('app.closingEmulatorNow')}</p>

  if (asked && stuck) {
    return (
      <>
        {/* Once it has been forced and is still here, the first line is no
            longer true — it was not the asking that failed. */}
        <p className="muted">{t(forced ? 'app.couldNotClose' : 'app.notClosing')}</p>
        <p className="muted">{t('app.holdToForce', { key: keyLabel('START') })}</p>
        <div className="btn-row">
          <FocusButton icon="quit" variant="danger" onSelect={force}>
            {t('app.forceClose')}
          </FocusButton>
        </div>
      </>
    )
  }

  // Said because the request is not the outcome: an emulator is given time to
  // save, so the overlay stays up for a moment and would otherwise look like a
  // button that did nothing.
  if (asked) return <p className="muted">{t('app.askingEmulatorToQuit')}</p>

  return (
    <>
      <p className="muted">{t('app.holdToClose', { key: keyLabel('START') })}</p>
      <div className="btn-row">
        {/* Not autofocused: the pad cannot reach it while a game is running, and
            a focused danger button nothing can press only looks armed. */}
        <FocusButton icon="cancel" variant="danger" onSelect={stop}>
          {t('app.closeEmulator')}
        </FocusButton>
      </div>
    </>
  )
}
