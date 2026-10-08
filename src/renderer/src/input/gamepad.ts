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
 * a pad missing from the list never arrived at all — the usual cause being a
 * session where Chromium can open every device in /dev/input and identify
 * none of them as a gamepad, udev's database being out of reach.
 *
 * Every pad, in slot order, since every pad drives the UI. See `readPads`.
 *
 * "Not seen yet" is also the honest answer before the first button press:
 * Chromium withholds pads from a page until one of them is used, so that a page
 * cannot silently fingerprint what is plugged in.
 */
export function useGamepadNames(): { index: number; name: string }[] {
  const [pads, setPads] = useState<{ index: number; name: string }[]>([])

  useEffect(() => {
    const read = (): void => {
      const next = navigator
        .getGamepads()
        .filter((pad): pad is Gamepad => pad !== null)
        .map((pad) => ({
          index: pad.index,
          name: `${pad.id}${pad.mapping === 'standard' ? '' : ' (unmapped)'}`
        }))
      // Read every second, so it must not re-render unless the list changed.
      setPads((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
    }
    read()
    // Polled rather than driven by `gamepadconnected`, which fires once and
    // says nothing about a pad already connected when this screen opened.
    const timer = window.setInterval(read, 1000)
    return () => window.clearInterval(timer)
  }, [])

  return pads
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

/** The controls the UI reads, before deciding what any of them means. */
type Control = Direction | 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'start'

/**
 * Every connected pad, read as one.
 *
 * All of them, because the pad in the first slot is only the one plugged in
 * first, not the one being held. Merged rather than read one after another, so
 * a control held on two pads is still one control held and fires once.
 *
 * Buttons count from every pad; axes only from the active one, the pad that
 * last had a button pressed. An axis says nothing about whether anybody is
 * holding the pad — a stick rests off centre or drifts, and on a pad Chromium
 * has no mapping for, the axes read as a hat may be something else at rest —
 * so an idle pad's axes would hold a direction down for as long as it stays
 * plugged in. For the same reason a stick moves the focus but never decides
 * which hints are shown.
 */
export interface PadsState {
  buttons: Set<Control>
  sticks: Set<Direction>
  /** `Gamepad.index` of the active pad, to hand back on the next read. */
  active: number | null
}

export function readPads(pads: readonly (Gamepad | null)[], active: number | null): PadsState {
  const buttons = new Set<Control>()
  const sticks = new Set<Direction>()

  const connected = pads.filter((pad): pad is Gamepad => pad !== null)
  const pressing = (pad: Gamepad): boolean => pad.buttons.some((button) => button.pressed)
  // The active pad keeps the role while it is in use, so two pads pressed at
  // once do not trade it back and forth every frame.
  const current = connected.find((pad) => pad.index === active)
  const next = current && pressing(current) ? current : (connected.find(pressing) ?? current)

  for (const pad of connected) {
    const button = (index: number): boolean => pad.buttons[index]?.pressed ?? false

    // See UNMAPPED: on a pad Chromium could not identify, the d-pad is a hat
    // on two more axes and Start has moved.
    const mapped = pad.mapping === 'standard'
    const axis = (index: number): number => (pad === next ? (pad.axes[index] ?? 0) : 0)
    const hatX = mapped ? 0 : axis(UNMAPPED.HAT_X)
    const hatY = mapped ? 0 : axis(UNMAPPED.HAT_Y)

    const pressed: [Control, boolean][] = [
      ['up', button(BUTTON.DPAD_UP) || hatY < -AXIS_DEADZONE],
      ['down', button(BUTTON.DPAD_DOWN) || hatY > AXIS_DEADZONE],
      ['left', button(BUTTON.DPAD_LEFT) || hatX < -AXIS_DEADZONE],
      ['right', button(BUTTON.DPAD_RIGHT) || hatX > AXIS_DEADZONE],
      ['a', button(BUTTON.A)],
      ['b', button(BUTTON.B)],
      ['x', button(BUTTON.X)],
      ['y', button(BUTTON.Y)],
      ['lb', button(BUTTON.LB)],
      ['rb', button(BUTTON.RB)],
      ['start', button(BUTTON.START) || (!mapped && button(UNMAPPED.START))]
    ]
    for (const [control, down] of pressed) if (down) buttons.add(control)

    const axisX = axis(0)
    const axisY = axis(1)
    if (axisY < -AXIS_DEADZONE) sticks.add('up')
    if (axisY > AXIS_DEADZONE) sticks.add('down')
    if (axisX < -AXIS_DEADZONE) sticks.add('left')
    if (axisX > AXIS_DEADZONE) sticks.add('right')
  }

  return { buttons, sticks, active: next?.index ?? null }
}

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
    /** The pad whose axes are read. See `readPads`. */
    let active: number | null = null

    const edge = (
      key: string,
      pressed: boolean,
      byButton: boolean,
      rawFire: () => void,
      repeats: boolean
    ): void => {
      // Reported here rather than at each call site, and only for a button: the
      // poll runs sixty times a second whether or not anything is held, and a
      // stick that moved the focus is not proof anybody is holding it. See
      // `readPads`.
      const fire = (): void => {
        if (byButton) noteRef.current('gamepad')
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
      const { buttons, sticks, active: nowActive } = readPads(navigator.getGamepads(), active)
      active = nowActive

      /**
       * An emulator owns the screen, so the pads are the emulator's.
       *
       * The Gamepad API is *polled*, not delivered: `navigator.getGamepads()`
       * reports button state whoever happens to hold window focus, so without
       * this every press meant for the game was also read here — and since the
       * running overlay autofocuses its Close button, pressing A in a game quit
       * the game.
       *
       * The one way through is Start held down, which is the way back from an
       * emulator that has hung or opened off-screen. Everything else is dropped,
       * including the held state behind it: a direction still down when the
       * game exits must not resume repeating into the library.
       */
      if (suspendedRef.current) {
        held.clear()
        if (!buttons.has('start')) {
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
        frame = requestAnimationFrame(poll)
        return
      }
      holdSince = null
      holdFired = false

      for (const direction of ['up', 'down', 'left', 'right'] as const) {
        const byButton = buttons.has(direction)
        edge(
          direction,
          byButton || sticks.has(direction),
          byButton,
          () => moveRef.current(direction),
          true
        )
      }

      const press = (control: Control, fire: () => void): void =>
        edge(control, buttons.has(control), true, fire, false)
      press('a', () => activateRef.current())
      press('b', () => actionRef.current('back'))
      press('x', () => actionRef.current('menu'))
      press('y', () => actionRef.current('search'))
      press('lb', () => actionRef.current('tabLeft'))
      press('rb', () => actionRef.current('tabRight'))
      press('start', () => actionRef.current('menu'))

      frame = requestAnimationFrame(poll)
    }

    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [])
}
