import { log } from './log.ts'
import type { OfflineCache } from './offline.ts'
import type { RommClient } from './romm/index.ts'
import type { Store } from './store.ts'

/**
 * One-off work an existing installation needs and a fresh one does not.
 *
 * A new field is easy: everything written from here on carries it. What is hard
 * is the folder somebody has been using for a year, where the same field is
 * missing from every record already on the disk — and the answer cannot be a
 * check on the read path, because then it is there forever and nothing ever
 * finishes the job.
 *
 * So each of those is a named step that runs once, recorded by name so it does
 * not run again. Ordered, and a step that fails stops the ones behind it: a
 * later step may be written expecting an earlier one to have happened, and
 * running it against a folder where it did not is worse than running neither.
 *
 * A failure is not fatal and not final. The step stays unrecorded and is tried
 * again — at the next start, and whenever RomMix reconnects, which is what the
 * one below needs, since back-filling what RomM knows about a game means asking
 * RomM.
 */

/** What every migration is handed. */
export interface MigrationContext {
  store: Store
  client: RommClient
  offline: OfflineCache
}

export interface Migration {
  /**
   * How this step is recorded, and therefore never reused or renamed: a changed
   * id is a step that runs a second time, on every installation that already
   * did it.
   */
  id: string
  /** Throws to leave the step unrecorded, so it is tried again later. */
  run(context: MigrationContext): Promise<void>
}

/**
 * Every migration, oldest first. Order is the order they run in.
 *
 * Empty, and that is the state to expect between changes: a step belongs here
 * only while there are folders in the wild that have not been through it, and
 * work that has to happen *again* — a list that must keep up with the server,
 * a record that can fail and be wanted later — is not a migration at all. See
 * `rememberInstalledGames` for the shape that one took instead.
 */
export const MIGRATIONS: readonly Migration[] = []

/**
 * Run whatever has not run yet, and record each one that finishes.
 *
 * Never throws: a migration that cannot be finished today is a line in the log
 * and another attempt later, not a reason to fail a start-up.
 */
export async function runMigrations(
  context: MigrationContext,
  migrations: readonly Migration[] = MIGRATIONS
): Promise<void> {
  const done = new Set(context.store.appliedMigrations)

  for (const migration of migrations) {
    if (done.has(migration.id)) continue
    const took = log.since()
    // Before it runs, not only after. A step that takes the process down with
    // it — or is still going when somebody pulls the power — is otherwise a
    // start-up that stopped with nothing to say which step it was in.
    log.info('migrate', 'running', { id: migration.id })
    try {
      await migration.run(context)
      context.store.recordMigration(migration.id)
      log.info('migrate', 'finished', { id: migration.id, ms: took() })
    } catch (cause) {
      log.warn('migrate', 'could not be finished, and will be tried again', {
        id: migration.id,
        reason: (cause as Error).message,
        ms: took()
      })
      return
    }
  }
}
