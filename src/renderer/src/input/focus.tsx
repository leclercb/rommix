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

/**
 * What the player is driving the UI with right now.
 *
 * Tracked because the hint bar has to name keys someone can actually press.
 * "Press A" is a lie on a keyboard, where A is Enter, and "Press Enter" is a
 * lie the moment a controller is picked up. Whichever device produced the last
 * input is the one being held, so that is the one the hints speak for — and it
 * switches back the instant the other is touched.
 */
export type InputKind = 'gamepad' | 'keyboard'

/** Is a pad plugged in at all? Decides the first guess, before any input. */
function gamepadPresent(): boolean {
  return navigator.getGamepads().some((pad) => pad !== null)
}

interface FocusableEntry {
  id: string
  element: HTMLElement
  onSelect?: () => void
  /** Focusables in a lower layer are ignored while a higher layer exists (modals). */
  layer: number
  /** Which region of the screen this belongs to. See `FocusZone`. */
  zone: string
}

interface FocusContextValue {
  register(entry: FocusableEntry): () => void
  focusedId: string | null
  setFocus(id: string): void
  move(direction: Direction): void
  activate(): void
  /** Subscribe to a non-directional action. Returns an unsubscribe function. */
  onAction(action: Action, handler: () => void, layer: number): () => void
  /** What the last input came from, for anything that has to name a button. */
  inputKind: InputKind
  /**
   * What pressing A would do right now, named by whatever holds focus.
   *
   * The hint bar is written per screen, so on its own it can only describe one
   * of the things A does there — "Play" stays on screen while focus sits on
   * Pull saves. This is the focused element's own answer, which is the only one
   * that is true at the moment it is read.
   */
  focusedAction: string | null
  /** Called by the focused element to say what it does. */
  reportAction(label: string | null): void
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

/**
 * The region of the screen a subtree belongs to.
 *
 * Zones are what stop the navigation bar and the page from competing. Purely
 * geometric navigation has no idea that the bar is a different *kind* of thing
 * from the page below it: a press that finds nothing in the direction it was
 * going takes whatever else lies that way, and the user is suddenly in the menu
 * without having asked to be. Which one wins depends on where the page happens
 * to have ended — that is the unpredictability.
 *
 * So a zone is left only when it has nothing further to offer in that direction,
 * and — going up or down — only once the page behind it has been scrolled to its
 * end as well. Walking up a library reaches the top of the library first, and
 * only the next press reaches the bar. That is the same contract every console
 * UI offers, and it is what makes the menu feel like somewhere you *go* rather
 * than somewhere you fall into.
 */
const ZoneContext = createContext('root')

/** Mark a subtree as one navigable region. */
export function FocusZone({ id, children }: { id: string; children: ReactNode }): JSX.Element {
  return <ZoneContext.Provider value={id}>{children}</ZoneContext.Provider>
}

interface Rect {
  cx: number
  cy: number
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Close enough to an end of the page to go all the way there.
 *
 * `scrollIntoView` moves the least it can get away with, so walking up a page
 * stops with the first row flush against the top edge and the page's own title
 * still hidden above it — the page never appears to reach the top. Focus near
 * either end therefore scrolls to that end instead of to the element, which is
 * what "up" means to someone holding the stick.
 */
const SNAP_TO_EDGE_PX = 260

/** The nearest ancestor that actually scrolls, if there is one. */
function scrollParentOf(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement
  while (node) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * Bring a newly focused element into view, snapping to the ends of the page.
 *
 * Only the focused element is measured — the registry can hold a couple of
 * thousand rows, and this runs on every press of a held direction.
 */
function revealElement(element: HTMLElement): void {
  const scroller = scrollParentOf(element)
  if (scroller) {
    // Where the element sits inside the scrolled content, not the viewport.
    const top =
      scroller.scrollTop +
      (element.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
    const bottom = top + element.offsetHeight

    if (top <= SNAP_TO_EDGE_PX) {
      scroller.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (bottom >= scroller.scrollHeight - SNAP_TO_EDGE_PX) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
      return
    }
  }
  element.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
}

/**
 * Scroll to the end of the page when there is nothing further to focus.
 *
 * A page is not only its buttons. Titles, the paragraph explaining what a
 * screen is for, the note under the last row — none of it is focusable, so
 * walking to the last item leaves the rest of the page unread and the next
 * press does nothing at all. That press means "further down"; this gives it
 * that meaning. It goes to the very end rather than by a screenful because
 * there is nothing focusable in between that could be skipped past.
 *
 * Returns false when the page is already at that end, which leaves the press
 * genuinely inert — the honest answer when there is nothing more to show.
 */
function scrollToEnd(element: HTMLElement, direction: 'up' | 'down'): boolean {
  const scroller = scrollParentOf(element)
  if (!scroller) return false

  const room =
    direction === 'up'
      ? scroller.scrollTop
      : scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
  if (room <= 1) return false

  scroller.scrollTo({ top: direction === 'up' ? 0 : scroller.scrollHeight, behavior: 'smooth' })
  return true
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
 * How much closer one candidate must be to count as genuinely nearer.
 *
 * Everything within this of the closest candidate is treated as being the same
 * distance away — one row of a grid, one line of a list — and is settled by
 * column instead. Cards in a row rarely align to the pixel once their titles
 * wrap, so the band has to be wider than that jitter and narrower than the gap
 * between two rows.
 */
const SAME_STEP_PX = 24

interface Measure {
  /** Distance to travel, edge to edge. */
  gap: number
  /** How far out of the line of travel, 0 when the line passes through it. */
  cross: number
}

/**
 * Measure a candidate for a directional move, or null when it does not lie in
 * that direction at all.
 *
 * Both terms are edge-to-edge rather than centre-to-centre. Centres make an
 * element's *size* count as distance: a tall row directly below would lose to a
 * short one further away but nearer the middle.
 *
 * The two are deliberately *not* combined into one number. Weighing distance
 * against alignment lets a well-aligned element two rows down beat the row
 * immediately below — which is how a press ends up skipping something the user
 * can plainly see. Distance decides; alignment only settles candidates that are
 * the same distance away.
 */
function measure(from: Rect, to: Rect, direction: Direction, anchor: number): Measure | null {
  const vertical = direction === 'down' || direction === 'up'

  /**
   * One of these sits inside the other: a row that is itself selectable, and
   * the Cancel or Uninstall button drawn within it.
   *
   * Edge-to-edge measurement cannot see these at all — a button inside a row
   * has a negative gap in all four directions, so it is rejected as "not that
   * way" from every side and simply cannot be reached. They are related by
   * containment rather than by distance, so the comparison is between centres.
   *
   * Deliberately sideways only. Letting Down step into a row's own buttons
   * would put one or two extra stops inside every row of a list that can run to
   * thousands, when the point of walking down is to pass them. Right reaches
   * the actions, Left comes back out, Down carries on to the next row.
   */
  const inside = (outer: Rect, inner: Rect): boolean =>
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom

  if (inside(from, to) || inside(to, from)) {
    if (vertical) return null
    const towards = direction === 'right' ? to.cx > from.cx : to.cx < from.cx
    return towards ? { gap: 0, cross: 0 } : null
  }

  const gap =
    direction === 'down'
      ? to.top - from.bottom
      : direction === 'up'
        ? from.top - to.bottom
        : direction === 'right'
          ? to.left - from.right
          : from.left - to.right

  // A one-pixel tolerance: adjacent rows often share a boundary exactly.
  if (gap < -1) return null

  const cross = vertical
    ? Math.max(0, to.left - anchor, anchor - to.right)
    : Math.max(0, to.top - anchor, anchor - to.bottom)

  return { gap: Math.max(gap, 0), cross }
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
  /**
   * The column a vertical run is travelling down, in viewport pixels.
   *
   * Held for as long as the run lasts so that a wide button between two rows of
   * cards does not become a funnel: without it, going down onto the button and
   * back up returns to whatever card is nearest the button's centre rather than
   * the one that was left. Cleared by any horizontal move, and by focus landing
   * somewhere for a reason other than travel — a click, an autofocus, an
   * overlay closing — because none of those continue a run.
   */
  const anchor = useRef<number | null>(null)
  /**
   * Where focus last was in each zone, so crossing back into one returns to
   * what you were doing there rather than to whatever is level with you.
   */
  const zoneMemory = useRef(new Map<string, string>())
  /** The zone focus is in, kept where a removed element cannot take it away. */
  const lastZone = useRef('root')

  focusedRef.current = focusedId

  const visibleEntries = useCallback((): FocusableEntry[] => {
    const layer = layerRef.current
    return [...entries.current.values()].filter(
      (entry) =>
        entry.layer === layer && entry.element.isConnected && entry.element.offsetParent !== null
    )
  }, [])

  /** Focus an element without disturbing a run in progress. */
  const applyFocus = useCallback((id: string): void => {
    const entry = entries.current.get(id)
    if (!entry) return
    focusedRef.current = id
    zoneMemory.current.set(entry.zone, id)
    lastZone.current = entry.zone
    setFocusedId(id)
    revealElement(entry.element)
  }, [])

  const setFocus = useCallback(
    (id: string): void => {
      anchor.current = null
      applyFocus(id)
    },
    [applyFocus]
  )

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
    // Prefer the zone focus was already in — remembered separately, because by
    // the time a screen has been replaced its focused element is gone from the
    // registry and cannot be asked what zone it was in. Falling back to
    // document order hands focus to the navigation rail every time a screen
    // changes, the rail being the first thing in the document, which is exactly
    // how opening a game used to leave the highlight sitting in the menu.
    const visible = visibleEntries()
    const first =
      visible.find((entry) => entry.zone === lastZone.current) ??
      visible[0] ??
      [...entries.current.values()].find((e) => e.layer === top)
    focusedRef.current = first?.id ?? null
    if (first) {
      zoneMemory.current.set(first.zone, first.id)
      lastZone.current = first.zone
    }
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
      const vertical = direction === 'down' || direction === 'up'
      // A vertical run keeps the column it started in; anything else starts a
      // new line of travel from where focus is now.
      if (!vertical || anchor.current === null) {
        anchor.current = vertical ? from.cx : from.cy
      }
      const line = anchor.current

      /**
       * The nearest candidate in this direction; among those the same distance
       * away, the one most nearly in line.
       */
      const pick = (pool: FocusableEntry[]): string | null => {
        const measured: { id: string; at: Measure }[] = []
        let nearest = Infinity

        for (const candidate of pool) {
          if (candidate.id === current.id) continue
          const at = measure(from, rectOf(candidate.element), direction, line)
          if (!at) continue
          measured.push({ id: candidate.id, at })
          nearest = Math.min(nearest, at.gap)
        }
        if (measured.length === 0) return null

        // One step's worth of candidates — a single row, a single line — then
        // the column decides between them.
        const step = measured.filter((entry) => entry.at.gap <= nearest + SAME_STEP_PX)
        step.sort((a, b) => a.at.cross - b.at.cross || a.at.gap - b.at.gap)
        return step[0].id
      }

      /**
       * Off the edge of this zone and into the next one that way.
       *
       * Where it lands is where you last were in that zone — the bar remembers
       * which item you left it on, the page remembers the game you were looking
       * at — falling back to whatever lies that way if you have never been there.
       */
      const cross = (): string | null => {
        const outside = candidates.filter((entry) => entry.zone !== current.zone)
        const crossing = pick(outside)
        if (!crossing) return null
        const zone = entries.current.get(crossing)?.zone
        const remembered = zone ? zoneMemory.current.get(zone) : undefined
        return remembered && outside.some((entry) => entry.id === remembered)
          ? remembered
          : crossing
      }

      // Within the zone first, always: a zone is left only once there is
      // genuinely nothing further to reach inside it.
      const inZone = candidates.filter((entry) => entry.zone === current.zone)
      let target = pick(inZone)

      // Up and down are the one way across, the menu being a row above the page.
      // Left and right stay put: they walk along the bar, and off its last item
      // there is nothing that way except whatever the page happens to have in
      // its left-hand column, which is not somewhere anyone asked to go.
      if (!target && vertical) {
        // Nothing left to focus that way, but the page may still have something
        // to show: the last press before the edge reveals the rest of it. That
        // is also what keeps the bar out of the way — the page is left for it
        // only from the very top, never from the middle of a list that still
        // scrolls.
        if (scrollToEnd(current.element, direction)) return
        target = cross()
      }

      if (!target) return

      applyFocus(target)
      // A horizontal move re-anchors on where it landed, so the next vertical
      // run travels down the new column rather than the one before it.
      if (!vertical) anchor.current = null
    },
    [applyFocus, setFocus, visibleEntries]
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

  // Starts as whatever is plugged in, then follows whatever is actually used.
  const [inputKind, setInputKind] = useState<InputKind>(() =>
    gamepadPresent() ? 'gamepad' : 'keyboard'
  )
  const [focusedAction, setFocusedAction] = useState<string | null>(null)
  // Reported by the focused element rather than read off the registry, so a
  // label that changes while focused — "Play" becoming "Running…" — keeps up.
  const reportAction = useCallback((label: string | null): void => {
    setFocusedAction((current) => (current === label ? current : label))
  }, [])
  // Set on every input, so it must not re-render unless the answer changed.
  const noteInput = useCallback((kind: InputKind): void => {
    setInputKind((current) => (current === kind ? current : kind))
  }, [])

  // Plugging a pad in is itself a statement of intent, and unplugging one
  // leaves a keyboard as the only thing left to press.
  useEffect(() => {
    const connected = (): void => noteInput('gamepad')
    const disconnected = (): void => {
      if (!gamepadPresent()) noteInput('keyboard')
    }
    window.addEventListener('gamepadconnected', connected)
    window.addEventListener('gamepaddisconnected', disconnected)
    return () => {
      window.removeEventListener('gamepadconnected', connected)
      window.removeEventListener('gamepaddisconnected', disconnected)
    }
  }, [noteInput])

  useGamepad(move, fireAction, activate, noteInput)
  useKeyboard(move, fireAction, activate, noteInput)

  const value = useMemo<FocusContextValue>(
    () => ({
      register,
      focusedId,
      setFocus,
      move,
      activate,
      onAction,
      inputKind,
      focusedAction,
      reportAction
    }),
    [
      register,
      focusedId,
      setFocus,
      move,
      activate,
      onAction,
      inputKind,
      focusedAction,
      reportAction
    ]
  )

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}

export function useFocusContext(): FocusContextValue {
  const ctx = useContext(FocusContext)
  if (!ctx) throw new Error('useFocusContext must be used inside a FocusProvider')
  return ctx
}

/** What a controller button is called on the keyboard that stands in for it. */
const KEYBOARD_LABELS: Record<string, string> = {
  A: 'Enter',
  B: 'Esc',
  X: 'M',
  Y: '/',
  LB: 'Shift+Tab',
  RB: 'Tab',
  START: 'M'
}

/**
 * Name a button for whatever the player is holding.
 *
 * Everything in the UI asks for controller buttons, because that is the primary
 * input and the one the layout is designed around. This translates at the point
 * of display, so a keyboard user is told to press Enter and the same call sites
 * keep saying `A`.
 */
export function useKeyLabel(): (key: string) => string {
  const { inputKind } = useFocusContext()
  return useCallback(
    (key: string): string =>
      inputKind === 'gamepad' ? key : (KEYBOARD_LABELS[key.toUpperCase()] ?? key),
    [inputKind]
  )
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
  /** What selecting this does, for the hint bar. */
  actionLabel?: string
}): UseFocusableResult {
  const { onSelect, enabled = true, autoFocus = false, actionLabel } = options
  const { register, focusedId, setFocus, reportAction } = useFocusContext()
  const layer = useContext(LayerContext)
  const zone = useContext(ZoneContext)
  const ref = useRef<HTMLElement | null>(null)
  const idRef = useRef<string>('')
  if (!idRef.current) idRef.current = `focusable-${nextId++}`
  const id = idRef.current

  // Keep the latest callback without re-registering on every render.
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect

  useEffect(() => {
    if (!enabled || !ref.current) return
    return register({
      id,
      element: ref.current,
      onSelect: () => selectRef.current?.(),
      layer,
      zone
    })
  }, [enabled, id, register, layer, zone])

  useEffect(() => {
    if (autoFocus && enabled) setFocus(id)
  }, [autoFocus, enabled, id, setFocus])

  // Only while focused: an element that has just lost focus must not overwrite
  // what the one that took it has already said.
  const focused = focusedId === id
  useEffect(() => {
    if (focused) reportAction(actionLabel ?? null)
  }, [focused, actionLabel, reportAction])

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
  activate: () => void,
  noteInput: (kind: InputKind) => void
): void {
  const moveRef = useRef(move)
  const actionRef = useRef(fireAction)
  const activateRef = useRef(activate)
  const noteRef = useRef(noteInput)
  moveRef.current = move
  actionRef.current = fireAction
  activateRef.current = activate
  noteRef.current = noteInput

  useEffect(() => {
    let frame = 0
    // Per-control state so a held stick repeats but a tap fires once.
    const held = new Map<string, { since: number; last: number }>()

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

        edge(
          'up',
          button(BUTTON.DPAD_UP) || axisY < -AXIS_DEADZONE,
          () => moveRef.current('up'),
          true
        )
        edge(
          'down',
          button(BUTTON.DPAD_DOWN) || axisY > AXIS_DEADZONE,
          () => moveRef.current('down'),
          true
        )
        edge(
          'left',
          button(BUTTON.DPAD_LEFT) || axisX < -AXIS_DEADZONE,
          () => moveRef.current('left'),
          true
        )
        edge(
          'right',
          button(BUTTON.DPAD_RIGHT) || axisX > AXIS_DEADZONE,
          () => moveRef.current('right'),
          true
        )

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
  activate: () => void,
  noteInput: (kind: InputKind) => void
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
        // Everyone tries the space bar on a button, controller UI or not.
        case ' ':
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
      // Only past the switch: an unhandled key is someone typing somewhere
      // else, not a statement that the keyboard is now driving the UI.
      noteInput('keyboard')
      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [move, fireAction, activate, noteInput])
}
