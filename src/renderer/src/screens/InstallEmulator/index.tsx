import { type JSX, useEffect, useRef, useState } from 'react'
import { emulatorById, emulatorsForSystem, installMethods } from '@config/emulators'
import { localize } from '@shared/i18n'
import type {
  EmulatorAsset,
  EmulatorDescriptor,
  EmulatorId,
  EmulatorInstallProgress,
  EmulatorRelease
} from '@shared/types'
import { Filled, Spinner, TransferProgress } from '../../components'
import { useApp, useI18n } from '../../state'
import { WizardPage } from './WizardPage'
import { AssetRow, EmulatorRow, MethodRow, ReleaseRow } from './rows'

/**
 * Putting an emulator on the machine, one question to a page.
 *
 * The pages, in the order they are asked: which emulator, how it should be
 * installed, which version, which build, the install itself, and what is left
 * to do inside it. Which of them are asked depends on the answers — only a
 * build RomMix downloads has a version, and an emulator the caller named has no
 * first page.
 *
 * A screen rather than the stack of dialogs this was, because of how long it
 * takes: choosing a build among twenty releases and then waiting for several
 * hundred megabytes is not something to do in a panel over the page that raised
 * it. The game screen and the Emulators screen both come here, and the only
 * difference between them is whether the first page is asked at all.
 */

/** One of the routes `installMethods` returns: a thing RomMix can actually do. */
type InstallMethod = ReturnType<typeof installMethods>[number]

type Step = 'emulator' | 'method' | 'manual' | 'version' | 'build' | 'progress' | 'notes'

/**
 * Where the flow opens, and with what already settled.
 *
 * Only what the caller has genuinely answered is skipped: an emulator it was
 * sent here for is not a question. How that emulator arrives is always asked,
 * even where there is a single route to take — installing reaches outside
 * RomMix, and on a pad the button under the cursor is one press from being
 * taken. That page is the confirmation as much as the choice.
 */
function openingOf(
  descriptor: EmulatorDescriptor | null,
  changeVersion: boolean
): { step: Step; method: InstallMethod | null } {
  if (!descriptor) return { step: 'emulator', method: null }

  const methods = installMethods(descriptor)
  // Changing the version of a build RomMix downloaded is the back half of this
  // flow: which emulator and how it is packaged are both settled by the install
  // being replaced.
  const download = methods.find((spec) => spec.kind === 'appimage') ?? null
  if (changeVersion && download) return { step: 'version', method: download }

  return { step: methods.length === 0 ? 'manual' : 'method', method: null }
}

