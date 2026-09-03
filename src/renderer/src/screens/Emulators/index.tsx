import { type JSX, useCallback, useEffect, useRef, useState } from 'react'
import type { DiagnosticsReport } from '@shared/types'
import { Hints, PageTitle } from '../../components'
import { useApp, useI18n } from '../../state'
import { EmulatorChangeNotice, EMULATOR_CHANGE_NOTICE } from './EmulatorChangeNotice'
import { EmulatorList } from './EmulatorList'
import { PlatformList } from './PlatformList'

/**
 * What can run a game here, and what runs each platform.
 *
 * A screen of its own rather than a tab in Settings, because it is not a
 * setting: it installs software, starts it, and decides which program a
 * platform is handed to. It was also several times longer than everything else
 * in Settings put together — two lists, one of them a row per platform in the
 * library — which is a lot of page to walk past on a D-pad to reach a toggle.
 *
 * The two lists are one subject asked twice, in general and per platform, so
 * neither is read without the other in view.
 *
 * The probe and the question live here: the report *is* the two lists, and
 * whether the user meant to change the emulator a platform runs on is asked
 * from both of them.
 */
export function EmulatorsScreen(): JSX.Element {
  const { t } = useI18n()
  const { settings, saveSettings, notify } = useApp()
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null)
  const [askingChange, setAskingChange] = useState(false)
  /**
   * The half-finished emulator change waiting on an answer.
   *
   * A promise resolver rather than a stored action, so the two callers — the
   * reorder buttons and the per-platform cycle — keep their own logic and only
   * hand this the question. See `EmulatorChangeNotice`.
   */
  const changeAnswer = useRef<((allowed: boolean) => void) | null>(null)

  const dismissed = settings?.dismissedNotices ?? []
  // The one fact the callback below needs, as a boolean. `dismissed` is a fresh
  // array on every render, so depending on it made the memo recreate the
  // callback each time — which then changed on every render of the two lists
  // holding it, defeating the point of memoising it at all.
  const changeNoticeDismissed = dismissed.includes(EMULATOR_CHANGE_NOTICE)

  const confirmEmulatorChange = useCallback((): Promise<boolean> => {
    if (changeNoticeDismissed) return Promise.resolve(true)
    setAskingChange(true)
    return new Promise<boolean>((resolve) => {
      changeAnswer.current = resolve
    })
  }, [changeNoticeDismissed])

  const settleEmulatorChange = (allowed: boolean, dontAskAgain = false): void => {
    setAskingChange(false)
    if (dontAskAgain && !changeNoticeDismissed) {
      void saveSettings({ dismissedNotices: [...dismissed, EMULATOR_CHANGE_NOTICE] })
    }
    changeAnswer.current?.(allowed)
    changeAnswer.current = null
  }

  const refreshDiagnostics = useCallback(async (): Promise<void> => {
    try {
      setDiagnostics(await window.rommix.system.diagnostics())
    } catch {
      // Reported centrally on `app:error`.
    }
  }, [])

  useEffect(() => {
    void refreshDiagnostics()
  }, [refreshDiagnostics])

  return (
    <div className="content">
      <PageTitle icon="emulator">{t('nav.emulators')}</PageTitle>
      <p className="page-subtitle">{t('emulators.explainer')}</p>

      <EmulatorList
        diagnostics={diagnostics}
        notify={notify}
        confirmChange={confirmEmulatorChange}
        onInstalled={() => void refreshDiagnostics()}
      />

      <h2 className="section-title">{t('emulators.platforms')}</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        {t('emulators.platformsExplainer')}
      </p>
      <PlatformList
        chosen={settings?.systemEmulators ?? {}}
        diagnostics={diagnostics}
        overrides={settings?.systemOverrides ?? {}}
        confirmChange={confirmEmulatorChange}
        onChoose={(next) => {
          void saveSettings({ systemEmulators: next }).then(() => void refreshDiagnostics())
        }}
      />

      {askingChange ? (
        <EmulatorChangeNotice
          sharedRoms={settings?.romStorage === 'rommix'}
          onConfirm={(dontAskAgain) => settleEmulatorChange(true, dontAskAgain)}
          onCancel={() => settleEmulatorChange(false)}
        />
      ) : null}

      <Hints
        items={[
          { key: 'A', label: t('action.select') },
          { key: 'B', label: t('action.back') }
        ]}
      />
    </div>
  )
}
