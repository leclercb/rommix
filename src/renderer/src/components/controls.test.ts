import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { uiScaleChoice, uiScaleOptions } from './controls.tsx'
import type { I18n } from '@shared/i18n'

/**
 * The two rules inside the controls that are not drawing.
 *
 * Reachable at all only because the test runner compiles JSX now — see
 * `scripts/test-resolve.mjs`. Nothing renders here: what is asked is which of
 * five offers a stored number answers to, and that is arithmetic over a list.
 * How the segmented control draws it is `test/app/`.
 */

/** The catalogue's own `t`, answering with the key so a label can be read. */
const t = ((key: string) => key) as I18n['t']

describe('the interface scale a person chose', () => {
  test('a number that is one of the offers comes back as that offer', () => {
    assert.equal(uiScaleChoice(1), '1')
    assert.equal(uiScaleChoice(1.25), '1.25')
    assert.equal(uiScaleChoice(1.5), '1.5')
    assert.equal(uiScaleChoice(2), '2')
  })

  test('and anything else falls back to letting the screen decide', () => {
    /**
     * Zero is what "measure the screen" is stored as, so it has to land on
     * Auto rather than on a percentage. The rest are the ways a stored value
     * can stop being one of the offers — a settings file written by an older
     * RomMix, or edited by hand — and a control with nothing selected is one a
     * pad cannot tell the state of.
     */
    assert.equal(uiScaleChoice(0), 'auto')
    assert.equal(uiScaleChoice(1.75), 'auto')
    assert.equal(uiScaleChoice(-1), 'auto')
    assert.equal(uiScaleChoice(Number.NaN), 'auto')
  })

  test('every offer the control draws is one the fallback recognises', () => {
    // The two are written apart: one builds the list, the other reads a number
    // back into it. An offer neither recognises is a row that cannot be chosen
    // twice — pick it, come back, and the control has forgotten.
    for (const { value } of uiScaleOptions(t)) {
      if (value === 'auto') continue
      assert.equal(uiScaleChoice(Number(value)), value)
    }
  })

  test('only the one that is a word is translated', () => {
    // The other four are percentages, which read the same in every language
    // RomMix speaks — so a catalogue key appearing among them would be a
    // missing translation nobody notices.
    const labels = uiScaleOptions(t).map((option) => option.label)
    assert.deepEqual(labels, ['value.auto', '100%', '125%', '150%', '200%'])
  })
})
