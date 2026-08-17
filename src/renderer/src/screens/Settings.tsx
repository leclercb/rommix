import { type JSX, useEffect, useState } from 'react'
import type { DiagnosticsReport, RunnerKind } from '@shared/types'
import { FocusButton, Hints, SegmentedControl, Spinner, TextField } from '../components'
import { useApp } from '../state'

/**
 * Settings and the pre-flight check.
 *
 * The diagnostics block is the important half: almost every failure in this app
 * is environmental — RetroDECK not installed, the sandbox unable to reach the
 * host, the ROM folder not writable — and each of those is far easier to fix
 * when it is named explicitly rather than surfacing as "launch failed".
 */
export function SettingsScreen(): JSX.Element {
  const { status, settings, saveSettings, navigate, notify } = useApp()
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null)
  const [romsOverride, setRomsOverride] = useState('')

  useEffect(() => {
    void window.rommix.system.diagnostics().then(setDiagnostics)
  }, [])

  useEffect(() => {
    if (settings) setRomsOverride(settings.pathOverrides.roms ?? '')
  }, [settings])

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
    navigate({ name: 'connect' })
  }

  const applyRomsOverride = async (): Promise<void> => {
    const value = romsOverride.trim()
    await saveSettings({
      pathOverrides: { ...settings.pathOverrides, roms: value === '' ? undefined : value }
    })
    setDiagnostics(await window.rommix.system.diagnostics())
    notify(value ? 'ROM folder override saved' : 'ROM folder override cleared')
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
        <FocusButton variant="danger" onSelect={() => void disconnect()} autoFocus>
          Disconnect
        </FocusButton>
      </div>

      <h2 className="section-title">Emulator</h2>
      <label className="field__label">Where should Rommix send games?</label>
      <SegmentedControl<RunnerKind>
        value={settings.preferredRunner}
        onChange={(value) => {
          void saveSettings({ preferredRunner: value }).then(async () =>
            setDiagnostics(await window.rommix.system.diagnostics())
          )
        }}
        options={[
          { value: 'retrodeck', label: 'RetroDECK' },
          { value: 'retroarch', label: 'RetroArch' }
        ]}
      />
      <p className="faint" style={{ fontSize: 14, marginTop: -8 }}>
        RetroDECK picks the right emulator per system from its own configuration. RetroArch is used
        as a fallback and only covers systems Rommix has a core mapping for.
      </p>

      <h2 className="section-title">Save sync</h2>
      <div className="segmented">
        <Toggle
          label="Download newer saves before playing"
          on={settings.syncSavesDown}
          onToggle={() => void saveSettings({ syncSavesDown: !settings.syncSavesDown })}
        />
        <Toggle
          label="Upload saves after playing"
          on={settings.syncSavesUp}
          onToggle={() => void saveSettings({ syncSavesUp: !settings.syncSavesUp })}
        />
      </div>

      <h2 className="section-title">Folders</h2>
      <div className="form">
        <TextField
          label="ROM folder override"
          value={romsOverride}
          onChange={setRomsOverride}
          placeholder={diagnostics?.runners.find((r) => r.kind === settings.preferredRunner)?.paths.roms ?? '/home/you/retrodeck/roms'}
          hint="Leave empty to use the folder Rommix discovers from RetroDECK's own configuration."
        />
        <div className="btn-row">
          <FocusButton onSelect={() => void applyRomsOverride()}>Save folder</FocusButton>
        </div>
      </div>

      <h2 className="section-title">Pre-flight check</h2>
      {!diagnostics ? (
        <Spinner />
      ) : (
        <>
          <dl className="kv">
            <dt>Running in flatpak</dt>
            <dd>{diagnostics.inFlatpak ? 'yes' : 'no'}</dd>
            <dt>Can start host apps</dt>
            <dd>{diagnostics.canSpawnHost ? 'yes' : 'no'}</dd>
            <dt>Active runner</dt>
            <dd>{diagnostics.activeRunner ?? 'none found'}</dd>
            <dt>ROM folder writable</dt>
            <dd>{diagnostics.romsWritable ? 'yes' : 'no'}</dd>
          </dl>

          {diagnostics.runners.map((runner) => (
            <dl className="kv" key={runner.kind}>
              <dt>{runner.kind}</dt>
              <dd>
                {runner.available ? 'available' : 'not available'} · {runner.appId}
              </dd>
              <dt>ROMs</dt>
              <dd>{runner.paths.roms ?? '—'}</dd>
              <dt>Saves</dt>
              <dd>{runner.paths.saves ?? '—'}</dd>
              <dt>States</dt>
              <dd>{runner.paths.states ?? '—'}</dd>
            </dl>
          ))}

          {diagnostics.notes.length > 0
            ? diagnostics.notes.map((note) => (
                <div className="notice notice--warn" key={note}>
                  {note}
                </div>
              ))
            : <div className="notice notice--ok">Everything looks ready to play.</div>}

          <div className="btn-row">
            <FocusButton
              onSelect={() => {
                void window.rommix.system.diagnostics().then(setDiagnostics)
              }}
            >
              Re-run check
            </FocusButton>
          </div>
        </>
      )}

      <h2 className="section-title">Application</h2>
      <div className="btn-row">
        <FocusButton onSelect={() => void window.rommix.system.toggleFullscreen()}>
          Toggle fullscreen
        </FocusButton>
        <FocusButton variant="danger" onSelect={() => void window.rommix.system.quit()}>
          Quit Rommix
        </FocusButton>
      </div>

      <Hints
        items={[
          { key: 'A', label: 'Select' },
          { key: 'B', label: 'Back' }
        ]}
      />
    </div>
  )
}

function Toggle({
  label,
  on,
  onToggle
}: {
  label: string
  on: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <SegmentedControl<'on' | 'off'>
      value={on ? 'on' : 'off'}
      onChange={(next) => {
        if ((next === 'on') !== on) onToggle()
      }}
      options={[
        { value: 'on', label: `${label}: on` },
        { value: 'off', label: 'off' }
      ]}
    />
  )
}
