import { useEffect, useRef, useState } from 'react'
import type { Action, Direction, InputKind } from './types'

/**
 * The pad, as Chromium reports it.
 *
 * The renderer is the only place gamepads are read: Chromium's Gamepad API is
 * the most dependable controller input available under both gamescope and a
 * plain desktop session, and it needs no native dependency. It is *polled*
 * rather than delivered, which is the fact the rest of this file is shaped by.
 */

/** Is a pad plugged in at all? Decides the first guess, before any input. */
export function gamepadPresent(): boolean {
  return navigator.getGamepads().some((pad) => pad !== null)
}

/**
 * What Chromium says it can see, for the pre-flight check.
 *
 * Worth reporting because a controller that does not work looks identical from
 * the couch whichever end it failed at, and this separates them: a name here
 * means the pad reached the page and the fault is in what the UI does with it;
 * nothing here means the pad never arrived at all — the usual cause being a
 * session where Chromium can open every device in /dev/input and identify
 * none of them as a gamepad, udev's database being out of reach.
 *
 * "Not seen yet" is also the honest answer before the first button press:
 * Chromium withholds pads from a page until one of them is used, so that a page
 * cannot silently fingerprint what is plugged in.
 */
export function useGamepadName(): string | null {
  const [name, setName] = useState<string | null>(null)

  useEffect(() => {
    const read = (): void => {
      const pad = navigator.getGamepads().find((entry) => entry !== null)
      const next = pad ? `${pad.id}${pad.mapping === 'standard' ? '' : ' (unmapped)'}` : null
      setName((current) => (current === next ? current : next))
    }
    read()
    // Polled rather than driven by `gamepadconnected`, which fires once and
    // says nothing about a pad already connected when this screen opened.
    const timer = window.setInterval(read, 1000)
    return () => window.clearInterval(timer)
  }, [])

  return name
}

/** Standard-mapping button indices. */
const BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  START: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15
} as const

/**
 * The same pad when Chromium has no mapping for it — `pad.mapping` is `''`.
 *
 * Chromium remaps a controller to the standard layout only when it recognises
 * the vendor and product id, from a table it keeps per platform. An Xbox pad on
 * the end of a USB cable is in that table; the same pad over Bluetooth through
 * xpadneo, a third-party clone, or anything the kernel presents under a name
 * upstream has not seen, is not — and then the buttons arrive in the order the
 * Linux joystick driver reports them instead.
 *
 * Which is nearly the standard order: A/B/X/Y and the shoulders land in the
 * same places, so only two things need saying here. Start is button 7 rather
 * than 9, and the d-pad is not a set of buttons at all but a hat reported as a
 * pair of axes. Neither exists in a standard-mapped pad — where axes 6 and 7
 * are absent and button 7 is the right trigger — so both are read only when
 * there is no mapping, and holding RT never opens the menu.
 */
const UNMAPPED = { START: 7, HAT_X: 6, HAT_Y: 7 } as const

const AXIS_DEADZONE = 0.55
/** Delay before a held direction starts repeating, then the repeat period. */
const REPEAT_DELAY_MS = 400
const REPEAT_INTERVAL_MS = 90

/**
 * How long Start must be held to reach RomMix while an emulator has the screen.
 *
 * Long enough that no game's own use of Start can trip it, short enough to be
 * an obvious deliberate act when the emulator has hung and this is the only way
 * out. The game sees the press either way — it will open its own pause menu, and
 * that is fine.
 */
const SUSPENDED_HOLD_MS = 1500

