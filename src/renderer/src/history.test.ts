import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { popRoute, prunedForOffline, pushRoute, type Route } from './history.ts'

/**
 * The algebra behind B.
 *
 * The most-pressed button on a controller, and the one whose failures are
 * hardest to describe: a press that appears to do nothing, or one that leaves
 * the screen somewhere nobody walked to. What decides either is a list of
 * routes and three rules over it, and none of it needs a window — which is why
 * it is here rather than in `state.tsx`, the same split `geometry.ts` is.
 *
 * One test per documented rule, named after what a player would see if it
 * broke. `test/app/` drives the real thing; this is what says why.
 */

const home: Route = { name: 'home' }
const library: Route = { name: 'library' }
const collections: Route = { name: 'collections' }
const game = (romId: number): Route => ({ name: 'game', romId })
const collection = (collectionId: number | string, title = 'Shelf'): Route => ({
  name: 'collection',
  collectionId,
  title
})

/** The route names a path is made of, which is what the assertions read. */
const path = (history: readonly Route[]): string[] => history.map((step) => step.name)

describe('going somewhere', () => {
  test('a section starts a path rather than continuing one', () => {
    // What keeps B a way out rather than a replay of the evening: the menu bar
    // is where a path begins, so choosing from it throws away whatever was
    // being walked.
    assert.deepEqual(pushRoute([home, game(1), collection(2)], library), [library])
  })

  test('anything else is a step deeper', () => {
    assert.deepEqual(path(pushRoute([collections], collection(2))), ['collections', 'collection'])
  })

  test('opening something already on the path walks back to it', () => {
    /**
     * The rule that keeps B from looking broken.
     *
     * A game reached from its own versions list is often one already two steps
     * back. Pushing a second copy would leave the next press moving between two
     * screens that look identical.
     */
    const history = [home, game(1), game(2), game(3)]
    assert.deepEqual(pushRoute(history, game(1)), [home, game(1)])
  })

  test('and a different one of the same kind is still a step deeper', () => {
    const history = [home, game(1)]
    assert.deepEqual(path(pushRoute(history, game(2))), ['home', 'game', 'game'])
  })

  test('collections are told apart by which shelf they are', () => {
    const history = [collections, collection(2)]
    assert.deepEqual(path(pushRoute(history, collection(9))), [
      'collections',
      'collection',
      'collection'
    ])
    assert.deepEqual(pushRoute(history, collection(2)), history)
  })

  test('a virtual shelf and a real one are not the same shelf', () => {
    // RomM draws the distinction itself, right down to the query parameter:
    // a number is a collection the user made, a string is one RomM derived.
    const history = [collections, collection(2)]
    assert.deepEqual(path(pushRoute(history, collection('genre:rpg'))), [
      'collections',
      'collection',
      'collection'
    ])
  })

  test('the path it came from is not disturbed', () => {
    // The array handed in is state React holds; rewriting it in place is how a
    // screen comes to disagree with the history behind it.
    const history: Route[] = [home, game(1)]
    pushRoute(history, game(2))
    assert.deepEqual(path(history), ['home', 'game'])
  })
})

describe('going back', () => {
  test('one step at a time', () => {
    assert.deepEqual(popRoute([home, game(1), collection(2)]), [home, game(1)])
  })

  test('and never off the end of the path', () => {
    // Running out of history is what makes B climb into the menu and then offer
    // to quit — see `App.back`. An empty path would leave nothing to draw.
    const history = [home]
    assert.equal(popRoute(history), history, 'the same path back, not a copy of it')
  })
})

describe('when the server goes away', () => {
  test('the screens that need one are taken out of the path', () => {
    // They have no local half, so leaving them under the screen on top would
    // make B a press onto a page with nothing on it.
    assert.deepEqual(path(prunedForOffline([collections, collection(2)])), ['home'])
  })

  test('a path with nothing to lose is left exactly as it was', () => {
    // By identity, so a connection answer that changes nothing does not redraw
    // every screen behind the one on it.
    const history = [home, game(1)]
    assert.equal(prunedForOffline(history), history)
  })

  test('what is left hangs off Home', () => {
    assert.deepEqual(path(prunedForOffline([collections, collection(2), game(1)])), [
      'home',
      'game'
    ])
  })

  test('and Home is not put in front of itself', () => {
    /**
     * A second Home under the first is a B press that appears to do nothing.
     *
     * The path keeps `canGoBack` true, the press pops one Home and draws the
     * other, and the screen does not change — which reads as a dead button
     * rather than as a step.
     */
    assert.deepEqual(path(prunedForOffline([home, collection(2), game(1)])), ['home', 'game'])
  })
})
