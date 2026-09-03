/**
 * The one-off steps an installation is brought through, and the record of them.
 *
 * Two failures matter and they are opposites. A step recorded when it did not
 * finish never runs again, and whatever it was supposed to fix stays broken
 * forever with nothing in the interface to say so. A step run twice is a step
 * that has to be written to survive being run twice, which is not something a
 * reader can check by looking at it. So what is asserted here is the record:
 * what goes into it, what stays out of it, and what happens to the steps behind
 * one that could not be finished.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OfflineCache } from './offline.ts'
import { MIGRATIONS, runMigrations, type Migration, type MigrationContext } from './migrations.ts'
import type { RommClient } from './romm/index.ts'
import { Store } from './store.ts'

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-migrations-test-'))
  scratches.push(dir)
  return dir
}

/** A context over a throwaway folder. No step here asks the server anything. */
function context(): MigrationContext {
  const dir = scratch()
  const client = {} as unknown as RommClient
  return {
    store: new Store(join(dir, 'config')),
    client,
    offline: new OfflineCache(join(dir, 'offline'), client)
  }
}

/** A step that records that it ran, and fails as many times as it is told to. */
function step(id: string, ran: string[], failures = 0): Migration {
  let left = failures
  return {
    id,
    async run() {
      ran.push(id)
      if (left > 0) {
        left -= 1
        throw new Error(`${id} is not ready`)
      }
    }
  }
}

describe('running the steps', () => {
  test('one that finishes is recorded, and never runs again', async () => {
    const ctx = context()
    const ran: string[] = []
    const steps = [step('first', ran)]

    await runMigrations(ctx, steps)
    await runMigrations(ctx, steps)

    assert.deepEqual(ran, ['first'])
    assert.deepEqual(ctx.store.appliedMigrations, ['first'])
  })

  test('one that fails is not recorded, and is tried again next time', async () => {
    const ctx = context()
    const ran: string[] = []
    const steps = [step('first', ran, 1)]

    await runMigrations(ctx, steps)
    assert.deepEqual(ctx.store.appliedMigrations, [])

    await runMigrations(ctx, steps)
    assert.deepEqual(ran, ['first', 'first'])
    assert.deepEqual(ctx.store.appliedMigrations, ['first'])
  })

  test('a failure stops the steps behind it, which may be counting on it', async () => {
    const ctx = context()
    const ran: string[] = []

    await runMigrations(ctx, [step('first', ran, 1), step('second', ran)])

    assert.deepEqual(ran, ['first'])
    assert.deepEqual(ctx.store.appliedMigrations, [])
  })

  test('a failure is not thrown on: a start-up is not failed by one', async () => {
    const ctx = context()
    await runMigrations(ctx, [step('first', [], 1)])
  })

  test('every id is different, or one of them would silence another', () => {
    // Empty today, and the assertion is what makes adding one safe: an id
    // reused from a step already recorded is a step that never runs.
    const ids = MIGRATIONS.map((migration) => migration.id)
    assert.equal(new Set(ids).size, ids.length)
  })
})
