import type { JSX } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'

/**
 * Spatial focus engine for controller and keyboard navigation.
 *
 * Browsers have no notion of "the thing to the right of this thing", so we keep
 * our own registry of focusable elements and pick the next one geometrically.
 * That is what makes a grid of cover art feel like a console UI rather than a
 * web page walked with Tab.
 *
 * The renderer is the only place gamepads are read: Chromium's Gamepad API is
 * the most dependable controller input available under both gamescope and a
 * plain desktop session, and it needs no native dependency.
 */

export type Direction = 'up' | 'down' | 'left' | 'right'

/** Buttons the UI reacts to, named by intent rather than by index. */
export type Action = 'back' | 'menu' | 'search' | 'tabLeft' | 'tabRight'

interface FocusableEntry {
  id: string
  element: HTMLElement
  onSelect?: () => void
  /** Focusables in a lower layer are ignored while a higher layer exists (modals). */
  layer: number
}

interface FocusContextValue {
  register(entry: FocusableEntry): () => void
  focusedId: string | null
  setFocus(id: string): void
  move(direction: Direction): void
  activate(): void
  /** Subscribe to a non-directional action. Returns an unsubscribe function. */
  onAction(action: Action, handler: () => void, layer: number): () => void
}

const FocusContext = createContext<FocusContextValue | null>(null)

/**
 * The layer a subtree's focusables belong to.
 *
 * Lexical rather than a stack: an overlay wraps its children in the next layer
 * up, so what is behind it stops being reachable for exactly as long as it is
 * mounted. A push/pop pair would have to run in an effect, and effects run
 * child-first — the overlay's own buttons would have registered on the layer
 * below before the push ever happened.
 */
const LayerContext = createContext(0)

interface Rect {
  cx: number
  cy: number
  left: number
  right: number
  top: number
  bottom: number
}

function rectOf(element: HTMLElement): Rect {
  const r = element.getBoundingClientRect()
  return {
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2,
    left: r.left,
    right: r.right,
    top: r.top,
    bottom: r.bottom
  }
}

/**
 * Score a candidate for a directional move. Lower is better.
 *
 * The primary-axis distance dominates and the perpendicular offset is
 * penalised, so moving right prefers the nearest item on roughly the same row
 * before jumping to a closer item on another row. Candidates that do not lie in
 * the requested direction at all score Infinity.
 */
function score(from: Rect, to: Rect, direction: Direction): number {
  const dx = to.cx - from.cx
  const dy = to.cy - from.cy

  // Overlap on the cross axis means the items are visually aligned.
  const horizontalOverlap = Math.min(from.right, to.right) - Math.max(from.left, to.left)
  const verticalOverlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top)

  switch (direction) {
    case 'right':
      if (to.left < from.right - 1) return Infinity
      return dx + (verticalOverlap > 0 ? 0 : Math.abs(dy) * 3)
    case 'left':
      if (to.right > from.left + 1) return Infinity
      return -dx + (verticalOverlap > 0 ? 0 : Math.abs(dy) * 3)
    case 'down':
      if (to.top < from.bottom - 1) return Infinity
      return dy + (horizontalOverlap > 0 ? 0 : Math.abs(dx) * 3)
    case 'up':
      if (to.bottom > from.top + 1) return Infinity
      return -dy + (horizontalOverlap > 0 ? 0 : Math.abs(dx) * 3)
  }
}

