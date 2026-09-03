import type { MessageKey } from '@shared/i18n'
import { isStopped, type DownloadItem, type InstalledRom } from '@shared/types'
import { FocusButton, Hints, Overlay, PageTitle, Spinner, Tabs } from '../../components'
import { useApp, useDownloads, useI18n } from '../../state'
import { startedMessage } from '../Game/useGameCopy'
import { useEffect, useMemo, useState, type JSX } from 'react'
import { fileNameOf } from '@shared/gamefiles'
import { InstalledRow } from './InstalledRow'
import { PlatformGroup } from './PlatformGroup'
import { ProgressRow } from './ProgressRow'

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
  if (sort === 'name')
    return (a.name || fileNameOf(a.path)).localeCompare(b.name || fileNameOf(b.path))
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
    isStopped(item.state)
  )
}

/** Transfer queue plus everything currently on local disk. */
export function DownloadsScreen(): JSX.Element {
  const { t, formatBytes } = useI18n()
  const { installed, navigate, notify, offline, refreshInstalled, settings } = useApp()
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
   * The three things a transfer can be doing, each under its own heading.
   *
   * One list held all of them, in the order the queue happened to be in, and it
   * read as a jumble: the game actually arriving could be the last row on the
   * screen, below two that had been stopped hours ago. What is on the wire is
   * what the screen is opened for, so it goes first and by itself; what is
   * waiting is a line, and its order is the order it will run in; what is
   * paused is a pile, and its order means nothing.
   */
  const running = active.filter(
    (item) => item.state === 'downloading' || item.state === 'extracting'
  )
  const waiting = active.filter((item) => item.state === 'queued')
  const paused = active.filter((item) => item.state === 'paused')
  const stalled = active.filter((item) => item.state === 'stalled')
  /** The four, in the order they are drawn, each labelled with its own badge. */
  const sections: { key: MessageKey; items: DownloadItem[] }[] = [
    { key: 'downloads.state.downloading', items: running },
    { key: 'downloads.state.queued', items: waiting },
    // Its own heading rather than folded in with the paused: these are not
    // waiting on anybody, and a row under "Paused" that starts by itself a
    // moment later is a heading that was wrong about both.
    { key: 'downloads.state.stalled', items: stalled },
    { key: 'downloads.state.paused', items: paused }
  ]
  /**
   * Whether what has the wire would give it up.
   *
   * A transfer that cannot be resumed would lose everything it has fetched, and
   * an archive being unpacked is nobody's to interrupt half-way; both are left
   * alone, and the promoted game takes the turn after instead.
   */
  const gives = running[0]?.state === 'downloading' && running[0].resumable !== false
  /**
   * Whether pressing it starts the game straight away or only moves it up.
   *
   * Two outcomes, so two words: a button that said "now" and meant "next" would
   * be the one thing worse than not having it.
   */
  const interrupts = running.length === 0 || gives
  /**
   * Would moving this transfer up do anything?
   *
   * It has to have something to get past: a game waiting ahead of it, or a
   * transfer on the wire that gives way. A paused game counts as much as a
   * queued one — resuming it puts it at the back of the queue, which is the
   * right default and the wrong one for the game being waited on.
   */
  const promotable = (item: DownloadItem): boolean =>
    (item.state === 'queued' || isStopped(item.state)) &&
    (gives || (waiting.length > 0 && waiting[0].romId !== item.romId))
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

  /**
   * Pick a stopped transfer up again, and say where it landed.
   *
   * Said from here rather than from the queue watcher: what the press did is
   * in the answer it came back with, and a game promoted to the front passes
   * through 'queued' on its way to the wire — announced off that state, it was
   * reported as waiting while it downloaded. See `startedMessage`.
   */
  const resume = async (item: DownloadItem): Promise<void> => {
    try {
      const started = await window.rommix.downloads.start(item.romId)
      notify(t(startedMessage(started, true)), 'ok', {
        title: started.name,
        coverPath: started.coverPath
      })
    } catch {
      // Reported centrally on `app:error`.
    }
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
      <PageTitle icon="downloads">{t('nav.downloads')}</PageTitle>
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
        <Overlay title={t('downloads.checkingTitle')} icon="refresh">
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

          {/* Each heading is the badge its rows carry, which is the point: the
              section says what is happening to everything under it, and the
              row is still readable on its own if it is read on its own. */}
          {sections.map(({ key, items }) =>
            items.length > 0 ? (
              <section key={key}>
                <h2 className="section-title">{t(key)}</h2>
                {items.map((item) => (
                  <ProgressRow
                    key={item.romId}
                    item={item}
                    onSelect={() => navigate({ name: 'game', romId: item.romId })}
                    onCancel={() => void window.rommix.downloads.cancel(item.romId)}
                    onPause={() => void window.rommix.downloads.pause(item.romId)}
                    onResume={() => void resume(item)}
                    onNext={
                      promotable(item)
                        ? () => void window.rommix.downloads.promote(item.romId)
                        : undefined
                    }
                    interrupts={interrupts}
                  />
                ))}
              </section>
            ) : null
          )}

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
            <FocusButton
              icon="sort"
              action="sort-by"
              onSelect={cycleSort}
              disabled={installed.length === 0}
            >
              {t('downloads.sortBy', {
                mode: t(SORTS.find((option) => option.id === sort)?.label ?? SORTS[0].label)
              })}
            </FocusButton>
            <FocusButton
              icon="group"
              action="group-by-system"
              onSelect={() => setGrouped((current) => !current)}
              disabled={installed.length === 0}
            >
              {t('downloads.groupBySystem', {
                value: grouped ? t('value.yesTitle') : t('value.noTitle')
              })}
            </FocusButton>
            {/* The one control here that is purely a question for RomM: it
                walks the whole server library. Everything else on this screen
                is about files on this disk, or about a transfer that is
                already allowed to stop and wait for one. */}
            <FocusButton
              icon="refresh"
              action="sync-with-disk"
              onSelect={() => void sync()}
              disabled={syncing || offline === true}
            >
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
        <Overlay title={t('uninstall.title')} icon="uninstall">
          <p className="muted">
            {t('uninstall.body', { folder: confirming.path.replace(/\/[^/]*$/, '') })}
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
