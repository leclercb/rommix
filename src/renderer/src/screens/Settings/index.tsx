import { type JSX, useCallback, useEffect, useRef, useState } from 'react'
import type { DiagnosticsReport, RootLocation } from '@shared/types'
import { Hints, Spinner, Tabs } from '../../components'
import { useApp } from '../../state'
import { EmulatorChangeNotice, EMULATOR_CHANGE_NOTICE } from './EmulatorChangeNotice'
import { EmulatorsTab, GamesTab, GeneralTab, SystemTab } from './tabs'

/**
 * Settings, in four tabs.
 *
 * One column before, and it had grown to a page you scrolled through twice to
 * find a switch: the server, the scale, two lists of emulators, four toggles, a
 * folder to move, the updater and the pre-flight check. On a pad that is a lot
 * of D-pad presses between the thing you came for and the top of the page.
 *
 * The split is by subject, and the subjects are the questions people actually
 * arrive with: who am I signed in as, what runs my games, what happens to my
 * saves, and is this installation healthy. LB/RB move between them, as
 * everywhere else in RomMix that has tabs.
 *
 * What is left here is the shell: the two things more than one tab reads — the
 * pre-flight report and where RomMix's folder is — and the question that has to
 * be asked from two of them, which is whether the user meant to change the
 * emulator a platform runs on.
 */

type SettingsTab = 'general' | 'emulators' | 'games' | 'system'

export function SettingsScreen(): JSX.Element {
  const { settings, saveSettings, update } = useApp()
  const [tab, setTab] = useState<SettingsTab>('general')
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null)
  const [root, setRoot] = useState<RootLocation | null>(null)
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

  /**
   * Run the machine probe and keep the report.
   *
   * Held here rather than in a tab because two of them draw from it: the
   * emulator lists are the report, and the pre-flight check is the same report
   * read as a verdict. A copy per tab would mean the one you are not looking at
   * is always the stale one.
   */
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
      <h1 className="page-title">Settings</h1>

      <div className="panel">
        <Tabs<SettingsTab>
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'general', label: 'General' },
            {
              id: 'emulators',
              label: 'Emulators',
              badge: diagnostics?.emulators.filter((e) => e.available).length || undefined
            },
            { id: 'games', label: 'Games' },
            {
              id: 'system',
              label: 'System',
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
          {tab === 'emulators' ? (
            <EmulatorsTab
              diagnostics={diagnostics}
              confirmChange={confirmEmulatorChange}
              onChanged={() => void refreshDiagnostics()}
            />
          ) : null}
          {tab === 'games' ? <GamesTab root={root} /> : null}
          {tab === 'system' ? (
            <SystemTab diagnostics={diagnostics} root={root} onRecheck={refreshDiagnostics} />
          ) : null}
        </div>
      </div>

      {askingChange ? (
        <EmulatorChangeNotice
          sharedRoms={settings.romStorage === 'rommix'}
          onConfirm={(dontAskAgain) => settleEmulatorChange(true, dontAskAgain)}
          onCancel={() => settleEmulatorChange(false)}
        />
      ) : null}

      <Hints
        items={[
          { key: 'A', label: 'Select' },
          { key: 'LB', label: 'Previous tab' },
          { key: 'RB', label: 'Next tab' },
          { key: 'B', label: 'Back' }
        ]}
      />
    </div>
  )
}
