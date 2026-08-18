import type { DownloadItem, InstalledRom } from '@shared/types'
import { CoverArt, FocusButton, Hints, PlatformBadge, formatBytes } from '../components'
import { useFocusable } from '../input/focus'
import { useApp } from '../state'
import { useMemo, type JSX, type Ref } from 'react'

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
  const { downloads, installed, navigate, notify, refreshInstalled } = useApp()

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
    try {
      await window.rommix.downloads.uninstall(entry.romId)
      await refreshInstalled()
      notify('Uninstalled', 'ok', {
        title: entry.name || entry.fileName,
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
              <PlatformBadge system={system} />
              {entries[0].platformName || system} · {entries.length} game
              {entries.length === 1 ? '' : 's'} ·{' '}
              {formatBytes(entries.reduce((sum, entry) => sum + entry.sizeBytes, 0))}
            </h3>
            {entries.map((entry) => (
              <InstalledRow
                key={entry.romId}
                entry={entry}
                onSelect={() => navigate({ name: 'detail', romId: entry.romId })}
                onRemove={() => void remove(entry)}
              />
            ))}
          </section>
        ))
      )}

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
        {item.platformName || item.system} · {STATE_LABELS[item.state]}
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
 * One installed game.
 *
 * Shows the game's name rather than its filename — the two were previously the
 * same string printed twice, once as a title and once inside the path — with
 * the cover for recognition and every file the game is made of underneath, so
 * a multi-disc set is visibly more than one file.
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
  // Entries written before these fields existed still have to render.
  const title = entry.name || entry.fileName
  const files = entry.files?.length ? entry.files : [entry.fileName]

  return (
    <div ref={ref as Ref<HTMLDivElement>} className="installed" {...props}>
      <div className="installed__art">
        <CoverArt path={entry.coverPath ?? null} name={title} />
      </div>

      <div className="installed__body">
        <div className="installed__title">{title}</div>
        <div className="installed__meta">
          <PlatformBadge system={entry.system} />
          <span>{entry.platformName || entry.system}</span>
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

