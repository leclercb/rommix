import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Nothing the user reads is written anywhere but the catalogue.
 *
 * Most of that is already the compiler's job: `setupNotes`, `biosStagingNote`
 * and `unsyncableReason` are `Text`, so a descriptor holding a sentence does not
 * build, and `Catalog` makes a phrase missing from one language a typecheck
 * failure. What no type can reach is a string literal handed straight to
 * something that shows it — and the two that matter are here.
 *
 * Deliberately *not* checked, because they are not translated on purpose:
 *
 *  - `log.*` in the main process. The log is what gets attached to a bug
 *    report, and one written in four languages is one nobody can triage. It is
 *    written for whoever reads `rommix.log`, which is not the player.
 *  - the demo's stub library in `src/renderer/src/dev/library.ts`. That is
 *    RomM's own metadata standing in for a server response — game summaries,
 *    company names — and the real app shows those in whatever language the
 *    server holds them in.
 *  - the system table in `src/config/systems.ts`. Those are console names.
 */

const ROOT = new URL('../../..', import.meta.url).pathname

/** Every `.ts`/`.tsx` under a directory, tests and all but the catalogue. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...sources(path))
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(path)
  }
  return out
}

/** The file with its comments blanked, so prose inside one is not a finding. */
function code(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

test('every error the main process can raise is built from the catalogue', () => {
  // These reach the user: `handler.ts` turns anything thrown inside an IPC call
  // into the message the renderer shows as a toast. A literal here is a
  // sentence that stays English however RomMix is set.
  const offenders: string[] = []
  for (const path of sources('src/main')) {
    const text = code(path)
    for (const match of text.matchAll(/new (?:Romm)?Error\(\s*(.)/g)) {
      if (!`'"\``.includes(match[1])) continue
      offenders.push(`${path}:${text.slice(0, match.index).split('\n').length}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these throw a written-out message instead of t('some.key'): ${offenders.join(', ')}`
  )
})

test('the interface reads its words from the catalogue and nowhere else', () => {
  // A JSX text node that is a word rather than an expression. The renderer draws
  // what it is given, so anything sitting here in quotes or in the markup is a
  // phrase that was never offered for translation.
  const offenders: string[] = []
  for (const path of sources('src/renderer')) {
    // The demo's stub library is server data, not interface text.
    if (path.endsWith('dev/library.ts')) continue
    const text = code(path)
    for (const match of text.matchAll(/>\s*([A-Z][a-z]+(?: [a-z]+)+)\s*</g)) {
      offenders.push(`${path}:${text.slice(0, match.index).split('\n').length} — ${match[1]}`)
    }
  }
  assert.deepEqual(offenders, [], `untranslated text in the markup: ${offenders.join(', ')}`)
})
