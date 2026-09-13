import type { JSX } from 'react'
import { THEMES_NOTICE } from '@shared/types'
import { FocusButton, Overlay } from './components'
import { useApp, useI18n } from './state'

/**
 * Said once, to somebody who had RomMix before it had palettes.
 *
 * A setting nobody knows about is a setting nobody has, and this one is three
 * levels down a menu that most people open twice. The alternative — a badge, or
 * a row that highlights itself — says there is something new without saying
 * what, on a screen the player has to go looking for anyway.
 *
 * Only for an installation that was already in use: the key is written into a
 * fresh folder's `dismissedNotices` before it ever draws a screen, by the
 * `announce-themes` migration. Dismissed by either button, so it is seen once
 * whichever way it is left, and B leaves it the same as Not now.
 */
export function ThemesNotice(): JSX.Element | null {
  const { t } = useI18n()
  const { settings, saveSettings, navigate } = useApp()

  const dismissed = settings?.dismissedNotices ?? []
  // Nothing until the settings have arrived, and nothing during the first-run
  // wizard: somebody being asked which language RomMix should speak is not
  // somebody who needs to be told what changed since last time.
  if (!settings?.setupComplete || dismissed.includes(THEMES_NOTICE)) return null

  const dismiss = async (): Promise<void> => {
    await saveSettings({ dismissedNotices: [...dismissed, THEMES_NOTICE] })
  }

  return (
    <Overlay title={t('themes.noticeTitle')} icon="theme">
      <p className="muted">{t('themes.noticeBody')}</p>
      <div className="btn-row">
        {/* The way to the thing being announced is what this dialog is for, and
            it is focused for that reason: nothing here is a change, so a press
            that arrives by accident costs a trip to Settings and a B. */}
        <FocusButton
          icon="theme"
          action="themes-notice-choose"
          variant="primary"
          autoFocus
          onSelect={() => {
            void dismiss()
            navigate({ name: 'settings' })
          }}
        >
          {t('themes.noticeChoose')}
        </FocusButton>
        <FocusButton icon="keep" action="themes-notice-later" onSelect={() => void dismiss()}>
          {t('themes.noticeLater')}
        </FocusButton>
      </div>
    </Overlay>
  )
}
