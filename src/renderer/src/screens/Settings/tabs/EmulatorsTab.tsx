import type { JSX } from 'react'
import type { DiagnosticsReport } from '@shared/types'
import { useApp } from '../../../state'
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
  const { settings, saveSettings, notify } = useApp()

  return (
    <>
      <h2 className="section-title">Emulators</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        What RomMix found on this machine, and how many platforms each one covers. The order is the
        preference: a platform with no choice of its own is run by the first emulator here that is
        installed and covers it, so moving one up makes it the default for everything it can run.
        Platforms you have chosen for individually below are unaffected.
      </p>
      <EmulatorList
        diagnostics={diagnostics}
        notify={notify}
        confirmChange={confirmChange}
        onInstalled={onChanged}
      />

      <h2 className="section-title">Platforms</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        Which emulator runs each platform in your library. Every platform starts on a default taken
        from what these emulators normally handle; change one and RomMix uses your choice for that
        platform only, and says so rather than quietly substituting if it is missing.
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
