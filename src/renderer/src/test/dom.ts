import { Window } from 'happy-dom'

/**
 * A browser for a test that has to render.
 *
 * Most of the renderer's logic has been lifted into plain modules so it can be
 * tested without one — `geometry.ts`, `history.ts`, `tiles.ts`. What that
 * cannot reach is a question about *rendering*, and two are asked here: what a
 * directional press costs is how many components React wakes up, and what a
 * paged query is holding is what its effects and its answers did in the order
 * they arrived.
 *
 * happy-dom rather than a full browser because nothing here needs layout.
 * There is none: `getBoundingClientRect` answers zero for everything and
 * `getComputedStyle` returns blank, so anything geometric has to be stubbed by
 * the test that wants it — see `focus.test.tsx`. What is real is the part these
 * tests are about: elements, events, and which one holds the caret.
 *
 * `defineProperty` rather than assignment because several of these — `navigator`
 * above all — are getter-only on `globalThis` in Node, and a plain assignment
 * throws.
 */

/** Everything React and the input layer reach for off the global object. */
const GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'HTMLElement',
  'HTMLInputElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'MutationObserver',
  'IntersectionObserver',
  'ResizeObserver',
  'matchMedia'
] as const

/**
 * Put a window on the global object, and give it back so a test can reach the
 * document without going through globals it did not set.
 */
export function installDom(): Window {
  const window = new Window({ url: 'http://localhost/' })
  for (const key of GLOBALS) {
    const value = (window as unknown as Record<string, unknown>)[key]
    if (value === undefined) continue
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  /**
   * No pads plugged in.
   *
   * happy-dom has no Gamepad API, and the focus engine asks at start-up which
   * input is present. A pad is polled rather than delivered as events, so what
   * it does is a question about a poll loop and belongs where a real one can be
   * supplied — `plugInPad` in `test/app/`. Here it only has to answer.
   */
  Object.defineProperty(window.navigator, 'getGamepads', {
    value: () => [],
    configurable: true,
    writable: true
  })
  // What React checks before it will let `act` drive an update.
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
    writable: true
  })
  return window
}
