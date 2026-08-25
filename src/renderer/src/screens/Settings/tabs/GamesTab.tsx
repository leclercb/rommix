import type { JSX } from 'react'
import type { RootLocation } from '@shared/types'
import { RomStorageChoice, Toggle } from '../../../components'
import { useApp, useI18n } from '../../../state'

/**
 * What happens to a game around playing it: where the file is written, and what
 * is done with the saves it leaves behind.
 *
 * One tab because they are one story told in order — download, play, sync — and
 * because every switch here is answered with On or Off and reads as a list.
 */
export function GamesTab({ root }: { root: RootLocation | null }): JSX.Element {
  const { t } = useI18n()
  const { settings, saveSettings, notify } = useApp()
  if (!settings) return <></>

  return (
    <>
      <h2 className="section-title">{t('settings.gamesOnDisk')}</h2>
      <RomStorageChoice
        value={settings.romStorage}
        onChange={(next) => {
          if (next === settings.romStorage) return
          void saveSettings({ romStorage: next }).then(() =>
            notify(
              next === 'rommix' ? t('settings.storageToRomMix') : t('settings.storageToEmulator'),
              'warn'
            )
          )
        }}
      />
      {/* The folder to add to Eden, RetroArch and the rest. Only worth naming
          where it is the one being used — otherwise it is a path to a folder
          nothing writes to. */}
      {settings.romStorage === 'rommix' && root ? (
        <p className="faint" style={{ fontSize: 14 }}>
          {t('settings.sharedFolderNote', { path: root.current })}
        </p>
      ) : null}

      <h2 className="section-title">{t('settings.saveSync')}</h2>
      <Toggle
        label={t('settings.syncDown')}
        hint={t('settings.syncDownHint')}
        on={settings.syncSavesDown}
        onToggle={() => void saveSettings({ syncSavesDown: !settings.syncSavesDown })}
      />
      <Toggle
        label={t('settings.syncUp')}
        hint={t('settings.syncUpHint')}
        on={settings.syncSavesUp}
        onToggle={() => void saveSettings({ syncSavesUp: !settings.syncSavesUp })}
      />
      <Toggle
        label={t('settings.confirmPush')}
        hint={t('settings.confirmPushHint')}
        on={settings.confirmSavePush}
        onToggle={() => void saveSettings({ confirmSavePush: !settings.confirmSavePush })}
      />

      <h2 className="section-title">{t('nav.downloads')}</h2>
      <Toggle
        label={t('settings.confirmUninstall')}
        hint={t('settings.confirmUninstallHint')}
        on={settings.confirmUninstall}
        onToggle={() => void saveSettings({ confirmUninstall: !settings.confirmUninstall })}
      />
    </>
  )
}
