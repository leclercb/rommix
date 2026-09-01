import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DATE_FORMATS,
  createI18n,
  dateFormatSample,
  localize,
  resolveLocale,
  localeFor
} from './index.ts'
import { de } from './de.ts'
import { en } from './en.ts'
import { es } from './es.ts'
import { fr } from './fr.ts'
import type { Catalog } from './catalog.ts'

/**
 * What the type system cannot check about a translation.
 *
 * `Catalog` already guarantees that every language has every key — a missing
 * one does not compile. What it says nothing about is whether the *sentence* is
 * still the same sentence: a translator who drops `{count}` produces a phrase
 * that typechecks, reads fine in isolation, and silently stops naming the
 * number it is about. Same for a plural set with only half its forms, which
 * comes out as the key on every screen that hits the missing one.
 *
 * So these are the three invariants worth pinning, and they are pinned against
 * English rather than against a list written out here: English is the
 * catalogue, and a second copy of the placeholders would be the thing that goes
 * stale.
 */

const CATALOGUES: Record<string, Catalog> = { fr, de, es }

/** Every `{placeholder}` in a phrase, in no particular order. */
function placeholders(phrase: string): Set<string> {
  return new Set([...phrase.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))
}

test('every language substitutes exactly what English does', () => {
  for (const [language, catalog] of Object.entries(CATALOGUES)) {
    for (const [key, phrase] of Object.entries(en)) {
      const mine = placeholders((catalog as Record<string, string>)[key])
      const theirs = placeholders(phrase)
      assert.deepEqual(
        [...mine].sort(),
        [...theirs].sort(),
        `${language} ${key} does not fill in the same values as English`
      )
    }
  }
})

test('a plural set is complete in every language, English included', () => {
  // `_one` without `_other` is the shape that fails silently: `t` falls back to
  // `_other`, finds nothing, and puts the key on the screen.
  for (const [language, catalog] of Object.entries({ en, ...CATALOGUES })) {
    const keys = Object.keys(catalog)
    for (const key of keys) {
      const stem = /^(.*)_(one|other|zero|two|few|many)$/.exec(key)
      if (!stem) continue
      assert.ok(
        keys.includes(`${stem[1]}_other`),
        `${language} has ${key} but no ${stem[1]}_other to fall back to`
      )
    }
  }
})

test('no phrase is left in English by accident', () => {
  // Not every entry differs — 'Flatpak', 'BIOS', 'Auto' and the Kickstart
  // versions are the same word everywhere, and translating a product name would
  // be the actual mistake. What this catches is a whole section pasted across
  // untranslated, which is why it is a proportion rather than a per-key rule.
  for (const [language, catalog] of Object.entries(CATALOGUES)) {
    const entries = Object.entries(en)
    const same = entries.filter(
      ([key, phrase]) => (catalog as Record<string, string>)[key] === phrase
    )
    assert.ok(
      same.length < entries.length / 10,
      `${language} still matches English for ${same.length} of ${entries.length} phrases`
    )
  }
})

test('the plural form follows the language rather than a comparison with one', () => {
  // French keeps the singular for zero; German and Spanish do not. Anything
  // written as `count === 1 ? … : …` is wrong in one of these three.
  assert.equal(createI18n('fr').t('library.count', { count: 0 }), '0 jeu')
  assert.equal(createI18n('de').t('library.count', { count: 0 }), '0 Spiele')
  assert.equal(createI18n('es').t('library.count', { count: 1 }), '1 juego')
  assert.equal(createI18n('en').t('library.count', { count: 2 }), '2 games')
})

test('numbers are written the way the language writes them', () => {
  assert.equal(createI18n('en').t('library.count', { count: 1234 }), '1,234 games')
  assert.equal(createI18n('de').t('library.count', { count: 1234 }), '1.234 Spiele')
  assert.equal(createI18n('fr').formatBytes(1536), '1,5 KB')
  assert.equal(createI18n('en').formatBytes(1536), '1.5 KB')
  // No size at all is a dash rather than "0 B": the callers are describing a
  // file whose size is not known, not one that is empty.
  assert.equal(createI18n('en').formatBytes(0), '—')
})