export function FocusProvider({ children }: { children: ReactNode }): JSX.Element {
  const entries = useRef(new Map<string, FocusableEntry>())
  const actionHandlers = useRef(new Map<Action, { handler: () => void; layer: number }[]>())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const focusedRef = useRef<string | null>(null)
  // Highest layer with anything on it: whatever is topmost owns the input.
  const layerRef = useRef(0)
  // Where focus was on each layer, so closing an overlay puts it back rather
  // than dropping the user at the top of the page behind it.
  const restorePoints = useRef(new Map<number, string>())

  focusedRef.current = focusedId

  const visibleEntries = useCallback((): FocusableEntry[] => {
    const layer = layerRef.current
    return [...entries.current.values()].filter(
      (entry) => entry.layer === layer && entry.element.isConnected && entry.element.offsetParent !== null
    )
  }, [])

  const setFocus = useCallback((id: string): void => {
    const entry = entries.current.get(id)
    if (!entry) return
    focusedRef.current = id
    setFocusedId(id)
    entry.element.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [])

  /**
   * Recompute which layer owns the input, and make sure focus is on it.
   *
   * Called whenever a focusable comes or goes, which is the only thing that can
   * change the answer: an overlay is simply a set of focusables one layer up.
   */
  const settleLayer = useCallback((): void => {
    let top = 0
    for (const entry of entries.current.values()) top = Math.max(top, entry.layer)

    const previous = layerRef.current
    if (top !== previous) {
      if (focusedRef.current) restorePoints.current.set(previous, focusedRef.current)
      layerRef.current = top
      restorePoints.current.delete(previous > top ? previous : top)
    }

    const focused = focusedRef.current ? entries.current.get(focusedRef.current) : undefined
    if (focused?.layer === top) return

    const restored = restorePoints.current.get(top)
    if (restored && entries.current.get(restored)?.layer === top) {
      setFocus(restored)
      return
    }
    const first = visibleEntries()[0] ?? [...entries.current.values()].find((e) => e.layer === top)
    focusedRef.current = first?.id ?? null
    setFocusedId(first?.id ?? null)
  }, [setFocus, visibleEntries])

  const register = useCallback(
    (entry: FocusableEntry): (() => void) => {
      entries.current.set(entry.id, entry)
      settleLayer()
      return () => {
        entries.current.delete(entry.id)
        settleLayer()
      }
    },
    [settleLayer]
  )

  const move = useCallback(
    (direction: Direction): void => {
      const candidates = visibleEntries()
      if (candidates.length === 0) return

      const current = focusedRef.current ? entries.current.get(focusedRef.current) : undefined
      if (!current || !current.element.isConnected) {
        setFocus(candidates[0].id)
        return
      }

      const from = rectOf(current.element)
      let best: { id: string; value: number } | null = null
      for (const candidate of candidates) {
        if (candidate.id === current.id) continue
        const value = score(from, rectOf(candidate.element), direction)
        if (value === Infinity) continue
        if (!best || value < best.value) best = { id: candidate.id, value }
      }
      if (best) setFocus(best.id)
    },
    [setFocus, visibleEntries]
  )

  const activate = useCallback((): void => {
    const id = focusedRef.current
    if (!id) return
    entries.current.get(id)?.onSelect?.()
  }, [])

  const onAction = useCallback(
    (action: Action, handler: () => void, layer: number): (() => void) => {
      const list = actionHandlers.current.get(action) ?? []
      const record = { handler, layer }
      list.push(record)
      actionHandlers.current.set(action, list)
      return () => {
        const current = actionHandlers.current.get(action) ?? []
        const index = current.indexOf(record)
        if (index >= 0) current.splice(index, 1)
      }
    },
    []
  )

  /** Run the most recently registered handler on the active layer. */
  const fireAction = useCallback((action: Action): void => {
    const list = actionHandlers.current.get(action) ?? []
    const onLayer = list.filter((h) => h.layer === layerRef.current)
    const target = onLayer.length > 0 ? onLayer[onLayer.length - 1] : undefined
    target?.handler()
  }, [])

  useGamepad(move, fireAction, activate)
  useKeyboard(move, fireAction, activate)

  const value = useMemo<FocusContextValue>(
    () => ({ register, focusedId, setFocus, move, activate, onAction }),
    [register, focusedId, setFocus, move, activate, onAction]
  )

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}

export function useFocusContext(): FocusContextValue {
  const ctx = useContext(FocusContext)
  if (!ctx) throw new Error('useFocusContext must be used inside a FocusProvider')
  return ctx
}

/**
 * Put everything inside into its own focus layer, so nothing behind it can be
 * reached until it unmounts. Wrapped around a modal's contents.
 */
export function FocusLayer({ children }: { children: ReactNode }): JSX.Element {
  const layer = useContext(LayerContext)
  return <LayerContext.Provider value={layer + 1}>{children}</LayerContext.Provider>
}

let nextId = 0

interface UseFocusableResult {
  ref: RefObject<HTMLElement | null>
  focused: boolean
  /** Spread onto the element so a mouse click behaves like a controller press. */
  props: {
    'data-focused': boolean
    onMouseEnter: () => void
    onClick: () => void
    tabIndex: -1
  }
}

/**
 * Make an element focusable by the controller.
 *
 * `enabled` lets a component keep its hook order stable while opting out (a
 * disabled button, an off-screen row).
 */
export function useFocusable(options: {
  onSelect?: () => void
  enabled?: boolean
  /** Focus this element as soon as it mounts. */
  autoFocus?: boolean
}): UseFocusableResult {
  const { onSelect, enabled = true, autoFocus = false } = options
  const { register, focusedId, setFocus } = useFocusContext()
  const layer = useContext(LayerContext)
  const ref = useRef<HTMLElement | null>(null)
  const idRef = useRef<string>('')
  if (!idRef.current) idRef.current = `focusable-${nextId++}`
  const id = idRef.current

  // Keep the latest callback without re-registering on every render.
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect

  useEffect(() => {
    if (!enabled || !ref.current) return
    return register({ id, element: ref.current, onSelect: () => selectRef.current?.(), layer })
  }, [enabled, id, register, layer])

  useEffect(() => {
    if (autoFocus && enabled) setFocus(id)
  }, [autoFocus, enabled, id, setFocus])

  return {
    ref,
    focused: focusedId === id,
    props: {
      'data-focused': focusedId === id,
      onMouseEnter: () => enabled && setFocus(id),
      onClick: () => selectRef.current?.(),
      tabIndex: -1
    }
  }
}

/** Register a handler for a controller action while the component is mounted. */
export function useAction(action: Action, handler: () => void, enabled = true): void {
  const { onAction } = useFocusContext()
  const layer = useContext(LayerContext)
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled) return
    return onAction(action, () => handlerRef.current(), layer)
  }, [action, enabled, onAction, layer])
}

