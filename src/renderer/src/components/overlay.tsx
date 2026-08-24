import { type JSX, type ReactNode } from 'react'
import { FocusLayer, useAction, useFocusContext, useKeyLabel } from '../input/focus'
import { FocusButton } from './controls'

/** The two frames every screen sits in: a modal over it, hints under it. */

export function Spinner(): JSX.Element {
  return <div className="spinner" aria-label="Loading" />
}

/**
 * A modal panel.
 *
 * Its contents are a focus layer of their own, so the screen behind it stops
 * being reachable while it is open — without that, the pad walks straight out
 * of a confirmation dialog onto the buttons it is asking about.
 */
export function Overlay({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="overlay">
      <div className="overlay__panel">
        <h2 className="overlay__title">{title}</h2>
        <FocusLayer>{children}</FocusLayer>
      </div>
    </div>
  )
}

/**
 * "Quit RomMix?", asked the same way wherever it is asked from.
 *
 * Here rather than in `App` because the connect screen asks it too, and that
 * screen is imported *by* `App` — a copy in each would be two dialogs to keep
 * in step, and importing one from the other would be a cycle.
 *
 * It matters most on the connect screen, which has no menu bar to climb into
 * and nothing behind it: without this, B there does nothing and a controller
 * has no way out of RomMix at all until a server has been configured.
 */
export function QuitOverlay({ onCancel }: { onCancel: () => void }): JSX.Element {
  return (
    <Overlay title="Quit RomMix?">
      <QuitActions onCancel={onCancel} />
    </Overlay>
  )
}

/**
 * The two answers.
 *
 * A child of the overlay rather than part of it: `useAction` registers on the
 * layer it is *called* from, and only inside `Overlay` is that the layer the
 * dialog is on. B here means "no" — the same button that opened the dialog
 * closes it, so a press too many lands back where it started.
 */
function QuitActions({ onCancel }: { onCancel: () => void }): JSX.Element {
  useAction('back', onCancel)

  return (
    <div className="btn-row">
      <FocusButton icon="keep" onSelect={onCancel} autoFocus>
        Stay
      </FocusButton>
      <FocusButton icon="quit" variant="danger" onSelect={() => void window.rommix.system.quit()}>
        Quit RomMix
      </FocusButton>
    </div>
  )
}

/**
 * The footer: who made this on the left, what the buttons do on the right.
 *
 * Call sites name controller buttons; what is drawn is whatever the player is
 * actually holding, so the bar stops telling a keyboard user to press A.
 *
 * The signature lives here because every screen draws this bar, which makes it
 * the only strip in the app that is genuinely always on screen — and because
 * the far end of it is the one place a line nobody needs to read can sit
 * without being in the way of something that must be.
 */
export function Hints({ items }: { items: { key: string; label: string }[] }): JSX.Element {
  const keyLabel = useKeyLabel()
  const { focusedAction } = useFocusContext()

  return (
    <div className="hints">
      <span className="hints__credit">
        Developed with <span className="hints__heart">♥</span> by leclercb
      </span>
      {items.map((item) => (
        <span key={item.key + item.label}>
          <span className="hint__key">{keyLabel(item.key)}</span>
          {/* A is whatever is focused, when it has said what it does: the
              screen's own label describes one action out of several and is
              wrong the moment focus moves off it. Every other key is a screen
              or app binding, and means the same wherever focus happens to be. */}
          {item.key === 'A' && focusedAction ? focusedAction : item.label}
        </span>
      ))}
    </div>
  )
}
