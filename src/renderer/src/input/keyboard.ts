import { useEffect } from 'react'
import type { I18n } from '@shared/i18n'
import type { Action, Direction, InputKind } from './types'

/**
 * The keyboard, standing in for the pad.
 *
 * Arrow keys move, Enter selects, Escape goes back — the same five actions the
 * controller produces, so nothing downstream has to know which was used.
 */

/**
 * What a controller button is called on the keyboard that stands in for it.
 *
 * Two of the seven are words and are translated; the rest are what is printed
 * on the key itself — `Tab`, `M`, `/` — which no language changes.
 */
export function keyboardLabel(key: string, t: I18n['t']): string | undefined {
  switch (key) {
    case 'A':
      return t('key.enter')
    case 'B':
      return t('key.esc')
    case 'X':
    case 'START':
      return 'M'
    case 'Y':
      return '/'
    case 'LB':
      return 'Shift+Tab'
    case 'RB':
      return 'Tab'
    default:
      return undefined
  }
}

/**
 * What one key press means, or null where it means nothing here.
 *
 * Split out of the handler so it can be tested, the same reason `geometry.ts`
 * was split out of `focus.tsx`: the rule worth pinning is that every key
 * `keyboardLabel` advertises is one this answers for — the hint bar drew `M`
 * uppercase while the switch tested `'m'`, so with Caps Lock on the press that
 * matched the label did nothing, and nothing anywhere could have caught it.
 *
 * Letters are lower-cased for that reason. `event.key` is what the shift state
 * produced, and which case a letter arrives in says nothing about what was
 * meant by it.
 */
export function intentOf(
  key: string,
  shiftKey = false
): { move: Direction } | { action: Action } | { activate: true } | null {
  switch (key.length === 1 ? key.toLowerCase() : key) {
    case 'ArrowUp':
      return { move: 'up' }
    case 'ArrowDown':
      return { move: 'down' }
    case 'ArrowLeft':
      return { move: 'left' }
    case 'ArrowRight':
      return { move: 'right' }
    case 'Enter':
    // Everyone tries the space bar on a button, controller UI or not.
    case ' ':
      return { activate: true }
    case 'Escape':
    case 'Backspace':
      return { action: 'back' }
    case 'Tab':
      return { action: shiftKey ? 'tabLeft' : 'tabRight' }
    case '/':
      return { action: 'search' }
    case 'm':
      return { action: 'menu' }
    default:
      return null
  }
}

export function useKeyboard(
  move: (direction: Direction) => void,
  fireAction: (action: Action) => void,
  activate: () => void,
  noteInput: (kind: InputKind) => void
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Let text fields have their keys.
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (typing && event.key !== 'Escape') return

      const intent = intentOf(event.key, event.shiftKey)
      // An unhandled key is someone typing somewhere else, not a statement that
      // the keyboard is now driving the UI.
      if (!intent) return

      if ('move' in intent) move(intent.move)
      else if ('activate' in intent) activate()
      else fireAction(intent.action)

      noteInput('keyboard')
      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [move, fireAction, activate, noteInput])
}
