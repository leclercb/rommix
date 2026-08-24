import { type JSX, useCallback, useEffect, useRef, useState } from 'react'
import type { DiagnosticsReport, RootLocation } from '@shared/types'
import {
  Choice,
  FocusButton,
  Hints,
  Overlay,
  RomStorageChoice,
  ScanToOpen,
  Spinner,
  TextField,
  Toggle,
  UI_SCALES,
  uiScaleChoice,
  type UiScaleChoice
} from '../../components'
import { useGamepadName } from '../../input/focus'
import { useApp } from '../../state'
import { EmulatorChangeNotice, EMULATOR_CHANGE_NOTICE } from './EmulatorChangeNotice'
import { EmulatorList } from './EmulatorList'
import { PlatformList } from './PlatformList'

/**
 * Where to send someone who wants to say thank you.
 *
 * A QR code first and a browser second, in that order: RomMix is driven from a
 * sofa, and on a gamescope session there may be no browser for a link to open
 * into at all.
 */
export const SUPPORT_URL = 'https://buymeacoffee.com/leclercb'

/**
 * Settings and the pre-flight check.
 *
 * The diagnostics block is the important half: almost every failure in this app
 * is environmental — RetroDECK not installed, flatpak missing, the ROM folder
 * not writable — and each of those is far easier to fix
 * when it is named explicitly rather than surfacing as "launch failed".
 */
