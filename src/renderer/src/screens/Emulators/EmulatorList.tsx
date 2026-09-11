import { type JSX, type ReactNode, useState } from 'react'
import { orderedEmulators, emulatorById, releaseSource, systemCount } from '@config/emulators'
import { localize, type MessageKey } from '@shared/i18n'
import type {
  DiagnosticsReport,
  EmulatorDescriptor,
  EmulatorId,
  EmulatorState,
  ResolvedInstall
} from '@shared/types'
import { FocusButton, StatusPill, TextField, type Tone } from '../../components'
import { Icon, type IconName } from '../../icons'
import { useApp, useI18n } from '../../state'
import { SetupNotesNotice } from './SetupNotesNotice'

/**
 * The emulators RomMix knows about, in the order it prefers them.
 *
 * Everything about one emulator is in this file: what the row says, where its
 * files are, and the three things that can be done to it — pointed at a folder,
 * installed, started. Installing is a separate screen, which this only opens:
 * see `InstallEmulatorScreen`.
 */

/** Installed / not-installed marker, with the in-between state named. */
export function Status({ state }: { state: EmulatorState | undefined }): JSX.Element {
  const { t } = useI18n()
  // Present but unusable is worth distinguishing from absent: the fix is
  // different (run it once, vs install it).
  const [label, tone]: [MessageKey, Tone] = !state
    ? ['emulator.notChecked', 'off']
    : state.available
      ? ['emulator.installed', 'ok']
      : state.install
        ? ['emulator.needsSetup', 'warn']
        : ['emulator.notInstalled', 'off']

  return <StatusPill tone={tone}>{t(label)}</StatusPill>
}

/**
 * How each install kind is spelled on screen.
 *
 * The keys are identifiers and read like them — `appimage` is not a word
 * anybody writes, and a row that says "appimage:" looks like a leaked internal
 * name rather than a statement about the user's machine.
 */
export const INSTALL_KIND: Record<ResolvedInstall['kind'], MessageKey> = {
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
  const i18n = useI18n()
  const { t } = i18n
  const { settings, saveSettings, refreshInstalled, navigate } = useApp()
  const [running, setRunning] = useState<EmulatorId | null>(null)
  /**
   * The emulator whose setup steps are being read, long after it arrived. Null
   * for one that wants nothing done, which is most of them.
   */
  const [setUp, setSetUp] = useState<EmulatorDescriptor | null>(null)

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
  const run = async (id: EmulatorId): Promise<void> => {
    setRunning(id)
    try {
      // This waits a couple of seconds now: the main process holds the answer
      // back until the emulator has either survived long enough to count as
      // started or quit with something to say about why. So the button says
      // "Starting…" rather than looking wedged.
      await window.rommix.system.runEmulator(id)
      // No toast: the overlay that goes up the moment it is running says the
      // same thing, and stays until it is closed. Two of them over one event is
      // one too many.
      onInstalled()
    } catch {
      // Reported centrally on `app:error`, in the emulator's own words.
    } finally {
      setRunning(null)
    }
  }

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
   * Steps the user has said they do not want shown again, by emulator.
   *
   * The same key the game page writes, so hiding them in either place hides
   * them in both: the answer is about this emulator, not about the screen it
   * was given on.
   */
  const dismissedNotices = settings?.dismissedNotices ?? []
  const hideSetup = async (descriptor: EmulatorDescriptor): Promise<void> => {
    const key = `setup:${descriptor.id}`
    if (dismissedNotices.includes(key)) return
    await saveSettings({ dismissedNotices: [...dismissedNotices, key] })
    notify(t('setup.hidden', { emulator: descriptor.name }))
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
          <div className="emulator" key={descriptor.id} data-emulator={descriptor.id}>
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

              {/* What is still to be done inside it, for an emulator that is
                  actually here — the same notice the game page shows when a
                  game is about to be launched on it. Faint text in a column was
                  the one place these could sit and be missed, which is the
                  whole thing they exist to prevent.

                  Dismissible, and by the same key the game page uses: the
                  answer is about this emulator rather than about the screen it
                  was given on, so saying it once is enough. Installing it again
                  is what brings the steps back. */}
              {state?.install &&
              descriptor.setupNotes.length > 0 &&
              !dismissedNotices.includes(`setup:${descriptor.id}`) ? (
                <div className="notice notice--warn">
                  <ul className="notice__list">
                    {descriptor.setupNotes.map((note) => (
                      <li key={typeof note === 'string' ? note : note.key}>
                        {localize(note, i18n)}
                      </li>
                    ))}
                  </ul>
                  <div className="btn-row">
                    <FocusButton
                      icon="hide"
                      variant="ghost"
                      onSelect={() => void hideSetup(descriptor)}
                    >
                      {t('setup.dontShowAgain')}
                    </FocusButton>
                  </div>
                </div>
              ) : null}

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
                      action="emulator-root-save"
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
                  action="emulator-root"
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
                  onSelect={() =>
                    navigate({
                      name: 'install-emulator',
                      emulatorId: descriptor.id,
                      changeVersion: true
                    })
                  }
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
                  onSelect={() => void run(descriptor.id)}
                >
                  {running === descriptor.id ? t('action.starting') : t('emulator.run')}
                </FocusButton>
              ) : (
                /* One button whatever the emulator offers — how it gets here is
                   the flow's business, including "you install this one
                   yourself". A row of routes would put the packaging of an
                   emulator in front of someone who only wants it installed. */
                <FocusButton
                  icon="install"
                  action="install-emulator"
                  variant="ghost"
                  onSelect={() => navigate({ name: 'install-emulator', emulatorId: descriptor.id })}
                >
                  {t('action.install')}
                </FocusButton>
              )}
              {/* The steps, on demand. Icon-only because it is the one button
                  in this row that opens a reference rather than doing
                  something, and because the row is already wide. Disabled
                  rather than hidden for an emulator that wants nothing done:
                  the answer "there is nothing to set up" is worth being able to
                  read off the row, and a button that comes and goes makes the
                  rows below it move. */}
              <FocusButton
                icon="note"
                action="setup-steps"
                variant="ghost"
                actionLabel={t('emulator.setupSteps')}
                disabled={descriptor.setupNotes.length === 0}
                onSelect={() => setSetUp(descriptor)}
              />
              {/* Last, so the buttons that do something to this emulator come
                  first and the pair that only moves it sits where a list's
                  handles belong. Rank, not decoration: moving one up makes it
                  the emulator that answers for every platform both cover. */}
              <FocusButton
                icon="moveUp"
                action="move-up"
                actionLabel={t('action.moveUp')}
                variant="ghost"
                disabled={index === 0}
                onSelect={() => void move(descriptor.id, -1)}
              />
              <FocusButton
                icon="moveDown"
                action="move-down"
                actionLabel={t('action.moveDown')}
                variant="ghost"
                disabled={index === order.length - 1}
                onSelect={() => void move(descriptor.id, 1)}
              />
            </div>
          </div>
        )
      })}

      {setUp ? <SetupNotesNotice emulator={setUp} onClose={() => setSetUp(null)} /> : null}
    </div>
  )
}
