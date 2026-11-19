import { ipcRenderer } from 'electron'
import { LEAVE_HOLD_MS, type PadState, startHeld } from '../shared/hold.ts'

/**
 * The preload of RomM's player window, which is RomM's page and not RomMix's.
 *
 * It exposes nothing to the page. It watches the pads for Start held down, the
 * same way out a native emulator has, and asks the main process to close the
 * window. Watched here rather than from RomMix's own window behind, so the
 * way out does not depend on a covered window still reading the pads.
 */

/** The hint element, as far as this file touches it. */
interface Hint {
  textContent: string | null
  style: Record<string, string>
  setAttribute(name: string, value: string): void
  remove(): void
}

/**
 * The page globals this file reads, typed here: the preload is built with the
 * main process's types, and pulling in the DOM library for them would retype
 * `Blob` and `fetch` across the whole of the main process.
 */
const page = globalThis as unknown as {
  navigator: { getGamepads(): readonly (PadState | null)[] }
  document: { createElement(tag: 'div'): Hint; documentElement: { append(node: Hint): void } }
  requestAnimationFrame(callback: (now: number) => void): number
}

/** How long the hint over the player stays up, and how long it takes to fade. */
const HINT_MS = 6000
const FADE_MS = 400

let since: number | null = null
let asked = false

function poll(now: number): void {
  const held = page.navigator.getGamepads().some((pad) => pad !== null && startHeld(pad))
  if (!held) since = null
  else if (since === null) since = now
  else if (!asked && now - since >= LEAVE_HOLD_MS) {
    asked = true
    ipcRenderer.send('player:leave')
  }
  page.requestAnimationFrame(poll)
}
page.requestAnimationFrame(poll)

/**
 * The way back, said over the page as it opens: the running overlay that says
 * it otherwise is in RomMix's window, under this one. The sentence comes from
 * the main process, which has the catalogue.
 */
ipcRenderer.on('player:hint', (_event, text: string) => {
  const hint = page.document.createElement('div')
  hint.textContent = text
  hint.setAttribute('role', 'status')
  Object.assign(hint.style, {
    position: 'fixed',
    top: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    padding: '12px 20px',
    borderRadius: '12px',
    background: 'rgba(11, 13, 19, 0.88)',
    color: '#ffffff',
    font: '600 18px system-ui, sans-serif',
    pointerEvents: 'none',
    transition: `opacity ${FADE_MS}ms`
  })
  page.document.documentElement.append(hint)
  setTimeout(() => {
    hint.style.opacity = '0'
    setTimeout(() => hint.remove(), FADE_MS)
  }, HINT_MS)
})
