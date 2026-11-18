import type { JSX } from 'react'
import { Toggle } from './controls'
import { useApp, useI18n } from '../state'

/**
 * The switch for `Settings.acceptSelfSigned`.
 *
 * On the sign-in form, because pairing is the first request to the server and
 * a certificate it will not trust fails it; and in Settings, for a server that
 * changes certificate later. Saved as it is flipped, so the next request
 * already uses it.
 */
export function SelfSignedToggle(): JSX.Element {
  const { t } = useI18n()
  const { settings, saveSettings } = useApp()
  return (
    <Toggle
      label={t('connect.acceptSelfSigned')}
      hint={t('connect.acceptSelfSignedHint')}
      on={settings?.acceptSelfSigned ?? false}
      onToggle={() => void saveSettings({ acceptSelfSigned: !settings?.acceptSelfSigned })}
    />
  )
}
