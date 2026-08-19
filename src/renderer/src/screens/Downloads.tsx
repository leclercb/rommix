import type { DownloadItem, InstalledRom } from '@shared/types'
import {
  CoverArt,
  FocusButton,
  Hints,
  Overlay,
  Spinner,
  SystemIcon,
  Tabs,
  formatBytes
} from '../components'
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

/** The two jobs this screen does, split so neither buries the other. */
type Tab = 'activity' | 'device'

/**
 * How the games on disk are ordered — which is a separate question from whether
 * they are grouped by system, and was wrong to fold into one control. Grouping
 * is a shape; this is an order, and every order is worth having in both shapes.
 */
type SortMode = 'recent' | 'largest' | 'name'

const SORTS: { id: SortMode; label: string }[] = [
  { id: 'recent', label: 'Recently added' },
  { id: 'largest', label: 'Largest first' },
  { id: 'name', label: 'Name' }
]

/** Order two games by the chosen rule. Used flat and inside each group. */
function compare(a: InstalledRom, b: InstalledRom, sort: SortMode): number {
  if (sort === 'largest') return b.sizeBytes - a.sizeBytes
  if (sort === 'name') return (a.name || a.fileName).localeCompare(b.name || b.fileName)
  return b.installedAt.localeCompare(a.installedAt)
}

/**
 * How many rows a flat order shows before asking.
 *
 * The same trick the library uses for the server: render a page, add another on
 * request. It bounds what a sort of four hundred games costs to draw without
 * needing the focus layer to understand rows that are not mounted.
 */
const FLAT_PAGE = 40

/** Is this transfer still going? */
function isActive(item: DownloadItem): boolean {
  return item.state === 'queued' || item.state === 'downloading' || item.state === 'extracting'
}

