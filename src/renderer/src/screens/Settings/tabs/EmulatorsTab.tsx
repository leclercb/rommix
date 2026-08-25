import type { JSX } from 'react'
import type { DiagnosticsReport } from '@shared/types'
import { useApp, useI18n } from '../../../state'
import { EmulatorList } from '../EmulatorList'
import { PlatformList } from '../PlatformList'

/**
 * What can run a game here, and what runs each platform.
 *
 * The two lists are one subject asked twice — which emulator, in general and
 * per platform — so they share a tab and neither is read without the other in
 * view. It is also the longest thing in Settings, which is most of why the rest
 * of the page is no longer under it.
 */
export function EmulatorsTab({
  diagnostics,
  confirmChange,
  onChanged
}: {
  diagnostics: DiagnosticsReport | null
  /** Ask before a change that costs a re-download. Resolves false on cancel. */
  confirmChange: () => Promise<boolean>
  /** Something changed what the machine can run: re-run the probe. */
  onChanged: () => void
}): JSX.Element {
  const { t } = useI18n()
  const { settings, saveSettings, notify } = useApp()

  return (
    <>
      <h2 className="section-title">{t('settings.emulators')}</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        {t('settings.emulatorsExplainer')}
      </p>
      <EmulatorList
        diagnostics={diagnostics}
        notify={notify}
        confirmChange={confirmChange}
        onInstalled={onChanged}
      />

      <h2 className="section-title">{t('settings.platforms')}</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        {t('settings.platformsExplainer')}
      </p>
      <PlatformList
        chosen={settings?.systemEmulators ?? {}}
        diagnostics={diagnostics}
        overrides={settings?.systemOverrides ?? {}}
        confirmChange={confirmChange}
        onChoose={(next) => {
          void saveSettings({ systemEmulators: next }).then(onChanged)
        }}
      />
    </>
  )
}
