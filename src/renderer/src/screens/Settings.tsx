import { Fragment, type JSX, useEffect, useState } from 'react'
import { emulatorById, systemCount } from '@shared/emulators'
import type { DiagnosticsReport, EmulatorId } from '@shared/types'
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

      <h2 className="section-title">Emulator priority</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        For each game, RomMix uses the first emulator in this list that is installed{' '}
        <em>and</em> can run that system. An emulator further down is not a fallback for
        everything — it is simply what gets used for the systems the ones above it do not cover.
      </p>
      <PriorityList
        order={settings.emulatorPriority}
        diagnostics={diagnostics}
        onReorder={(next) => {
          void saveSettings({ emulatorPriority: next }).then(async () =>
            setDiagnostics(await window.rommix.system.diagnostics())
          )
        }}
      />
      {Object.keys(settings.systemEmulators).length > 0 ? (
        <dl className="kv">
          {Object.entries(settings.systemEmulators).map(([system, id]) => (
            <Fragment key={system}>
              <dt>{system}</dt>
              <dd>pinned to {id}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      <p className="faint" style={{ fontSize: 14 }}>
        A single system can be pinned to one emulator regardless of this order, which is how you
        choose between two emulators for the same system. Pins are strict: if the pinned emulator
        is missing, RomMix reports it rather than quietly using another.
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
          placeholder={
            diagnostics?.emulators.find((e) => e.id === diagnostics.activeEmulator)?.paths.roms ??
            '/home/you/retrodeck/roms'
          }
          hint="Leave empty to use the folder RomMix discovers from RetroDECK's own configuration."
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
            <dt>Active emulator</dt>
            <dd>{diagnostics.activeEmulator ?? 'none found'}</dd>
            <dt>ROM folder writable</dt>
            <dd>{diagnostics.romsWritable ? 'yes' : 'no'}</dd>
          </dl>

          {diagnostics.emulators.map((emulator) => (
            <dl className="kv" key={emulator.id}>
              <dt>{emulator.name}</dt>
              <dd>
                {emulator.available ? 'available' : 'not available'}
                {emulator.install ? ` · ${emulator.install.ref}` : ''}
              </dd>
              <dt>ROMs</dt>
              <dd>{emulator.paths.roms ?? '—'}</dd>
              <dt>Saves</dt>
              <dd>{emulator.paths.saves ?? '—'}</dd>
              <dt>States</dt>
              <dd>{emulator.paths.states ?? '—'}</dd>
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
          Quit RomMix
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

/**
 * The emulator order, as a list the user can move entries up and down in.
 *
 * A segmented control cannot express this: it asks "which one", and the honest
 * answer is "in what order", because the interesting cases are an emulator
 * that does not cover a system and two emulators that cover the same one.
 * Each row states what that emulator actually covers, so the order visibly
 * only matters where coverage overlaps.
 */
function PriorityList({
  order,
  diagnostics,
  onReorder
}: {
  order: EmulatorId[]
  diagnostics: DiagnosticsReport | null
  onReorder: (next: EmulatorId[]) => void
}): JSX.Element {
  const move = (index: number, delta: number): void => {
    const next = [...order]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onReorder(next)
  }

  return (
    <div className="form">
      {order.map((id, index) => {
        const descriptor = emulatorById(id)
        if (!descriptor) return null
        const state = diagnostics?.emulators.find((emulator) => emulator.id === id)
        const covers = systemCount(descriptor)

        return (
          <div className="btn-row" key={id}>
            <span style={{ flex: 1 }}>
              <strong>
                {index + 1}. {descriptor.name}
              </strong>{' '}
              <span className="faint">
                {covers === 'all'
                  ? 'every system, chosen by RetroDECK itself'
                  : `${covers} system${covers === 1 ? '' : 's'}`}
                {' · '}
                {state ? (state.available ? 'installed' : 'not installed') : 'not checked'}
              </span>
            </span>
            <FocusButton variant="ghost" disabled={index === 0} onSelect={() => move(index, -1)}>
              Up
            </FocusButton>
            <FocusButton
              variant="ghost"
              disabled={index === order.length - 1}
              onSelect={() => move(index, 1)}
            >
              Down
            </FocusButton>
          </div>
        )
      })}
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
