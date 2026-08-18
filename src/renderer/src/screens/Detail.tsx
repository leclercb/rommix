import { type JSX, useEffect, useState } from 'react'
import type { InstalledRom, RommRom } from '@shared/types'
import { CoverArt, FocusButton, Hints, Spinner, formatBytes } from '../components'
import { useApp } from '../state'

/**
 * A single game: artwork, metadata, and the actions that matter — download it,
 * play it, remove it.
 */
export function DetailScreen({ romId }: { romId: number }): JSX.Element {
  const { installed, downloads, runningRomId, goBack, notify, refreshInstalled } = useApp()

  const [rom, setRom] = useState<RommRom | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setRom(null)
    void window.rommix.library
      .rom(romId)
      .then(setRom)
      .catch((cause: Error) => setError(cause.message))
  }, [romId])

  const entry: InstalledRom | undefined = installed.find((item) => item.romId === romId)
  const download = downloads.find((item) => item.romId === romId)
  const active = download?.state === 'downloading' || download?.state === 'queued' || download?.state === 'extracting'
  const running = runningRomId === romId

  const startDownload = async (): Promise<void> => {
    setBusy(true)
    try {
      const item = await window.rommix.downloads.start(romId)
      // Already on disk: the main process adopts it instead of queueing, so
      // saying "download started" would be a plain lie.
      notify(item.state === 'done' ? 'Already downloaded' : 'Download started')
    } catch (cause) {
      notify((cause as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const play = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.rommix.game.launch(romId)
      if (!result.ok) {
        notify(result.error ?? 'The game could not be started', 'error')
      } else {
        const synced = result.uploadedSaves + result.uploadedStates
        notify(
          synced > 0
            ? `Session ended — ${synced} save file${synced === 1 ? '' : 's'} sent to RomM`
            : 'Session ended',
          result.error ? 'warn' : 'ok'
        )
        if (result.error) notify(result.error, 'warn')
      }
    } catch (cause) {
      notify((cause as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const uninstall = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.rommix.downloads.uninstall(romId)
      await refreshInstalled()
      notify('Removed from local storage')
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
            <span className="chip">{rom.platform_display_name}</span>
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
          <FocusButton variant="primary" onSelect={() => void play()} disabled={busy || running} autoFocus>
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

        {entry ? (
          <FocusButton variant="danger" onSelect={() => void uninstall()} disabled={busy || running}>
            Remove download
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

      <h2 className="section-title">Details</h2>
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
          </>
        ) : null}
      </dl>

      {running ? (
        <div className="notice notice--warn">
          The game is running. RomMix will sync your saves back to RomM when you quit the emulator.
        </div>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: entry ? 'Play' : 'Download' },
          { key: 'B', label: 'Back' }
        ]}
      />
    </div>
  )
}
