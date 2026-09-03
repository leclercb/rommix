import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { measure, rectOf, SAME_STEP_PX, type Rect } from './geometry.ts'

/**
 * The arithmetic behind every directional press.
 *
 * The only part of the focus engine that can be reasoned about without a
 * layout, and the part where a wrong answer is hardest to read from outside: a
 * press that lands on the wrong element looks the same however it got there,
 * and the app tests can only ever see where it stopped. So the rules `measure`
 * is documented to follow are pinned here, one test per rule, each named after
 * the thing a player would see if it broke.
 *
 * Rectangles rather than elements throughout. `measure` takes `Rect`, which is
 * the whole reason this file exists as its own module — the registry that runs
 * it over real elements is `focus.tsx`, and testing that needs a browser.
 */

/** A rectangle by its edges, with the centres `Rect` also carries. */
function box(left: number, top: number, width: number, height: number): Rect {
  return {
    cx: left + width / 2,
    cy: top + height / 2,
    left,
    right: left + width,
    top,
    bottom: top + height
  }
}

describe('which way a candidate lies', () => {
  test('something behind the highlight is not a candidate for going forwards', () => {
    const from = box(0, 100, 100, 20)
    const above = box(0, 40, 100, 20)
    assert.equal(measure(from, above, 'down', from.cx), null)
    assert.equal(measure(from, above, 'up', from.cx)?.gap, 40)
  })

  test('the same holds sideways', () => {
    const from = box(100, 0, 100, 20)
    const left = box(0, 0, 40, 20)
    assert.equal(measure(from, left, 'right', from.cy), null)
    assert.equal(measure(from, left, 'left', from.cy)?.gap, 60)
  })

  test('two rows sharing a boundary are still one step apart', () => {
    // Adjacent rows land on the same pixel often enough that an exact touch
    // must not read as an overlap; the tolerance is what stops a list becoming
    // unwalkable wherever two rows happen to abut.
    const from = box(0, 0, 100, 20)
    const touching = box(0, 20, 100, 20)
    assert.deepEqual(measure(from, touching, 'down', from.cx), { gap: 0, cross: 0 })

    const overlapping = box(0, 19, 100, 20)
    assert.deepEqual(measure(from, overlapping, 'down', from.cx), { gap: 0, cross: 0 })
  })

  test('something genuinely overlapping is not in any direction', () => {
    const from = box(0, 0, 100, 20)
    const across = box(0, 10, 100, 20)
    assert.equal(measure(from, across, 'down', from.cx), null)
  })
})

describe('distance is edge to edge', () => {
  test('a tall row directly below is nearer than a short one past it', () => {
    // The failure this prevents: measuring centres makes an element's own
    // height count as distance, so the tall row immediately below loses to a
    // short one further away, and a press jumps over the thing in front of the
    // player.
    const from = box(0, 0, 100, 20)
    // Beside each other rather than stacked, which is the only way the two
    // measurements can disagree: the tall one starts sooner and ends much
    // later, so its middle is the furthest thing here.
    const tall = box(0, 30, 100, 400)
    const short = box(200, 100, 100, 20)

    const toTall = measure(from, tall, 'down', from.cx)
    const toShort = measure(from, short, 'down', from.cx)
    assert.ok(toTall && toShort)
    assert.ok(toTall.gap < toShort.gap, `${toTall.gap} should be nearer than ${toShort.gap}`)

    // Centres would have said the opposite, which is the whole point.
    assert.ok(tall.cy - from.cy > short.cy - from.cy)
  })
})

describe('the column a vertical run is travelling down', () => {
  test('alignment is measured from the anchor, not from where the press started', () => {
    // Going down onto a wide button and back up must return to the card that
    // was left, not to whatever sits under the button's middle. The anchor is
    // how the run remembers the column, so `cross` has to be measured against
    // it rather than against `from`.
    const from = box(0, 100, 400, 40)
    const card = box(300, 160, 100, 100)

    assert.equal(measure(from, card, 'down', 350)?.cross, 0)
    assert.ok((measure(from, card, 'down', 0)?.cross ?? 0) > 0)
  })

  test('a candidate the line passes through is perfectly in line', () => {
    const from = box(0, 0, 100, 20)
    const under = box(80, 40, 100, 20)
    assert.equal(measure(from, under, 'down', 120)?.cross, 0)
  })

  test('and one beside it is out of line by the gap, whichever side it is', () => {
    const from = box(0, 0, 100, 20)
    const right = box(200, 40, 100, 20)
    const left = box(0, 40, 40, 20)
    assert.equal(measure(from, right, 'down', 150)?.cross, 50)
    assert.equal(measure(from, left, 'down', 150)?.cross, 110)
  })
})

