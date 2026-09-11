/**
 * Which RomM versions this build knows how to talk to.
 *
 * `romm.ts` is a transcription of somebody else's schema, and the thing that
 * keeps it honest is `schema/`: one document per supported version, every one
 * of them checked against the types. That makes the oldest document the oldest
 * server RomMix has any evidence it works against — so it is the minimum, and
 * `romm.test.ts` holds the two together rather than leaving them to drift.
 *
 * Below it the failure is not a refusal but a silence: a field RomM had not
 * added yet arrives as `undefined`, and nothing between it and a screen says
 * so. A save with no `updated_at` is one every comparison reads as ancient.
 */
export const MINIMUM_SERVER_VERSION = '5.0.0'

/**
 * Does this version string say anything a comparison can use?
 *
 * RomM's `get_version()` answers the literal `development` for any build whose
 * `__version__` placeholder its release pipeline never substituted — a source
 * checkout, or one of the community install scripts. There is no number in that
 * to weigh against the minimum, which is the same position as a server that
 * sends no version at all, and it gets the same answer. See
 * `RommClient.heartbeat`.
 */
export function isComparable(version: string): boolean {
  return version.split('.').some((piece) => counted(piece) !== null)
}

/**
 * Is this version at least that one?
 *
 * Compared segment by segment as numbers rather than as text, which is the
 * whole reason this is not a `>=`: `'4.9.0' >= '5.0.0'` is false for the right
 * answer and `'4.10.0' >= '4.9.0'` is false for the wrong one.
 *
 * Anything that is not a leading integer counts as zero, so a pre-release is
 * read as the version it is a candidate for. That is the forgiving direction on
 * purpose — somebody running a release candidate of the minimum is nearer to
 * supported than to not, and being turned away by their own server's version
 * string is a worse failure than the one this guards against.
 */
export function atLeast(version: string, minimum: string): boolean {
  const have = segments(version)
  const need = segments(minimum)

  for (let at = 0; at < Math.max(have.length, need.length); at += 1) {
    const one = have[at] ?? 0
    const other = need[at] ?? 0
    if (one !== other) return one > other
  }
  return true
}

function segments(version: string): number[] {
  return version.split('.').map((piece) => counted(piece) ?? 0)
}

/** The number a segment opens with, or null where it opens with none. */
function counted(piece: string): number | null {
  const number = Number.parseInt(piece, 10)
  return Number.isFinite(number) ? number : null
}
