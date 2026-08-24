import type { JSX } from 'react'
import type { RootLocation } from '@shared/types'
import { RomStorageChoice, Toggle } from '../../../components'
import { useApp } from '../../../state'

/**
 * What happens to a game around playing it: where the file is written, and what
 * is done with the saves it leaves behind.
 *
 * One tab because they are one story told in order — download, play, sync — and
 * because every switch here is answered with On or Off and reads as a list.
 */
export function GamesTab({ root }: { root: RootLocation | null }): JSX.Element {
  const { settings, saveSettings, notify } = useApp()
  if (!settings) return <></>

  return (
    <>
      <h2 className="section-title">Games on disk</h2>
      <RomStorageChoice
        value={settings.romStorage}
        onChange={(next) => {
          if (next === settings.romStorage) return
          void saveSettings({ romStorage: next }).then(() =>
            notify(
              next === 'rommix'
                ? 'New downloads go to the RomMix folder — add it to each emulator'
                : "New downloads go to each emulator's own folder",
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
          Games are written to {root.current}/roms/&lt;system&gt;. Games already downloaded into an
          emulator&apos;s own folder stay there and are offered for download again; switch back and
          they reappear.
        </p>
      ) : null}

      <h2 className="section-title">Save sync</h2>
      <Toggle
        label="Download newer saves before playing"
        hint="Only when strictly newer. The local file is kept as *.rommix-bak."
        on={settings.syncSavesDown}
        onToggle={() => void saveSettings({ syncSavesDown: !settings.syncSavesDown })}
      />
      <Toggle
        label="Upload saves after playing"
        hint="Only what the session wrote is sent."
        on={settings.syncSavesUp}
        onToggle={() => void saveSettings({ syncSavesUp: !settings.syncSavesUp })}
      />
      <Toggle
        label="Ask before sending saves to RomM"
        hint="Shows what will be sent before sending it."
        on={settings.confirmSavePush}
        onToggle={() => void saveSettings({ confirmSavePush: !settings.confirmSavePush })}
      />

      <h2 className="section-title">Downloads</h2>
      <Toggle
        label="Ask before deleting a downloaded game"
        hint="Uninstall is one A press from deleting a multi-gigabyte file."
        on={settings.confirmUninstall}
        onToggle={() => void saveSettings({ confirmUninstall: !settings.confirmUninstall })}
      />
    </>
  )
}