/** Transfer queue plus everything currently on local disk. */
export function DownloadsScreen(): JSX.Element {
  const { downloads, installed, navigate, notify, refreshInstalled, settings } = useApp()
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<{ checked: number; total: number } | null>(null)
  const [confirming, setConfirming] = useState<InstalledRom | null>(null)
  // Whatever is moving right now is why the screen was opened; with nothing in
  // flight, it was opened to look at what is on the disk.
  const [tab, setTab] = useState<Tab>(() => (downloads.some(isActive) ? 'activity' : 'device'))
  const [sort, setSort] = useState<SortMode>('recent')
  const [grouped, setGrouped] = useState(true)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [shown, setShown] = useState(FLAT_PAGE)

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
    } catch {
      // Reported centrally on `app:error`; the spinner still has to stop.
    } finally {
      setSyncing(false)
      setProgress(null)
    }
  }

  const active = downloads.filter(isActive)
  const finished = downloads.filter(
    (item) => item.state === 'done' || item.state === 'error' || item.state === 'cancelled'
  )

  const totalOnDisk = installed.reduce((sum, item) => sum + item.sizeBytes, 0)

  /**
   * Grouped by platform, each group ordered by the current sort.
   *
   * The groups themselves follow the same rule, so the order means the same
   * thing at both levels: largest first puts the platform eating the most disk
   * at the top, and recently added leads with the system you last downloaded
   * to. Ordering groups one way while ordering their contents another is how
   * "sorted by size" ends up showing a small platform first.
   */
  const byPlatform = useMemo(() => {
    const groups = new Map<string, InstalledRom[]>()
    for (const entry of installed) {
      const group = groups.get(entry.system)
      if (group) group.push(entry)
      else groups.set(entry.system, [entry])
    }
    for (const group of groups.values()) group.sort((a, b) => compare(a, b, sort))

    const weight = (entries: InstalledRom[]): number =>
      sort === 'largest' ? entries.reduce((sum, entry) => sum + entry.sizeBytes, 0) : entries.length

    return [...groups.entries()].sort(([systemA, a], [systemB, b]) => {
      if (sort === 'name') return a[0].platformName.localeCompare(b[0].platformName)
      // Newest first for `recent`, since each group is already sorted and its
      // first entry is therefore its most recent install.
      if (sort === 'recent') return compare(a[0], b[0], 'recent')
      return weight(b) - weight(a) || systemA.localeCompare(systemB)
    })
  }, [installed, sort])

  /** The same games in one list, for when grouping is off. */
  const flat = useMemo(
    () => [...installed].sort((a, b) => compare(a, b, sort)),
    [installed, sort]
  )

  const cycleSort = (): void => {
    const next = SORTS[(SORTS.findIndex((option) => option.id === sort) + 1) % SORTS.length]
    setSort(next.id)
    // A new order starts at the top: keeping the previous count would leave
    // "Largest first" showing 200 rows because the last order had been paged.
    setShown(FLAT_PAGE)
  }

  const toggleGroup = (system: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(system)) next.add(system)
      return next
    })
  }

  const remove = async (entry: InstalledRom): Promise<void> => {
    setConfirming(null)
    try {
      await window.rommix.downloads.uninstall(entry.romId)
      await refreshInstalled()
      notify('Uninstalled', 'ok', {
        title: entry.name,
        coverPath: entry.coverPath
      })
    } catch {
      // Reported centrally; this only keeps "Uninstalled" from being claimed.
    }
  }

  return (
    <div className="content">
      <h1 className="page-title">Downloads</h1>
      <p className="page-subtitle">
        {installed.length} game{installed.length === 1 ? '' : 's'} on disk · {formatBytes(totalOnDisk)}
      </p>

      {/* Two jobs, two tabs. Watching a transfer and managing a full disk are
          different errands, and a library of hundreds buried the first under
          the second. */}
      <Tabs
        tabs={[
          { id: 'activity', label: 'Activity', badge: active.length > 0 ? active.length : undefined },
          { id: 'device', label: 'On this device' }
        ]}
        active={tab}
        onChange={setTab}
      />

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

      {tab === 'activity' ? (
        <>
          {active.length === 0 && finished.length === 0 ? (
            <div className="empty">Nothing transferring. Pick a game and press Download.</div>
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
        </>
      ) : (
        <>
          <div className="btn-row">
            <FocusButton onSelect={cycleSort} disabled={installed.length === 0}>
              Sort: {SORTS.find((option) => option.id === sort)?.label}
            </FocusButton>
            <FocusButton
              onSelect={() => setGrouped((current) => !current)}
              disabled={installed.length === 0}
            >
              {grouped ? 'Grouped by system' : 'One flat list'}
            </FocusButton>
            <FocusButton onSelect={() => void sync()} disabled={syncing}>
              {syncing ? 'Checking…' : 'Sync with disk'}
            </FocusButton>
          </div>

          {installed.length === 0 ? (
            <div className="empty">Nothing downloaded yet. Pick a game and press Download.</div>
          ) : grouped ? (
            byPlatform.map(([system, entries]) => (
              <PlatformGroup
                key={system}
                system={system}
                entries={entries}
                open={expanded.has(system)}
                onToggle={() => toggleGroup(system)}
                onOpenGame={(entry) => navigate({ name: 'detail', romId: entry.romId })}
                onRemove={(entry) =>
                  settings?.confirmUninstall === false ? void remove(entry) : setConfirming(entry)
                }
              />
            ))
          ) : (
            <>
              {flat.slice(0, shown).map((entry) => (
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
              {flat.length > shown ? (
                <div className="btn-row">
                  <FocusButton onSelect={() => setShown((count) => count + FLAT_PAGE)}>
                    Show {Math.min(FLAT_PAGE, flat.length - shown)} more of {flat.length}
                  </FocusButton>
                </div>
              ) : null}
            </>
          )}
        </>
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
          { key: 'A', label: tab === 'device' && grouped ? 'Open · Expand' : 'Open' },
          { key: 'LB', label: 'Previous tab' },
          { key: 'RB', label: 'Next tab' },
          { key: 'B', label: 'Back' }
        ]}
      />
    </div>
  )
}

/**
 * One platform, collapsed to a single row until asked.
 *
 * Closed, a library of four hundred games is fifteen rows — which is the whole
 * point: on a D-pad the only way past a row is through it, so every game that
 * is on screen and not being looked for is a button press spent. The header
 * carries what the group is worth answering without opening it (how many, how
 * much disk), so the collapsed view is useful on its own rather than being a
 * lid over the useful thing.
 */
function PlatformGroup({
  system,
  entries,
  open,
  onToggle,
  onOpenGame,
  onRemove
}: {
  system: string
  entries: InstalledRom[]
  open: boolean
  onToggle: () => void
  onOpenGame: (entry: InstalledRom) => void
  onRemove: (entry: InstalledRom) => void
}): JSX.Element {
  const { ref, props } = useFocusable({ onSelect: onToggle })
  const size = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0)

  return (
    <section className="group">
      <div ref={ref as Ref<HTMLDivElement>} className="group__header" data-open={open} {...props}>
        <span className="group__chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <SystemIcon system={system} size={30} />
        <span className="group__name">{entries[0].platformName}</span>
        <span className="group__meta">
          {entries.length} game{entries.length === 1 ? '' : 's'} · {formatBytes(size)}
        </span>
      </div>

      {open
        ? entries.map((entry) => (
            <InstalledRow
              key={entry.romId}
              entry={entry}
              onSelect={() => onOpenGame(entry)}
              // The same rule as the detail screen: this button is one A press
              // away from deleting a game, so it asks unless the user has
              // turned confirmation off.
              onRemove={() => onRemove(entry)}
            />
          ))
        : null}
    </section>
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

