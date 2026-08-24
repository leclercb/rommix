/** What the input layer talks about, shared by the sources and the engine. */

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