export function SettingsScreen(): JSX.Element {
  const { status, settings, saveSettings, replace, notify } = useApp()
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null)
  const [root, setRoot] = useState<RootLocation | null>(null)
  const [rootDraft, setRootDraft] = useState('')
  const [rechecking, setRechecking] = useState(false)
  const [supporting, setSupporting] = useState(false)
  const [askingChange, setAskingChange] = useState(false)
  /**
   * The half-finished emulator change waiting on an answer.
   *
   * A promise resolver rather than a stored action, so the two callers — the
   * reorder buttons and the per-platform cycle — keep their own logic and only
   * hand this the question. See `EmulatorChangeNotice`.
   */
  const changeAnswer = useRef<((allowed: boolean) => void) | null>(null)
  const controller = useGamepadName()

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

  useEffect(() => {
    void window.rommix.system.diagnostics().then(setDiagnostics)
  }, [])

  /**
   * Run the pre-flight check again, and say what it found.
   *
   * The button used to replace the report silently, which on a machine where
   * nothing had changed was indistinguishable from a button that does nothing —
   * the same list of notes, redrawn. The count is the part that answers "did
   * that do anything", so the notification leads with it.
   */
  const recheck = async (): Promise<void> => {
    setRechecking(true)
    try {
      const report = await window.rommix.system.diagnostics()
      setDiagnostics(report)
      const problems = report.notes.length
      notify(
        problems === 0
          ? 'Checked — everything looks ready to play'
          : `Checked — ${problems} thing${problems === 1 ? '' : 's'} to sort out`,
        problems === 0 ? 'ok' : 'warn'
      )
    } catch {
      // Reported centrally on `app:error`.
    } finally {
      setRechecking(false)
    }
  }

  useEffect(() => {
    void window.rommix.system.root().then((value) => {
      setRoot(value)
      setRootDraft(value.current)
    })
  }, [])

  if (!settings) {
    return (
      <div className="content">
        <Spinner />
      </div>
    )
  }

  const disconnect = async (): Promise<void> => {
    await window.rommix.server.disconnect()
    notify('Disconnected from RomM')
    // The end of a session, so the screens behind this one go with it: every
    // one of them is a view of a library there is no longer a server for.
    replace({ name: 'connect' })
  }

  /**
   * Repoint RomMix's folder. The restart is not optional: Electron fixes its
   * userData path before the app starts, so the running process is still
   * reading and writing the old location.
   */
  const moveRoot = async (): Promise<void> => {
    const value = rootDraft.trim()
    if (!value) return
    try {
      await window.rommix.system.setRoot(value)
      notify('RomMix folder moved — restarting')
      await window.rommix.system.restart()
    } catch {
      // Reported centrally on `app:error`.
    }
  }

  return (
    <div className="content">
      <h1 className="page-title">Settings</h1>

      <h2 className="section-title">Server</h2>
      <dl className="kv">
        <dt>Address</dt>
        <dd>{status?.baseUrl ?? 'Not configured'}</dd>
        <dt>Signed in as</dt>
        <dd>{status?.user?.username ?? '—'}</dd>
        <dt>RomM version</dt>
        <dd>{status?.serverVersion ?? 'unknown'}</dd>
      </dl>
      <div className="btn-row">
        <FocusButton
          icon="disconnect"
          variant="danger"
          onSelect={() => void disconnect()}
          autoFocus
        >
          Disconnect
        </FocusButton>
      </div>

      <h2 className="section-title">Interface</h2>
      <Choice<UiScaleChoice>
        label="Scale"
        hint="Auto follows the screen: twice the size on a 4K television."
        value={uiScaleChoice(settings.uiScale)}
        options={UI_SCALES}
        onChange={(next) => void saveSettings({ uiScale: next === 'auto' ? 0 : Number(next) })}
      />

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
        confirmChange={confirmEmulatorChange}
        onInstalled={() => {
          void window.rommix.system.diagnostics().then(setDiagnostics)
        }}
      />

      <h2 className="section-title">Platforms</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        Which emulator runs each platform in your library. Every platform starts on a default taken
        from what these emulators normally handle; change one and RomMix uses your choice for that
        platform only, and says so rather than quietly substituting if it is missing.
      </p>
      <PlatformList
        chosen={settings.systemEmulators}
        diagnostics={diagnostics}
        overrides={settings.systemOverrides}
        confirmChange={confirmEmulatorChange}
        onChoose={(next) => {
          void saveSettings({ systemEmulators: next }).then(async () =>
            setDiagnostics(await window.rommix.system.diagnostics())
          )
        }}
      />

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

      <h2 className="section-title">RomMix folder</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        Settings, credentials, the download index, and any emulator RomMix installed. Move this
        folder to move the whole installation.
      </p>
      <div className="form">
        <TextField
          label="Folder"
          value={rootDraft}
          onChange={setRootDraft}
          placeholder={root?.fallback ?? '/home/you/rommix'}
          hint={
            root?.fromEnvironment
              ? 'Set by ROMMIX_HOME, which wins over anything chosen here.'
              : 'Settings are copied to the new folder; emulators and ROMs stay where they are.'
          }
        />
        <div className="btn-row">
          <FocusButton
            icon="folder"
            disabled={root?.fromEnvironment || rootDraft.trim() === root?.current}
            onSelect={() => void moveRoot()}
          >
            Move and restart
          </FocusButton>
        </div>
      </div>

      <h2 className="section-title">Pre-flight check</h2>
      {!diagnostics ? (
        <Spinner />
      ) : (
        <>
          <dl className="kv">
            {/* Not about RomMix, which is an AppImage: it is about the
                emulators, most of which are flatpaks and none of which can be
                found without the command. */}
            <dt>Flatpak available</dt>
            <dd>{diagnostics.flatpakAvailable ? 'yes' : 'no'}</dd>
            {/* The other half of the same question. A machine can have flatpak
                and still have nowhere to install from, which otherwise shows up
                only as every emulator reading "not installed". */}
            <dt>Flathub set up</dt>
            <dd>
              {!diagnostics.flatpakAvailable
                ? '—'
                : diagnostics.flathubConfigured
                  ? 'yes'
                  : 'no — added on first install'}
            </dd>
            <dt>Emulators installed</dt>
            <dd>
              {diagnostics.emulators.filter((e) => e.available).length} of{' '}
              {diagnostics.emulators.length}
            </dd>
            <dt>ROM folders writable</dt>
            <dd>{diagnostics.romsWritable ? 'yes' : 'no'}</dd>
            <dt>Controller</dt>
            <dd>{controller ?? 'none seen — press a button on it'}</dd>
            {/* The file to attach to a bug report, named where the problems are. */}
            <dt>Log file</dt>
            <dd>{diagnostics.logPath}</dd>
          </dl>

          {/* Per-emulator detail lives only in the Emulators section above. */}

          {diagnostics.notes.length > 0 ? (
            diagnostics.notes.map((note) => (
              <div className="notice notice--warn" key={note}>
                {note}
              </div>
            ))
          ) : (
            <div className="notice notice--ok">Everything looks ready to play.</div>
          )}

          <div className="btn-row">
            <FocusButton icon="refresh" disabled={rechecking} onSelect={() => void recheck()}>
              {rechecking ? 'Checking…' : 'Re-run check'}
            </FocusButton>
          </div>
        </>
      )}

      <h2 className="section-title">Support RomMix</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        RomMix is free and always will be. If it saved you an afternoon of wiring emulators
        together, you can buy me a coffee.
      </p>
      <div className="btn-row">
        <FocusButton icon="coffee" onSelect={() => setSupporting(true)}>
          Buy me a coffee
        </FocusButton>
      </div>

      <h2 className="section-title">Application</h2>
      <div className="btn-row">
        <FocusButton
          icon="fullscreen"
          onSelect={() => void window.rommix.system.toggleFullscreen()}
        >
          Toggle fullscreen
        </FocusButton>
        <FocusButton icon="quit" variant="danger" onSelect={() => void window.rommix.system.quit()}>
          Quit RomMix
        </FocusButton>
      </div>

      {askingChange ? (
        <EmulatorChangeNotice
          sharedRoms={settings.romStorage === 'rommix'}
          onConfirm={(dontAskAgain) => settleEmulatorChange(true, dontAskAgain)}
          onCancel={() => settleEmulatorChange(false)}
        />
      ) : null}

      {supporting ? (
        <Overlay title="Buy me a coffee">
          <p className="muted">
            Scan this with your phone, or open it in a browser on this machine.
          </p>
          <ScanToOpen url={SUPPORT_URL} />
          <div className="btn-row">
            <FocusButton icon="keep" onSelect={() => setSupporting(false)} autoFocus>
              Close
            </FocusButton>
            <FocusButton
              icon="homepage"
              onSelect={() => {
                setSupporting(false)
                void window.rommix.system.openExternal(SUPPORT_URL)
              }}
            >
              Open in a browser
            </FocusButton>
          </div>
        </Overlay>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: 'Select' },
          { key: 'B', label: 'Back' }
        ]}
      />
    </div>
  )
}
