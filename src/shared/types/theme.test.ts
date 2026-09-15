import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_THEME, THEMES } from './theme.ts'

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

/**
 * Every colour a palette is made of, read from the default's own stylesheet:
 * that file is `:root` as well as itself, so what it names is exactly the set
 * a theme leaving one out falls back to.
 */
const PALETTE = [
  ...readFileSync(join(THEME_DIR, `${DEFAULT_THEME}.css`), 'utf8').matchAll(/^\s*(--[a-z-]+):/gm)
].map(([, token]) => token)

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

test('every palette names every colour, rather than keeping one it did not choose', () => {
  // The fallback is what makes a theme a file worth writing — and a trap for
  // the two contrast colours, which are the only ones that cannot be left
  // behind quietly: a light theme without `--accent-contrast` draws the
  // default's near-black on its own accent, and the focused control is the one
  // thing on the screen nobody can read.
  //
  // The face is the exception, and deliberately not checked: `--font` and the
  // two sizes under it are what a theme adds when it has a face of its own, so
  // most of them say nothing about any of the three.
  for (const theme of THEMES) {
    if (theme === DEFAULT_THEME) continue

    const sheet = readFileSync(join(THEME_DIR, `${theme}.css`), 'utf8')
    const missing = PALETTE.filter((token) => !new RegExp(`^\\s*${token}:`, 'm').test(sheet))

    assert.deepEqual(missing, [], `${theme} leaves ${missing.join(', ')} to ${DEFAULT_THEME}`)
  }
})

test('and says whether it is a light theme or a dark one', () => {
  // `color-scheme` is what the browser draws its own things in: the scrollbar
  // down the side of a list, a text field, the canvas behind the page. A
  // palette that does not name it keeps `dark` from `:root`, which is a light
  // theme with dark scrollbars and a dark flash before the first paint —
  // neither of them anything the tokens above can say. The default is the one
  // theme that cannot state it here, being what `:root` means; `base.css` says
  // it there.
  for (const theme of THEMES) {
    if (theme === DEFAULT_THEME) continue

    const sheet = readFileSync(join(THEME_DIR, `${theme}.css`), 'utf8')

    assert.match(sheet, /^\s*color-scheme: (light|dark);$/m, `${theme} says which it is nowhere`)
  }
})
