import type { MessageKey } from '@shared/i18n'
import type { DownloadItem, InstalledRom } from '@shared/types'
import {
  CoverArt,
  DownloadBadge,
  DownloadBar,
  FocusButton,
  Hints,
  Overlay,
  Spinner,
  SystemIcon,
  Tabs
} from '../../components'
import { Icon } from '../../icons'
import { useFocusable } from '../../input/focus'
import { useApp, useDownloads, useI18n } from '../../state'
import { useEffect, useMemo, useState, type JSX, type Ref } from 'react'

/** The two jobs this screen does, split so neither buries the other. */
type Tab = 'activity' | 'device'

/**
 * How the games on disk are ordered — which is a separate question from whether
 * they are grouped by system, and was wrong to fold into one control. Grouping
 * is a shape; this is an order, and every order is worth having in both shapes.
 */
type SortMode = 'recent' | 'largest' | 'name'

const SORTS = [
  { id: 'recent', label: 'downloads.sort.recent' },
  { id: 'largest', label: 'downloads.sort.largest' },
  { id: 'name', label: 'downloads.sort.name' }
] as const satisfies readonly { id: SortMode; label: MessageKey }[]

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

/**
 * Is this transfer still going, or waiting to?
 *
 * A paused one counts: it is not finished, and this is the list the user comes
 * to when they want to finish it. See `DownloadState`.
 */
function isActive(item: DownloadItem): boolean {
  return (
    item.state === 'queued' ||
    item.state === 'downloading' ||
    item.state === 'extracting' ||
    item.state === 'paused'
  )
}