export function useGamepad(
  move: (direction: Direction) => void,
  fireAction: (action: Action) => void,
  activate: () => void,
  noteInput: (kind: InputKind) => void,
  suspended: boolean
): void {
  const moveRef = useRef(move)
  const actionRef = useRef(fireAction)
  const activateRef = useRef(activate)
  const noteRef = useRef(noteInput)
  // Read inside the poll rather than closed over: the loop is started once and
  // must not be torn down and rebuilt every time a game starts or stops.
  const suspendedRef = useRef(suspended)
  moveRef.current = move
  actionRef.current = fireAction
  activateRef.current = activate
  noteRef.current = noteInput
  suspendedRef.current = suspended

  useEffect(() => {
    let frame = 0
    // Per-control state so a held stick repeats but a tap fires once.
    const held = new Map<string, { since: number; last: number }>()
    /** When Start went down while suspended, and whether the hold has fired. */
    let holdSince: number | null = null
    let holdFired = false

    const edge = (key: string, pressed: boolean, rawFire: () => void, repeats: boolean): void => {
      // Reported here rather than at each call site: every path that reaches a
      // fire is a button someone pressed, and the poll runs sixty times a
      // second whether or not anything is held.
      const fire = (): void => {
        noteRef.current('gamepad')
        rawFire()
      }
      const now = performance.now()
      const state = held.get(key)

      if (!pressed) {
        held.delete(key)
        return
      }
      if (!state) {
        held.set(key, { since: now, last: now })
        fire()
        return
      }
      if (!repeats) return
      if (now - state.since < REPEAT_DELAY_MS) return
      if (now - state.last < REPEAT_INTERVAL_MS) return
      state.last = now
      fire()
    }

    const poll = (): void => {
      for (const pad of navigator.getGamepads()) {
        if (!pad) continue

        const button = (index: number): boolean => pad.buttons[index]?.pressed ?? false
        const [axisX = 0, axisY = 0] = pad.axes

        // See UNMAPPED: on a pad Chromium could not identify, the d-pad is a
        // hat on two more axes and Start has moved.
        const mapped = pad.mapping === 'standard'
        const hatX = mapped ? 0 : (pad.axes[UNMAPPED.HAT_X] ?? 0)
        const hatY = mapped ? 0 : (pad.axes[UNMAPPED.HAT_Y] ?? 0)
        const start = button(BUTTON.START) || (!mapped && button(UNMAPPED.START))

        /**
         * An emulator owns the screen, so the pad is the emulator's.
         *
         * The Gamepad API is *polled*, not delivered: `navigator.getGamepads()`
         * reports button state whoever happens to hold window focus, so without
         * this every press meant for the game was also read here — and since the
         * running overlay autofocuses its Close button, pressing A in a game
         * quit the game.
         *
         * The one way through is Start held down, which is the way back from an
         * emulator that has hung or opened off-screen. Everything else is
         * dropped, including the held state behind it: a direction still down
         * when the game exits must not resume repeating into the library.
         */
        if (suspendedRef.current) {
          held.clear()
          if (!start) {
            holdSince = null
            holdFired = false
          } else {
            const now = performance.now()
            if (holdSince === null) holdSince = now
            else if (!holdFired && now - holdSince >= SUSPENDED_HOLD_MS) {
              holdFired = true
              noteRef.current('gamepad')
              actionRef.current('menu')
            }
          }
          break
        }
        holdSince = null
        holdFired = false

        edge(
          'up',
          button(BUTTON.DPAD_UP) || axisY < -AXIS_DEADZONE || hatY < -AXIS_DEADZONE,
          () => moveRef.current('up'),
          true
        )
        edge(
          'down',
          button(BUTTON.DPAD_DOWN) || axisY > AXIS_DEADZONE || hatY > AXIS_DEADZONE,
          () => moveRef.current('down'),
          true
        )
        edge(
          'left',
          button(BUTTON.DPAD_LEFT) || axisX < -AXIS_DEADZONE || hatX < -AXIS_DEADZONE,
          () => moveRef.current('left'),
          true
        )
        edge(
          'right',
          button(BUTTON.DPAD_RIGHT) || axisX > AXIS_DEADZONE || hatX > AXIS_DEADZONE,
          () => moveRef.current('right'),
          true
        )

        edge('a', button(BUTTON.A), () => activateRef.current(), false)
        edge('b', button(BUTTON.B), () => actionRef.current('back'), false)
        edge('x', button(BUTTON.X), () => actionRef.current('menu'), false)
        edge('y', button(BUTTON.Y), () => actionRef.current('search'), false)
        edge('lb', button(BUTTON.LB), () => actionRef.current('tabLeft'), false)
        edge('rb', button(BUTTON.RB), () => actionRef.current('tabRight'), false)
        edge('start', start, () => actionRef.current('menu'), false)

        // One connected pad drives the UI; a second would double every input.
        break
      }
      frame = requestAnimationFrame(poll)
    }

    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [])
}
