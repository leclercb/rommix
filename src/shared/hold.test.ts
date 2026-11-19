import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startHeld } from './hold.ts'

const pressed = (index: number): { pressed: boolean }[] =>
  Array.from({ length: 17 }, (_, at) => ({ pressed: at === index }))

test('Start is read where the mapping puts it', () => {
  assert.equal(startHeld({ mapping: 'standard', buttons: pressed(9) }), true)
  assert.equal(startHeld({ mapping: '', buttons: pressed(7) }), true)
  assert.equal(startHeld({ mapping: '', buttons: pressed(9) }), true)
  // Button 7 on a standard pad is the right trigger, not Start.
  assert.equal(startHeld({ mapping: 'standard', buttons: pressed(7) }), false)
})
