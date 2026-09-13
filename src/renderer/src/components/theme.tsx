import { useEffect, useState, type JSX, type Ref } from 'react'
import { DEFAULT_THEME, THEMES, type Theme } from '@shared/types'
import { Swatch } from './art'
import { FocusButton } from './controls'
import { Overlay } from './overlay'
import { StatusBadge } from './status'
import { useFocusable } from '../input/focus'
import { useApp, useI18n } from '../state'

/**
 * The theme row, and the dialog behind it.
 *
 * One component rather than a row here and a dialog there, because the preview
 * belongs to neither on its own: it is written straight onto the root element
 * and has to be taken back wherever the dialog is left. Settings asks this and
 * so does the first-run wizard, which is the other reason it is here.
 */
export function ThemeChoice({
  open = false
}: {
  /**
   * Open the dialog as soon as this is drawn, for somebody sent here to use it.
   *
   * The initial state rather than an effect, so closing the dialog closes it:
   * an effect watching this would put it back up on every render for as long as
   * the route that asked for it is the route in force.
   */
  open?: boolean
}): JSX.Element {
  const { t } = useI18n()
  const { settings, saveSettings } = useApp()
  const [choosing, setChoosing] = useState(open)
  /** The theme the dialog's highlight is on, or null when it is closed. */
  const [preview, setPreview] = useState<Theme | null>(null)
  const theme = settings?.theme ?? DEFAULT_THEME

  /*
   * The preview, painted over what `AppProvider` put on the root element.
   *
   * The dialog is a panel on the screen it is changing, so what it previews is
   * everything around it — which means writing the attribute here rather than
   * drawing a sample inside the panel. Both writers agree on the saved theme,
   * and this one is the only thing that ever says anything else.
   */
  useEffect(() => {
    document.documentElement.dataset.theme = preview ?? theme
  }, [preview, theme])

  const choose = async (next: Theme): Promise<void> => {
    // Saved before the dialog goes, so the theme on screen is never handed
    // back: closing it drops the preview, and the old colours would be up for
    // the length of the round trip if the settings did not already say this.
    await saveSettings({ theme: next })
    setPreview(null)
    setChoosing(false)
  }

  return (
    <>
      <div className="setting">
        <div className="setting__text">
          <div className="setting__label">{t('settings.theme')}</div>
          <div className="setting__hint">{t('settings.themeHint')}</div>
        </div>
        <FocusButton
          action="theme"
          actionLabel={t('settings.theme')}
          onSelect={() => setChoosing(true)}
        >
          <Swatch theme={theme} />
          {t(`settings.theme.${theme}`)}
        </FocusButton>
      </div>

      {choosing ? (
        <ThemeDialog
          current={theme}
          onPreview={setPreview}
          onPick={(next) => void choose(next)}
          onClose={() => {
            setPreview(null)
            setChoosing(false)
          }}
        />
      ) : null}
    </>
  )
}

/**
 * Which theme the interface is drawn in, asked as a list that previews.
 *
 * A row of names is the one control this choice cannot be made with: the words
 * are not what is being chosen, the colours are, and nobody picks a theme by
 * reading it. So the highlight previews — everything around this dialog is
 * drawn in whatever the pad is standing on — and nothing is saved until the
 * press. Leaving puts back the theme that was in force.
 */
function ThemeDialog({
  current,
  onPreview,
  onPick,
  onClose
}: {
  current: Theme
  /**
   * The theme under the highlight, which the screen behind is drawn in — and
   * null wherever the highlight is on something that is not a theme.
   */
  onPreview: (theme: Theme | null) => void
  onPick: (theme: Theme) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useI18n()

  return (
    <Overlay title={t('settings.theme')} icon="theme" sheer onDismiss={onClose}>
      <p className="muted">{t('settings.themeBody')}</p>
      <ul className="asset-list">
        {THEMES.map((theme) => (
          <Choice
            key={theme}
            theme={theme}
            current={theme === current}
            // Opened on the theme in force, so the first thing the pad can do
            // is walk away from it and come back.
            autoFocus={theme === current}
            onPreview={onPreview}
            onSelect={() => onPick(theme)}
          />
        ))}
      </ul>

      <div className="btn-row">
        <FocusButton icon="back" action="close-theme-choice" onSelect={onClose}>
          {t('action.close')}
        </FocusButton>
      </div>
    </Overlay>
  )
}

/** One theme, behind a dot drawn in itself. See `Swatch`. */
function Choice({
  theme,
  current,
  autoFocus,
  onPreview,
  onSelect
}: {
  theme: Theme
  current: boolean
  autoFocus: boolean
  onPreview: (theme: Theme | null) => void
  onSelect: () => void
}): JSX.Element {
  const { t } = useI18n()
  const { ref, focused, props } = useFocusable({
    onSelect,
    autoFocus,
    actionLabel: t('action.select')
  })

  /*
   * Reported from the highlight rather than from a pointer or a press: the pad
   * is what this interface is driven by, and `focused` is the one thing that
   * knows it has arrived here whichever input walked it in.
   *
   * Withdrawn again on the way out, so the screen is only ever drawn in a
   * theme the highlight is actually standing on. Walking off the list and
   * onto Close otherwise leaves the last theme walked past on screen, which
   * says the choice has been made when nothing has been saved. React runs every
   * cleanup before any effect, so moving between two rows puts the new one up
   * rather than the ground in between.
   */
  useEffect(() => {
    if (!focused) return
    onPreview(theme)
    return () => onPreview(null)
  }, [focused, theme, onPreview])

  return (
    <li ref={ref as Ref<HTMLLIElement>} data-choice={theme} data-current={current} {...props}>
      <Swatch theme={theme} />
      <span className="asset__name">{t(`settings.theme.${theme}`)}</span>
      {/* Only on the theme actually saved: with the screen already drawn in
          whatever the highlight is on, this is the one thing left saying which
          one leaving the dialog comes back to. */}
      {current ? <StatusBadge tone="ok" icon="confirm" label={t('settings.themeCurrent')} /> : null}
    </li>
  )
}
