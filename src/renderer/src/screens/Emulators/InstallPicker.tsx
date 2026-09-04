import { type JSX, type Ref, useEffect, useState } from 'react'
import { emulatorById } from '@config/emulators'
import type {
  EmulatorAsset,
  EmulatorId,
  EmulatorInstallProgress,
  EmulatorRelease
} from '@shared/types'
import { FocusButton, Overlay, ProgressBar, Spinner } from '../../components'
import { Icon } from '../../icons'
import { useAction, useFocusable } from '../../input/focus'
import { useI18n } from '../../state'

/**
 * Pick a release build to install, in two steps: which version, then which file.
 *
 * One list would be shorter to write and worse to use. Eden publishes eight
 * runnable Linux builds per release on a given architecture — legacy, steamdeck
 * and rog-ally variants, each in a clang-pgo and a gcc-standard flavour — and
 * offers twenty releases at a time. Flattened, that is a hundred and sixty
 * near-identical filenames in one column, where the two questions a person
 * actually has are asked at once: *which version*, which they mostly answer
 * "the newest", and *which build*, which depends on their hardware.
 *
 * So the version is settled first, on a short list where each row says what
 * distinguishes it — how new it is, whether it is a pre-release — and the files
 * are shown only for the one chosen. Going back is B, as everywhere else.
 *
 * The list is what the project published, less anything this machine could not
 * run: the main process drops builds for another architecture before any of it
 * gets here, since only it has a `process.arch` to compare against.
 */
export function InstallPicker({
  emulatorId,
  onClose,
  onInstalled
}: {
  emulatorId: EmulatorId
  onClose: () => void
  onInstalled: () => void
}): JSX.Element {
  const { t, formatBytes } = useI18n()
  const [releases, setReleases] = useState<EmulatorRelease[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<EmulatorInstallProgress | null>(null)
  /** The release whose files are showing, or null while the version is being picked. */
  const [chosen, setChosen] = useState<EmulatorRelease | null>(null)

  const descriptor = emulatorById(emulatorId)

  useEffect(() => {
    void window.rommix.system
      .emulatorReleases(emulatorId)
      .then(setReleases)
      .catch((cause: Error) => setError(cause.message))
  }, [emulatorId])

  // Only this emulator's: the same channel carries the flatpak installer's own
  // output, which another dialog is reading at the same time.
  useEffect(
    () =>
      window.rommix.system.onInstallProgress((next) => {
        if (next.emulatorId === emulatorId) setProgress(next)
      }),
    [emulatorId]
  )

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
    const received = progress?.receivedBytes ?? 0
    const total = progress?.totalBytes ?? 0
    return (
      <Overlay
        title={t('install.installing', { name: descriptor?.name ?? emulatorId })}
        icon="install"
      >
        <div className="install-progress">
          <div className="install-progress__file">{busy}</div>
          {total > 0 ? (
            <>
              <ProgressBar percent={(received / total) * 100} />
              <div className="install-progress__meta">
                {t('install.progressBytes', {
                  received: formatBytes(received),
                  total: formatBytes(total)
                })}
              </div>
            </>
          ) : (
            /* Nothing to divide by until the first bytes arrive, and Eden's
               release API reports no size for its assets at all — so what has
               arrived is the whole of what can honestly be said. */
            <>
              <div className="install-progress__meta">{formatBytes(received)}</div>
              <Spinner />
            </>
          )}
        </div>
      </Overlay>
    )
  }

  if (chosen) {
    return (
      <AssetPicker
        emulatorName={descriptor?.name ?? emulatorId}
        release={chosen}
        error={error}
        onPick={(asset) => void install(asset)}
        onBack={() => {
          setError(null)
          setChosen(null)
        }}
      />
    )
  }

  return (
    <Overlay title={t('install.title', { name: descriptor?.name ?? emulatorId })} icon="install">
      {error ? <div className="notice notice--error">{error}</div> : null}
      {!releases && !error ? <Spinner /> : null}

      {releases?.length === 0 ? <div className="empty">{t('install.noBuilds')}</div> : null}

      {releases && releases.length > 0 ? (
        <>
          <p className="muted">{t('install.whichVersion')}</p>
          <div className="release-list">
            {releases.map((release, index) => (
              <ReleaseRow
                key={release.tag}
                release={release}
                // The newest is what nearly everybody wants, and it is first.
                latest={index === 0}
                onSelect={() => setChosen(release)}
                autoFocus={index === 0}
              />
            ))}
          </div>
        </>
      ) : null}

      <p className="faint" style={{ fontSize: 13 }}>
        {t('install.publishedAt', { url: descriptor?.homepage ?? '' })}
      </p>

      <div className="btn-row">
        <FocusButton icon="cancel" onSelect={onClose}>
          {t('action.cancel')}
        </FocusButton>
      </div>
    </Overlay>
  )
}

