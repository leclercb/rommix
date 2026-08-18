import type { DownloadItem, InstalledRom } from '@shared/types'
import { CoverArt, FocusButton, Hints, Overlay, Spinner, SystemIcon, formatBytes } from '../components'
import { useFocusable } from '../input/focus'
import { useApp } from '../state'
import { useEffect, useMemo, useState, type JSX, type Ref } from 'react'

const STATE_LABELS: Record<DownloadItem['state'], string> = {
  queued: 'Waiting',
  downloading: 'Downloading',
  extracting: 'Extracting',
  done: 'Installed',
  error: 'Failed',
  cancelled: 'Cancelled'
}

/** Transfer queue plus everything currently on local disk. */
export function DownloadsScreen(): JSX.Element {
  const { downloads, installed, navigate, notify, refreshInstalled, settings } = useApp()
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<{ checked: number; total: number } | null>(null)
  const [confirming, setConfirming] = useState<InstalledRom | null>(null)

  useEffect(() => window.rommix.library.onSyncProgress(setProgress), [])

  /**
   * Check the list against the disk.
   *
   * RomMix reconciles as you browse, which only ever covers the games a screen
   * has loaded — so a ROM deleted with a file manager keeps its Play button
   * until you happen to open that library page again, and a ROM copied in by
   * hand is offered as a download. This walks the whole library once and
   * settles both.
   */
  const sync = async (): Promise<void> => {
    setSyncing(true)
    setProgress(null)
    try {
      const result = await window.rommix.library.sync()
      await refreshInstalled()
      const parts: string[] = []
      if (result.adopted > 0) parts.push(`${result.adopted} found on disk`)
      if (result.removed > 0) parts.push(`${result.removed} no longer there`)
      notify(
        parts.length > 0
          ? parts.join(' · ')
          : `${result.checked} game${result.checked === 1 ? '' : 's'} checked — nothing changed`
      )
    } catch (cause) {
      notify((cause as Error).message, 'error')
    } finally {
      setSyncing(false)
      setProgress(null)
    }
  }

  const active = downloads.filter(
    (item) => item.state === 'queued' || item.state === 'downloading' || item.state === 'extracting'
  )
  const finished = downloads.filter(
    (item) => item.state === 'done' || item.state === 'error' || item.state === 'cancelled'
  )

  const totalOnDisk = installed.reduce((sum, item) => sum + item.sizeBytes, 0)

  /**
   * Grouped by platform, biggest group first, newest install first within each.
   * A flat list of everything on disk stops being readable the moment a library
   * is more than a couple of screens long.
   */
  const byPlatform = useMemo(() => {
    const groups = new Map<string, InstalledRom[]>()
    for (const entry of installed) {
      const group = groups.get(entry.system)
      if (group) group.push(entry)
      else groups.set(entry.system, [entry])
    }
    for (const group of groups.values()) {
      group.sort((a, b) => b.installedAt.localeCompare(a.installedAt))
    }
    return [...groups.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
    )
  }, [installed])

  const remove = async (entry: InstalledRom): Promise<void> => {
    setConfirming(null)
    try {
      await window.rommix.downloads.uninstall(entry.romId)
      await refreshInstalled()
      notify('Uninstalled', 'ok', {
        title: entry.name,
        coverPath: entry.coverPath
      })
    } catch (cause) {
      notify((cause as Error).message, 'error')
    }
  }

  return (
    <div className="content">
      <h1 className="page-title">Downloads</h1>
      <p className="page-subtitle">
        {installed.length} game{installed.length === 1 ? '' : 's'} on disk · {formatBytes(totalOnDisk)}
      </p>

      <div className="btn-row">
        <FocusButton onSelect={() => void sync()} disabled={syncing}>
          {syncing ? 'Checking…' : 'Sync with disk'}
        </FocusButton>
      </div>

      {syncing ? (
        <Overlay title="Checking your library">
          <p className="muted">
            {progress
              ? `${progress.checked} of ${progress.total} games checked`
              : 'Asking RomM what you have…'}
          </p>
          <p className="faint" style={{ fontSize: 13 }}>
            Every game on the server is compared against the folder it would be installed in.
          </p>
          <Spinner />
        </Overlay>
      ) : null}

      {active.length > 0 ? (
        <>
          <h2 className="section-title">In progress</h2>
          {active.map((item) => (
            <ProgressRow
              key={item.romId}
              item={item}
              onSelect={() => void window.rommix.downloads.cancel(item.romId)}
            />
          ))}
        </>
      ) : null}

      {finished.length > 0 ? (
        <>
          <h2 className="section-title">Recent</h2>
          {finished.map((item) => (
            <ProgressRow
              key={item.romId}
              item={item}
              onSelect={() => navigate({ name: 'detail', romId: item.romId })}
            />
          ))}
          <div className="btn-row">
            <FocusButton onSelect={() => void window.rommix.downloads.clearFinished()}>
              Clear finished
            </FocusButton>
          </div>
        </>
      ) : null}

      <h2 className="section-title">On this device</h2>
      {installed.length === 0 ? (
        <div className="empty">Nothing downloaded yet. Pick a game and press Download.</div>
      ) : (
        byPlatform.map(([system, entries]) => (
          <section key={system}>
            <h3 className="section-title installed__group" style={{ fontSize: 17 }}>
              <SystemIcon system={system} size={30} />
              {entries[0].platformName} · {entries.length} game
              {entries.length === 1 ? '' : 's'} ·{' '}
              {formatBytes(entries.reduce((sum, entry) => sum + entry.sizeBytes, 0))}
            </h3>
            {entries.map((entry) => (
              <InstalledRow
                key={entry.romId}
                entry={entry}
                onSelect={() => navigate({ name: 'detail', romId: entry.romId })}
                // The same rule as the detail screen: this button is one A
                // press away from deleting a game, so it asks unless the user
                // has turned confirmation off.
                onRemove={() =>
                  settings?.confirmUninstall === false ? void remove(entry) : setConfirming(entry)
                }
              />
            ))}
          </section>
        ))
      )}

      {confirming ? (
        <Overlay title="Uninstall this game?">
          <p className="muted">
            {confirming.fileName} will be deleted from{' '}
            {confirming.path.replace(/\/[^/]*$/, '')}. Your saves on RomM are not touched, and you
            can download it again at any time.
          </p>
          <div className="btn-row">
            <FocusButton onSelect={() => setConfirming(null)} autoFocus>
              Keep it
            </FocusButton>
            <FocusButton variant="danger" onSelect={() => void remove(confirming)}>
              Uninstall, freeing {formatBytes(confirming.sizeBytes)}
            </FocusButton>
          </div>
        </Overlay>
      ) : null}

      <Hints
        items={[
          { key: 'A', label: 'Open' },
          { key: 'B', label: 'Back' }
        ]}
      />
    </div>
  )
}

