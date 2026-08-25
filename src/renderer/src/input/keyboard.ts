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

      switch (event.key) {
        case 'ArrowUp':
          move('up')
          break
        case 'ArrowDown':
          move('down')
          break
        case 'ArrowLeft':
          move('left')
          break
        case 'ArrowRight':
          move('right')
          break
        case 'Enter':
        // Everyone tries the space bar on a button, controller UI or not.
        case ' ':
          activate()
          break
        case 'Escape':
        case 'Backspace':
          fireAction('back')
          break
        case 'Tab':
          fireAction(event.shiftKey ? 'tabLeft' : 'tabRight')
          break
        case '/':
          fireAction('search')
          break
        case 'm':
          fireAction('menu')
          break
        default:
          return
      }
      // Only past the switch: an unhandled key is someone typing somewhere
      // else, not a statement that the keyboard is now driving the UI.
      noteInput('keyboard')
      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [move, fireAction, activate, noteInput])
}
