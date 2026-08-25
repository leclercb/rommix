import { type JSX, type ReactNode, useEffect, useState } from 'react'
import {
  orderedEmulators,
  emulatorById,
  installMethods,
  releaseSource,
  systemCount
} from '@config/emulators'
import type { MessageKey } from '@shared/i18n'
import type {
  DiagnosticsReport,
  EmulatorDescriptor,
  EmulatorId,
  EmulatorState,
  ResolvedInstall
} from '@shared/types'
import { FocusButton, Filled, Overlay, Spinner, TextField } from '../../components'
import { Icon, type IconName } from '../../icons'
import { useApp, useI18n } from '../../state'
import { InstallPicker } from './InstallPicker'

/**
 * The emulators RomMix knows about, in the order it prefers them.
 *
 * Everything about one emulator is in this file: what the row says, where its
 * files are, and the three things that can be done to it — pointed at a folder,
 * installed, started. The version picker installing brings up is its own module.
 */

/** Installed / not-installed marker, with the in-between state named. */
export function Status({ state }: { state: EmulatorState | undefined }): JSX.Element {
  const { t } = useI18n()
  if (!state)
    return (
      <span className="status" data-state="off">
        {t('emulator.notChecked')}
      </span>
    )
  if (state.available)
    return (
      <span className="status" data-state="ok">
        {t('emulator.installed')}
      </span>
    )
  // Present but unusable is worth distinguishing from absent: the fix is
  // different (run it once, vs install it).
  if (state.install)
    return (
      <span className="status" data-state="warn">
        {t('emulator.needsSetup')}
      </span>
    )
  return (
    <span className="status" data-state="off">
      {t('emulator.notInstalled')}
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
const INSTALL_KIND: Record<ResolvedInstall['kind'], MessageKey> = {
  flatpak: 'emulator.kindFlatpak',
  binary: 'emulator.kindBinary',
  appimage: 'emulator.kindAppImage',
  scripts: 'emulator.kindScripts'
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
export function EmulatorList({
  diagnostics,
  notify,
  confirmChange,
  onInstalled
}: {
  diagnostics: DiagnosticsReport | null
  notify: ReturnType<typeof useApp>['notify']
  /** Ask before a change that costs a re-download. Resolves false on cancel. */
  confirmChange: () => Promise<boolean>
  onInstalled: () => void
}): JSX.Element {
  const { t } = useI18n()
  const { settings, saveSettings, refreshInstalled } = useApp()
  const [installing, setInstalling] = useState<EmulatorId | null>(null)
  const [running, setRunning] = useState<EmulatorId | null>(null)
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

    // Asked before anything is written: this reorders which emulator answers
    // for every platform both cover, which is a re-download of their games and
    // a reinstall of their BIOS. See `EmulatorChangeNotice`.
    if (!(await confirmChange())) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    await saveSettings({ emulatorPriority: ids })
    // The probe has re-run in the main process by the time this returns, and
    // both of these are drawn from it: which emulator is in charge of each
    // platform, and which downloads that emulator can actually see.
    onInstalled()
    await refreshInstalled()
    notify(
      t(delta < 0 ? 'emulator.movedUp' : 'emulator.movedDown', {
        name: emulatorById(id)?.name ?? id
      })
    )
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
    setRunning(id)
    try {
      // This waits a couple of seconds now: the main process holds the answer
      // back until the emulator has either survived long enough to count as
      // started or quit with something to say about why. So the button says
      // "Starting…" rather than looking wedged.
      await window.rommix.system.runEmulator(id)
      notify(t('emulator.started', { name }))
      onInstalled()
    } catch {
      // Reported centrally on `app:error`, in the emulator's own words.
    } finally {
      setRunning(null)
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
    notify(
      trimmed
        ? t('emulator.rootSet', { name: emulatorById(id)?.name ?? id, path: trimmed })
        : t('emulator.rootCleared', { name: emulatorById(id)?.name ?? id })
    )
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
      notify(t('emulator.installedToast', { name: descriptor.name }))
    } catch {
      // Reported centrally on `app:error`; this only keeps the success
      // notification from firing over a failed install.
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
                  <h3 className="emulator__group-title">{t('emulator.groupGeneral')}</h3>
                  <Detail icon="emulator">{t('emulator.platforms', { count: covers })}</Detail>
                  {/* Why it cannot be used, directly under the badge that says
                      so rather than across the gap in the other column. */}
                  {state?.unavailableReason ? (
                    <Detail icon="warn">{state.unavailableReason}</Detail>
                  ) : null}
                  <Path
                    icon="homepage"
                    label={t('emulator.homepage')}
                    value={descriptor.homepage}
                  />
                  {state?.install ? (
                    <Path
                      icon="package"
                      label={t(INSTALL_KIND[state.install.kind])}
                      value={state.install.ref}
                    />
                  ) : null}
                </section>

                {/* Where its files are. Absent entirely for an emulator that is
                    not here: a heading over nothing is a column of empty. */}
                {folders ? (
                  <section className="emulator__group">
                    <h3 className="emulator__group-title">{t('emulator.groupFolders')}</h3>
                    {/* Home first: for an emulator that owns a library the three
                        below hang off it, so the block reads top-down instead of
                        ending on the folder they all came from. */}
                    {home ? (
                      <Path
                        icon="home"
                        label={t('emulator.home')}
                        value={state?.paths.home ?? t('emulator.notFound')}
                        note={
                          settings?.emulatorRoots?.[descriptor.id]
                            ? ` ${t('emulator.setByYou')}`
                            : ''
                        }
                      />
                    ) : null}
                    <Path icon="roms" label={t('emulator.roms')} value={state?.paths.roms} />
                    <Path icon="saves" label={t('emulator.saves')} value={state?.paths.saves} />
                    <Path icon="bios" label={t('emulator.bios')} value={state?.paths.bios} />
                  </section>
                ) : null}
              </div>

              {/* Below the columns rather than inside one: a field and its two
                  buttons need the width of the row, and half of it would put a
                  path input in a column narrower than the paths it edits. */}
              {rootDraft?.id === descriptor.id ? (
                <div className="form">
                  <TextField
                    label={t('emulator.homeFolder')}
                    value={rootDraft.value}
                    onChange={(value) => setRootDraft({ id: descriptor.id, value })}
                    placeholder={state?.paths.home ?? ''}
                    hint={t('emulator.homeFolderHint')}
                    autoFocus
                  />
                  <div className="btn-row">
                    <FocusButton
                      icon="folder"
                      onSelect={() => void saveRoot(descriptor.id, rootDraft.value)}
                    >
                      {t('emulator.useThisFolder')}
                    </FocusButton>
                    <FocusButton icon="back" variant="ghost" onSelect={() => setRootDraft(null)}>
                      {t('action.cancel')}
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
                  {t('emulator.homeFolder')}
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
                  {t('emulator.changeVersion')}
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
                  disabled={running !== null}
                  onSelect={() => void run(descriptor.id, descriptor.name)}
                >
                  {running === descriptor.id ? t('action.starting') : t('emulator.run')}
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
                  {flatpakBusy === descriptor.id ? t('action.installing') : t('action.install')}
                </FocusButton>
              )}
              {/* Last, so the buttons that do something to this emulator come
                  first and the pair that only moves it sits where a list's
                  handles belong. Rank, not decoration: moving one up makes it
                  the emulator that answers for every platform both cover. */}
              <FocusButton
                icon="moveUp"
                actionLabel={t('action.moveUp')}
                variant="ghost"
                disabled={index === 0}
                onSelect={() => void move(descriptor.id, -1)}
              />
              <FocusButton
                icon="moveDown"
                actionLabel={t('action.moveDown')}
                variant="ghost"
                disabled={index === order.length - 1}
                onSelect={() => void move(descriptor.id, 1)}
              />
            </div>
          </div>
        )
      })}

      {flatpakBusy ? (
        <Overlay title={t('emulator.installingFlathub')}>
          <p className="muted">{flatpakLine ?? t('emulator.contactingFlathub')}</p>
          <Spinner />
        </Overlay>
      ) : null}

      {/* Every route this emulator has, each naming what it would do — and the
          answer "none of them" where that is the truth. */}
      {pending ? (
        <Overlay title={t('emulator.installTitle', { name: pending.name })}>
          {installMethods(pending).map((spec, index) => (
            <div className="choice" key={spec.kind}>
              <FocusButton
                icon={spec.kind === 'flatpak' ? 'install' : 'download'}
                onSelect={() => void install(pending, spec)}
                autoFocus={index === 0}
              >
                {t(INSTALL_KIND[spec.kind])}
              </FocusButton>
              <span className="faint">
                {spec.kind === 'flatpak'
                  ? t('emulator.fromFlathub', { appId: spec.appId })
                  : t('emulator.buildIntoRomMix')}
              </span>
            </div>
          ))}

          {installMethods(pending).length === 0 ? (
            <p className="muted">
              {pending.homepage ? (
                /* `homepage` is deliberately not passed: an unfilled
                   placeholder is left standing, which is exactly what `Filled`
                   then splits the sentence at. */
                <Filled
                  text={t('emulator.manualInstallFrom', { name: pending.name })}
                  name="homepage"
                >
                  <strong>{pending.homepage}</strong>
                </Filled>
              ) : (
                t('emulator.manualInstall', { name: pending.name })
              )}
            </p>
          ) : null}

          <div className="btn-row">
            <FocusButton
              icon="cancel"
              variant="ghost"
              onSelect={() => setPending(null)}
              autoFocus={installMethods(pending).length === 0}
            >
              {t('action.cancel')}
            </FocusButton>
          </div>
        </Overlay>
      ) : null}

      {installing ? (
        <InstallPicker
          emulatorId={installing}
          onClose={() => setInstalling(null)}
          onInstalled={() => {
            const name = emulatorById(installing)?.name ?? installing
            setInstalling(null)
            onInstalled()
            notify(t('emulator.installedToast', { name }))
          }}
        />
      ) : null}
    </div>
  )
}