/**
 * One version, as a row rather than a button.
 *
 * A release's name is often just a tag, so the row carries what actually
 * separates one from another: how long ago it was published, whether it is a
 * pre-release, and how many files it has for this machine.
 */
function ReleaseRow({
  release,
  latest,
  onSelect,
  autoFocus
}: {
  release: EmulatorRelease
  latest: boolean
  onSelect: () => void
  autoFocus: boolean
}): JSX.Element {
  const { t, formatDateTime } = useI18n()
  const { ref, props } = useFocusable({
    onSelect,
    autoFocus,
    actionLabel: t('install.chooseVersion')
  })
  const count = release.assets.length

  return (
    <div ref={ref as Ref<HTMLDivElement>} className="release" {...props}>
      <div className="release__body">
        <div className="release__name">
          {release.name || release.tag}
          {latest ? (
            <span className="status" data-state="ok">
              {t('install.latest')}
            </span>
          ) : null}
          {release.prerelease ? (
            <span className="status" data-state="warn">
              {t('install.prerelease')}
            </span>
          ) : null}
        </div>
        <div className="release__meta">
          {release.publishedAt ? formatDateTime(release.publishedAt) : t('install.noDate')} ·{' '}
          {t('install.builds', { count })}
        </div>
      </div>
      <Icon name="next" size={18} />
    </div>
  )
}

/**
 * The files in one release, which is the question the version step left over.
 *
 * B goes back to the versions rather than out of the dialog: this is a step in
 * a flow now, and the same press that arrives here by accident should undo
 * exactly that.
 */
function AssetPicker({
  emulatorName,
  release,
  error,
  onPick,
  onBack
}: {
  emulatorName: string
  release: EmulatorRelease
  error: string | null
  onPick: (asset: EmulatorAsset) => void
  onBack: () => void
}): JSX.Element {
  const { t } = useI18n()
  useAction('back', onBack)

  return (
    <Overlay title={`${emulatorName} ${release.name || release.tag}`} icon="package">
      {error ? <div className="notice notice--error">{error}</div> : null}
      <p className="muted">{t('install.whichBuild')}</p>

      <div className="release-list">
        {release.assets.map((asset, index) => (
          <AssetRow
            key={asset.url}
            asset={asset}
            onSelect={() => onPick(asset)}
            autoFocus={index === 0}
          />
        ))}
      </div>

      <div className="btn-row">
        <FocusButton icon="previous" variant="ghost" onSelect={onBack}>
          {t('install.otherVersions')}
        </FocusButton>
      </div>
    </Overlay>
  )
}

/**
 * One downloadable file.
 *
 * The name is the whole content of the decision, so it gets a row of its own
 * and wraps rather than being ellipsised — these run to fifty characters and
 * differ only near the end.
 */
function AssetRow({
  asset,
  onSelect,
  autoFocus
}: {
  asset: EmulatorAsset
  onSelect: () => void
  autoFocus: boolean
}): JSX.Element {
  const { t, formatBytes } = useI18n()
  const { ref, props } = useFocusable({
    onSelect,
    autoFocus,
    actionLabel: t('install.chooseBuild')
  })

  return (
    <div ref={ref as Ref<HTMLDivElement>} className="release" {...props}>
      <div className="release__body">
        <div className="release__name release__name--file">{asset.name}</div>
        {/* Eden's release API reports zero for every asset, so this is left out
            rather than printed as "0 B". */}
        {asset.sizeBytes > 0 ? (
          <div className="release__meta">{formatBytes(asset.sizeBytes)}</div>
        ) : null}
      </div>
      <Icon name="download" size={18} />
    </div>
  )
}
