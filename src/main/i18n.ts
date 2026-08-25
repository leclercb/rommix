import { app } from 'electron'
import {
  createI18n,
  localeFor,
  type I18n,
  type LanguageChoice,
  type MessageKey,
  type MessageParams
} from '@shared/i18n'

/**
 * The language the main process writes in.
 *
 * Everything it tells the user — a launch that failed, a BIOS with nowhere to
 * go, a folder it cannot write to — is translated here, before it crosses IPC.
 * The renderer therefore receives sentences rather than keys, and there is no
 * way for a message and the screen it lands on to end up in two different
 * languages.
 *
 * Module state rather than something threaded through every call: the language
 * is one setting for the whole application, and a `RommError` thrown six frames
 * down inside a save scan has no business being handed a locale to be able to
 * say what went wrong.
 */

let choice: LanguageChoice = 'auto'
let cached: I18n | null = null

/** Follow this choice from now on. Called at start-up and whenever it changes. */
export function setLanguage(next: LanguageChoice): void {
  choice = next
  cached = null
}

/**
 * The formatter and catalogue for the current language.
 *
 * `app.getLocale()` is only meaningful once Electron is ready, and something
 * logged or thrown before then must not freeze English in for the session — so
 * the answer is cached only from the point where it can be trusted.
 * `createI18n` caches per language anyway, so the uncached path is a map
 * lookup.
 */
export function i18n(): I18n {
  if (cached) return cached
  const ready = app.isReady()
  const resolved = createI18n(localeFor(choice, ready ? app.getLocale() : null))
  if (ready) cached = resolved
  return resolved
}

/** One phrase, in the current language. The main process's whole vocabulary. */
export function t(key: MessageKey, params?: MessageParams): string {
  return i18n().t(key, params)
}
