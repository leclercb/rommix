import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readPads } from './gamepad.ts'

/**
 * What the poll sees, with every connected pad folded into one.
 *
 * Pure, so it needs no window and no Gamepad API: a pad here is the shape
 * Chromium hands back, built by hand. The loop around it is timing and
 * dispatch and is covered by `test/app/`.
 */

/** A pad in slot `index` with the given buttons down and its axes where they are put. */
function pad(
  index: number,
  pressed: number[] = [],
  axes: number[] = [0, 0, 0, 0],
  mapping: GamepadMappingType = 'standard'
): Gamepad {
  const buttons = Array.from({ length: 17 }, (_, slot) => ({
    pressed: pressed.includes(slot),
    touched: pressed.includes(slot),
    value: pressed.includes(slot) ? 1 : 0
  }))
  return { index, buttons, axes, mapping } as unknown as Gamepad
}

describe('reading every pad', () => {
  test('a press on a pad past the first slot is seen', () => {
    // Chromium numbers pads by when they arrived, so the one being used can
    // be in any slot.
    const { buttons } = readPads([pad(0), null, pad(2, [0])], null)
    assert.ok(buttons.has('a'))
  })

  test('the same control held on two pads is one control', () => {
    const { buttons } = readPads([pad(0, [0]), pad(1, [0])], null)
    assert.deepEqual([...buttons], ['a'])
  })

  test('nothing connected reads as nothing held', () => {
    const { buttons, sticks, active } = readPads([null, null, null, null], 0)
    assert.equal(buttons.size, 0)
    assert.equal(sticks.size, 0)
    assert.equal(active, null)
  })
})

describe('the active pad', () => {
  test('is the one that pressed a button', () => {
    assert.equal(readPads([pad(0), pad(1, [0])], null).active, 1)
  })

  test('stays active once its buttons are released', () => {
    assert.equal(readPads([pad(0), pad(1)], 1).active, 1)
  })

  test('keeps the role while pressing, whatever else is pressed', () => {
    assert.equal(readPads([pad(0, [0]), pad(1, [1])], 1).active, 1)
  })

  test('hands over to another pad that presses a button', () => {
    assert.equal(readPads([pad(0, [0]), pad(1)], 1).active, 0)
  })

  test('is nobody until a button is pressed', () => {
    assert.equal(readPads([pad(0, [], [1, 1, 0, 0])], null).active, null)
  })
})

describe('axes', () => {
  test('a stick off centre on the active pad moves without counting as a button', () => {
    // A stick resting off centre reports this with nobody pressing anything,
    // and it must not decide which hints are shown.
    const { buttons, sticks } = readPads([pad(0, [], [0.9, -0.9, 0, 0])], 0)
    assert.equal(buttons.size, 0)
    assert.deepEqual([...sticks].sort(), ['right', 'up'])
  })

  test('a stick off centre on an idle pad is ignored', () => {
    // Left alone, it would hold a direction down and walk the focus away
    // from the pad actually in use.
    const { sticks } = readPads([pad(0, [], [0.9, -0.9, 0, 0]), pad(1)], 1)
    assert.equal(sticks.size, 0)
  })

  test('a stick inside the dead zone is at rest', () => {
    const { sticks } = readPads([pad(0, [], [0.3, -0.3, 0, 0])], 0)
    assert.equal(sticks.size, 0)
  })

  test('the d-pad is a button, from any pad', () => {
    const { buttons, sticks } = readPads([pad(0), pad(1, [12, 15])], 0)
    assert.deepEqual([...buttons].sort(), ['right', 'up'])
    assert.equal(sticks.size, 0)
  })
})

describe('a pad Chromium has no mapping for', () => {
  test('its hat is the d-pad when it is the active pad', () => {
    const { buttons } = readPads([pad(0, [], [0, 0, 0, 0, 0, 0, -1, 1], '')], 0)
    assert.deepEqual([...buttons].sort(), ['down', 'left'])
  })

  test('its hat is ignored when another pad is active', () => {
    // Axes 6 and 7 are only a hat by assumption; at rest they may be
    // something else entirely, held at one end.
    const { buttons } = readPads([pad(0, [], [0, 0, 0, 0, 0, 0, -1, -1], ''), pad(1)], 1)
    assert.equal(buttons.size, 0)
  })

  test('Start is button 7', () => {
    assert.ok(readPads([pad(0, [7], [0, 0], '')], null).buttons.has('start'))
  })

  test('on a mapped pad button 7 is the right trigger, not Start', () => {
    assert.ok(!readPads([pad(0, [7])], null).buttons.has('start'))
  })
})