test('a value the caller does not supply is left standing', () => {
  // `EmulatorList` relies on this: it leaves `{homepage}` unfilled so that
  // `Filled` can split the sentence there and put an element in its place.
  assert.equal(
    createI18n('en').t('emulator.manualInstallFrom', { name: 'Eden' }),
    'Eden has to be installed by hand, from {homepage}.'
  )
})

test('a timestamp that is not one is nothing, not "Invalid Date"', () => {
  const i18n = createI18n('en')
  assert.equal(i18n.formatDateTime(null), null)
  assert.equal(i18n.formatDateTime('not a date'), null)
  assert.ok(i18n.formatDateTime('2026-08-24T09:05:00Z'))
})

test('each date format writes the same instant its own way', () => {
  // Local time throughout: these are file times and release dates being read
  // off the clock the reader is sitting at, so the test builds one that way.
  const at = new Date(2026, 8, 1, 21, 20)

  assert.equal(createI18n('en', 'dmy').formatDateTime(at.toISOString()), '01/09/2026 21:20')
  assert.equal(createI18n('en', 'mdy').formatDateTime(at.toISOString()), '09/01/2026 21:20')
  assert.equal(createI18n('en', 'iso').formatDateTime(at.toISOString()), '2026-09-01 21:20')
})

test('the fixed formats are the same in every language, and `language` is not', () => {
  const at = new Date(2026, 8, 1, 21, 20).toISOString()

  // The point of choosing one: it is the order asked for, whoever is reading.
  assert.equal(
    createI18n('de', 'dmy').formatDateTime(at),
    createI18n('es', 'dmy').formatDateTime(at)
  )
  assert.notEqual(
    createI18n('de', 'language').formatDateTime(at),
    createI18n('en', 'language').formatDateTime(at)
  )
})

test('a date with no time of day follows the same choice', () => {
  // Both formatters, or the release date on the Details tab reads in an order
  // the file dates above it do not.
  const at = new Date(2026, 8, 1)
  assert.equal(createI18n('en', 'dmy').formatDate(at), '01/09/2026')
  assert.equal(createI18n('en', 'iso').formatDate(at), '2026-09-01')
})

test('the sample in Settings tells the two numeric orders apart', () => {
  // A day past the twelfth, or the row offering both would show the same
  // string twice on eleven days in twelve.
  assert.equal(dateFormatSample('en', 'dmy'), '25/12/2026')
  assert.equal(dateFormatSample('en', 'mdy'), '12/25/2026')
  assert.notEqual(dateFormatSample('en', 'dmy'), dateFormatSample('en', 'mdy'))
})

test('midnight is 00:00 rather than 24:00, in every format', () => {
  const at = new Date(2026, 8, 1, 0, 0).toISOString()
  for (const format of DATE_FORMATS) {
    assert.match(createI18n('en', format).formatDateTime(at) ?? '', /00:00/)
  }
})

test('an unknown language tag falls back to English', () => {
  assert.equal(resolveLocale('is'), 'en')
  assert.equal(resolveLocale(null), 'en')
  // Regional variants are the same catalogue: RomMix draws no distinction, and
  // treating fr-CA as unknown would put a French desktop into English.
  assert.equal(resolveLocale('fr-CA'), 'fr')
  assert.equal(resolveLocale('de_AT'), 'de')
})

test('a stored choice wins over the machine, and auto defers to it', () => {
  assert.equal(localeFor('es', 'de-DE'), 'es')
  assert.equal(localeFor('auto', 'de-DE'), 'de')
  assert.equal(localeFor(null, 'pt-BR'), 'en')
})

test('a phrase a descriptor names is read in the language asked for', () => {
  // What the emulator descriptors hold: a key, or a key and the values it needs
  // filled in. Neither is a sentence, which is the point — they run where there
  // is no language to write one in.
  assert.equal(localize('saves.dolphin', createI18n('en')), en['saves.dolphin'])
  assert.equal(localize('saves.dolphin', createI18n('de')), de['saves.dolphin'])

  const named = { key: 'saves.switchNoProfile', params: { emulator: 'Eden' } } as const
  assert.match(localize(named, createI18n('fr')), /Eden/)
  assert.notEqual(localize(named, createI18n('fr')), localize(named, createI18n('en')))

  assert.equal(localize(null, createI18n('es')), null)
})
