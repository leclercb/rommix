import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { THEMES } from './theme.ts'

/**
 * That a theme in the list is a theme on the disk.
 *
 * `THEMES` is the only place a palette is named outside `styles/themes/`, and
 * the two halves are joined by nothing but the spelling: a name here with no
 * file behind it is an entry in the picker that draws midnight, saves a theme
 * nothing can apply, and reports no error anywhere.
 *
 * The catalogue half needs no test: the key a name is looked up under is built
 * as a template, so every theme is already a `MessageKey` and a phrase missing
 * from one language does not compile. What no type can reach is a stylesheet,
 * which is the rest of it.
 *
 * Beside the list rather than beside the files, because the list is the half
 * that can be wrong on its own.
 */

const THEME_DIR = new URL('../../renderer/src/styles/themes', import.meta.url).pathname

/** Every palette on the disk, by the name its file is under. */
const files = readdirSync(THEME_DIR)
  .filter((name) => name.endsWith('.css') && name !== 'index.css')
  .map((name) => name.replace(/\.css$/, ''))

test('every theme offered is a stylesheet, and every stylesheet is offered', () => {
  assert.deepEqual([...THEMES].sort(), files.sort())
})

test('every theme is imported, or the file is one nothing loads', () => {
  // The cascade is the import order in `themes/index.css`, and a file left out
  // of it is a palette that exists, is offered, and never arrives.
  const index = readFileSync(join(THEME_DIR, 'index.css'), 'utf8')

  for (const theme of THEMES) {
    assert.ok(index.includes(`@import './${theme}.css';`), `${theme} is not imported`)
  }
})

test('every theme answers to its own name, which is what a swatch asks for', () => {
  // `Swatch` puts `data-theme` on a single element so the dot is drawn in the
  // palette it offers. A file written under `:root` alone would paint the whole
  // interface and leave the picker in one colour — which is midnight's reason
  // for carrying both selectors.
  for (const theme of THEMES) {
    const sheet = readFileSync(join(THEME_DIR, `${theme}.css`), 'utf8')

    assert.match(sheet, new RegExp(`\\[data-theme='${theme}'\\]`), `${theme} names no selector`)
  }
})