describe('a button drawn inside a row', () => {
  // Edge to edge, a nested rectangle has a negative gap from every side, so
  // without the containment rule the Cancel button inside a download row could
  // not be reached from anywhere at all.
  const row = box(0, 0, 800, 60)
  const cancel = box(700, 15, 80, 30)

  test('is reached sideways', () => {
    assert.deepEqual(measure(row, cancel, 'right', row.cy), { gap: 0, cross: 0 })
  })

  test('and left again from inside it', () => {
    assert.deepEqual(measure(cancel, row, 'left', cancel.cy), { gap: 0, cross: 0 })
  })

  test('but never by walking down the list', () => {
    // Down through a list of thousands must pass rows rather than stop twice
    // inside each one.
    assert.equal(measure(row, cancel, 'down', row.cx), null)
    assert.equal(measure(row, cancel, 'up', row.cx), null)
    assert.equal(measure(cancel, row, 'down', cancel.cx), null)
  })

  test('and not sideways against the way it lies', () => {
    assert.equal(measure(row, cancel, 'left', row.cy), null)
  })
})

describe('what the engine does with the two numbers', () => {
  /**
   * `nearest` in `focus.tsx`, in the two lines that matter.
   *
   * Repeated rather than imported because the registry it lives in needs a
   * browser, and the rule being pinned is the contract between the two files:
   * distance decides, and alignment only settles candidates that are already
   * the same distance away. `measure` returning the right pair means nothing if
   * they are combined into one number on the way out.
   */
  function winner(from: Rect, pool: Record<string, Rect>, anchor: number): string | null {
    const measured = Object.entries(pool)
      .map(([id, rect]) => ({ id, at: measure(from, rect, 'down', anchor) }))
      .filter((entry) => entry.at !== null)
    if (measured.length === 0) return null
    const closest = Math.min(...measured.map((entry) => entry.at!.gap))
    return measured
      .filter((entry) => entry.at!.gap <= closest + SAME_STEP_PX)
      .sort((a, b) => a.at!.cross - b.at!.cross || a.at!.gap - b.at!.gap)[0].id
  }

  const from = box(200, 0, 100, 40)

  test('within one step, the better aligned one wins even if it is further', () => {
    // One row of a grid is not flat: titles wrap and cards settle a few pixels
    // apart. Everything in that band is the same row, and the column is what
    // decides which card in it.
    const drawn = {
      offset: box(0, 100, 100, 100),
      aligned: box(200, 100 + SAME_STEP_PX - 1, 100, 100)
    }
    assert.equal(winner(from, drawn, from.cx), 'aligned')
  })

  test('past one step, distance wins however well aligned the far one is', () => {
    // The failure this prevents: a well-aligned element two rows down beating
    // the row immediately below, so a press skips a row the player can see.
    const drawn = {
      near: box(0, 100, 100, 100),
      alignedButFurther: box(200, 100 + SAME_STEP_PX + 2, 100, 100)
    }
    assert.equal(winner(from, drawn, from.cx), 'near')
  })

  test('nothing that way is no answer rather than the nearest thing anywhere', () => {
    assert.equal(winner(from, { above: box(200, -200, 100, 100) }, from.cx), null)
  })
})

describe('reading a rectangle off an element', () => {
  test('the centres come from the measured box', () => {
    const element = {
      getBoundingClientRect: () => ({
        left: 10,
        top: 20,
        right: 110,
        bottom: 70,
        width: 100,
        height: 50
      })
    } as unknown as HTMLElement
    assert.deepEqual(rectOf(element), {
      cx: 60,
      cy: 45,
      left: 10,
      right: 110,
      top: 20,
      bottom: 70
    })
  })
})
