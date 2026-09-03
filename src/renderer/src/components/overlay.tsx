import { type JSX, type ReactNode } from 'react'
import { FocusLayer, useAction, useFocusContext, useKeyLabel } from '../input/focus'
import { useI18n } from '../state'
import { Icon, type IconName } from '../icons'
import { FocusButton } from './controls'
import { Filled } from './text'

/** The frames every screen sits in: its heading, a modal over it, hints under it. */

/**
 * A screen's own heading, under the mark the menu reaches it by.
 *
 * The same icon the navigation bar uses, on purpose: a section is recognised by
 * that mark from across the room long before its name is read, and a heading
 * that dropped it made the page look like somewhere else. The two setup pages
 * pass none, having no menu item to be recognised from.
 */
export function PageTitle({
  icon,
  children
}: {
  icon?: IconName
  children: ReactNode
}): JSX.Element {
  return (
    <h1 className="page-title">
      {icon ? <Icon name={icon} size={28} /> : null}
      {children}
    </h1>
  )
}

export function Spinner(): JSX.Element {
  const { t } = useI18n()
  return <div className="spinner" aria-label={t('app.loading')} />
}

/**
 * A modal panel.
 *
 * Its contents are a focus layer of their own, so the screen behind it stops
 * being reachable while it is open — without that, the pad walks straight out
 * of a confirmation dialog onto the buttons it is asking about.
 */
export function Overlay({
  title,
  icon,
  children
}: {
  title: string
  /**
   * What this dialog is about, in the heading beside its words.
   *
   * A modal arrives over whatever the player was doing and has to say what it
   * is before it is read — from a sofa, the mark is what does that, and the
   * sentence is what confirms it. The buttons underneath have carried one all
   * along; the heading over them had nothing.
   */
  icon?: IconName
  children: ReactNode
}): JSX.Element {
  return (
    <div className="overlay">
      <div className="overlay__panel">
        <h2 className="overlay__title">
          {icon ? <Icon name={icon} size={22} /> : null}
          {title}
        </h2>
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
  const { t } = useI18n()
  return (
    <Overlay title={t('app.quitTitle')} icon="quit">
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
  const { t } = useI18n()
  useAction('back', onCancel)

  return (
    <div className="btn-row">
      <FocusButton icon="keep" onSelect={onCancel} autoFocus>
        {t('app.stay')}
      </FocusButton>
      <FocusButton icon="quit" variant="danger" onSelect={() => void window.rommix.system.quit()}>
        {t('app.quitRomMix')}
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
  const { t } = useI18n()
  const keyLabel = useKeyLabel()
  const { focusedAction } = useFocusContext()

  return (
    <div className="hints">
      <span className="hints__credit">
        {/* One sentence with the heart inside it, rather than two fragments
            around it: where the mark falls is the sentence's business, and in
            another language it does not fall in the same place. */}
        <Filled text={t('app.credit')} name="heart">
          <span className="hints__heart">♥</span>
        </Filled>
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
