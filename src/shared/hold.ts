/**
 * How long Start must be held to reach RomMix while something else has the
 * screen — an emulator, or RomM's player.
 *
 * Long enough that no game's own use of Start can trip it, short enough to be
 * an obvious deliberate act when the emulator has hung and this is the only way
 * out. The game sees the press either way — it will open its own pause menu, and
 * that is fine.
 */
export const LEAVE_HOLD_MS = 1500

/** The parts of a Gamepad `startHeld` reads. */
export interface PadState {
  mapping: string
  buttons: readonly { pressed: boolean }[]
}

/**
 * Is Start down on this pad?
 *
 * Button 9, the standard layout's, on any pad; and 7 as well where Chromium has
 * no mapping for it — the same reading as `BUTTON` and `UNMAPPED` in the
 * renderer's `input/gamepad.ts`, which say why. On a mapped pad 7 is the right
 * trigger, so it is not read there.
 */
export function startHeld(pad: PadState): boolean {
  const down = (index: number): boolean => pad.buttons[index]?.pressed === true
  return down(9) || (pad.mapping !== 'standard' && down(7))
}