export function InstallEmulatorScreen({
  emulatorId,
  system,
  platform,
  changeVersion = false
}: {
  /** The emulator already settled on, which is what skips the first page. */
  emulatorId?: EmulatorId
  /** The system the first page's list is drawn from. */
  system?: string
  /** What that system is called on RomM, for the sentence over the list. */
  platform?: string
  /** Straight to the builds, for an install RomMix already manages. */
  changeVersion?: boolean
}): JSX.Element {
  const i18n = useI18n()
  const { t } = i18n
  const { settings, goBack } = useApp()

  const named = emulatorId ? emulatorById(emulatorId) : null
  // Settled once: where the flow opens is a fact about how it was entered, and
  // working it out again on a later render would put a page back under
  // somebody who has already answered it.
  const [opening] = useState(() => openingOf(named, changeVersion))

  const [chosen, setChosen] = useState<EmulatorDescriptor | null>(named)
  const [step, setStep] = useState<Step>(opening.step)
  const [method, setMethod] = useState<InstallMethod | null>(opening.method)
  const [release, setRelease] = useState<EmulatorRelease | null>(null)
  const [asset, setAsset] = useState<EmulatorAsset | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  /** Whether the first page was asked, which decides what is behind the second. */
  const picked = named === null
  const leave = (): void => goBack()
  const backFromMethod = picked ? () => setStep('emulator') : leave
  // Every route out of the version list goes back through the page that chose
  // it, except the one that entered on the list itself.
  const backFromVersion = changeVersion ? leave : () => setStep('method')

  const take = (spec: InstallMethod): void => {
    setMethod(spec)
    setFailure(null)
    setStep(spec.kind === 'appimage' ? 'version' : 'progress')
  }

  const pick = (descriptor: EmulatorDescriptor): void => {
    setChosen(descriptor)
    setStep(installMethods(descriptor).length === 0 ? 'manual' : 'method')
  }

  if (step === 'emulator') {
    const candidates = system ? emulatorsForSystem(system, settings?.emulatorPriority ?? []) : []
    return (
      <WizardPage
        title={t('install.whichEmulator')}
        subtitle={t('install.whichEmulatorFor', { platform: platform ?? system ?? '' })}
        onBack={leave}
      >
        {candidates.length === 0 ? <div className="empty">{t('platforms.noneCovers')}</div> : null}
        <div className="release-list">
          {candidates.map((descriptor, index) => (
            <EmulatorRow
              key={descriptor.id}
              descriptor={descriptor}
              onSelect={() => pick(descriptor)}
              // The first is the one RomMix would pick for the platform by
              // itself — see `orderedEmulators`.
              autoFocus={index === 0}
            />
          ))}
        </div>
      </WizardPage>
    )
  }

  // Every page below is about one emulator, and none of them is reached
  // without one: the step above is where the flow opens with nothing chosen.
  if (!chosen) return <WizardPage title={t('install.whichEmulator')} onBack={leave} />

  if (step === 'method') {
    return (
      <WizardPage
        title={t('emulator.installTitle', { name: chosen.name })}
        subtitle={t('install.whichMethod')}
        onBack={backFromMethod}
      >
        <div className="release-list">
          {installMethods(chosen).map((spec, index) => (
            <MethodRow
              key={spec.kind}
              kind={spec.kind}
              detail={
                spec.kind === 'flatpak'
                  ? t('emulator.fromFlathub', { appId: spec.appId })
                  : t('emulator.buildIntoRomMix')
              }
              onSelect={() => take(spec)}
              autoFocus={index === 0}
            />
          ))}
        </div>
      </WizardPage>
    )
  }

  if (step === 'manual') {
    return (
      <WizardPage
        title={t('emulator.installTitle', { name: chosen.name })}
        onBack={backFromMethod}
        action={{ label: t('action.close'), icon: 'confirm', onSelect: leave }}
      >
        <p className="muted">
          {chosen.homepage ? (
            /* `homepage` is deliberately not passed: an unfilled placeholder is
               left standing, which is exactly what `Filled` then splits the
               sentence at. */
            <Filled text={t('emulator.manualInstallFrom', { name: chosen.name })} name="homepage">
              <strong>{chosen.homepage}</strong>
            </Filled>
          ) : (
            t('emulator.manualInstall', { name: chosen.name })
          )}
        </p>
      </WizardPage>
    )
  }

  if (step === 'version') {
    return (
      <VersionPage
        descriptor={chosen}
        onPick={(next) => {
          setRelease(next)
          setStep('build')
        }}
        onBack={backFromVersion}
      />
    )
  }

  if (step === 'build' && release) {
    return (
      <WizardPage
        title={`${chosen.name} ${release.name || release.tag}`}
        subtitle={t('install.whichBuild')}
        onBack={() => setStep('version')}
      >
        <div className="release-list">
          {release.assets.map((next, index) => (
            <AssetRow
              key={next.url}
              asset={next}
              onSelect={() => {
                setAsset(next)
                setFailure(null)
                setStep('progress')
              }}
              autoFocus={index === 0}
            />
          ))}
        </div>
      </WizardPage>
    )
  }

  if (step === 'progress' && method) {
    // What went wrong, on the page it went wrong on: the install is one press
    // from being tried again, and the build that failed is the page behind.
    if (failure) {
      return (
        <WizardPage
          title={t('install.failedTitle', { name: chosen.name })}
          onBack={() => setStep(method.kind === 'appimage' ? 'build' : 'method')}
          action={{
            label: t('action.tryAgain'),
            icon: 'install',
            onSelect: () => setFailure(null)
          }}
        >
          <div className="notice notice--error">{failure}</div>
        </WizardPage>
      )
    }

    return (
      <WizardPage title={t('install.installing', { name: chosen.name })}>
        <InstallRun
          descriptor={chosen}
          method={method}
          asset={asset}
          onDone={() => setStep('notes')}
          onFailed={setFailure}
        />
      </WizardPage>
    )
  }

  // The last page, which is the one every path through this screen ends on.
  return (
    <WizardPage
      title={t('emulator.installedTitle', { name: chosen.name })}
      subtitle={
        chosen.setupNotes.length > 0
          ? t('emulator.setupIntro', { name: chosen.name })
          : t('install.nothingElse', { name: chosen.name })
      }
      action={{ label: t('action.close'), icon: 'confirm', onSelect: leave }}
    >
      {/* The steps, at the moment the emulator arrives. This is when the user
          is already thinking about it and has nothing else in flight, which is
          the cheapest moment to spend their attention — the game page keeps its
          own copy, dismissible per emulator, for the times this page was walked
          past. */}
      <ul className="notice__list muted">
        {chosen.setupNotes.map((note) => (
          <li key={typeof note === 'string' ? note : note.key}>{localize(note, i18n)}</li>
        ))}
      </ul>
    </WizardPage>
  )
}

