/**
 * The two rules every list of saves is drawn and ordered by, and the one rule
 * that decides whether a file can be uploaded without anybody being asked.
 *
 * The last of those is the only decision in RomMix that can destroy something
 * nobody can get back: a save pushed over a newer one made on another device is
 * gone from both ends. So the assertions here are mostly about what is *not*
 * sent — the cases where the honest answer is to stop and ask.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { PendingSave } from './types/index.ts'
import { mayBeSentUnasked } from './saveassets.ts'

function pending(replaces: PendingSave['replaces']): PendingSave {
  return {
    kind: 'save',
    fileName: 'Sonic the Hedgehog (USA).srm',
    path: '/saves/Sonic the Hedgehog (USA).srm',
    sizeBytes: 8192,
    modifiedAt: '2026-08-10T12:00:00.000Z',
    emulator: 'retroarch',
    isDirectory: false,
    replaces
  }
}

function serverCopy(fields: Partial<NonNullable<PendingSave['replaces']>>) {
  return {
    sizeBytes: 8192,
    updatedAt: '2026-08-01T12:00:00.000Z',
    emulator: 'retroarch',
    fromThisDevice: null,
    originName: null,
    isNewer: false,
    ...fields
  }
}

describe('sending a save nobody was asked about', () => {
  test('a name RomM holds nothing under has nothing to lose', () => {
    assert.equal(mayBeSentUnasked(pending(null)), true)
  })

  test('the copy up there being this device’s own is a continuation', () => {
    // The common case by far: one console, played away from the network, and
    // the newest copy on the server is the one it uploaded last time.
    assert.equal(mayBeSentUnasked(pending(serverCopy({ fromThisDevice: true }))), true)
  })

  test('a copy from another device is never written over unasked', () => {
    assert.equal(mayBeSentUnasked(pending(serverCopy({ fromThisDevice: false }))), false)
  })

  test('a copy RomM records no origin for is not this device’s to assume', () => {
    // Every save state lands here: RomM stores no origin for them at all.
    assert.equal(mayBeSentUnasked(pending(serverCopy({ fromThisDevice: null }))), false)
  })

  test('a server copy that has moved on is a question however it got there', () => {
    assert.equal(
      mayBeSentUnasked(pending(serverCopy({ fromThisDevice: true, isNewer: true }))),
      false
    )
  })
})