function ProgressRow({
  item,
  onSelect
}: {
  item: DownloadItem
  onSelect: () => void
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect })
  const percent = item.totalBytes > 0 ? Math.round((item.receivedBytes / item.totalBytes) * 100) : 0

  return (
    <div ref={ref as Ref<HTMLDivElement>} className="download" {...props}>
      <div className="download__art">
        <CoverArt path={item.coverPath} name={item.name} />
      </div>
      <span className="download__name">{item.name}</span>
      <span className="download__state">
        <SystemIcon system={item.system} size={18} />
        {item.platformName} · {STATE_LABELS[item.state]}
        {item.state === 'downloading'
          ? ` · ${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`
          : ''}
      </span>
      <div className="download__bar" style={{ gridColumn: '2 / -1' }}>
        <div
          className="download__fill"
          style={{
            width: `${item.state === 'done' ? 100 : percent}%`,
            background: item.state === 'error' ? 'var(--danger)' : undefined
          }}
        />
      </div>
      {item.error ? <span className="download__state faint">{item.error}</span> : null}
    </div>
  )
}

/**
 * One installed game: the name RomM knows it by, its cover for recognition, and
 * every file it is made of underneath, so a multi-disc set is visibly more than
 * one file.
 */
function InstalledRow({
  entry,
  onSelect,
  onRemove
}: {
  entry: InstalledRom
  onSelect: () => void
  onRemove: () => void
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect })
  const title = entry.name
  const files = entry.files

  return (
    <div ref={ref as Ref<HTMLDivElement>} className="installed" {...props}>
      <div className="installed__art">
        <CoverArt path={entry.coverPath ?? null} name={title} />
      </div>

      <div className="installed__body">
        <div className="installed__title">{title}</div>
        <div className="installed__meta">
          <SystemIcon system={entry.system} size={22} />
          <span>{entry.platformName}</span>
          <span>·</span>
          <span>{formatBytes(entry.sizeBytes)}</span>
          {files.length > 1 ? <span>· {files.length} files</span> : null}
        </div>
        <ul className="installed__files">
          {files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      </div>

      <div className="installed__actions">
        <FocusButton variant="danger" onSelect={onRemove}>
          Uninstall
        </FocusButton>
      </div>
    </div>
  )
}