/** Transfer queue plus everything currently on local disk. */
export function DownloadsScreen(): JSX.Element {
  const { t, formatBytes } = useI18n()
  const { installed, navigate, notify, refreshInstalled, settings } = useApp()
  const downloads = useDownloads()
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
      if (result.adopted > 0) parts.push(t('downloads.syncFound', { count: result.adopted }))
      if (result.removed > 0) parts.push(t('downloads.syncRemoved', { count: result.removed }))
      notify(
        parts.length > 0
          ? parts.join(' · ')
          : t('downloads.syncUnchanged', { count: result.checked })
      )
    } catch {
      // Reported centrally on `app:error`; the spinner still has to stop.
    } finally {
      setSyncing(false)
      setProgress(null)
    }
  }

  const active = downloads.filter(isActive)
  /**
   * The row at the front of the run order, which is what a promoted transfer
   * moves in front of — and which is not always the one on the wire, since a
   * resumed transfer is queued where it already sits. See
   * `DownloadManager.promote`.
   */
  const front = downloads.find((item) => item.state === 'queued' || item.state === 'downloading')
  /** The transfer that runs next, which has only the wire left to overtake. */
  const firstWaiting = downloads.find((item) => item.state === 'queued')?.romId
  /**
   * Whether pressing it starts the game straight away or only moves it up.
   *
   * What is on the wire is interrupted to let another past — unless it cannot
   * be resumed, in which case interrupting it would throw away everything it
   * has fetched, and the promoted game takes the turn after instead. Two
   * outcomes, so two words: a button that said "now" and meant "next" would be
   * the one thing worse than not having it.
   */
  const interrupts = downloads.find((item) => item.state === 'downloading')?.resumable !== false
  /**
   * Would moving this transfer up do anything?
   *
   * Anything waiting can overtake what waits ahead of it. The transfer that
   * runs next has nothing waiting ahead of it, only what is on the wire — so
   * its button is worth offering exactly when that gives way, which a transfer
   * that cannot be resumed does not.
   */
  const promotable = (item: DownloadItem): boolean =>
    item.state === 'queued' &&
    (item.romId !== firstWaiting || (front?.state === 'downloading' && front.resumable !== false))
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
  const flat = useMemo(() => [...installed].sort((a, b) => compare(a, b, sort)), [installed, sort])

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
      notify(t('downloads.uninstalled'), 'ok', {
        title: entry.name,
        coverPath: entry.coverPath
      })
    } catch {
      // Reported centrally; this only keeps "Uninstalled" from being claimed.
    }
  }

  return (
    <div className="content">
      <h1 className="page-title">{t('nav.downloads')}</h1>
      <p className="page-subtitle">
        {t('downloads.onDisk', { count: installed.length, size: formatBytes(totalOnDisk) })}
      </p>

      {/* Two jobs, two tabs. Watching a transfer and managing a full disk are
          different errands, and a library of hundreds buried the first under
          the second. */}
      <Tabs
        tabs={[
          {
            id: 'activity',
            label: t('downloads.tabActivity'),
            icon: 'download',
            badge: active.length > 0 ? active.length : undefined
          },
          { id: 'device', label: t('downloads.tabDevice'), icon: 'device' }
        ]}
        active={tab}
        onChange={setTab}
      />

      {syncing ? (
        <Overlay title={t('downloads.checkingTitle')}>
          <p className="muted">
            {progress
              ? t('downloads.checkedOf', { checked: progress.checked, total: progress.total })
              : t('downloads.askingRomM')}
          </p>
          <p className="faint" style={{ fontSize: 13 }}>
            {t('downloads.checkExplainer')}
          </p>
          <Spinner />
        </Overlay>
      ) : null}

      {tab === 'activity' ? (
        <>
          {active.length === 0 && finished.length === 0 ? (
            <div className="empty">{t('downloads.nothingTransferring')}</div>
          ) : null}

          {active.length > 0 ? (
            <>
              <h2 className="section-title">{t('downloads.inProgress')}</h2>
              {active.map((item) => (
                <ProgressRow
                  key={item.romId}
                  item={item}
                  onSelect={() => navigate({ name: 'game', romId: item.romId })}
                  onCancel={() => void window.rommix.downloads.cancel(item.romId)}
                  onPause={() => void window.rommix.downloads.pause(item.romId)}
                  onResume={() => void window.rommix.downloads.start(item.romId)}
                  onNext={
                    promotable(item)
                      ? () => void window.rommix.downloads.promote(item.romId)
                      : undefined
                  }
                  interrupts={interrupts}
                />
              ))}
            </>
          ) : null}

          {finished.length > 0 ? (
            <>
              <h2 className="section-title">{t('downloads.recent')}</h2>
              {finished.map((item) => (
                <ProgressRow
                  key={item.romId}
                  item={item}
                  onSelect={() => navigate({ name: 'game', romId: item.romId })}
                />
              ))}
              <div className="btn-row">
                <FocusButton
                  icon="clear"
                  onSelect={() => {
                    // Counted before the call: the list is what is about to be
                    // emptied, and afterwards there is nothing left to count.
                    const cleared = finished.length
                    void window.rommix.downloads
                      .clearFinished()
                      .then(() => notify(t('downloads.cleared', { count: cleared })))
                  }}
                >
                  {t('downloads.clearFinished')}
                </FocusButton>
              </div>
            </>
          ) : null}
        </>
      ) : (
        <>
          <div className="btn-row">
            <FocusButton icon="sort" onSelect={cycleSort} disabled={installed.length === 0}>
              {t('downloads.sortBy', {
                mode: t(SORTS.find((option) => option.id === sort)?.label ?? SORTS[0].label)
              })}
            </FocusButton>
            <FocusButton
              icon="group"
              onSelect={() => setGrouped((current) => !current)}
              disabled={installed.length === 0}
            >
              {t('downloads.groupBySystem', {
                value: grouped ? t('value.yesTitle') : t('value.noTitle')
              })}
            </FocusButton>
            <FocusButton icon="refresh" onSelect={() => void sync()} disabled={syncing}>
              {syncing ? t('action.checking') : t('downloads.syncWithDisk')}
            </FocusButton>
          </div>

          {installed.length === 0 ? (
            <div className="empty">{t('downloads.nothingDownloaded')}</div>
          ) : grouped ? (
            byPlatform.map(([system, entries]) => (
              <PlatformGroup
                key={system}
                system={system}
                entries={entries}
                open={expanded.has(system)}
                onToggle={() => toggleGroup(system)}
                onOpenGame={(entry) => navigate({ name: 'game', romId: entry.romId })}
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
                  onSelect={() => navigate({ name: 'game', romId: entry.romId })}
                  // The same rule as the game screen: this button is one A
                  // press away from deleting a game, so it asks unless the user
                  // has turned confirmation off.
                  onRemove={() =>
                    settings?.confirmUninstall === false ? void remove(entry) : setConfirming(entry)
                  }
                />
              ))}
              {flat.length > shown ? (
                <div className="btn-row">
                  <FocusButton icon="more" onSelect={() => setShown((count) => count + FLAT_PAGE)}>
                    {t('downloads.showMore', {
                      count: Math.min(FLAT_PAGE, flat.length - shown),
                      total: flat.length
                    })}
                  </FocusButton>
                </div>
              ) : null}
            </>
          )}
        </>
      )}

      {confirming ? (
        <Overlay title={t('uninstall.title')}>
          <p className="muted">
            {t('uninstall.body', {
              file: confirming.fileName,
              folder: confirming.path.replace(/\/[^/]*$/, '')
            })}
          </p>
          <div className="btn-row">
            <FocusButton icon="keep" onSelect={() => setConfirming(null)} autoFocus>
              {t('action.keep')}
            </FocusButton>
            <FocusButton icon="uninstall" variant="danger" onSelect={() => void remove(confirming)}>
              {t('uninstall.freeing', { size: formatBytes(confirming.sizeBytes) })}
            </FocusButton>
          </div>
        </Overlay>
      ) : null}

      <Hints
        items={[
          {
            key: 'A',
            label: tab === 'device' && grouped ? t('downloads.openExpand') : t('action.open')
          },
          // Row actions are reached sideways, which is worth saying: walking
          // down a list never passes through them.
          { key: '→', label: t('action.rowActions') },
          { key: 'LB', label: t('action.previousTab') },
          { key: 'RB', label: t('action.nextTab') },
          { key: 'B', label: t('action.back') }
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
  const { t, formatBytes } = useI18n()
  const { ref, props } = useFocusable({
    onSelect: onToggle,
    actionLabel: open ? t('action.collapse') : t('action.expand')
  })
  const size = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0)

  return (
    <section className="group">
      <div ref={ref as Ref<HTMLDivElement>} className="group__header" data-open={open} {...props}>
        <span className="group__chevron">
          <Icon name={open ? 'collapse' : 'expand'} size={16} />
        </span>
        <SystemIcon system={system} size={30} />
        <span className="group__name">{entries[0].platformName}</span>
        <span className="group__meta">
          {t('downloads.groupMeta', { count: entries.length, size: formatBytes(size) })}
        </span>
      </div>

      {open
        ? entries.map((entry) => (
            <InstalledRow
              key={entry.romId}
              entry={entry}
              onSelect={() => onOpenGame(entry)}
              // The same rule as the game screen: this button is one A press
              // away from deleting a game, so it asks unless the user has
              // turned confirmation off.
              onRemove={() => onRemove(entry)}
            />
          ))
        : null}
    </section>
  )
}

