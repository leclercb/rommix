import { type JSX, useEffect, useState } from 'react'
import {
  EMULATORS,
  defaultEmulatorFor,
  emulatorById,
  emulatorsForSystem,
  systemCount
} from '@shared/emulators'
import { resolveSystem } from '@shared/systems'
import type {
  DiagnosticsReport,
  EmulatorAsset,
  EmulatorId,
  EmulatorInstallProgress,
  EmulatorRelease,
  EmulatorState,
  RommPlatform,
  RootLocation
} from '@shared/types'
import {
  FocusButton,
  Hints,
  Overlay,
  SegmentedControl,
  Spinner,
  TextField,
  formatBytes
} from '../components'
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
  const [root, setRoot] = useState<RootLocation | null>(null)
  const [rootDraft, setRootDraft] = useState('')

  useEffect(() => {
    void window.rommix.system.diagnostics().then(setDiagnostics)
  }, [])

  useEffect(() => {
    if (settings) setRomsOverride(settings.libraryRoot ?? '')
  }, [settings])

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
    navigate({ name: 'connect' })
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
    } catch (cause) {
      notify((cause as Error).message, 'error')
    }
  }

  const applyRomsOverride = async (): Promise<void> => {
    const value = romsOverride.trim()
    await saveSettings({ libraryRoot: value === '' ? null : value })
    setDiagnostics(await window.rommix.system.diagnostics())
    notify(value ? 'ROM library folder saved' : 'ROM library folder cleared')
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

      <h2 className="section-title">Emulators</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        What RomMix found on this machine, and how many platforms each one covers.
      </p>
      <EmulatorList
        diagnostics={diagnostics}
        onInstalled={() => {
          void window.rommix.system.diagnostics().then(setDiagnostics)
        }}
      />

      <h2 className="section-title">Platforms</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        Which emulator runs each platform in your library. Every platform starts on a default
        taken from what these emulators normally handle; change one and RomMix uses your choice
        for that platform only, and says so rather than quietly substituting if it is missing.
      </p>
      <PlatformList
        chosen={settings.systemEmulators}
        diagnostics={diagnostics}
        overrides={settings.systemOverrides}
        onChoose={(next) => {
          void saveSettings({ systemEmulators: next }).then(async () =>
            setDiagnostics(await window.rommix.system.diagnostics())
          )
        }}
      />

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

      <h2 className="section-title">RomMix folder</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        Everything RomMix owns lives here — settings, your RomM credentials, the index of
        downloaded games, and any emulator RomMix installed for you. Moving this one folder moves
        the whole installation.
      </p>
      <div className="form">
        <TextField
          label="Folder"
          value={rootDraft}
          onChange={setRootDraft}
          placeholder={root?.fallback ?? '/home/you/RomMix'}
          hint={
            root?.fromEnvironment
              ? 'Set by ROMMIX_HOME, which wins over anything chosen here.'
              : 'Settings are copied to the new folder; emulators and ROMs stay where they are.'
          }
        />
        <div className="btn-row">
          <FocusButton
            disabled={root?.fromEnvironment || rootDraft.trim() === root?.current}
            onSelect={() => void moveRoot()}
          >
            Move and restart
          </FocusButton>
        </div>
      </div>

      <h2 className="section-title">ROM library</h2>
      <p className="faint" style={{ fontSize: 14 }}>
        One folder holds every downloaded game, whichever emulator opens it — emulators are given
        the full path at launch, so a ROM does not have to live inside the tree of the one that
        runs it. Left empty, RomMix uses the folder discovered from the emulator handling that
        platform, which for RetroDECK is the location set in its own configuration.
      </p>
      <div className="form">
        <TextField
          label="ROM library folder"
          value={romsOverride}
          onChange={setRomsOverride}
          placeholder={
            diagnostics?.emulators.find((e) => e.id === diagnostics.activeEmulator)?.paths.roms ??
            '/home/you/retrodeck/roms'
          }
          hint="An absolute path, e.g. a folder on an SD card."
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

          {/* Per-emulator detail deliberately lives only in the Emulators
              section above; listing it again here showed every emulator twice. */}

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

/** Installed / not-installed marker, with the in-between state named. */
function Status({ state }: { state: EmulatorState | undefined }): JSX.Element {
  if (!state) return <span className="status" data-state="off">Not checked</span>
  if (state.available) return <span className="status" data-state="ok">Installed</span>
  // Present but unusable is worth distinguishing from absent: the fix is
  // different (run it once, vs install it).
  if (state.install) return <span className="status" data-state="warn">Needs setup</span>
  return <span className="status" data-state="off">Not installed</span>
}

/** The installed emulators, with what each covers. */
function EmulatorList({
  diagnostics,
  onInstalled
}: {
  diagnostics: DiagnosticsReport | null
  onInstalled: () => void
}): JSX.Element {
  const [installing, setInstalling] = useState<EmulatorId | null>(null)

  return (
    <div>
      {EMULATORS.map((descriptor) => {
        const state = diagnostics?.emulators.find((emulator) => emulator.id === descriptor.id)
        const covers = systemCount(descriptor)

        return (
          <div className="emulator" key={descriptor.id}>
            <div className="emulator__body">
              <div className="emulator__name">
                {descriptor.name}
                <Status state={state} />
              </div>
              <div className="emulator__meta">
                {covers} platform{covers === 1 ? '' : 's'}
                {descriptor.role === 'frontend' ? ' · picks the emulator itself per platform' : ''}
              </div>
              {state?.install ? (
                <div className="emulator__path" title={state.install.ref}>
                  {state.install.kind}: {state.install.ref}
                </div>
              ) : null}
              {state?.paths.roms ? (
                <div className="emulator__path" title={state.paths.roms}>
                  ROMs: {state.paths.roms}
                </div>
              ) : null}
              {state?.unavailableReason ? (
                <div className="emulator__meta">{state.unavailableReason}</div>
              ) : null}
            </div>
            {descriptor.releases ? (
              <div className="emulator__actions">
                <FocusButton variant="ghost" onSelect={() => setInstalling(descriptor.id)}>
                  {state?.available ? 'Change version' : 'Download'}
                </FocusButton>
              </div>
            ) : null}
          </div>
        )
      })}

      {installing ? (
        <InstallPicker
          emulatorId={installing}
          onClose={() => setInstalling(null)}
          onInstalled={() => {
            setInstalling(null)
            onInstalled()
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Pick a release build to install.
 *
 * Eden publishes a dozen Linux builds per release — amd64, aarch64, legacy,
 * steamdeck and rog-ally, each in a clang-pgo and a gcc-standard flavour — so
 * there is no single right file to fetch silently. The list is what the
 * project actually published, filtered to what RomMix can run.
 */
function InstallPicker({
  emulatorId,
  onClose,
  onInstalled
}: {
  emulatorId: EmulatorId
  onClose: () => void
  onInstalled: () => void
}): JSX.Element {
  const [releases, setReleases] = useState<EmulatorRelease[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<EmulatorInstallProgress | null>(null)

  const descriptor = emulatorById(emulatorId)

  useEffect(() => {
    void window.rommix.system
      .emulatorReleases(emulatorId)
      .then(setReleases)
      .catch((cause: Error) => setError(cause.message))
  }, [emulatorId])

  useEffect(() => window.rommix.system.onInstallProgress(setProgress), [])

  const install = async (asset: EmulatorAsset): Promise<void> => {
    setBusy(asset.name)
    setError(null)
    try {
      await window.rommix.system.installEmulator(emulatorId, asset)
      onInstalled()
    } catch (cause) {
      setError((cause as Error).message)
      setBusy(null)
    }
  }

  if (busy) {
    const pct =
      progress && progress.totalBytes > 0
        ? Math.round((progress.receivedBytes / progress.totalBytes) * 100)
        : null
    return (
      <Overlay title={`Installing ${descriptor?.name ?? emulatorId}`}>
        <p className="muted">{busy}</p>
        <p className="muted">
          {formatBytes(progress?.receivedBytes ?? 0)}
          {pct != null ? ` · ${pct}%` : ''}
        </p>
        <Spinner />
      </Overlay>
    )
  }

  return (
    <Overlay title={`Install ${descriptor?.name ?? emulatorId}`}>
      {error ? <div className="notice notice--error">{error}</div> : null}
      {!releases && !error ? <Spinner /> : null}

      {releases?.length === 0 ? (
        <div className="empty">No downloadable builds were published.</div>
      ) : null}

      <div style={{ maxHeight: '46vh', overflowY: 'auto' }}>
        {releases?.map((release) => (
          <section key={release.tag}>
            <h3 className="section-title" style={{ fontSize: 17, margin: '18px 0 8px' }}>
              {release.name}
              {release.prerelease ? ' · pre-release' : ''}
            </h3>
            <div className="btn-row" style={{ margin: 0 }}>
              {release.assets.map((asset) => (
                <FocusButton key={asset.url} variant="ghost" onSelect={() => void install(asset)}>
                  {asset.name}
                </FocusButton>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="faint" style={{ fontSize: 13 }}>
        Downloaded from {descriptor?.releases?.homepage} into RomMix&apos;s own emulator folder.
      </p>

      <div className="btn-row">
        <FocusButton onSelect={onClose} autoFocus>
          Cancel
        </FocusButton>
      </div>
    </Overlay>
  )
}

/**
 * Platform -> emulator, one row per platform in the user's RomM library.
 *
 * Only the library's platforms are listed. There are ~200 ES-DE systems and a
 * screen of rows for consoles the user does not own would bury the handful
 * that matter.
 *
 * The control cycles rather than opening a menu: candidates are usually two or
 * three, and a single button that advances on A is the least awkward thing to
 * drive from a gamepad.
 */
function PlatformList({
  chosen,
  diagnostics,
  overrides,
  onChoose
}: {
  chosen: Record<string, EmulatorId>
  diagnostics: DiagnosticsReport | null
  overrides: Record<string, string>
  onChoose: (next: Record<string, EmulatorId>) => void
}): JSX.Element {
  const [platforms, setPlatforms] = useState<RommPlatform[]>([])

  useEffect(() => {
    void window.rommix.library
      .platforms()
      .then((list) => setPlatforms(list.filter((platform) => platform.rom_count > 0)))
      .catch(() => setPlatforms([]))
  }, [])

  if (platforms.length === 0) {
    return <p className="faint">Connect to RomM to see the platforms in your library.</p>
  }

  const rows = platforms
    .map((platform) => ({
      platform,
      system: resolveSystem(platform.slug, platform.fs_slug, overrides)
    }))
    .filter((row): row is { platform: RommPlatform; system: string } => row.system !== null)

  return (
    <div>
      {rows.map(({ platform, system }) => {
        const candidates = emulatorsForSystem(system)
        const fallback = defaultEmulatorFor(system)
        const current = chosen[system]
        const effective = current ?? fallback
        const state = diagnostics?.emulators.find((emulator) => emulator.id === effective)

        // 'default' first, then every emulator that runs this system.
        const cycle: (EmulatorId | null)[] = [null, ...candidates.map((c) => c.id)]

        const advance = (): void => {
          const index = cycle.indexOf(current ?? null)
          const next = cycle[(index + 1) % cycle.length]
          const updated = { ...chosen }
          if (next === null) delete updated[system]
          else updated[system] = next
          onChoose(updated)
        }

        return (
          <div className="emulator" key={platform.id}>
            <div className="emulator__body">
              <div className="emulator__name">
                {platform.display_name}
                {effective ? (
                  <Status state={state} />
                ) : (
                  <span className="status" data-state="warn">
                    No emulator
                  </span>
                )}
              </div>
              <div className="emulator__meta">
                {system} · {platform.rom_count} game{platform.rom_count === 1 ? '' : 's'}
              </div>
            </div>
            <div className="emulator__actions">
              <FocusButton
                variant="ghost"
                disabled={candidates.length === 0}
                onSelect={advance}
              >
                {effective ? (emulatorById(effective)?.name ?? effective) : 'None'}
                {current == null ? ' (default)' : ''}
              </FocusButton>
            </div>
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
