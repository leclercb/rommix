import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { setLanguage, t } from './i18n.ts'

/**
 * The language the main process writes in.
 *
 * Module state, and a cache in front of it, which is the pair worth checking:
 * everything the main process tells the user is translated before it crosses
 * IPC, so a language that does not take effect is every error message in the
 * wrong language until a restart — with nothing to indicate why.
 *
 * Out here Electron is never ready, so `i18n()` deliberately does not cache and
 * the desktop's own locale is never consulted. What is left is exactly the part
 * that is RomMix's: the stored choice.
 */

afterEach(() => {
  setLanguage('auto')
})

test('a chosen language is what the main process writes in', () => {
  setLanguage('fr')
  const french = t('action.cancel')

  setLanguage('de')
  const german = t('action.cancel')

  assert.notEqual(french, german)
  assert.ok(french.length > 0)
  assert.ok(german.length > 0)
})

test('a change of language takes effect on the next phrase, not the next restart', () => {
  setLanguage('es')
  const before = t('action.cancel')

  setLanguage('en')

  assert.notEqual(t('action.cancel'), before)
  assert.equal(t('action.cancel'), 'Cancel')
})

test('with no Electron to ask, auto falls back to English rather than throwing', () => {
  // `app.getLocale()` is only meaningful once Electron is ready, and asking it
  // before then throws — see the stub in scripts/test-resolve.mjs. Every error
  // the main process raises passes through here, so this path has to answer.
  setLanguage('auto')

  assert.equal(t('action.cancel'), 'Cancel')
})