/**
 * One transfer.
 *
 * Selecting the row opens the game, the same as everywhere else in the app.
 * Cancelling is a labelled button of its own: it used to be what the row itself
 * did, so pressing A on a download in progress — the obvious thing to do to a
 * thing you are watching — threw away the transfer with nothing on screen
 * saying that it would.
 */
function ProgressRow({
  item,
  onSelect,
  onCancel,
  onPause,
  onResume,
  onNext,
  interrupts = true
}: {
  item: DownloadItem
  onSelect: () => void
  onCancel?: () => void
  onPause?: () => void
  onResume?: () => void
  /** Offered only where it would change the order. See `DownloadManager.promote`. */
  onNext?: () => void
  /** Whether pressing that starts this game now or only moves it up the queue. */
  interrupts?: boolean
}): JSX.Element {
  const { t, formatBytes } = useI18n()
  const { ref, props } = useFocusable({ onSelect, actionLabel: t('action.open') })
  const percent = item.totalBytes > 0 ? Math.round((item.receivedBytes / item.totalBytes) * 100) : 0
  const paused = item.state === 'paused'
  const resumable = paused && onResume !== undefined
  /**
   * Whether Pause is a thing this transfer can honestly offer.
   *
   * Extracting is out because unpacking an archive is nobody's to interrupt
   * half-way. A ROM the server cannot send in pieces is out for a better
   * reason: pausing it would lose everything transferred, which is what Cancel
   * is for — two buttons for one outcome, one of them lying about it.
   */
  const stoppable =
    onPause !== undefined &&
    item.resumable !== false &&
    (item.state === 'downloading' || item.state === 'queued')
  // The column the buttons need is added for the buttons there actually are,
  // not for one of them: a row that only offers Resume needs it just as much.
  const acts = Boolean(onCancel) || resumable || stoppable || Boolean(onNext)

  return (
    <div
      ref={ref as Ref<HTMLDivElement>}
      className={`download download--row ${acts ? 'download--action' : ''}`}
      {...props}
    >
      <div className="download__art">
        <CoverArt path={item.coverPath} name={item.name} />
      </div>
      {/* The game over what is happening to it, in two lines of one column.
          Everything here is text that can run long — a game's name, a platform,
          the file of a disc set on the wire — so it is the part that gives way,
          and the figures and buttons beside it keep their place. */}
      <div className="download__text">
        <span className="download__name">{item.name}</span>
        <span className="download__facts">
          <span className="download__fact">
            <SystemIcon system={item.system} size={16} />
            {item.platformName}
          </span>
          {/* Said rather than left to be inferred from a missing button. */}
          {item.state === 'downloading' && item.resumable === false ? (
            <span className="download__fact">{t('downloads.notResumable')}</span>
          ) : null}
          {/* Which of a disc set's files is on the wire, which is the only
              thing that moves through twenty minutes of the same bar. Only
              while one actually is: a transfer that has stopped is not
              halfway through anything. */}
          {item.state === 'downloading' && item.currentFile ? (
            <span className="download__fact download__fact--file">
              <Icon name="file" size={13} />
              <span className="download__filename">{item.currentFile}</span>
            </span>
          ) : null}
        </span>
      </div>
      {/* The state and how far it has got, together and to the right — the two
          things that change, where they can be read down the list without the
          words beside them moving anything sideways. */}
      <div className="download__figures">
        <DownloadBadge state={item.state} />
        {item.state === 'downloading' || paused ? (
          <span className="download__size">
            {formatBytes(item.receivedBytes)} / {formatBytes(item.totalBytes)}
          </span>
        ) : null}
      </div>
      {acts ? (
        <div className="download__actions">
          {/* First, because it is the one that decides what the other two are
              about: a small game moved past a large one is the difference
              between playing it now and pausing something to get at it. */}
          {onNext ? (
            <FocusButton icon="next" onSelect={onNext}>
              {interrupts ? t('downloads.now') : t('downloads.next')}
            </FocusButton>
          ) : null}
          {resumable ? (
            <FocusButton icon="download" onSelect={onResume}>
              {t('action.resume')}
            </FocusButton>
          ) : null}
          {stoppable ? (
            <FocusButton icon="pause" onSelect={onPause}>
              {t('action.pause')}
            </FocusButton>
          ) : null}
          {onCancel ? (
            <FocusButton icon="cancel" variant="danger" onSelect={onCancel}>
              {t('action.cancel')}
            </FocusButton>
          ) : null}
        </div>
      ) : null}
      <DownloadBar state={item.state} percent={percent} />
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
  const { t, formatBytes } = useI18n()
  const { ref, props } = useFocusable({ onSelect, actionLabel: t('action.open') })
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
          {files.length > 1 ? (
            <span>· {t('downloads.fileCount', { count: files.length })}</span>
          ) : null}
        </div>
        <ul className="installed__files">
          {files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      </div>

      <div className="installed__actions">
        <FocusButton icon="uninstall" variant="danger" onSelect={onRemove}>
          {t('action.uninstall')}
        </FocusButton>
      </div>
    </div>
  )
}
