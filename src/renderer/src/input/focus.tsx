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
import { measure, rectOf, SAME_STEP_PX, type Measure } from './geometry'
import { gamepadPresent, useGamepad } from './gamepad'
import { keyboardLabel, useKeyboard } from './keyboard'
import { revealElement, scrollToEnd } from './scroll'
import { playCue } from './sound'
import { useI18n } from '../state'
import type { Action, Direction, InputKind } from './types'

/**
 * Spatial focus engine for controller and keyboard navigation.
 *
 * Browsers have no notion of "the thing to the right of this thing", so we keep
 * our own registry of focusable elements and pick the next one geometrically.
 * That is what makes a grid of cover art feel like a console UI rather than a
 * web page walked with Tab.
 *
 * This file is the registry and the rules around it: which elements exist,
 * which layer and zone each belongs to, and where a press lands. The parts it
 * is built on live beside it — `geometry` measures candidates, `scroll` keeps
 * the page under them, and `gamepad` and `keyboard` are the two things that can
 * produce a press.
 */

export type { Action, Direction, InputKind } from './types'
export { useGamepadName } from './gamepad'

interface FocusableEntry {
  id: string
  element: HTMLElement
  onSelect?: () => void
  /** Focusables in a lower layer are ignored while a higher layer exists (modals). */
  layer: number
  /** Which region of the screen this belongs to. See `FocusZone`. */
  zone: string
  /** The run it belongs to, or '' for none. See `FocusGroup`. */
  group: string
}

