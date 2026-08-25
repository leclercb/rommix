/**
 * Render the landing page, once per language, into `out/site`.
 *
 * `site/index.html` is a template: one copy of the layout, the stylesheet and
 * the drawing of the app, with `{{key}}` where the prose goes. This fills those
 * in from `site/text/<lang>.json` and writes English to the root and the rest
 * into `fr/`, `de/` and `es/` beside it — so a reader lands on `/fr/`, and
 * every asset and link still points at the one copy under the root.
 *
 * Two sources of text, and the distinction is the point:
 *
 *  - `{{key}}` is the page's own prose, in `site/text/`. Nothing else uses it.
 *  - `{{@key}}` is the *application's* catalogue, `src/shared/i18n/`. The
 *    picture on the page is a drawing of RomMix, so its menu, its shelf titles
 *    and its hint bar are read from what RomMix actually says. A label renamed
 *    in the app changes the picture too, and a key deleted there fails this
 *    build rather than leaving a drawing that quietly lies.
 *
 * Every placeholder must resolve and every key must be used. Both directions
 * are errors: a missing one would ship `{{does.title}}` as a heading, and an
 * unused one is a translation of something that is no longer on the page.
 *
 * Run through `node --experimental-transform-types`, which is what lets it
 * import the catalogue's TypeScript directly. No bundler is involved and the
 * rendered pages still contain no script of their own.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createI18n, LANGUAGE_NAMES, LOCALES } from '../src/shared/i18n/index.ts'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'out/site')

/** Where the published site lives, for the `hreflang` links search engines want. */
const SITE = 'https://leclercb.github.io/rommix'

/** The language the site is served from its root, and the one others fall back to. */
const DEFAULT = 'en'

/** `fr` lives at `/fr/`; English is the root itself. */
const pathOf = (locale) => (locale === DEFAULT ? '' : `${locale}/`)

/** How deep a page sits, as the prefix that gets back to the site root. */
const rootOf = (locale) => (locale === DEFAULT ? './' : '../')

async function render(template, locale) {
  const page = JSON.parse(await readFile(resolve(ROOT, 'site/text', `${locale}.json`), 'utf8'))
  const { t } = createI18n(locale)
  const used = new Set()

  // The other three, each named in itself — the one form a reader looking for
  // their own language recognises without being able to read the page yet.
  //
  // Indented here rather than in the template, which prettier keeps on one line
  // because a placeholder is, as far as it knows, a word.
  const languages = [
    '',
    ...LOCALES.map((other) =>
      other === locale
        ? `          <span aria-current="page">${LANGUAGE_NAMES[other]}</span>`
        : `          <a href="${rootOf(locale)}${pathOf(other)}" hreflang="${other}" lang="${other}">${LANGUAGE_NAMES[other]}</a>`
    ),
    '        '
  ].join('\n')

  const alternates = [
    ...LOCALES.map(
      (other) => `    <link rel="alternate" hreflang="${other}" href="${SITE}/${pathOf(other)}" />`
    ),
    `    <link rel="alternate" hreflang="x-default" href="${SITE}/" />`
  ].join('\n')

  const fixed = { lang: locale, root: rootOf(locale), languages, alternates }

  const rendered = template.replace(/\{\{(@?[\w.]+)\}\}/g, (whole, key) => {
    if (key in fixed) return fixed[key]
    // The application's own words, for the parts of the page that are a
    // drawing of it. `t` answers with the key itself when there is none, which
    // would be invisible here — so it is checked rather than trusted.
    if (key.startsWith('@')) {
      const phrase = t(key.slice(1))
      if (phrase === key.slice(1)) {
        throw new Error(`${locale}: the application catalogue has no ${key.slice(1)}`)
      }
      // The one phrase on this page that wraps something that is not text.
      return phrase.replace('{heart}', '<i>♥</i>')
    }
    if (!(key in page)) throw new Error(`${locale}: site/text/${locale}.json has no ${key}`)
    used.add(key)
    return page[key]
  })

  const spare = Object.keys(page).filter((key) => !key.startsWith('_') && !used.has(key))
  if (spare.length > 0) {
    throw new Error(`${locale}: nothing on the page uses ${spare.join(', ')}`)
  }

  const target = resolve(OUT, pathOf(locale), 'index.html')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, rendered, 'utf8')
  return target
}

const source = await readFile(resolve(ROOT, 'site/index.html'), 'utf8')

// The template's own comment is a note to whoever edits it — about placeholders
// and where the two halves of the site come from — and has no business being
// served. What replaces it says which file the page came from, which is the one
// thing a reader viewing source might actually want.
const template = source.replace(
  /^<!doctype html>\n<!--[\s\S]*?-->\n/,
  '<!doctype html>\n<!-- Rendered from site/index.html by scripts/build-landing.mjs. -->\n'
)
if (template === source) throw new Error('site/index.html has lost its header comment')

for (const locale of LOCALES) {
  const target = await render(template, locale)
  console.log(`    ${locale} -> ${target.slice(ROOT.length + 1)}`)
}
