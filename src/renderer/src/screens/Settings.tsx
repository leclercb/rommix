import { type JSX, type ReactNode, useEffect, useState } from 'react'
import {
  orderedEmulators,
  emulatorById,
  emulatorsForSystem,
  installMethods,
  releaseSource,
  systemCount
} from '@config/emulators'
import { resolveSystem, systemLabel } from '@config/systems'
import type {
  DiagnosticsReport,
  EmulatorAsset,
  EmulatorDescriptor,
  EmulatorId,
  EmulatorInstallProgress,
  EmulatorRelease,
  EmulatorState,
  ResolvedInstall,
  RommPlatform,
  RootLocation
} from '@shared/types'
import {
  FocusButton,
  Hints,
  Overlay,
  SegmentedControl,
  Spinner,
  PlatformIcon,
  TextField,
  formatBytes
} from '../components'
import { Icon, type IconName } from '../icons'
import { useGamepadName } from '../input/focus'
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
  const [root, setRoot] = useState<RootLocation | null>(null)
  const [rootDraft, setRootDraft] = useState('')
  const controller = useGamepadName()

  useEffect(() => {
    void window.rommix.system.diagnostics().then(setDiagnostics)
  }, [])

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
            <dt>Running in flatpak</dt>
            <dd>{diagnostics.inFlatpak ? 'yes' : 'no'}</dd>
            <dt>Can start host apps</dt>
            <dd>{diagnostics.canSpawnHost ? 'yes' : 'no'}</dd>
            <dt>Emulators installed</dt>
            <dd>
              {diagnostics.emulators.filter((e) => e.available).length} of{' '}
              {diagnostics.emulators.length}
            </dd>
            <dt>ROM folders writable</dt>
            <dd>{diagnostics.romsWritable ? 'yes' : 'no'}</dd>
            <dt>Controller</dt>
            <dd>{controller ?? 'none seen — press a button on it'}</dd>
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
            <FocusButton
              icon="refresh"
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
  if (!state)
    return (
      <span className="status" data-state="off">
        Not checked
      </span>
    )
  if (state.available)
    return (
      <span className="status" data-state="ok">
        Installed
      </span>
    )
  // Present but unusable is worth distinguishing from absent: the fix is
  // different (run it once, vs install it).
  if (state.install)
    return (
      <span className="status" data-state="warn">
        Needs setup
      </span>
    )
  return (
    <span className="status" data-state="off">
      Not installed
    </span>
  )
}

/** One of the routes `installMethods` returns: a thing RomMix can actually do. */
type InstallMethod = ReturnType<typeof installMethods>[number]

/**
 * How each install kind is spelled on screen.
 *
 * The keys are identifiers and read like them — `appimage` is not a word
 * anybody writes, and a row that says "appimage:" looks like a leaked internal
 * name rather than a statement about the user's machine.
 */
const INSTALL_KIND: Record<ResolvedInstall['kind'], string> = {
  flatpak: 'Flatpak',
  binary: 'Program',
  appimage: 'AppImage',
  scripts: 'Launchers'
}

/**
 * One line of an emulator's description, marked with what kind of fact it is.
 *
 * The icon is the column: a row can carry seven of these and they are all the
 * same faint grey text, so scanning for "where are its saves" means reading
 * every one of them. A glyph in front turns that into a glance — and it is
 * drawn from the same vocabulary as the rest of the app, so the save mark here
 * is the save mark on the game page.
 */
function Detail({
  icon,
  children,
  title
}: {
  icon: IconName
  children: ReactNode
  title?: string
}): JSX.Element {
  return (
    <div className="emulator__line" title={title}>
      <Icon name={icon} size={14} />
      <span className="emulator__line-text">{children}</span>
    </div>
  )
}

/**
 * One `Label: /path` line, or nothing when there is no path to name.
 *
 * A missing path is left out rather than printed as "none": these rows say
 * where the emulator's files are, and an emulator that keeps no save folder of
 * its own has nothing to say here, not an empty answer.
 */