// ---------------------------------------------------------------------------
// Input sources
// ---------------------------------------------------------------------------

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

const AXIS_DEADZONE = 0.55
/** Delay before a held direction starts repeating, then the repeat period. */
const REPEAT_DELAY_MS = 400
const REPEAT_INTERVAL_MS = 90

function useGamepad(
  move: (direction: Direction) => void,
  fireAction: (action: Action) => void,
  activate: () => void
): void {
  const moveRef = useRef(move)
  const actionRef = useRef(fireAction)
  const activateRef = useRef(activate)
  moveRef.current = move
  actionRef.current = fireAction
  activateRef.current = activate

  useEffect(() => {
    let frame = 0
    // Per-control state so a held stick repeats but a tap fires once.
    const held = new Map<string, { since: number; last: number }>()

    const edge = (key: string, pressed: boolean, fire: () => void, repeats: boolean): void => {
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

        edge('up', button(BUTTON.DPAD_UP) || axisY < -AXIS_DEADZONE, () => moveRef.current('up'), true)
        edge('down', button(BUTTON.DPAD_DOWN) || axisY > AXIS_DEADZONE, () => moveRef.current('down'), true)
        edge('left', button(BUTTON.DPAD_LEFT) || axisX < -AXIS_DEADZONE, () => moveRef.current('left'), true)
        edge('right', button(BUTTON.DPAD_RIGHT) || axisX > AXIS_DEADZONE, () => moveRef.current('right'), true)

        edge('a', button(BUTTON.A), () => activateRef.current(), false)
        edge('b', button(BUTTON.B), () => actionRef.current('back'), false)
        edge('x', button(BUTTON.X), () => actionRef.current('menu'), false)
        edge('y', button(BUTTON.Y), () => actionRef.current('search'), false)
        edge('lb', button(BUTTON.LB), () => actionRef.current('tabLeft'), false)
        edge('rb', button(BUTTON.RB), () => actionRef.current('tabRight'), false)
        edge('start', button(BUTTON.START), () => actionRef.current('menu'), false)

        // One connected pad drives the UI; a second would double every input.
        break
      }
      frame = requestAnimationFrame(poll)
    }

    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [])
}

function useKeyboard(
  move: (direction: Direction) => void,
  fireAction: (action: Action) => void,
  activate: () => void
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Let text fields have their keys.
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (typing && event.key !== 'Escape') return

      switch (event.key) {
        case 'ArrowUp':
          move('up')
          break
        case 'ArrowDown':
          move('down')
          break
        case 'ArrowLeft':
          move('left')
          break
        case 'ArrowRight':
          move('right')
          break
        case 'Enter':
          activate()
          break
        case 'Escape':
        case 'Backspace':
          fireAction('back')
          break
        case 'Tab':
          fireAction(event.shiftKey ? 'tabLeft' : 'tabRight')
          break
        case '/':
          fireAction('search')
          break
        case 'm':
          fireAction('menu')
          break
        default:
          return
      }
      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [move, fireAction, activate])
}
