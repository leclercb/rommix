import type { EmulatorId } from '@shared/types'

/**
 * Where RomMix is, and the rules for getting from one screen to the next.
 *
 * Pure, and its own module for that reason — the same split `geometry.ts` is:
 * this is the algebra behind the most-pressed button on the pad, and the
 * provider that holds it in React state is not something `npm test` can run.
 * What is here can be, and the rules below are worth more pinned than
 * described.
 */

export type Route =
  /**
   * First-run setup, and the sign-in form it ends on. See `SetupScreen`.
   */
  | { name: 'setup' }
  | { name: 'home' }
  | { name: 'library' }
  /**
   * One game. `fromVersions` says it was opened from another dump's versions
   * list, which is where the highlight belongs when it arrives: the pad is on a
   * tab strip and stepping to the next version should leave it there.
   */
  | { name: 'game'; romId: number; fromVersions?: true }
  | { name: 'downloads' }
  /**
   * One shelf on RomM. The name travels with the id: it was on screen in the
   * list that was pressed to get here, so refetching it would put a spinner
   * where the title goes.
   *
   * A number is a collection the user made and a string is one RomM derived —
   * which is the distinction the server itself draws, right down to the query
   * parameter each is passed as.
   */
  | { name: 'collection'; collectionId: number | string; title: string }
  | { name: 'collections' }
  | { name: 'bios' }
  | { name: 'emulators' }
  /**
   * Installing an emulator, page by page.
   *
   * `emulatorId` is one already settled on — the row pressed on the Emulators
   * screen — and its absence is what puts the choice of emulator in front: a
   * game's platform is covered by several, and which of them is the first
   * question. `system` is the list that choice is drawn from and `platform`
   * what to call it on screen.
   */
  | {
      name: 'install-emulator'
      emulatorId?: EmulatorId
      system?: string
      platform?: string
      /** Straight to the builds, for an install RomMix already manages. */
      changeVersion?: true
    }
  | { name: 'settings' }

/**
 * The screens that are a place rather than a thing: what the menu bar offers.
 *
 * Going to one of these starts a path instead of continuing one — see
 * `navigate` — which is what keeps B a way *out* rather than a replay of the
 * evening. Everything not named here is something looked at inside a place: a
 * game, a collection's contents.
 */
const SECTIONS: readonly Route['name'][] = [
  'home',
  'library',
  'collections',
  'downloads',
  'bios',
  'emulators',
  'settings'
]

/**
 * The screens with no local half, and so nothing to show while RomM is away.
 *
 * Only the shelves the server keeps. Every other screen narrows instead of
 * disappearing — Home to the games on this disk, the Library to the ones
 * downloaded, BIOS to what is in place — which is what keeps the menu the same
 * shape offline as on, rather than swapping it for a different application.
 */
const NEEDS_SERVER: readonly Route['name'][] = ['collections', 'collection']

/**
 * Is this the same screen, rather than one of the same kind?
 *
 * What decides whether a move continues the path or returns along it. Opening
 * the game already two steps back is going back to it, and pushing a second
 * copy would make the next B press look like it did nothing.
 */
function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false
  if (a.name === 'game' && b.name === 'game') return a.romId === b.romId
  if (a.name === 'collection' && b.name === 'collection') return a.collectionId === b.collectionId
  return true
}

/**
 * Where `navigate` leaves the path. See the doc on `AppState.navigate`.
 *
 * A section replaces whatever was on screen, because a section is where a path
 * starts. Anything else is a step deeper and is pushed — unless it is already
 * on the path, in which case this is a walk back to it and everything above it
 * goes.
 */
export function pushRoute(history: readonly Route[], next: Route): Route[] {
  if (SECTIONS.includes(next.name)) return [next]
  const at = history.findIndex((step) => sameRoute(step, next))
  return at >= 0 ? history.slice(0, at + 1) : [...history, next]
}

/**
 * Where B leaves the path, which is nowhere once it is down to one screen.
 *
 * The same list back where there is nothing to pop, rather than a copy of it:
 * this is handed straight to `setHistory`, and a new array with the same
 * contents is a re-render of every screen for a press that did nothing.
 */
export function popRoute(history: readonly Route[]): readonly Route[] {
  return history.length > 1 ? history.slice(0, -1) : history
}

/**
 * The path with the screens that need a server taken out of it.
 *
 * What is left hangs off Home, which is where the menu starts — a path with a
 * hole in it would make B a press onto a screen with nothing on it. Home is
 * not added twice: a path that already starts there keeps the one it has.
 */
export function prunedForOffline(history: readonly Route[]): readonly Route[] {
  const kept = history.filter((step) => !NEEDS_SERVER.includes(step.name))
  // Unchanged, and said so by identity: see `popRoute`.
  if (kept.length === history.length) return history
  return kept[0]?.name === 'home' ? kept : [{ name: 'home' }, ...kept]
}