function Path({
  icon,
  label,
  value,
  note
}: {
  icon: IconName
  label: string
  value: string | null | undefined
  note?: string
}): JSX.Element | null {
  if (!value) return null
  return (
    <Detail icon={icon} title={value}>
      {label}: {value}
      {note}
    </Detail>
  )
}

/** The installed emulators, with what each covers. */
function EmulatorList({
  diagnostics,
  notify,
  onInstalled
}: {
  diagnostics: DiagnosticsReport | null
  notify: ReturnType<typeof useApp>['notify']
  onInstalled: () => void
}): JSX.Element {
  const { settings, saveSettings, refreshInstalled } = useApp()
  const [installing, setInstalling] = useState<EmulatorId | null>(null)
  const [flatpakBusy, setFlatpakBusy] = useState<EmulatorId | null>(null)
  const [flatpakLine, setFlatpakLine] = useState<string | null>(null)
  /**
   * The emulator whose install panel is open.
   *
   * One button in the row and the choice inside the panel: installing reaches
   * outside RomMix — it runs flatpak against the host, or writes a program into
   * its own folder — and on a pad the button under the cursor is one A press
   * away at all times. The panel is both the confirmation and, for an emulator
   * packaged more than one way, where that is picked.
   */
  const [pending, setPending] = useState<EmulatorDescriptor | null>(null)

  // The order shown is the order used. Held as a full list rather than as the
  // moved entry alone, so what is saved is exactly what is on screen.
  const order = orderedEmulators(settings?.emulatorPriority ?? [])

  const move = async (id: EmulatorId, delta: number): Promise<void> => {
    const ids = order.map((emulator) => emulator.id)
    const from = ids.indexOf(id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    await saveSettings({ emulatorPriority: ids })
    // The probe has re-run in the main process by the time this returns, and
    // both of these are drawn from it: which emulator is in charge of each
    // platform, and which downloads that emulator can actually see.
    onInstalled()
    await refreshInstalled()
  }

  /**
   * Start an emulator with no game.
   *
   * Some of what RomMix needs can only be done by the emulator itself:
   * RetroDECK does not create its folder layout until it has been run once, and
   * cores, game directories and BIOS setup are all its own screens. The probe
   * is re-run afterwards, since running it once is often exactly what makes it
   * usable.
   */
  const run = async (id: EmulatorId, name: string): Promise<void> => {
    try {
      await window.rommix.system.runEmulator(id)
      notify(`${name} started`)
      onInstalled()
    } catch {
      // Reported centrally on `app:error`.
    }
  }

  useEffect(
    () =>
      window.rommix.system.onInstallProgress((progress) => {
        if (progress.message) setFlatpakLine(progress.message)
      }),
    []
  )

  /**
   * The home folder the user is editing, and what they have typed.
   *
   * Held per emulator rather than as one draft: two emulators can both own a
   * library, and a half-typed path for one must not leak into the other.
   */
  const [rootDraft, setRootDraft] = useState<{ id: EmulatorId; value: string } | null>(null)

  const saveRoot = async (id: EmulatorId, value: string): Promise<void> => {
    const trimmed = value.trim()
    const roots = { ...(settings?.emulatorRoots ?? {}) }
    // An emptied field is a request to go back to discovery, not a request to
    // look for the library in a directory called "".
    if (trimmed) roots[id] = trimmed
    else delete roots[id]

    await saveSettings({ emulatorRoots: roots })
    setRootDraft(null)
    onInstalled()
    await refreshInstalled()
  }

  /**
   * Put this emulator on the machine, by the route the user confirmed.
   *
   * A download is a choice of build rather than one act, so it opens the
   * picker; Flathub is one command and runs here.
   */
  const install = async (descriptor: EmulatorDescriptor, spec: InstallMethod): Promise<void> => {
    setPending(null)
    if (spec.kind === 'appimage') {
      setInstalling(descriptor.id)
      return
    }

    setFlatpakBusy(descriptor.id)
    setFlatpakLine(null)
    try {
      await window.rommix.system.installEmulatorFlatpak(descriptor.id)
      onInstalled()
    } finally {
      setFlatpakBusy(null)
      setFlatpakLine(null)
    }
  }

  return (
    <div>
      {order.map((descriptor, index) => {
        const state = diagnostics?.emulators.find((emulator) => emulator.id === descriptor.id)
        const covers = systemCount(descriptor)

        // The library root is named only for an emulator that is here and keeps
        // one relocatable tree: naming a folder for RetroArch would suggest
        // RomMix could move a library RetroArch does not have, and "not found"
        // under "Not installed" is the same fact twice.
        const home = Boolean(descriptor.layout?.relative && state?.install)
        const folders =
          home || Boolean(state?.paths.roms || state?.paths.saves || state?.paths.bios)

        return (
          <div className="emulator" key={descriptor.id}>
            <div className="emulator__body">
              <div className="emulator__name">
                {descriptor.name}
                <Status state={state} />
              </div>
              <div className="emulator__columns">
                {/* What this emulator is and where it came from. */}
                <section className="emulator__group">
                  <h3 className="emulator__group-title">General</h3>
                  <Detail icon="emulator">
                    {covers} platform{covers === 1 ? '' : 's'}
                  </Detail>
                  {/* Why it cannot be used, directly under the badge that says
                      so rather than across the gap in the other column. */}
                  {state?.unavailableReason ? (
                    <Detail icon="warn">{state.unavailableReason}</Detail>
                  ) : null}
                  <Path icon="homepage" label="Homepage" value={descriptor.homepage} />
                  {state?.install ? (
                    <Path
                      icon="package"
                      label={INSTALL_KIND[state.install.kind]}
                      value={state.install.ref}
                    />
                  ) : null}
                </section>

                {/* Where its files are. Absent entirely for an emulator that is
                    not here: a heading over nothing is a column of empty. */}
                {folders ? (
                  <section className="emulator__group">
                    <h3 className="emulator__group-title">Folders</h3>
                    {/* Home first: for an emulator that owns a library the three
                        below hang off it, so the block reads top-down instead of
                        ending on the folder they all came from. */}
                    {home ? (
                      <Path
                        icon="home"
                        label="Home"
                        value={state?.paths.home ?? 'not found'}
                        note={settings?.emulatorRoots?.[descriptor.id] ? ' (set by you)' : ''}
                      />
                    ) : null}
                    <Path icon="roms" label="Roms" value={state?.paths.roms} />
                    <Path icon="saves" label="Saves" value={state?.paths.saves} />
                    <Path icon="bios" label="Bios" value={state?.paths.bios} />
                  </section>
                ) : null}
              </div>

              {/* Below the columns rather than inside one: a field and its two
                  buttons need the width of the row, and half of it would put a
                  path input in a column narrower than the paths it edits. */}
              {rootDraft?.id === descriptor.id ? (
                <div className="form">
                  <TextField
                    label="Home folder"
                    value={rootDraft.value}
                    onChange={(value) => setRootDraft({ id: descriptor.id, value })}
                    placeholder={state?.paths.home ?? ''}
                    hint={
                      'Roms, saves, states and BIOS are read from inside this folder. ' +
                      'Leave it empty to go back to finding it automatically.'
                    }
                    autoFocus
                  />
                  <div className="btn-row">
                    <FocusButton
                      icon="folder"
                      onSelect={() => void saveRoot(descriptor.id, rootDraft.value)}
                    >
                      Use this folder
                    </FocusButton>
                    <FocusButton icon="back" variant="ghost" onSelect={() => setRootDraft(null)}>
                      Cancel
                    </FocusButton>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="emulator__actions">
              {/* First, ahead of the buttons that install and rank: it is the
                  one thing here that opens something rather than doing it.
                  Offered even when the emulator is not detected — a library
                  RomMix cannot find is the main reason to point it at one. */}
              {descriptor.layout?.relative && rootDraft?.id !== descriptor.id ? (
                <FocusButton
                  icon="folder"
                  variant="ghost"
                  onSelect={() =>
                    setRootDraft({
                      id: descriptor.id,
                      value: settings?.emulatorRoots?.[descriptor.id] ?? state?.paths.home ?? ''
                    })
                  }
                >
                  Home folder
                </FocusButton>
              ) : null}
              {/* Only for an install RomMix downloaded: a build it fetched is
                  the one kind it keeps managing after the fact. Offering this
                  beside a flatpak would propose swapping it for an AppImage,
                  which is not a version change but a different install. */}
              {state?.install?.kind === 'appimage' && releaseSource(descriptor) ? (
                <FocusButton
                  icon="download"
                  variant="ghost"
                  onSelect={() => setInstalling(descriptor.id)}
                >
                  Change version
                </FocusButton>
              ) : null}
              {/* Run and Install are the same slot, because they are the same
                  question asked of an emulator that is here and one that is
                  not. Run is offered whenever the program is *present*, not
                  only when it is usable: an emulator that has never been run is
                  unavailable precisely because it has never been run, and this
                  is the button that fixes it. */}
              {state?.install ? (
                <FocusButton
                  icon="play"
                  variant="ghost"
                  onSelect={() => void run(descriptor.id, descriptor.name)}
                >
                  Run
                </FocusButton>
              ) : (
                /* One button whatever the emulator offers — how it gets here is
                   the panel's business, including "you install this one
                   yourself". A row of routes would put the packaging of an
                   emulator in front of someone who only wants it installed. */
                <FocusButton
                  icon="install"
                  variant="ghost"
                  disabled={flatpakBusy !== null}
                  onSelect={() => setPending(descriptor)}
                >
                  {flatpakBusy === descriptor.id ? 'Installing…' : 'Install'}
                </FocusButton>
              )}
              {/* Last, so the buttons that do something to this emulator come
                  first and the pair that only moves it sits where a list's
                  handles belong. Rank, not decoration: moving one up makes it
                  the emulator that answers for every platform both cover. */}
              <FocusButton
                icon="moveUp"
                actionLabel="Move up"
                variant="ghost"
                disabled={index === 0}
                onSelect={() => void move(descriptor.id, -1)}
              />
              <FocusButton
                icon="moveDown"
                actionLabel="Move down"
                variant="ghost"
                disabled={index === order.length - 1}
                onSelect={() => void move(descriptor.id, 1)}
              />
            </div>
          </div>
        )
      })}

      {flatpakBusy ? (
        <Overlay title="Installing from Flathub">
          <p className="muted">{flatpakLine ?? 'Contacting Flathub…'}</p>
          <Spinner />
        </Overlay>
      ) : null}

      {/* Every route this emulator has, each naming what it would do — and the
          answer "none of them" where that is the truth. */}
      {pending ? (
        <Overlay title={`Install ${pending.name}`}>
          {installMethods(pending).map((spec, index) => (
            <div className="choice" key={spec.kind}>
              <FocusButton
                icon={spec.kind === 'flatpak' ? 'install' : 'download'}
                onSelect={() => void install(pending, spec)}
                autoFocus={index === 0}
              >
                {INSTALL_KIND[spec.kind]}
              </FocusButton>
              <span className="faint">
                {spec.kind === 'flatpak'
                  ? `${spec.appId}, from Flathub`
                  : "the build you pick, into RomMix's own folder"}
              </span>
            </div>
          ))}

          {installMethods(pending).length === 0 ? (
            <p className="muted">
              {pending.name} has to be installed by hand
              {pending.homepage ? (
                <>
                  , from <strong>{pending.homepage}</strong>
                </>
              ) : null}
              .
            </p>
          ) : null}

          <div className="btn-row">
            <FocusButton
              icon="cancel"
              variant="ghost"
              onSelect={() => setPending(null)}
              autoFocus={installMethods(pending).length === 0}
            >
              Cancel
            </FocusButton>
          </div>
        </Overlay>
      ) : null}

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
        Published at {descriptor?.homepage}.
      </p>

      <div className="btn-row">
        <FocusButton icon="cancel" onSelect={onClose} autoFocus>
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
  // The same order the Emulators list is showing, so "Default" here names the
  // emulator that would actually run the platform.
  const { settings } = useApp()
  const priority = settings?.emulatorPriority ?? []
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
        const candidates = emulatorsForSystem(system, priority)
        /**
         * The default is the first *installed* emulator that covers the
         * platform, which is what the launcher will pick too.
         *
         * Naming one that is not installed describes an arrangement that
         * cannot happen: RomMix would fall through to the next available
         * emulator and put the games in a different folder than this row
         * claims. With none of them installed there is no default to name, and
         * the row says so instead of pointing at an emulator that is not there.
         */
        const installed = new Set(
          (diagnostics?.emulators ?? []).filter((e) => e.available).map((e) => e.id)
        )
        const fallback = candidates.find((c) => installed.has(c.id))?.id ?? null
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
            <PlatformIcon
              slug={platform.slug}
              system={system}
              size={30}
              label={platform.display_name}
            />
            <div className="emulator__body">
              <div className="emulator__name">
                {platform.display_name}
                {effective ? (
                  <Status state={state} />
                ) : (
                  <span className="status" data-state="warn">
                    {candidates.length === 0 ? 'No emulator covers this' : 'None installed'}
                  </span>
                )}
              </div>
              <div className="emulator__meta">
                {systemLabel(system)} · {platform.rom_count} game
                {platform.rom_count === 1 ? '' : 's'}
              </div>
            </div>
            <div className="emulator__actions">
              <FocusButton
                icon="emulator"
                variant="ghost"
                disabled={candidates.length === 0}
                onSelect={advance}
              >
                {effective ? (emulatorById(effective)?.name ?? effective) : 'None'}
                {current == null && effective ? ' (default)' : ''}
              </FocusButton>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * A labelled setting with its own On/Off control, rather than the label
 * smuggled into the text of one of the options.
 */
function Toggle({
  label,
  hint,
  on,
  onToggle
}: {
  label: string
  hint?: string
  on: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <div className="setting">
      <div className="setting__text">
        <div className="setting__label">{label}</div>
        {hint ? <div className="setting__hint">{hint}</div> : null}
      </div>
      <SegmentedControl<'on' | 'off'>
        value={on ? 'on' : 'off'}
        onChange={(next) => {
          if ((next === 'on') !== on) onToggle()
        }}
        options={[
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' }
        ]}
      />
    </div>
  )
}

/** The same row as `Toggle`, for a setting with more than two answers. */
function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange
}: {
  label: string
  hint?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="setting">
      <div className="setting__text">
        <div className="setting__label">{label}</div>
        {hint ? <div className="setting__hint">{hint}</div> : null}
      </div>
      <SegmentedControl<T> value={value} options={options} onChange={onChange} />
    </div>
  )
}

/**
 * The scales offered, as the strings the segmented control switches on.
 *
 * A short list of round numbers rather than a slider: this is a control being
 * driven from a sofa, and every value between 100% and 200% that anyone would
 * actually stop at is here. `auto` is 0 in settings — see `Settings.uiScale`.
 */
type UiScaleChoice = 'auto' | '1' | '1.25' | '1.5' | '2'

const UI_SCALES: { value: UiScaleChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '1', label: '100%' },
  { value: '1.25', label: '125%' },
  { value: '1.5', label: '150%' },
  { value: '2', label: '200%' }
]

/** The stored number as one of the offered choices, falling back to Auto. */
function uiScaleChoice(scale: number): UiScaleChoice {
  const match = UI_SCALES.find((option) => option.value === String(scale))
  return match ? match.value : 'auto'
}
