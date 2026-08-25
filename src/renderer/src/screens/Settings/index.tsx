import { type JSX, useCallback, useEffect, useState } from 'react'
import type { DiagnosticsReport, RootLocation } from '@shared/types'
import { Hints, Spinner, Tabs } from '../../components'
import { useApp, useI18n } from '../../state'
import { GamesTab, GeneralTab, SystemTab } from './tabs'

/**
 * Settings, in three tabs.
 *
 * One column before, and it had grown to a page you scrolled through twice to
 * find a switch: the server, the scale, four toggles, a folder to move, the
 * updater and the pre-flight check. On a pad that is a lot of D-pad presses
 * between the thing you came for and the top of the page.
 *
 * The split is by subject, and the subjects are the questions people actually
 * arrive with: who am I signed in as, what happens to my saves, and is this
 * installation healthy. LB/RB move between them, as everywhere else in RomMix
 * that has tabs.
 *
 * What runs a game is not here at all — see `EmulatorsScreen`. It installs
 * software and decides which program a platform is handed to, which is not a
 * preference, and it was longer than the whole of the rest of this page.
 *
 * What is left is the shell and the two things more than one tab reads: the
 * pre-flight report and where RomMix's folder is.
 */

type SettingsTab = 'general' | 'games' | 'system'

export function SettingsScreen(): JSX.Element {
  const { t } = useI18n()
  const { settings, update } = useApp()
  const [tab, setTab] = useState<SettingsTab>('general')
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null)
  const [root, setRoot] = useState<RootLocation | null>(null)

  /** Run the machine probe and keep the report, for the pre-flight check. */
  const refreshDiagnostics = useCallback(async (): Promise<DiagnosticsReport | null> => {
    try {
      const report = await window.rommix.system.diagnostics()
      setDiagnostics(report)
      return report
    } catch {
      // Reported centrally on `app:error`.
      return null
    }
  }, [])

  useEffect(() => {
    void refreshDiagnostics()
  }, [refreshDiagnostics])

  useEffect(() => {
    void window.rommix.system.root().then(setRoot)
  }, [])

  if (!settings) {
    return (
      <div className="content">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="content">
      <h1 className="page-title">{t('nav.settings')}</h1>

      <div className="panel">
        <Tabs<SettingsTab>
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'general', label: t('settings.tabGeneral') },
            { id: 'games', label: t('settings.tabGames') },
            {
              id: 'system',
              label: t('settings.tabSystem'),
              // The new version, on the tab that can do something about it. The
              // menu already carries this mark; without it here, arriving in
              // Settings loses the trail one step short of the panel.
              badge:
                update && update.latest && update.state !== 'idle' && update.state !== 'checking'
                  ? update.latest
                  : undefined
            }
          ]}
        />

        <div className="panel__body">
          {tab === 'general' ? <GeneralTab /> : null}
          {tab === 'games' ? <GamesTab root={root} /> : null}
          {tab === 'system' ? (
            <SystemTab diagnostics={diagnostics} root={root} onRecheck={refreshDiagnostics} />
          ) : null}
        </div>
      </div>

      <Hints
        items={[
          { key: 'A', label: t('action.select') },
          { key: 'LB', label: t('action.previousTab') },
          { key: 'RB', label: t('action.nextTab') },
          { key: 'B', label: t('action.back') }
        ]}
      />
    </div>
  )
}