/**
 * The versions this emulator has published, newest first.
 *
 * Its own component because it fetches: the list is asked for when the page is
 * reached rather than when the flow starts, so an emulator installed from
 * Flathub never calls the release API at all.
 *
 * What comes back is what the project published, less anything this machine
 * could not run — the main process drops builds for another architecture before
 * any of it gets here, since only it has a `process.arch` to compare against.
 */
function VersionPage({
  descriptor,
  onPick,
  onBack
}: {
  descriptor: EmulatorDescriptor
  onPick: (release: EmulatorRelease) => void
  onBack: () => void
}): JSX.Element {
  const { t } = useI18n()
  const [releases, setReleases] = useState<EmulatorRelease[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.rommix.system
      .emulatorReleases(descriptor.id)
      .then(setReleases)
      .catch((cause: Error) => setError(cause.message))
  }, [descriptor.id])

  return (
    <WizardPage
      title={t('install.title', { name: descriptor.name })}
      subtitle={t('install.whichVersion')}
      onBack={onBack}
    >
      {error ? <div className="notice notice--error">{error}</div> : null}
      {!releases && !error ? <Spinner /> : null}
      {releases?.length === 0 ? <div className="empty">{t('install.noBuilds')}</div> : null}

      <div className="release-list">
        {(releases ?? []).map((release, index) => (
          <ReleaseRow
            key={release.tag}
            release={release}
            // The newest is what nearly everybody wants, and it is first.
            latest={index === 0}
            onSelect={() => onPick(release)}
            autoFocus={index === 0}
          />
        ))}
      </div>

      <p className="faint" style={{ fontSize: 13 }}>
        {t('install.publishedAt', { url: descriptor.homepage ?? '' })}
      </p>
    </WizardPage>
  )
}

/**
 * The install itself, started by being drawn.
 *
 * Mounting is what runs it, so the page above decides when an install happens
 * by deciding when this is on screen — and trying again is this component
 * mounting a second time rather than a second path through the flow.
 *
 * The two kinds report themselves differently and are drawn differently:
 * RomMix's own download knows how many bytes there are, and flatpak knows only
 * what it has just said out loud.
 */
function InstallRun({
  descriptor,
  method,
  asset,
  onDone,
  onFailed
}: {
  descriptor: EmulatorDescriptor
  method: InstallMethod
  /** The build chosen, for a download. Null for a flatpak, which has no file. */
  asset: EmulatorAsset | null
  onDone: () => void
  onFailed: (message: string) => void
}): JSX.Element {
  const { t } = useI18n()
  const [progress, setProgress] = useState<EmulatorInstallProgress | null>(null)

  // Read at fire time rather than closed over: both are rebuilt on every render
  // of the screen above, and an effect depending on them would start the
  // install again each time a byte arrived.
  const handlers = useRef({ onDone, onFailed })
  useEffect(() => {
    handlers.current = { onDone, onFailed }
  })

  // Only this emulator's: the same channel carries every install RomMix runs.
  useEffect(
    () =>
      window.rommix.system.onInstallProgress((next) => {
        if (next.emulatorId === descriptor.id) setProgress(next)
      }),
    [descriptor.id]
  )

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        if (method.kind === 'appimage') {
          if (!asset) return
          await window.rommix.system.installEmulator(descriptor.id, asset)
        } else {
          await window.rommix.system.installEmulatorFlatpak(descriptor.id)
        }
        if (live) handlers.current.onDone()
      } catch (cause) {
        // Also reported centrally on `app:error`. Kept here as well because the
        // toast is gone in five seconds and this page is what is left.
        if (live) handlers.current.onFailed((cause as Error).message)
      }
    })()
    // Only the identity of what is being installed. A run that is still going
    // when this unmounts is left to finish in the main process; what the flag
    // stops is a finished one reporting back to a page nobody is on.
    return () => {
      live = false
    }
  }, [descriptor.id, method.kind, asset])

  if (method.kind === 'flatpak') {
    return (
      <>
        <p className="muted">{progress?.message ?? t('emulator.contactingFlathub')}</p>
        <Spinner />
      </>
    )
  }

  return (
    <div className="install-progress">
      <TransferProgress
        name={asset?.name ?? descriptor.name}
        receivedBytes={progress?.receivedBytes ?? 0}
        totalBytes={progress?.totalBytes ?? 0}
      />
    </div>
  )
}