interface FocusContextValue {
  register(entry: FocusableEntry): () => void
  focusedId: string | null
  setFocus(id: string): void
  move(direction: Direction): void
  /**
   * Send focus into a zone by name, as `move` cannot: a button that says "go to
   * the menu" is not a direction, and from the middle of a library the menu is
   * not the thing lying that way.
   *
   * False when focus is already in that zone, or the zone has nothing to focus.
   * The caller is asking to *enter* it, so being there already is an answer and
   * not a failure — it is what lets a second press of the same button mean the
   * next thing.
   */
  enterZone(zone: string): boolean
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
  /** See `useSuspendGamepad`. */
  setInputSuspended(suspended: boolean): void
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

/**
 * A run of focusables that is entered at a known place rather than wherever the
 * geometry happens to point.
 *
 * Zones settle where a press *leaves* one region for another; this settles
 * where it *lands* inside the region it arrives in. The two are different
 * problems, and the home screen is where the second one shows: the hero spans
 * the page, so its centre column is somewhere around the fourth card of the
 * shelf below it, and Down off the hero would pick that card — a different one
 * on every library, for a reason nothing on screen explains.
 *
 * So a group reached from outside one is entered at its first item, or — once
 * it has been visited — at the item last left in it.
 *
 * From inside a group the geometry stands, and that is the whole of the rule:
 * between two shelves the card above or below the highlight is the one the
 * player is looking at, and sending the press somewhere else instead is what
 * would read as arbitrary. Movement *within* a group is untouched too — Left
 * and Right walk it one card at a time.
 */
const GroupContext = createContext('')

/** Mark a subtree as one navigable region. */
export function FocusZone({ id, children }: { id: string; children: ReactNode }): JSX.Element {
  return <ZoneContext.Provider value={id}>{children}</ZoneContext.Provider>
}

/** Mark a subtree as one run entered at a fixed point. See `GroupContext`. */
export function FocusGroup({ id, children }: { id: string; children: ReactNode }): JSX.Element {
  return <GroupContext.Provider value={id}>{children}</GroupContext.Provider>
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
  /**
   * Where focus last was in each group, so a shelf is re-entered where it was
   * left rather than at whatever card the column happens to point at.
   */
  const groupMemory = useRef(new Map<string, string>())

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
    if (entry.group) groupMemory.current.set(entry.group, id)
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

  /** See `enterZone` on the context. */
  const enterZone = useCallback(
    (zone: string): boolean => {
      const current = focusedRef.current ? entries.current.get(focusedRef.current) : undefined
      if (current?.zone === zone) return false

      // Only what the active layer can reach: with an overlay up, the bar
      // behind it is not somewhere focus is allowed to go.
      const visible = visibleEntries().filter((entry) => entry.zone === zone)
      if (visible.length === 0) return false

      // Where the zone was left, exactly as walking back into it would land —
      // one button and one stick should not disagree about where the menu is.
      const remembered = zoneMemory.current.get(zone)
      setFocus(visible.find((entry) => entry.id === remembered)?.id ?? visible[0].id)
      return true
    },
    [setFocus, visibleEntries]
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
      if (first.group) groupMemory.current.set(first.group, first.id)
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
        playCue('move')
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
       * Where a press that arrives in a group from outside every group lands.
       *
       * The geometry picked a member of that group; which member is not the
       * geometry's business, because the whole point of a group is that it is
       * entered at a stated place. Where it was left if it has been visited,
       * its first item otherwise.
       *
       * A press that starts inside a group keeps what the geometry picked: one
       * shelf to the next is a move between two things the player can see, and
       * the tile below the highlight is the one they mean. See `GroupContext`.
       *
       * "First" is document order rather than the left-most rect: a shelf runs
       * to several hundred cards once it has paged a few times, and measuring
       * all of them on every press of a held direction is exactly the cost the
       * rest of this file avoids. `compareDocumentPosition` answers from the
       * tree and forces no layout — registration order would have been cheaper
       * still, but a shelf that re-sorts keeps its nodes and only moves them,
       * so the order things registered in stops matching the order they are
       * drawn in.
       *
       * Sideways moves are exempt. Left and Right off the end of a shelf are
       * how you reach the buttons beside a row, and rewriting those to the head
       * of whatever they reached would make the two directions disagree about
       * where they went.
       */
      const landing = (id: string): string => {
        if (!vertical || current.group) return id
        const group = entries.current.get(id)?.group
        if (!group) return id

        const remembered = groupMemory.current.get(group)
        if (remembered && candidates.some((entry) => entry.id === remembered)) return remembered

        let first: FocusableEntry | null = null
        for (const candidate of candidates) {
          if (candidate.group !== group) continue
          const before =
            first === null ||
            (first.element.compareDocumentPosition(candidate.element) &
              Node.DOCUMENT_POSITION_PRECEDING) !==
              0
          if (before) first = candidate
        }
        return first?.id ?? id
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

      const arrived = landing(target)
      applyFocus(arrived)
      // Only where a press actually moved: every return above is a press that
      // found nothing, and a click for those would say the opposite.
      playCue('move')
      // A horizontal move re-anchors on where it landed, so the next vertical
      // run travels down the new column rather than the one before it. So does
      // entering a group at its own head: the column the run was travelling
      // down is not the one focus is in any more, and carrying it further would
      // aim the next press back at where the run started.
      if (!vertical || arrived !== target) anchor.current = null
    },
    [applyFocus, setFocus, visibleEntries]
  )

  const activate = useCallback((): void => {
    const id = focusedRef.current
    if (!id) return
    const select = entries.current.get(id)?.onSelect
    if (!select) return
    playCue('select')
    select()
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
    if (!target) return
    // Leaving has its own cue; the rest — the menu, the search box, a tab — are
    // the interface moving, which is what the move cue says.
    playCue(action === 'back' ? 'back' : 'move')
    target.handler()
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

  /**
   * Whether an emulator has the screen, in which case the pad is not ours.
   *
   * Only the gamepad is suspended. Keyboard and mouse are delivered as events
   * and so already follow window focus — an emulator that has focus gets the
   * keystrokes and RomMix never sees them. The Gamepad API is polled instead,
   * which is why it needs telling. See the poll in `useGamepad`.
   */
  const [inputSuspended, setInputSuspended] = useState(false)

  useGamepad(move, fireAction, activate, noteInput, inputSuspended)
  useKeyboard(move, fireAction, activate, noteInput)

  const value = useMemo<FocusContextValue>(
    () => ({
      register,
      focusedId,
      setFocus,
      move,
      enterZone,
      activate,
      onAction,
      inputKind,
      focusedAction,
      reportAction,
      setInputSuspended
    }),
    [
      register,
      focusedId,
      setFocus,
      move,
      enterZone,
      activate,
      onAction,
      inputKind,
      focusedAction,
      reportAction,
      setInputSuspended
    ]
  )

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}

export function useFocusContext(): FocusContextValue {
  const ctx = useContext(FocusContext)
  if (!ctx) throw new Error('useFocusContext must be used inside a FocusProvider')
  return ctx
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
  const { t } = useI18n()
  return useCallback(
    (key: string): string =>
      inputKind === 'gamepad' ? key : (keyboardLabel(key.toUpperCase(), t) ?? key),
    [inputKind, t]
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
  const group = useContext(GroupContext)
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
      zone,
      group
    })
  }, [enabled, id, register, layer, zone, group])

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

/**
 * Hand the pad over to something else for as long as `suspended` is true.
 *
 * For the one case RomMix has: an emulator is on screen, and every button the
 * player presses is meant for the game. The Gamepad API does not know that —
 * it reports button state to whoever polls, focused or not — so it has to be
 * told, and the running overlay's autofocused Close button is otherwise one A
 * press away for the whole session.
 *
 * Holding Start still reaches RomMix, as the way out of an emulator that has
 * hung. See `SUSPENDED_HOLD_MS`.
 */
export function useSuspendGamepad(suspended: boolean): void {
  const { setInputSuspended } = useFocusContext()
  useEffect(() => {
    setInputSuspended(suspended)
    // Released on unmount so a screen torn down mid-session cannot leave the
    // pad switched off.
    return () => setInputSuspended(false)
  }, [suspended, setInputSuspended])
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
