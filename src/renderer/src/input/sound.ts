/**
 * The sounds the interface makes as it is driven.
 *
 * A console UI is looked at from across a room, often out of the corner of an
 * eye, and a quiet click is what tells the player a press landed when the thing
 * that moved is on the far side of the screen. Three cues and no more: focus
 * moved, something was chosen, something was left.
 *
 * Synthesised rather than shipped as audio files. Each cue is one oscillator
 * and one envelope, which is a few lines here against a set of binary assets in
 * the AppImage — with a licence to track — for less than a second of sound.
 *
 * Deliberately not part of the focus engine: what a press *does* is that file's
 * subject, and what it sounds like is not.
 */

export type Cue = 'move' | 'select' | 'back'

/**
 * Each cue as a pitch, a length and a level.
 *
 * Pitched apart so the three are told apart with the television turned down:
 * choosing rises above the tick that walks the grid, leaving falls below it.
 * Quiet enough to sit under whatever else the room is doing — this is feedback,
 * not an alert, and it plays on every single press.
 */
const CUES: Record<Cue, { hz: number; seconds: number; gain: number }> = {
  move: { hz: 620, seconds: 0.04, gain: 0.035 },
  select: { hz: 900, seconds: 0.075, gain: 0.05 },
  back: { hz: 340, seconds: 0.07, gain: 0.045 }
}

let context: AudioContext | null = null
/** Off until the settings have been read, so nothing plays before the answer. */
let enabled = false
/** Set when the machine has no audio to give, after which nothing is retried. */
let silenced = false

/** Follows the user's setting. See `Settings.navigationSounds`. */
export function setSoundEnabled(on: boolean): void {
  enabled = on
}

/**
 * The audio context, built on the first press rather than at startup.
 *
 * A context created before any input has happened starts suspended under the
 * browser's autoplay rules — which the web preview is subject to — and every
 * cue would be dropped until something resumed it. The first press is a user
 * gesture, so building it here is what makes it start running.
 */
function audio(): AudioContext | null {
  if (!enabled || silenced) return null
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    silenced = true
    return null
  }
}

/** Play one cue, or nothing at all where there is no sound to play it with. */
export function playCue(cue: Cue): void {
  const ctx = audio()
  if (!ctx) return

  const { hz, seconds, gain } = CUES[cue]
  const now = ctx.currentTime
  const tone = ctx.createOscillator()
  const envelope = ctx.createGain()

  // A triangle rather than a sine: a little of the edge a click needs, without
  // the buzz a square gives a note this short.
  tone.type = 'triangle'
  tone.frequency.setValueAtTime(hz, now)

  // Faded in and out rather than switched on and off. A tone that starts or
  // stops at full level is a click of its own, and at this length that click is
  // most of what would be heard.
  envelope.gain.setValueAtTime(0, now)
  envelope.gain.linearRampToValueAtTime(gain, now + 0.004)
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + seconds)

  tone.connect(envelope)
  envelope.connect(ctx.destination)
  tone.start(now)
  tone.stop(now + seconds)
}
