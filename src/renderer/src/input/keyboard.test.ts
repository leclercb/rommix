import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { intentOf, keyboardLabel } from './keyboard.ts'
import type { Action } from './types.ts'

/**
 * What the keyboard standing in for the pad actually answers to.
 *
 * Two halves of one contract, written in the same file and able to disagree
 * without anything noticing: `keyboardLabel` is what the hint bar prints under
 * a button, and `intentOf` is what a press of that key does. The bar drew `M`
 * for the menu while the switch tested `'m'`, so with Caps Lock on — or Shift
 * held, which is how anybody types a capital — the press that matched the
 * label did nothing at all, on a screen advertising it.
 *
 * Pure on both sides, so neither needs a window. The handler around them is
 * two lines of dispatch and is covered by `test/app/`, which drives real keys
 * at a real application.
 */

/** The hint bar's own `t`, which returns the key rather than a translation. */
const t = ((key: string) => key) as Parameters<typeof keyboardLabel>[1]

/** The action a button stands for, where the hint bar names one. */
const ACTIONS: Record<string, Action> = {
  X: 'menu',
  START: 'menu',
  Y: 'search',
  LB: 'tabLeft',
  RB: 'tabRight'
}

describe('what the hint bar promises', () => {
  test('every key it prints is one a press answers to', () => {
    // The rule the uppercase `M` broke. Asked of the label itself rather than
    // of a list written out here, so a button whose label changes is a button
    // this still checks.
    for (const button of ['X', 'START', 'Y', 'LB', 'RB']) {
      const label = keyboardLabel(button, t)
      assert.ok(label, `${button} should have a label`)
      const key = label.replace(/^Shift\+/, '')
      assert.notEqual(
        intentOf(key, label.startsWith('Shift+')),
        null,
        `the bar prints ${label} for ${button}, so that key has to do something`
      )
    }
  })

  test('and it does the thing the button it stands for does', () => {
    for (const [button, action] of Object.entries(ACTIONS)) {
      const label = keyboardLabel(button, t) as string
      const key = label.replace(/^Shift\+/, '')
      assert.deepEqual(
        intentOf(key, label.startsWith('Shift+')),
        { action },
        `${label} should be ${action}, which is what ${button} does`
      )
    }
  })

  test('A and B are words, and are translated rather than printed', () => {
    // The two that name a key by its word instead of its glyph, which is the
    // reason `keyboardLabel` takes a `t` at all.
    assert.equal(keyboardLabel('A', t), 'key.enter')
    assert.equal(keyboardLabel('B', t), 'key.esc')
  })

  test('a button the keyboard has no key for says so rather than guessing', () => {
    assert.equal(keyboardLabel('LT', t), undefined)
  })
})

describe('what a press means', () => {
  test('the arrows move, and nothing else does', () => {
    assert.deepEqual(intentOf('ArrowUp'), { move: 'up' })
    assert.deepEqual(intentOf('ArrowDown'), { move: 'down' })
    assert.deepEqual(intentOf('ArrowLeft'), { move: 'left' })
    assert.deepEqual(intentOf('ArrowRight'), { move: 'right' })
  })

  test('a letter is read whatever case it arrives in', () => {
    // Caps Lock, or Shift held to type the capital the hint bar draws. `key` is
    // what the shift state produced, and which case it came in says nothing
    // about what was meant.
    assert.deepEqual(intentOf('m'), { action: 'menu' })
    assert.deepEqual(intentOf('M'), { action: 'menu' })
    assert.deepEqual(intentOf('M', true), { action: 'menu' })
  })

  test('Enter and the space bar both select', () => {
    // Everyone tries the space bar on a button, controller interface or not.
    assert.deepEqual(intentOf('Enter'), { activate: true })
    assert.deepEqual(intentOf(' '), { activate: true })
  })

  test('Escape and Backspace both go back', () => {
    assert.deepEqual(intentOf('Escape'), { action: 'back' })
    assert.deepEqual(intentOf('Backspace'), { action: 'back' })
  })

  test('Tab walks the tab strip, and Shift walks it the other way', () => {
    assert.deepEqual(intentOf('Tab'), { action: 'tabRight' })
    assert.deepEqual(intentOf('Tab', true), { action: 'tabLeft' })
  })

  test('anything else means nothing here', () => {
    // The answer that keeps the keyboard from claiming to be driving the
    // interface every time somebody types: a key with no meaning is passed
    // over, `preventDefault` is not called, and the input kind is left alone.
    for (const key of ['a', 'F5', 'Shift', 'Control', '1']) {
      assert.equal(intentOf(key), null, `${key} should mean nothing`)
    }
  })
})
