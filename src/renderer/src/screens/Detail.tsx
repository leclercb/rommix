import { type JSX, useCallback, useEffect, useState } from 'react'
import { resolveSystem } from '@config/systems'
import type { InstalledRom, LaunchChoice, RemoteAsset, RommRom } from '@shared/types'
import {
  CoverArt,
  FocusButton,
  Hints,
  Overlay,
  Spinner,
  PlatformIcon,
  Tabs,
  formatBytes
} from '../components'
import { useApp } from '../state'

type DetailTab = 'about' | 'saves' | 'files' | 'screenshots'

/**
 * A single game: artwork, metadata, and the actions that matter — download it,
 * play it, remove it.
 */
export function DetailScreen({ romId }: { romId: number }): JSX.Element {
  const { installed, downloads, runningRomId, goBack, notify, refreshInstalled, settings } =
    useApp()

  const [rom, setRom] = useState<RommRom | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [choosing, setChoosing] = useState<LaunchChoice | null>(null)
  const [tab, setTab] = useState<DetailTab>('about')
  const [assets, setAssets] = useState<RemoteAsset[] | null>(null)

  useEffect(() => {
    setRom(null)
    setTab('about')
    void window.rommix.library
      .rom(romId)
      .then(setRom)
      .catch((cause: Error) => setError(cause.message))
  }, [romId])

  /**
   * What RomM holds for this game, refetched after every pull or push so the
   * list is never one action out of date.
   */
  const loadAssets = useCallback(async (): Promise<void> => {
    setAssets(await window.rommix.saves.list(romId).catch(() => []))
  }, [romId])

  useEffect(() => {
    setAssets(null)
    void loadAssets()
  }, [loadAssets])

  const entry: InstalledRom | undefined = installed.find((item) => item.romId === romId)
  const download = downloads.find((item) => item.romId === romId)
  const active = download?.state === 'downloading' || download?.state === 'queued' || download?.state === 'extracting'
  const running = runningRomId === romId

  // Only to decide whether "Run with…" is worth showing. The launch path asks
  // again rather than trusting this, since the emulator for a platform can be
  // changed from Settings while this screen is open.
  const [variants, setVariants] = useState<LaunchChoice['options']>([])
  useEffect(() => {
    if (!entry) {
      setVariants([])
      return
    }
    void window.rommix.game
      .variants(romId)
      .then((choice) => setVariants(choice.options))
      .catch(() => setVariants([]))
  }, [romId, entry?.emulatorId, entry?.system])

  const startDownload = async (): Promise<void> => {
    setBusy(true)
    try {
      const item = await window.rommix.downloads.start(romId)
      // Already on disk: the main process adopts it instead of queueing, so
      // saying "download started" would be a plain lie.
      notify(item.state === 'done' ? 'Already downloaded' : 'Download started', 'ok', {
        title: item.name,
        coverPath: item.coverPath
      })
    } catch (cause) {
      notify((cause as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Play, asking first when the emulator offers more than one way to run this
   * system and the user has not already said which.
   *
   * EmuDeck ships three Saturn cores and four Switch emulators; picking one
   * silently would be a guess, and the wrong guess is a game that will not
   * start or a save written where the other emulator will not find it. The
   * answer is remembered per platform, so this is asked once.
   */
  const startPlay = async (): Promise<void> => {
    setBusy(true)
    try {
      const choice = await window.rommix.game.variants(romId)
      if (choice.options.length > 1 && !choice.chosen) {
        setChoosing(choice)
        return
      }
      await play(choice.chosen ?? undefined)
    } catch (cause) {
      notify((cause as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const play = async (variant?: string): Promise<void> => {
    setChoosing(null)
    setBusy(true)
    try {
      const result = await window.rommix.game.launch(romId, variant)
      const subject = {
        title: rom?.name ?? rom?.fs_name ?? 'Game',
        coverPath: rom?.path_cover_small ?? rom?.path_cover_large ?? null
      }
      if (!result.ok) {
        notify(result.error ?? 'The game could not be started', 'error', subject)
      } else {
        const synced = result.uploadedSaves + result.uploadedStates
        notify(
          synced > 0
            ? `Session ended — ${synced} save file${synced === 1 ? '' : 's'} sent to RomM`
            : 'Session ended',
          result.error ? 'warn' : 'ok',
          subject
        )
        if (result.error) notify(result.error, 'warn')
      }
    } catch (cause) {
      notify((cause as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Move saves by hand, in either direction.
   *
   * The automatic sync happens around a launch, which leaves two real gaps
   * this fills: a save made on another device is not wanted *now* unless the
   * game is about to be played here, and a save made before RomMix was
   * installed is never picked up at all, because the post-session push only
   * looks at what the session wrote.
   */
  const syncSaves = async (direction: 'pull' | 'push'): Promise<void> => {
    setBusy(true)
    try {
      const result =
        direction === 'pull'
          ? await window.rommix.saves.pull(romId)
          : await window.rommix.saves.push(romId)
      const subject = {
        title: rom?.name ?? rom?.fs_name ?? 'Game',
        coverPath: rom?.path_cover_small ?? rom?.path_cover_large ?? null
      }

      if (result.skippedReason) {
        notify(result.skippedReason, 'warn', subject)
      } else {
        const moved = result.saves + result.states
        notify(
          moved === 0
            ? direction === 'pull'
              ? 'Nothing newer on RomM'
              : 'No local saves to send'
            : `${moved} file${moved === 1 ? '' : 's'} ${direction === 'pull' ? 'downloaded' : 'sent to RomM'}`,
          'ok',
          subject
        )
      }
      await loadAssets()
    } catch (cause) {
      notify((cause as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** Re-open the picker for a platform that has already been answered. */
  const openChooser = async (): Promise<void> => {
    try {
      setChoosing(await window.rommix.game.variants(romId))
    } catch (cause) {
      notify((cause as Error).message, 'error')
    }
  }

  const uninstall = async (): Promise<void> => {
    setConfirmingRemoval(false)
    setBusy(true)
    try {
      await window.rommix.downloads.uninstall(romId)
      await refreshInstalled()
      notify('Uninstalled', 'ok', {
        title: rom?.name ?? entry?.fileName ?? 'Game',
        coverPath: rom?.path_cover_small ?? rom?.path_cover_large ?? null
      })
    } catch (cause) {
      notify((cause as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="content">
        <div className="notice notice--error">{error}</div>
        <div className="btn-row">
          <FocusButton onSelect={goBack} autoFocus>
            Back
          </FocusButton>
        </div>
      </div>
    )
  }

  if (!rom) {
    return (
      <div className="content">
        <Spinner />
      </div>
    )
  }

  const title = rom.name ?? rom.fs_name
  // The installed entry knows the system for certain; for a game that is not
  // downloaded it is worked out from the platform, exactly as a download would.
  const system = entry?.system ?? resolveSystem(rom.platform_slug, rom.platform_fs_slug, settings?.systemOverrides)
  const year = rom.metadatum.first_release_date
    ? new Date(rom.metadatum.first_release_date * 1000).getFullYear()
    : null
  const progress = download && download.totalBytes > 0
    ? Math.round((download.receivedBytes / download.totalBytes) * 100)
    : 0

  return (
    <div className="content">
      <div className="hero">
        <div className="hero__art">
          <CoverArt path={rom.path_cover_large ?? rom.path_cover_small} name={title} />
        </div>
        <div>
          <h1 className="hero__title">{title}</h1>
          <div className="hero__meta">
            <span className="chip chip--icon">
              <PlatformIcon
                slug={rom.platform_slug}
                system={system}
                size={20}
                label={rom.platform_display_name}
              />
              {rom.platform_display_name}
            </span>
            {year ? <span className="chip">{year}</span> : null}
            <span className="chip">{formatBytes(rom.fs_size_bytes)}</span>
            {entry ? <span className="chip chip--on">Downloaded</span> : null}
            {rom.metadatum.genres.slice(0, 3).map((genre) => (
              <span className="chip" key={genre}>
                {genre}
              </span>
            ))}
          </div>
          {rom.summary ? <p className="hero__summary">{rom.summary}</p> : null}
        </div>
      </div>

      <div className="btn-row">
        {entry ? (
          <FocusButton
            variant="primary"
            onSelect={() => void startPlay()}
            disabled={busy || running}
            autoFocus
          >
            {running ? 'Running…' : 'Play'}
          </FocusButton>
        ) : active ? (
          <FocusButton variant="danger" onSelect={() => void window.rommix.downloads.cancel(romId)} autoFocus>
            Cancel download ({progress}%)
          </FocusButton>
        ) : (
          <FocusButton variant="primary" onSelect={() => void startDownload()} disabled={busy} autoFocus>
            Download
          </FocusButton>
        )}

        {/* The way back to a choice already made: without it, a platform
            answered once could only be changed by editing settings. Shown only
            where there is genuinely more than one answer. */}
        {entry && variants.length > 1 ? (
          <FocusButton
            onSelect={() => void openChooser()}
            disabled={busy || running}
          >
            Run with…
          </FocusButton>
        ) : null}

        {/* Only for a game that is here: there is no local save directory to
            read from or write into until the ROM has been downloaded. */}
        {entry ? (
          <>
            <FocusButton onSelect={() => void syncSaves('pull')} disabled={busy || running}>
              Pull saves
            </FocusButton>
            <FocusButton onSelect={() => void syncSaves('push')} disabled={busy || running}>
              Push saves
            </FocusButton>
          </>
        ) : null}

        {entry ? (
          <FocusButton
            variant="danger"
            onSelect={() =>
              // Without the confirmation, one A press on a focused danger
              // button deletes a multi-gigabyte download outright.
              settings?.confirmUninstall === false ? void uninstall() : setConfirmingRemoval(true)
            }
            disabled={busy || running}
          >
            Uninstall
          </FocusButton>
        ) : null}

        <FocusButton variant="ghost" onSelect={goBack}>
          Back
        </FocusButton>
      </div>

      {active ? (
        <div className="download">
          <span className="download__name">
            {download?.state === 'extracting' ? 'Extracting…' : 'Downloading…'}
          </span>
          <span className="download__state">
            {formatBytes(download?.receivedBytes ?? 0)} / {formatBytes(download?.totalBytes ?? 0)}
          </span>
          <div className="download__bar">
            <div className="download__fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}

      {download?.state === 'error' && download.error ? (
        <div className="notice notice--error">{download.error}</div>
      ) : null}

      {/* Tabs rather than one long column: saves, files and screenshots are
          each a list that can run to dozens of rows, and stacking them put the
          thing you came for several screens of scrolling down. */}
      <Tabs<DetailTab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'about', label: 'About' },
          { id: 'saves', label: 'Saves', badge: assets?.length },
          { id: 'files', label: 'Files', badge: rom.files.length || undefined },
          {
            id: 'screenshots',
            label: 'Screenshots',
            badge: rom.merged_screenshots?.length || undefined
          }
        ]}
      />

      {tab === 'about' ? <About rom={rom} entry={entry} /> : null}
      {tab === 'saves' ? <SavesTab assets={assets} entry={entry} /> : null}
      {tab === 'files' ? <FilesTab rom={rom} entry={entry} /> : null}
      {tab === 'screenshots' ? <ScreenshotsTab rom={rom} /> : null}

      {running ? (
        <div className="notice notice--warn">
          The game is running. RomMix will sync your saves back to RomM when you quit the emulator.
        </div>
      ) : null}

      {choosing ? (
        <Overlay title={`How should ${choosing.system} games run?`}>
          <p className="muted">
            {choosing.emulatorName} can run this platform in more than one way, and which is best
            depends on the game. RomMix remembers your answer for {choosing.system} — change it
            later with Run with…
          </p>
          <div className="btn-row">
            {choosing.options.map((option) => (
              <FocusButton
                key={option.id}
                variant={option.id === choosing.chosen ? 'primary' : 'default'}
                onSelect={() => void play(option.id)}
                autoFocus={option.id === (choosing.chosen ?? choosing.options[0].id)}
              >
                {option.label}
                {option.note ? ` · ${option.note}` : ''}
              </FocusButton>
            ))}
          </div>
          <div className="btn-row">
            <FocusButton variant="ghost" onSelect={() => setChoosing(null)}>
              Cancel
            </FocusButton>
          </div>
        </Overlay>
      ) : null}

      {confirmingRemoval && entry ? (
        <Overlay title="Uninstall this game?">
          <p className="muted">
            {entry.fileName} will be deleted from {entry.path.replace(/\/[^/]*$/, '')}. Your saves
            on RomM are not touched, and you can download it again at any time.
          </p>
          <div className="btn-row">
            <FocusButton onSelect={() => setConfirmingRemoval(false)} autoFocus>
              Keep it
            </FocusButton>
            <FocusButton variant="danger" onSelect={() => void uninstall()}>
              Uninstall, freeing {formatBytes(entry.sizeBytes)}
            </FocusButton>
          </div>
        </Overlay>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: entry ? 'Play' : 'Download' },
          { key: 'LB', label: 'Previous tab' },
          { key: 'RB', label: 'Next tab' },
          { key: 'B', label: 'Back' }
        ]}
      />
    </div>
  )
}

function About({ rom, entry }: { rom: RommRom; entry?: InstalledRom }): JSX.Element {
  return (
    <dl className="kv">
      <dt>File</dt>
      <dd>{rom.fs_name}</dd>
      <dt>Size</dt>
      <dd>{formatBytes(rom.fs_size_bytes)}</dd>
      {rom.metadatum.companies.length > 0 ? (
        <>
          <dt>Company</dt>
          <dd>{rom.metadatum.companies.join(', ')}</dd>
        </>
      ) : null}
      {rom.regions.length > 0 ? (
        <>
          <dt>Region</dt>
          <dd>{rom.regions.join(', ')}</dd>
        </>
      ) : null}
      {rom.rom_user.last_played ? (
        <>
          <dt>Last played</dt>
          <dd>{new Date(rom.rom_user.last_played).toLocaleString()}</dd>
        </>
      ) : null}
      {entry ? (
        <>
          <dt>Installed to</dt>
          <dd>{entry.path}</dd>
          <dt>System folder</dt>
          <dd>{entry.system}</dd>
          {/* Which emulator's library holds this copy. It is the reason a game
              can be on disk and still offered as a download: pointing the
              platform elsewhere does not move the file. */}
          <dt>Downloaded for</dt>
          <dd>{entry.emulatorId}</dd>
        </>
      ) : null}
    </dl>
  )
}

/**
 * Saves and states held by RomM.
 *
 * Both kinds in one list rather than two: they answer the same question — what
 * of mine is on the server, and how recent is it — and a save and its state
 * from the same session belong next to each other.
 */
function SavesTab({
  assets,
  entry
}: {
  assets: RemoteAsset[] | null
  entry?: InstalledRom
}): JSX.Element {
  if (!assets) return <Spinner />
  if (assets.length === 0) {
    return (
      <div className="empty">
        RomM has no saves for this game yet.
        {entry ? ' Press Push saves to send what is on this device.' : ''}
      </div>
    )
  }

  return (
    <ul className="asset-list">
      {assets.map((asset) => (
        <li key={`${asset.kind}-${asset.id}`}>
          <span className="asset__kind" data-kind={asset.kind}>
            {asset.kind === 'save' ? 'Save' : 'State'}
          </span>
          <span className="asset__name">{asset.fileName}</span>
          <span className="asset__meta">
            {formatBytes(asset.sizeBytes)}
            {asset.emulator ? ` · ${asset.emulator}` : ''} ·{' '}
            {new Date(asset.updatedAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The files the game is made of, on the server and on this device.
 *
 * Both, because they are not always the same: RomM zips a multi-file game for
 * transport and RomMix unpacks it, so a two-file cue+bin on the server is two
 * files in a directory here — and a game whose local copy has lost a track is
 * a thing you can only see by comparing the two.
 */
function FilesTab({ rom, entry }: { rom: RommRom; entry?: InstalledRom }): JSX.Element {
  const local = entry?.files?.length ? entry.files : entry ? [entry.fileName] : []

  return (
    <>
      <h3 className="section-title" style={{ fontSize: 17 }}>
        On the server
      </h3>
      {rom.files.length === 0 ? (
        <div className="empty">RomM lists no files for this game.</div>
      ) : (
        <ul className="asset-list">
          {rom.files.map((file) => (
            <li key={file.id}>
              <span className="asset__name">{file.file_name}</span>
              <span className="asset__meta">{formatBytes(file.file_size_bytes)}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-title" style={{ fontSize: 17 }}>
        On this device
      </h3>
      {local.length === 0 ? (
        <div className="empty">Not downloaded.</div>
      ) : (
        <ul className="asset-list">
          {local.map((file) => (
            <li key={file}>
              <span className="asset__name">{file}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ScreenshotsTab({ rom }: { rom: RommRom }): JSX.Element {
  const shots = rom.merged_screenshots ?? []
  if (shots.length === 0) {
    return <div className="empty">RomM has no screenshots for this game.</div>
  }
  return (
    <div className="shots">
      {shots.map((path) => (
        <img
          key={path}
          className="shot"
          src={window.rommix.system.imageUrl(path) ?? undefined}
          alt=""
          loading="lazy"
        />
      ))}
    </div>
  )
}
